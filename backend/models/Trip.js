import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    busId: { type: mongoose.Schema.Types.ObjectId, ref: "Bus", required: true },
    routeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Route",
      default: null,
    },
    from: { type: String, required: true },
    to: { type: String, required: true },
    departureAt: { type: Date, required: true, index: true },
    arrivalAt: { type: Date, default: null },
    durationMinutes: { type: Number, min: 1, default: null },
    seatIds: { type: [Number], default: [] },
    status: {
      type: String,
      enum: ["scheduled", "boarding", "departed", "completed", "cancelled"],
      default: "scheduled",
    },
    pickup: { label: String, lat: Number, lon: Number },
  },
  { timestamps: true },
);
export default mongoose.model("Trip", schema);
