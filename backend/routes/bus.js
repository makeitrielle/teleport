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
import { authenticateDevice, updateProximity } from "../tracking.js";

const router = express.Router();
router.use(authenticateDevice);

// Finds the one active bus record. Falls back to the first bus in the
// collection if no busId match is found, so this keeps working even if
// someone seeds a bus without an explicit busId.
async function findTheBus(req) {
  return req.deviceBus;
}

// GET /api/bus/current - full current state of the one bus
router.get("/current", async (req, res) => {
  const bus = await findTheBus(req);
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
  const bus = await findTheBus(req);
  if (!bus) return res.status(404).json({ error: "No bus is configured yet" });

  const {
    latitude,
    longitude,
    speed,
    timestamp,
    progress,
    etaMin,
    status,
    accuracy,
    dop,
    fixStatus,
  } = req.body;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return res.status(400).json({
      error: "A valid numeric GPS latitude and longitude are required",
    });
  }
  if (speed !== undefined && (!Number.isFinite(speed) || speed < 0)) {
    return res
      .status(400)
      .json({ error: "Speed must be a non-negative number" });
  }
  if (
    typeof timestamp !== "string" ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    return res.status(400).json({ error: "Timestamp must be a valid date" });
  }
  const fixTime = timestamp ? new Date(timestamp) : new Date();
  if (
    fixTime.getTime() > Date.now() + 30000 ||
    Date.now() - fixTime.getTime() > 120000 ||
    (bus.location?.updatedAt && fixTime < bus.location.updatedAt)
  )
    return res
      .status(400)
      .json({ error: "GPS update is stale, out of order, or in the future." });
  if (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0))
    return res
      .status(400)
      .json({ error: "GPS accuracy must be a non-negative number in meters." });
  if (dop !== undefined && (!Number.isFinite(dop) || dop <= 0))
    return res.status(400).json({ error: "GNSS DOP must be positive." });
  if (fixStatus !== undefined && ![2, 3].includes(fixStatus))
    return res
      .status(400)
      .json({ error: "A valid 2D or 3D GPS fix is required." });

  bus.location = {
    lat: latitude,
    lon: longitude,
    speed: speed ?? bus.location?.speed ?? 0,
    updatedAt: fixTime,
    accuracy: accuracy ?? null,
    dop: dop ?? null,
    fixStatus: fixStatus ?? null,
  };
  if (progress !== undefined) bus.progress = progress;
  if (etaMin !== undefined) bus.etaMin = etaMin;
  if (
    status !== undefined &&
    !(bus.status === "boarding" && status === "active")
  )
    bus.status = status;

  await bus.save();
  const proximity = await updateProximity(bus);
  const safe = bus.toObject();
  delete safe.deviceTokenHash;
  res.json({ ...safe, proximity });
});

// GET /api/bus/seats - current seat layout for the one bus
router.get("/seats", async (req, res) => {
  const bus = await findTheBus(req);
  if (!bus) return res.status(404).json({ error: "No bus is configured yet" });
  res.json(bus.seats);
});

// POST /api/bus/seats - the ESP32's physical seat sensor reading(s).
// Body: { seatId, status: "available" | "booked" } stores physical
// occupancy separately from ticket reservations, or { seatId, sensor: "fault" }.
router.post("/seats", async (req, res) => {
  const bus = await findTheBus(req);
  if (!bus) return res.status(404).json({ error: "No bus is configured yet" });

  const { seatId, status, sensor } = req.body;
  const seat = bus.seats.find((s) => s.id === Number(seatId));
  if (!seat)
    return res
      .status(404)
      .json({ error: `Seat ${seatId} not found on this bus` });

  if (status === "available" || status === "booked") {
    seat.occupancy = status === "booked" ? "occupied" : "available";
    seat.sensor = "ok";
  } else if (sensor === "fault") {
    seat.sensor = "fault";
  } else {
    return res
      .status(400)
      .json({ error: "Provide a valid seat status or sensor fault report." });
  }
  seat.sensorUpdatedAt = Date.now();
  seat.updatedAt = Date.now();

  await bus.save();
  res.json(bus.seats);
});

// Active passenger-selected destinations for the on-bus GPS alert device.
router.get("/dropoffs", async (req, res) => {
  const bus = await findTheBus(req);
  if (!bus) return res.status(404).json({ error: "No bus is configured yet" });
  const tickets = await Ticket.find({
    busId: bus._id,
    status: "active",
    dropoffAlerted: false,
    "dropoffLocation.lat": { $type: "number" },
    "dropoffLocation.lon": { $type: "number" },
  })
    .select("_id dropoffLocation to from routeTo")
    .lean();
  res.json(
    tickets.map((ticket) => ({
      id: String(ticket._id),
      lat: ticket.dropoffLocation.lat,
      lon: ticket.dropoffLocation.lon,
      label: ticket.to,
      clip: voiceClipFor(ticket.to, ticket.from, ticket.routeTo),
    })),
  );
});

router.post("/dropoffs/:ticketId/alerted", async (req, res) => {
  const ticket = await Ticket.findOneAndUpdate(
    { _id: req.params.ticketId, busId: req.deviceBus._id, status: "active" },
    { $set: { dropoffAlerted: true } },
    { new: true },
  );
  if (!ticket)
    return res.status(404).json({ error: "Active ticket not found" });
  res.json({ ok: true });
});
export default router;
