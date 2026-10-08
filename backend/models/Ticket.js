import mongoose from "mongoose";

const TicketSchema = new mongoose.Schema(
  {
    busId: { type: mongoose.Schema.Types.ObjectId, ref: "Bus", required: true },
    passengerId: { type: mongoose.Schema.Types.ObjectId, ref: "Passenger", default: null },
    passengerType: { type: String, enum: ["regular", "student", "pwd", "senior"], default: "regular" },
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
    status: { type: String, enum: ["active", "used", "cancelled"], default: "active" },
  },
  { timestamps: true }
);

export default mongoose.model("Ticket", TicketSchema);
