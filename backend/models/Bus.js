import mongoose from "mongoose";

const SeatSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true },
    status: {
      type: String,
      enum: ["available", "booked"],
      default: "available",
    },
    occupancy: { type: String, enum: ["available", "occupied"], default: null },
    sensor: { type: String, enum: ["ok", "fault"], default: "ok" },
    // Updated only by hardware telemetry, never by ticket sales.
    sensorUpdatedAt: { type: Number, default: null },
    updatedAt: { type: Number, default: () => Date.now() },
  },
  { _id: false },
);

// Raw GPS fix from the on-board unit (ESP32 + GPS module), as distinct
// from `progress` below (the 0-1 fraction along the route that the
// frontend map animates with). Firmware can send either or both.
const LocationSchema = new mongoose.Schema(
  {
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },
    speed: { type: Number, default: 0 },
    // Date, not Number: the firmware sends the GPS module's own UTC
    // date/time as an ISO 8601 string (e.g. "2026-10-02T13:45:30Z"),
    // which Mongoose casts to a Date automatically.
    updatedAt: { type: Date, default: null },
    accuracy: { type: Number, min: 0, default: null },
    dop: { type: Number, min: 0, default: null },
    fixStatus: { type: Number, default: null },
  },
  { _id: false },
);

const BusSchema = new mongoose.Schema(
  {
    // Stable, human-readable identifier for the on-board unit - this is
    // the single source of truth referenced by GPS data, seat sensor
    // data, the backend API, and the passenger app. The app is built
    // around exactly ONE bus right now, so this defaults to "BUS-001"
    // and is enforced unique at the database level.
    busId: { type: String, required: true, unique: true, default: "BUS-001" },
    name: { type: String, required: true },
    deviceTokenHash: { type: String, select: false, default: null },
    trackingEnabled: { type: Boolean, default: true },
    proximityTarget: {
      label: String,
      lat: Number,
      lon: Number,
      thresholdMeters: { type: Number, default: 100 },
    },
    proximityInside: { type: Boolean, default: false },
    monitoredSeatIds: { type: [Number], default: [1, 2, 3, 4, 5] },
    driver: { type: String, default: "" },
    from: { type: String, required: true },
    to: { type: String, required: true },
    stops: { type: [String], default: [] },
    totalSeats: { type: Number, required: true },
    seats: { type: [SeatSchema], default: [] },
    progress: { type: Number, default: 0 },
    location: { type: LocationSchema, default: () => ({}) },
    status: {
      type: String,
      enum: ["active", "boarding", "idle"],
      default: "idle",
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    etaMin: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export default mongoose.model("Bus", BusSchema);
