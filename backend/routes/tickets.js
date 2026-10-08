import express from "express";
import crypto from "crypto";
import Ticket from "../models/Ticket.js";
import Bus from "../models/Bus.js";
import { farePointForRoute } from "../../shared/fareMatrix.js";

const router = express.Router();
const passengerTypes = new Set(["regular", "student", "pwd", "senior"]);
const SENSOR_STALE_AFTER_MS = 90000;

function hasFreshAvailableSensor(seat) {
  const reportedAt = Number(seat.sensorUpdatedAt || 0);
  const ageMs = Date.now() - reportedAt;
  return seat.sensor === "ok" && seat.occupancy === "available" &&
    ageMs >= -60000 && ageMs <= SENSOR_STALE_AFTER_MS;
}

router.get("/", async (req, res) => {
  const filter = {};
  if (req.query.busId) filter.busId = req.query.busId;
  if (req.query.passengerId) filter.passengerId = req.query.passengerId;
  if (req.query.qrCode) filter.qrCode = req.query.qrCode;
  if (req.query.qrCode) filter.status = "active";
  const tickets = await Ticket.find(filter).sort({ createdAt: -1 });
  res.json(tickets);
});

// POST /api/tickets - dispense a new ticket (kiosk flow: pick seat -> pick drop-off)
router.post("/", async (req, res) => {
  const { busId, passengerId, seatId, standing = false, passengerType = "regular", from, routeTo, to, distanceKm, dropoffLocation } = req.body;
  if (!passengerTypes.has(passengerType)) {
    return res.status(400).json({ error: "Passenger type must be regular, student, pwd, or senior." });
  }
  const distance = Number(distanceKm);
  const lat = Number(dropoffLocation?.lat);
  const lon = Number(dropoffLocation?.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return res.status(400).json({ error: "A valid drop-off pin is required" });
  }
  const normalizedDropoff = { lat, lon };
  const bus = await Bus.findById(busId);
  if (!bus) return res.status(404).json({ error: "Bus not found" });
  const ticketFrom = from || bus.from;
  const ticketRouteTo = routeTo || bus.to;
  const farePoint = farePointForRoute(ticketFrom, ticketRouteTo, to);
  if (!farePoint || !Number.isFinite(distance) || distance !== farePoint.distanceKm) {
    return res.status(400).json({ error: "Choose a valid drop-off from this route's fare matrix." });
  }
  const calculatedFare = passengerType === "regular" ? farePoint.regular : farePoint.discounted;

  if (standing) {
    const hasAvailableSeat = bus.seats.some((s) => Number(s.id) <= 5 && s.status !== "booked" && hasFreshAvailableSensor(s));
    if (hasAvailableSeat) return res.status(409).json({ error: "A seat is still available" });
  } else {
    const seat = bus.seats.find((s) => s.id === Number(seatId));
    if (!seat) return res.status(404).json({ error: "Seat not found" });
    if (Number(seat.id) > 5 || !hasFreshAvailableSensor(seat)) return res.status(409).json({ error: "Seat sensor is offline or the seat is occupied; this seat is unavailable" });
    if (seat.status === "booked") return res.status(409).json({ error: "Seat already booked" });
    seat.status = "booked";
    seat.updatedAt = Date.now();
    await bus.save();
  }

  const qrCode = crypto.randomUUID();
  const printToken = crypto.randomBytes(32).toString("hex");
  const printTokenHash = crypto.createHash("sha256").update(printToken).digest("hex");
  const ticket = await Ticket.create({
    busId,
    passengerId: passengerId || null,
    passengerType,
    seatId,
    standing,
    from: ticketFrom,
    routeTo: ticketRouteTo,
    to,
    dropoffLocation: normalizedDropoff,
    distanceKm: distance,
    fare: calculatedFare,
    qrCode,
    printTokenHash,
  });

  const ticketData = ticket.toObject();
  delete ticketData.printTokenHash;
  res.status(201).json({ ...ticketData, printToken });
});

// PATCH /api/tickets/:id - mark used/cancelled
router.patch("/:id", async (req, res) => {
  const ticket = await Ticket.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  // free up the seat if cancelled
  if (req.body.status === "cancelled") {
    const bus = await Bus.findById(ticket.busId);
    if (bus) {
      const seat = bus.seats.find((s) => s.id === ticket.seatId);
      if (seat) {
        seat.status = "available";
        seat.updatedAt = Date.now();
        await bus.save();
      }
    }
  }

  res.json(ticket);
});

export default router;
