// Singleton routes for the ONE bus this system represents (BUS-001).
// These are thin convenience wrappers around the same Bus model used by
// the plural /api/buses collection routes in buses.js - no business logic
// is duplicated. They exist so hardware (the ESP32 firmware) and simple
// clients don't need to know a MongoDB ObjectId: they just talk to "the
// bus" by its stable busId.
import express from "express";
import Bus from "../models/Bus.js";
import Ticket from "../models/Ticket.js";
import { voiceClipFor } from "../voiceClips.js";

const router = express.Router();

// Finds the one active bus record. Falls back to the first bus in the
// collection if no busId match is found, so this keeps working even if
// someone seeds a bus without an explicit busId.
async function findTheBus() {
  const bus = await Bus.findOne({ busId: "BUS-001" });
  if (bus) return bus;
  return Bus.findOne().sort({ createdAt: 1 });
}

// GET /api/bus/current - full current state of the one bus
router.get("/current", async (req, res) => {
  const bus = await findTheBus();
  if (!bus) return res.status(404).json({ error: "No bus is configured yet" });
  res.json(bus);
});

// POST /api/bus/location - the ESP32's onboard GPS fix, sent over WiFi
// Body: { busId, latitude, longitude, speed, timestamp, progress?, etaMin?, status? }
// latitude/longitude/speed/timestamp are stored as-is in `location`.
// progress/etaMin/status are optional - the firmware already computes
// these from the GPS fix against the known route stops, so if present
// they're applied too (this is what the frontend map currently reads).
router.post("/location", async (req, res) => {
  const bus = await findTheBus();
  if (!bus) return res.status(404).json({ error: "No bus is configured yet" });

  const { latitude, longitude, speed, timestamp, progress, etaMin, status } = req.body;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: "A valid numeric GPS latitude and longitude are required" });
  }
  if (speed !== undefined && (!Number.isFinite(speed) || speed < 0)) {
    return res.status(400).json({ error: "Speed must be a non-negative number" });
  }
  if (timestamp !== undefined && !Number.isFinite(Date.parse(timestamp))) {
    return res.status(400).json({ error: "Timestamp must be a valid date" });
  }

  bus.location = {
    lat: latitude,
    lon: longitude,
    speed: speed ?? bus.location?.speed ?? 0,
    updatedAt: timestamp ? new Date(timestamp) : new Date(),
  };
  if (progress !== undefined) bus.progress = progress;
  if (etaMin !== undefined) bus.etaMin = etaMin;
  if (status !== undefined && !(bus.status === "boarding" && status === "active")) bus.status = status;

  await bus.save();
  res.json(bus);
});

// GET /api/bus/seats - current seat layout for the one bus
router.get("/seats", async (req, res) => {
  const bus = await findTheBus();
  if (!bus) return res.status(404).json({ error: "No bus is configured yet" });
  res.json(bus.seats);
});

// POST /api/bus/seats - the ESP32's seat sensor reading(s)
// Body: either one seat { seatId, status } where status is
// "available" | "booked", with sensor assumed "ok" - or a fault report
// { seatId, sensor: "fault" } to mark a sensor offline.
router.post("/seats", async (req, res) => {
  const bus = await findTheBus();
  if (!bus) return res.status(404).json({ error: "No bus is configured yet" });

  const { seatId, status, sensor } = req.body;
  const seat = bus.seats.find((s) => s.id === Number(seatId));
  if (!seat) return res.status(404).json({ error: `Seat ${seatId} not found on this bus` });

  if (status) seat.status = status;
  if (sensor) seat.sensor = sensor;
  seat.updatedAt = Date.now();

  await bus.save();
  res.json(bus.seats);
});


// Active passenger-selected destinations for the on-bus GPS alert device.
router.get("/dropoffs", async (req, res) => {
  const bus = await findTheBus();
  if (!bus) return res.status(404).json({ error: "No bus is configured yet" });
  const tickets = await Ticket.find({ busId: bus._id, status: "active", dropoffAlerted: false,
    "dropoffLocation.lat": { $type: "number" }, "dropoffLocation.lon": { $type: "number" } })
    .select("_id dropoffLocation to").lean();
  res.json(tickets.map((ticket) => ({ id: String(ticket._id), lat: ticket.dropoffLocation.lat,
    lon: ticket.dropoffLocation.lon, label: ticket.to, clip: voiceClipFor(ticket.to) })));
});

router.post("/dropoffs/:ticketId/alerted", async (req, res) => {
  const ticket = await Ticket.findOneAndUpdate({ _id: req.params.ticketId, status: "active" },
    { $set: { dropoffAlerted: true } }, { new: true });
  if (!ticket) return res.status(404).json({ error: "Active ticket not found" });
  res.json({ ok: true });
});
export default router;
