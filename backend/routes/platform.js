import express from "express";
import crypto from "node:crypto";
import Bus from "../models/Bus.js";
import Trip from "../models/Trip.js";
import Ticket from "../models/Ticket.js";
import Passenger from "../models/Passenger.js";
import Admin from "../models/Admin.js";
import Notification from "../models/Notification.js";
import { Activity, audit } from "../models/Activity.js";
import {
  requireAuth,
  requireStaff,
  requireAdmin,
  guardId,
  isObjectId,
  Session,
  clearSession,
  rateLimit,
  hashToken,
} from "../security.js";
import { validCoordinates, proximityState } from "../../shared/proximity.js";
import { farePointForRoute } from "../../shared/fareMatrix.js";

const router = express.Router();
export function reservationIsEligible(ticket, now = Date.now()) {
  return (
    ticket.status === "active" &&
    (!ticket.expiresAt || new Date(ticket.expiresAt).getTime() > now)
  );
}
export function ownsTicket(auth, ticket) {
  return Boolean(
    auth &&
    (["staff", "admin"].includes(auth.role) ||
      String(ticket.passengerId) === String(auth.userId)),
  );
}
function safeUser(user) {
  const value = user.toObject();
  for (const key of Object.keys(value))
    if (/password|TokenHash|Expires/.test(key)) delete value[key];
  return value;
}
function ticketView(ticket, bus, trip, passenger, publicView = false) {
  const t = ticket.toObject ? ticket.toObject() : ticket;
  return {
    id: t._id,
    bookingReference: t.bookingReference || String(t._id),
    ticketNumber: t.qrCode,
    qrCode: t.qrCode,
    tripId: t.tripId,
    busId: bus?.busId || "Unassigned",
    busName: bus?.name,
    from: t.from,
    to: t.to,
    routeTo: t.routeTo,
    seatId: t.seatId,
    passengerIdentifier: publicView
      ? t.passengerId
        ? String(t.passengerId).slice(-6)
        : "Walk-up passenger"
      : passenger?.name || "Walk-up passenger",
    passengerType:
      t.categoryVerified || t.eligibilityDeclared ? t.passengerType : "regular",
    categoryVerified: Boolean(t.categoryVerified),
    departureAt: t.departureAt || trip?.departureAt || null,
    createdAt: t.createdAt,
    confirmedAt: t.confirmedAt || t.createdAt,
    status:
      t.status === "active" && !reservationIsEligible(t)
        ? "expired"
        : t.status === "active"
          ? "confirmed"
          : t.status === "used"
            ? "completed"
            : t.status,
    fare: t.fare,
    expiresAt: t.expiresAt,
    printState: t.printState || "ready",
    printedAt: t.printedAt,
    pickup: trip?.pickup || null,
    dropoffLocation: t.dropoffLocation,
  };
}
router.get("/session", async (req, res) => {
  if (!req.auth) return res.json({ user: null });
  const model = req.auth.role === "passenger" ? Passenger : Admin;
  const user = await model.findById(req.auth.userId);
  if (!user) {
    clearSession(res);
    return res.json({ user: null });
  }
  res.json({ user: safeUser(user), role: req.auth.role });
});
router.post("/logout", async (req, res) => {
  if (req.auth) await Session.deleteOne({ _id: req.auth._id });
  clearSession(res);
  res.json({ ok: true });
});

router.get("/trips", async (req, res) => {
  const filter = {};
  if (req.query.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
      return res.status(400).json({ error: "Invalid trip date." });
    const start = new Date(`${req.query.date}T00:00:00+08:00`);
    if (!Number.isFinite(start.getTime()))
      return res.status(400).json({ error: "Invalid trip date." });
    filter.departureAt = {
      $gte: start,
      $lt: new Date(start.getTime() + 86400000),
    };
  } else filter.departureAt = { $gte: new Date(Date.now() - 86400000) };
  if (req.query.busId) filter.busId = req.query.busId;
  const trips = await Trip.find(filter)
    .populate("busId", "busId name")
    .sort({ departureAt: 1 })
    .limit(300)
    .lean();
  const tickets = await Ticket.find({
    tripId: { $in: trips.map((t) => t._id) },
    status: "active",
  })
    .select("tripId seatId")
    .lean();
  const values = trips.map((t) => {
    const taken = new Set(
      tickets
        .filter((x) => String(x.tripId) === String(t._id))
        .map((x) => x.seatId),
    );
    return {
      ...t,
      availableSeatIds: t.seatIds.filter((id) => !taken.has(id)),
      reservationOpen:
        ["scheduled", "boarding"].includes(t.status) &&
        new Date(t.departureAt) > new Date(),
    };
  });
  res.json(values);
});
router.post("/trips", requireStaff, async (req, res) => {
  const {
    busId,
    from,
    to,
    departureAt,
    arrivalAt,
    durationMinutes,
    seatIds,
    pickup,
    routeId,
  } = req.body;
  if (
    !isObjectId(busId) ||
    typeof from !== "string" ||
    typeof to !== "string" ||
    !from.trim() ||
    !to.trim()
  )
    return res
      .status(400)
      .json({ error: "Choose a valid bus, origin and destination." });
  if (
    durationMinutes !== undefined &&
    durationMinutes !== null &&
    (!Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > 2880)
  )
    return res.status(400).json({
      error: "Duration must be between 1 and 2880 minutes, or left blank.",
    });
  const bus = await Bus.findById(busId);
  if (!bus) return res.status(404).json({ error: "Bus not found." });
  const departure = new Date(departureAt),
    arrival = arrivalAt ? new Date(arrivalAt) : null;
  if (
    !from ||
    !to ||
    !Number.isFinite(departure.getTime()) ||
    departure <= new Date() ||
    (arrival && (!Number.isFinite(arrival.getTime()) || arrival <= departure))
  )
    return res.status(400).json({
      error:
        "Specify the route, future departure and a later arrival if known.",
    });
  if (
    !Array.isArray(seatIds) ||
    !seatIds.length ||
    new Set(seatIds).size !== seatIds.length ||
    seatIds.some(
      (id) => !Number.isInteger(id) || !bus.seats.some((s) => s.id === id),
    )
  )
    return res.status(400).json({
      error: "Configure a verified list of reservable seat IDs for this trip.",
    });
  if (pickup && !validCoordinates(pickup.lat, pickup.lon))
    return res.status(400).json({ error: "Pickup coordinates are invalid." });
  const trip = await Trip.create({
    busId,
    routeId: routeId || null,
    from,
    to,
    departureAt: departure,
    arrivalAt: arrival,
    durationMinutes: durationMinutes || null,
    seatIds,
    pickup,
  });
  await audit(req, "schedule.created", "success", { tripId: trip._id, busId });
  res.status(201).json(trip);
});
router.patch("/trips/:id", requireStaff, guardId, async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) return res.status(404).json({ error: "Trip not found." });
  const active = await Ticket.countDocuments({
    tripId: trip._id,
    status: "active",
  });
  if (["busId", "from", "to", "seatIds"].some((k) => req.body[k] !== undefined))
    return res.status(409).json({
      error:
        "Publish a replacement trip to change its bus, route, or seat inventory. Existing schedules retain their history.",
    });
  if (
    req.body.status &&
    !["scheduled", "boarding", "departed", "completed", "cancelled"].includes(
      req.body.status,
    )
  )
    return res.status(400).json({ error: "Invalid schedule status." });
  for (const key of ["departureAt", "arrivalAt"])
    if (req.body[key] !== undefined) {
      const date = new Date(req.body[key]);
      if (!Number.isFinite(date.getTime()))
        return res.status(400).json({ error: "Invalid date." });
      trip[key] = date;
    }
  if (trip.arrivalAt && trip.arrivalAt <= trip.departureAt)
    return res.status(400).json({ error: "Arrival must be after departure." });
  if (req.body.status) trip.status = req.body.status;
  await trip.save();
  if (trip.status === "cancelled" || trip.status === "completed")
    await Ticket.updateMany(
      { tripId: trip._id, status: "active" },
      { $set: { status: trip.status === "cancelled" ? "cancelled" : "used" } },
    );
  // Update ticket copies so receipts and expiry follow authorized timetable changes.
  await Ticket.updateMany(
    { tripId: trip._id, status: "active" },
    {
      $set: {
        departureAt: trip.departureAt,
        expiresAt:
          trip.arrivalAt ||
          new Date(
            trip.departureAt.getTime() +
              ((trip.durationMinutes || 1440) + 120) * 60000,
          ),
      },
    },
  );
  await audit(req, "schedule.updated", "success", {
    tripId: trip._id,
    busId: trip.busId,
  });
  res.json(trip);
});
router.get("/reservations", requireAuth, async (req, res) => {
  const filter =
    req.auth.role === "passenger" ? { passengerId: req.auth.userId } : {};
  if (req.query.busId) filter.busId = req.query.busId;
  const tickets = await Ticket.find(filter)
    .sort({ createdAt: -1 })
    .limit(300)
    .populate("busId")
    .populate("tripId")
    .populate("passengerId", "name");
  res.json(tickets.map((t) => ticketView(t, t.busId, t.tripId, t.passengerId)));
});
router.post("/reservations", requireAuth, rateLimit(20), async (req, res) => {
  const { tripId, seatId, to, dropoffLocation } = req.body;
  if (
    dropoffLocation &&
    !validCoordinates(dropoffLocation.lat, dropoffLocation.lon)
  )
    return res
      .status(400)
      .json({ error: "Choose valid numeric drop-off coordinates." });
  if (req.auth.role !== "passenger")
    return res.status(403).json({
      error: "Sign in to the passenger account to make a reservation.",
    });
  const passenger = await Passenger.findById(req.auth.userId);
  if (!passenger)
    return res.status(401).json({ error: "Passenger account unavailable." });
  const trip = await Trip.findById(tripId);
  if (
    !trip ||
    !["scheduled", "boarding"].includes(trip.status) ||
    trip.departureAt <= new Date()
  )
    return res
      .status(409)
      .json({ error: "This trip is unavailable for reservation." });
  if (!Number.isInteger(seatId) || !trip.seatIds.includes(seatId))
    return res
      .status(400)
      .json({ error: "Choose a reservable seat from this trip." });
  const fare = farePointForRoute(trip.from, trip.to, to);
  if (!fare)
    return res.status(400).json({
      error: "Select a destination from the configured route fare matrix.",
    });
  const bus = await Bus.findById(trip.busId);
  if (!bus)
    return res.status(409).json({ error: "The assigned bus is unavailable." });
  const passengerType = passenger.categoryVerified
    ? passenger.category
    : "regular";
  const printToken = crypto.randomBytes(32).toString("hex");
  const ticket = await Ticket.create({
    busId: bus._id,
    tripId: trip._id,
    passengerId: passenger._id,
    seatId,
    standing: false,
    passengerType,
    categoryVerified: passenger.categoryVerified,
    from: trip.from,
    routeTo: trip.to,
    to,
    distanceKm: fare.distanceKm,
    dropoffLocation: dropoffLocation || undefined,
    fare: passengerType === "regular" ? fare.regular : fare.discounted,
    qrCode: crypto.randomBytes(32).toString("hex"),
    bookingReference: `SM-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
    printTokenHash: hashToken(printToken),
    departureAt: trip.departureAt,
    expiresAt:
      trip.arrivalAt ||
      new Date(
        trip.departureAt.getTime() +
          ((trip.durationMinutes || 1440) + 120) * 60000,
      ),
  });
  // A schedule cancellation racing ticket insertion must not leave an active booking.
  const current = await Trip.findById(trip._id);
  if (!current || !["scheduled", "boarding"].includes(current.status)) {
    ticket.status = "cancelled";
    await ticket.save();
    return res.status(409).json({
      error:
        "The trip changed before confirmation. Your booking was cancelled.",
    });
  }
  await audit(req, "reservation.created", "success", {
    ticketId: ticket._id,
    tripId: trip._id,
    reference: ticket.bookingReference,
    busId: bus._id,
  });
  res.status(201).json(ticketView(ticket, bus, trip, passenger));
});
router.post(
  "/reservations/:id/cancel",
  requireAuth,
  guardId,
  async (req, res) => {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket || !ownsTicket(req.auth, ticket))
      return res.status(404).json({ error: "Reservation not found." });
    if (ticket.status !== "active")
      return res
        .status(409)
        .json({ error: "Only an active reservation can be cancelled." });
    if (
      ticket.departureAt &&
      ticket.departureAt <= new Date() &&
      req.auth.role === "passenger"
    )
      return res.status(409).json({
        error: "Contact staff to cancel a trip that has already departed.",
      });
    const changed = await Ticket.findOneAndUpdate(
      { _id: ticket._id, status: "active" },
      { $set: { status: "cancelled" } },
      { new: true },
    );
    if (!changed)
      return res
        .status(409)
        .json({ error: "Reservation status changed. Refresh and try again." });
    if (!ticket.tripId)
      await Bus.updateOne(
        { _id: ticket.busId, "seats.id": ticket.seatId },
        { $set: { "seats.$.status": "available" } },
      );
    await audit(req, "reservation.cancelled", "success", {
      ticketId: ticket._id,
      passengerId: ticket.passengerId,
      busId: ticket.busId,
      reference: ticket.bookingReference,
    });
    res.json({ ok: true });
  },
);
router.post("/verify", rateLimit(20), async (req, res) => {
  const { reference, source = "manual" } = req.body;
  if (
    typeof reference !== "string" ||
    !(
      /^[a-f\d]{64}$/i.test(reference) ||
      /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(reference)
    )
  )
    return res
      .status(400)
      .json({ error: "Enter the complete ticket number or scan its QR code." });
  const ticket = await Ticket.findOne({ qrCode: reference });
  if (!ticket) {
    await audit(req, "ticket.verification", "failure", {
      detail: "Unknown ticket",
    });
    return res.status(404).json({ error: "Ticket not found." });
  }
  if (!reservationIsEligible(ticket)) {
    await audit(req, "ticket.verification", "failure", {
      ticketId: ticket._id,
      reference: ticket.bookingReference,
      detail: "Ineligible ticket",
    });
    return res
      .status(409)
      .json({ error: "This ticket is cancelled, completed, or expired." });
  }
  const [bus, trip] = await Promise.all([
    Bus.findById(ticket.busId),
    ticket.tripId ? Trip.findById(ticket.tripId) : null,
  ]);
  if (trip?.status === "cancelled" || trip?.status === "completed")
    return res.status(409).json({ error: "The trip is no longer eligible." });
  await audit(
    req,
    source === "qr" ? "ticket.qr_verified" : "ticket.manual_verified",
    "success",
    {
      ticketId: ticket._id,
      reference: ticket.bookingReference,
      busId: ticket.busId,
      passengerId: ticket.passengerId,
    },
  );
  // Possession of a full unpredictable QR token authorizes this minimal kiosk view.
  // It never grants account access, cancellation, editing or passenger contact data.
  res.json(ticketView(ticket, bus, trip, null, true));
});
router.post(
  "/reservations/:id/complete",
  requireStaff,
  guardId,
  async (req, res) => {
    const ticket = await Ticket.findOneAndUpdate(
      {
        _id: req.params.id,
        status: "active",
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      },
      { $set: { status: "used" } },
      { new: true },
    );
    if (!ticket)
      return res.status(409).json({
        error: "Ticket is already used, cancelled, expired, or invalid.",
      });
    if (!ticket.tripId)
      await Bus.updateOne(
        { _id: ticket.busId, "seats.id": ticket.seatId },
        { $set: { "seats.$.status": "available" } },
      );
    await audit(req, "ticket.completed", "success", {
      ticketId: ticket._id,
      reference: ticket.bookingReference,
      passengerId: ticket.passengerId,
      busId: ticket.busId,
    });
    res.json({ ok: true });
  },
);
router.post("/receipt-authorization", rateLimit(10), async (req, res) => {
  if (
    typeof req.body.reference !== "string" ||
    !(
      /^[a-f\d]{64}$/i.test(req.body.reference) ||
      /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(req.body.reference)
    )
  )
    return res
      .status(400)
      .json({ error: "A complete valid ticket reference is required." });
  const ticket = await Ticket.findOne({ qrCode: req.body.reference });
  if (!ticket || !reservationIsEligible(ticket))
    return res.status(404).json({ error: "Valid ticket required." });
  if (ticket.printState === "printing" || ticket.printState === "uncertain")
    return res.status(409).json({
      error:
        "A previous print is pending or uncertain. Ask staff to check the printer.",
    });
  if (ticket.printedAt && !["staff", "admin"].includes(req.auth?.role))
    return res.status(403).json({
      error: "An authorized staff member must approve a receipt reprint.",
    });
  const token = crypto.randomBytes(32).toString("hex");
  // Do not invalidate an in-flight job while two kiosk requests race.
  const changed = await Ticket.findOneAndUpdate(
    { _id: ticket._id, printState: { $nin: ["printing", "uncertain"] } },
    { $set: { printTokenHash: hashToken(token), printState: "ready" } },
  );
  if (!changed)
    return res.status(409).json({ error: "A print job is already pending." });
  res.json({ ticketId: String(ticket._id), printToken: token });
});
router.get("/activity", requireAuth, async (req, res) => {
  const filter =
    req.auth.role === "passenger" ? { passengerId: req.auth.userId } : {};
  for (const key of ["event", "outcome", "reference", "busId"])
    if (req.query[key]) filter[key] = req.query[key];
  if (req.query.busId && !isObjectId(req.query.busId)) {
    const bus = await Bus.findOne({ busId: req.query.busId }).select("_id");
    if (!bus) return res.json([]);
    filter.busId = bus._id;
  }
  if (req.query.ticketNumber) {
    const t = await Ticket.findOne({ qrCode: req.query.ticketNumber });
    if (!t || !ownsTicket(req.auth, t)) return res.json([]);
    filter.ticketId = t._id;
  }
  if (req.query.start || req.query.end) {
    filter.createdAt = {};
    for (const [key, op] of [
      ["start", "$gte"],
      ["end", "$lte"],
    ])
      if (req.query[key]) {
        const date = new Date(req.query[key]);
        if (!Number.isFinite(date.getTime()))
          return res.status(400).json({ error: "Invalid activity date." });
        filter.createdAt[op] = date;
      }
  }
  res.json(
    await Activity.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .populate("busId", "busId")
      .lean(),
  );
});
router.post(
  "/reservations/:id/resolve-print",
  requireStaff,
  guardId,
  async (req, res) => {
    if (!["printed", "failed"].includes(req.body.outcome))
      return res.status(400).json({
        error: "Check the physical printer and select printed or failed.",
      });
    const ticket = await Ticket.findOneAndUpdate(
      { _id: req.params.id, printState: "uncertain" },
      {
        $set: {
          printState: req.body.outcome,
          ...(req.body.outcome === "printed" ? { printedAt: new Date() } : {}),
        },
      },
      { new: true },
    );
    if (!ticket)
      return res
        .status(409)
        .json({ error: "Only an uncertain print job can be resolved." });
    await audit(req, "receipt.resolved", "success", {
      ticketId: ticket._id,
      reference: ticket.bookingReference,
      passengerId: ticket.passengerId,
      busId: ticket.busId,
      detail: "Staff checked physical printer: " + req.body.outcome,
    });
    res.json({ ok: true });
  },
);
router.get("/tracking", requireAuth, async (req, res) => {
  let filter = {};
  if (req.auth.role === "passenger") {
    const tickets = await Ticket.find({
      passengerId: req.auth.userId,
      status: "active",
    }).select("busId");
    filter = { _id: { $in: tickets.map((t) => t.busId) } };
  }
  const buses = await Bus.find(filter).lean();
  res.json(
    buses.map((b) => ({
      ...proximityState(b),
      id: b._id,
      route: `${b.from} → ${b.to}`,
      targetCoordinates: b.proximityTarget,
      location: b.location,
      trackingEnabled: b.trackingEnabled,
      tripStatus: b.status,
      etaMin: b.etaMin,
      seats: (b.seats || []).map(
        ({ id, occupancy, sensor, sensorUpdatedAt, status }) => ({
          id,
          occupancy,
          sensor,
          sensorUpdatedAt,
          status,
        }),
      ),
    })),
  );
});
router.patch("/tracking/:id", requireAdmin, guardId, async (req, res) => {
  const { label, lat, lon, trackingEnabled } = req.body;
  if (!label || !validCoordinates(lat, lon))
    return res.status(400).json({
      error: "A label and valid numeric target coordinates are required.",
    });
  const bus = await Bus.findByIdAndUpdate(
    req.params.id,
    {
      $set: {
        proximityTarget: { label, lat, lon, thresholdMeters: 100 },
        trackingEnabled: trackingEnabled !== false,
        proximityInside: false,
      },
    },
    { new: true, runValidators: true },
  );
  if (!bus) return res.status(404).json({ error: "Bus not found." });
  await audit(req, "tracking.configured", "success", { busId: bus._id });
  res.json(proximityState(bus));
});
router.post(
  "/tracking/:id/device-key",
  requireAdmin,
  guardId,
  async (req, res) => {
    const token = crypto.randomBytes(32).toString("hex");
    const bus = await Bus.findByIdAndUpdate(req.params.id, {
      $set: { deviceTokenHash: hashToken(token) },
    });
    if (!bus) return res.status(404).json({ error: "Bus not found." });
    await audit(req, "tracking.key_rotated", "success", { busId: bus._id });
    res.json({ busId: bus.busId, deviceKey: token });
  },
);
export default router;
