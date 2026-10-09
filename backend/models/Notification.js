import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    passengerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Passenger",
      default: null,
    },
    busId: { type: mongoose.Schema.Types.ObjectId, ref: "Bus", default: null },
    audience: { type: String, enum: ["passenger", "staff"], default: "staff" },
    body: { type: String, default: "" },
  },
  { timestamps: true },
);

export default mongoose.model("Notification", NotificationSchema);
