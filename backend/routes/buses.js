import express from "express";
import Bus from "../models/Bus.js";
import Ticket from "../models/Ticket.js";
import Trip from "../models/Trip.js";
import { requireStaff, requireAdmin, guardId } from "../security.js";
import { audit } from "../models/Activity.js";
import { withReservationStatus } from "../reservationSeats.js";
import { activeTicketFilter } from "../ticketValidity.js";
import { seatDisplayState } from "../../shared/seatPolicy.js";
const router = express.Router();
router.use(requireStaff);
router.get("/", async (req, res) =>
  res.json(
    await withReservationStatus(
      await Bus.find().sort({ createdAt: 1 }).lean(),
      { staff: true },
    ),
  ),
);
router.get("/:id", guardId, async (req, res) => {
  const bus = await Bus.findById(req.params.id);
  if (!bus) return res.status(404).json({ error: "Bus not found." });
  res.json((await withReservationStatus([bus.toObject()], { staff: true }))[0]);
});
// Conductor verification is the only identity signal. Pressure alone cannot
// prove that the person sitting matches the owner of a reserved ticket.
router.post("/:id/seats/:seatId/verify-occupant", guardId, async (req, res) => {
  const seatId = Number(req.params.seatId);
  const { reference } = req.body;
  if (
    !Number.isInteger(seatId) ||
    typeof reference !== "string" ||
    !/^[a-f\d]{64}$/i.test(reference)
  )
    return res
      .status(400)
      .json({
        error: "Enter the full ticket QR reference and a valid seat number.",
      });
  const bus = await Bus.findById(req.params.id).lean();
  const seat = bus?.seats.find((s) => s.id === seatId);
  if (!seat || seatDisplayState(bus, seat) !== "occupied")
    return res
      .status(409)
      .json({
        error: "A fresh occupied seat reading is required for verification.",
      });
  const ticket = await Ticket.findOne({
    qrCode: reference,
    busId: bus._id,
    ...activeTicketFilter(),
  });
  if (!ticket)
    return res
      .status(409)
      .json({ error: "No valid ticket for this bus matches the reference." });
  const updated = await Bus.findOneAndUpdate(
    {
      _id: bus._id,
      seats: {
        $elemMatch: {
          id: seatId,
          sensorRevision: seat.sensorRevision || 0,
          occupancy: "occupied",
          sensor: "ok",
        },
      },
    },
    {
      $set: {
        "seats.$.verificationTicketId": ticket._id,
        "seats.$.verificationAt": new Date(),
      },
    },
    { new: true },
  );
  if (!updated)
    return res
      .status(409)
      .json({ error: "Sensor state changed; check the seat again." });
  const mismatch = ticket.seatId !== seatId;
  await audit(
    req,
    mismatch ? "seat.occupancy_conflict" : "seat.occupant_verified",
    mismatch ? "failure" : "success",
    {
      busId: bus._id,
      seatId,
      ticketId: ticket._id,
      reference: ticket.bookingReference,
      detail: mismatch
        ? `Passenger ticket assigns seat ${ticket.seatId}; conductor observed seat ${seatId}. No reassignment made.`
        : `Conductor verified ticket for seat ${seatId}.`,
    },
  );
  res.json({ ok: !mismatch, warning: mismatch ? "wrong_seat" : null });
});
router.post("/", requireAdmin, async (req, res) => {
  const {
    busId,
    name,
    from,
    to,
    totalSeats,
    monitoredSeatIds = [],
    driver = "",
  } = req.body;
  if (
    typeof busId !== "string" ||
    !busId.trim() ||
    !name ||
    !from ||
    !to ||
    !Number.isInteger(totalSeats) ||
    totalSeats < 1 ||
    totalSeats > 100 ||
    !Array.isArray(monitoredSeatIds) ||
    monitoredSeatIds.some(
      (id) => !Number.isInteger(id) || id < 1 || id > totalSeats,
    )
  )
    return res.status(400).json({
      error:
        "Provide a unique bus ID, name, route, valid capacity and monitored seat IDs.",
    });
  const seats = Array.from({ length: totalSeats }, (_, i) => ({
    id: i + 1,
    status: "available",
    sensor: "fault",
    occupancy: null,
    sensorUpdatedAt: null,
  }));
  const bus = await Bus.create({
    busId: busId.trim(),
    name,
    driver,
    from,
    to,
    totalSeats,
    monitoredSeatIds,
    seats,
    status: "idle",
  });
  await audit(req, "bus.created", "success", { busId: bus._id });
  res.status(201).json(bus);
});
router.patch("/:id", requireAdmin, guardId, async (req, res) => {
  const changes = {};
  for (const key of ["name", "driver", "from", "to", "status", "stops"])
    if (req.body[key] !== undefined) changes[key] = req.body[key];
  const bus = await Bus.findByIdAndUpdate(req.params.id, changes, {
    new: true,
    runValidators: true,
  });
  if (!bus) return res.status(404).json({ error: "Bus not found." });
  await audit(req, "bus.updated", "success", { busId: bus._id });
  res.json(bus);
});
router.patch("/:id/seats/:seatId", requireAdmin, guardId, async (req, res) => {
  const bus = await Bus.findById(req.params.id);
  const seat = bus?.seats.find((s) => s.id === Number(req.params.seatId));
  if (!seat) return res.status(404).json({ error: "Seat not found." });
  if (
    req.body.status === "available" &&
    (await Ticket.exists({
      busId: bus._id,
      seatId: seat.id,
      tripId: null,
      status: "active",
    }))
  )
    return res.status(409).json({
      error:
        "Cancel or complete the active walk-up ticket before releasing this seat.",
    });
  // Physical telemetry can only be submitted by its authenticated device.
  if (!["available", "booked"].includes(req.body.status))
    return res.status(400).json({ error: "Specify available or booked." });
  seat.status = req.body.status;
  await bus.save();
  await audit(req, "seat.override", "success", { busId: bus._id });
  res.json(bus);
});
router.delete("/:id", requireAdmin, guardId, async (req, res) => {
  if (
    (await Ticket.exists({ busId: req.params.id })) ||
    (await Trip.exists({ busId: req.params.id }))
  )
    return res.status(409).json({
      error:
        "This bus has historical reservations or schedules. Set it idle instead of deleting it.",
    });
  await Bus.findByIdAndDelete(req.params.id);
  await audit(req, "bus.deleted");
  res.sendStatus(204);
});
export default router;
