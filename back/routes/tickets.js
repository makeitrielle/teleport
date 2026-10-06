import express from "express";
import crypto from "crypto";
import Ticket from "../models/Ticket.js";
import Bus from "../models/Bus.js";

const router = express.Router();
const passengerTypes = new Set(["regular", "student", "pwd", "senior"]);

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
  const { busId, passengerId, seatId, standing = false, passengerType = "regular", from, to, fare, dropoffLocation } = req.body;
  if (!passengerTypes.has(passengerType)) {
    return res.status(400).json({ error: "Passenger type must be regular, student, pwd, or senior." });
  }
  const lat = Number(dropoffLocation?.lat);
  const lon = Number(dropoffLocation?.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return res.status(400).json({ error: "A valid drop-off pin is required" });
  }
  const normalizedDropoff = { lat, lon };

  const bus = await Bus.findById(busId);
  if (!bus) return res.status(404).json({ error: "Bus not found" });

  if (standing) {
    const hasAvailableSeat = bus.seats.some((s) => s.sensor !== "fault" && Number(s.id) <= 5 && s.status !== "booked");
    if (hasAvailableSeat) return res.status(409).json({ error: "A seat is still available" });
  } else {
    const seat = bus.seats.find((s) => s.id === Number(seatId));
    if (!seat) return res.status(404).json({ error: "Seat not found" });
    if (seat.sensor === "fault" || Number(seat.id) > 5) return res.status(409).json({ error: "Seat sensor is offline; this seat is unavailable" });
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
    from,
    to,
    dropoffLocation: normalizedDropoff,
    fare,
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
