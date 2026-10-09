import mongoose from "mongoose";

const TicketSchema = new mongoose.Schema(
  {
    busId: { type: mongoose.Schema.Types.ObjectId, ref: "Bus", required: true },
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Trip",
      default: null,
    },
    bookingReference: { type: String, default: null },
    departureAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    categoryVerified: { type: Boolean, default: false },
    confirmedAt: { type: Date, default: Date.now },
    printedAt: { type: Date, default: null },
    printState: {
      type: String,
      enum: ["ready", "printing", "printed", "failed", "uncertain"],
      default: "ready",
    },
    passengerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Passenger",
      default: null,
    },
    passengerType: {
      type: String,
      enum: ["regular", "student", "pwd", "senior"],
      default: "regular",
    },
    seatId: { type: Number, default: null },
    standing: { type: Boolean, default: false },
    from: { type: String, required: true },
    routeTo: { type: String, default: "" },
    to: { type: String, required: true },
    dropoffLocation: {
      lat: { type: Number, min: -90, max: 90 },
      lon: { type: Number, min: -180, max: 180 },
    },
    dropoffAlerted: { type: Boolean, default: false },
    distanceKm: { type: Number, min: 0 },
    fare: { type: Number, default: 0 },
    qrCode: { type: String, required: true }, // encoded ticket reference string
    printTokenHash: { type: String, select: false, default: null },
    status: {
      type: String,
      enum: ["active", "used", "cancelled"],
      default: "active",
    },
  },
  { timestamps: true },
);

// This index only applies to new scheduled reservations. Historical walk-up
// ticket records are retained without changing their identifiers or ownership.
TicketSchema.index(
  { tripId: 1, seatId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      tripId: { $type: "objectId" },
      seatId: { $type: "number" },
      status: "active",
    },
  },
);
TicketSchema.index({ qrCode: 1 }, { unique: true });
TicketSchema.index(
  { bookingReference: 1 },
  {
    unique: true,
    partialFilterExpression: { bookingReference: { $type: "string" } },
  },
);

export default mongoose.model("Ticket", TicketSchema);
