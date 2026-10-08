import express from "express";
import Bus from "../models/Bus.js";

const router = express.Router();

async function ensureCanonicalBusSeats(bus) {
  const byId = new Map(bus.seats.map((seat) => [Number(seat.id), seat]));
  let changed = bus.totalSeats !== 61 || bus.seats.length !== 61;
  const seats = Array.from({ length: 61 }, (_, index) => {
    const id = index + 1;
    const existing = byId.get(id);
    if (!existing) changed = true;
    if (id > 5 && existing?.sensor !== "fault") changed = true;
    if (id <= 5 && !existing) changed = true;
    return existing
      ? { id, status: existing.status, occupancy: existing.occupancy, sensor: id <= 5 ? existing.sensor : "fault",
          sensorUpdatedAt: existing.sensorUpdatedAt, updatedAt: existing.updatedAt }
      : { id, status: "available", sensor: "fault", updatedAt: Date.now() };
  });
  if (changed) {
    bus.totalSeats = 61;
    bus.seats = seats;
    await bus.save();
  }
  return bus;
}
// GET /api/buses - list all buses
router.get("/", async (req, res) => {
  const buses = await Bus.find().sort({ createdAt: 1 });
  await Promise.all(buses.map(ensureCanonicalBusSeats));
  res.json(buses);
});

// GET /api/buses/:id - single bus
router.get("/:id", async (req, res) => {
  const bus = await Bus.findById(req.params.id);
  if (!bus) return res.status(404).json({ error: "Bus not found" });
  res.json(bus);
});

// POST /api/buses - create a bus
router.post("/", async (req, res) => {
  const bus = await Bus.create(req.body);
  res.status(201).json(bus);
});

// PATCH /api/buses/:id - update a bus (e.g. progress, status, etaMin)
router.patch("/:id", async (req, res) => {
  const bus = await Bus.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!bus) return res.status(404).json({ error: "Bus not found" });
  res.json(bus);
});

// PATCH /api/buses/:id/seats/:seatId - update a single seat (booking or sensor status)
router.patch("/:id/seats/:seatId", async (req, res) => {
  const bus = await Bus.findById(req.params.id);
  if (!bus) return res.status(404).json({ error: "Bus not found" });

  const seat = bus.seats.find((s) => s.id === Number(req.params.seatId));
  if (!seat) return res.status(404).json({ error: "Seat not found" });

  if (req.body.status) seat.status = req.body.status;
  if (req.body.sensor) seat.sensor = req.body.sensor;
  seat.updatedAt = Date.now();

  await bus.save();
  res.json(bus);
});

// DELETE /api/buses/:id
router.delete("/:id", async (req, res) => {
  await Bus.findByIdAndDelete(req.params.id);
  res.status(204).send();
});

export default router;
