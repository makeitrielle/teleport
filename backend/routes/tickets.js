import express from "express";
import crypto from "node:crypto";
import Ticket from "../models/Ticket.js";
import Bus from "../models/Bus.js";
import Trip from "../models/Trip.js";
import { farePointForRoute } from "../../shared/fareMatrix.js";
import {
  requireAuth,
  requireStaff,
  guardId,
  hashToken,
  rateLimit,
  isObjectId,
} from "../security.js";
import { audit } from "../models/Activity.js";
import { canUseSeat } from "../../shared/seatPolicy.js";
const router = express.Router();
router.get("/", requireAuth, async (req, res) => {
  const filter =
    req.auth.role === "passenger" ? { passengerId: req.auth.userId } : {};
  if (req.query.busId) filter.busId = req.query.busId;
  const tickets = await Ticket.find(filter).sort({ createdAt: -1 }).limit(300);
  res.json(tickets);
});
// Public kiosk data contains only the route and seat information needed to book.
router.get("/kiosk/buses", async (req, res) => {
  res.json(
    await Bus.find()
      .select("busId name from to totalSeats monitoredSeatIds seats")
      .sort({ createdAt: 1 })
      .lean(),
  );
});
router.post("/kiosk", rateLimit(20), (req, res, next) => {
  issueTicket(req, res, true).catch(next);
});
router.post("/", requireStaff, (req, res, next) => {
  issueTicket(req, res, false).catch(next);
});
async function issueTicket(req, res, selfService) {
  const {
    busId,
    seatId,
    passengerType = "regular",
    from,
    routeTo,
    to,
    distanceKm,
    dropoffLocation,
  } = req.body;
  if (req.body.standing)
    return res
      .status(400)
      .json({ error: "Standing reservations are no longer supported." });
  if (!["regular", "student", "pwd", "senior"].includes(passengerType))
    return res.status(400).json({ error: "Invalid passenger category." });
  if (
    passengerType !== "regular" &&
    (selfService
      ? req.body.eligibilityDeclared !== true
      : req.body.categoryVerified !== true)
  )
    return res.status(400).json({
      error: selfService
        ? "Confirm your eligibility for this passenger category."
        : "Staff must verify discount eligibility before issuing this category.",
    });
  if (
    !isObjectId(busId) ||
    !Number.isInteger(Number(seatId)) ||
    Number(seatId) < 1 ||
    (selfService && Number(seatId) > 61)
  )
    return res.status(400).json({ error: "Choose a valid bus and seat." });
  const bus = await Bus.findById(busId);
  if (!bus) return res.status(404).json({ error: "Bus not found." });
  if (!canUseSeat(bus, seatId, passengerType))
    return res.status(403).json({
      error: "First-row seats are reserved for PWD and senior passengers.",
    });
  // Keep physical walk-ups from bypassing a published scheduled seat allocation.
  if (
    await Trip.exists({
      busId: bus._id,
      status: { $in: ["scheduled", "boarding"] },
      departureAt: { $gt: new Date() },
    })
  )
    return res.status(409).json({
      error:
        "This bus uses published reservations. Reserve through its scheduled trip to avoid conflicting seat allocations.",
    });
  const fare = farePointForRoute(
    selfService ? bus.from : from || bus.from,
    selfService ? bus.to : routeTo || bus.to,
    to,
  );
  if (!fare || distanceKm !== fare.distanceKm)
    return res
      .status(400)
      .json({ error: "Choose a valid drop-off from the fare matrix." });
  const lat = dropoffLocation?.lat,
    lon = dropoffLocation?.lon;
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  )
    return res.status(400).json({ error: "A valid drop-off pin is required." });
  if (!bus.monitoredSeatIds.includes(Number(seatId)))
    return res.status(409).json({ error: "Seat sensor is unavailable." });
  const locked = await Bus.findOneAndUpdate(
    {
      _id: busId,
      seats: {
        $elemMatch: {
          id: Number(seatId),
          status: "available",
          sensor: "ok",
          occupancy: "available",
          sensorUpdatedAt: {
            $gte: Date.now() - 90000,
            $lte: Date.now() + 30000,
          },
        },
      },
    },
    { $set: { "seats.$.status": "booked" } },
    { new: true },
  );
  if (!locked)
    return res.status(409).json({
      error: "Seat is occupied, reserved, or its sensor data is stale.",
    });
  let saved = false;
  try {
    const printToken = crypto.randomBytes(32).toString("hex");
    const ticket = await Ticket.create({
      busId,
      seatId: Number(seatId),
      passengerType,
      categoryVerified: !selfService && req.body.categoryVerified === true,
      eligibilityDeclared:
        selfService &&
        passengerType !== "regular" &&
        req.body.eligibilityDeclared === true,
      from: selfService ? bus.from : from || bus.from,
      routeTo: selfService ? bus.to : routeTo || bus.to,
      to,
      distanceKm,
      dropoffLocation,
      fare: passengerType === "regular" ? fare.regular : fare.discounted,
      qrCode: crypto.randomBytes(32).toString("hex"),
      bookingReference:
        "SM-" + crypto.randomBytes(8).toString("hex").toUpperCase(),
      printTokenHash: hashToken(printToken),
      expiresAt: new Date(Date.now() + 86400000),
    });
    saved = true;
    await audit(req, "ticket.issued", "success", {
      ticketId: ticket._id,
      busId,
      reference: ticket.bookingReference,
    });
    const value = ticket.toObject();
    delete value.printTokenHash;
    res.status(201).json({ ...value, printToken });
  } catch (err) {
    if (!saved)
      await Bus.updateOne(
        { _id: busId, "seats.id": Number(seatId) },
        { $set: { "seats.$.status": "available" } },
      );
    throw err;
  }
}
router.patch("/:id", requireStaff, guardId, async (req, res) => {
  if (!["used", "cancelled"].includes(req.body.status))
    return res
      .status(400)
      .json({ error: "Only completion or cancellation is permitted." });
  const ticket = await Ticket.findOneAndUpdate(
    { _id: req.params.id, status: "active" },
    { $set: { status: req.body.status } },
    { new: true },
  );
  if (!ticket)
    return res
      .status(409)
      .json({ error: "Ticket not found or no longer active." });
  if (!ticket.tripId)
    await Bus.updateOne(
      { _id: ticket.busId, "seats.id": ticket.seatId },
      { $set: { "seats.$.status": "available" } },
    );
  await audit(req, "ticket." + req.body.status, "success", {
    ticketId: ticket._id,
    busId: ticket.busId,
    passengerId: ticket.passengerId,
    reference: ticket.bookingReference,
  });
  res.json(ticket);
});
export default router;
