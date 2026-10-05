import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    body: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Notification", NotificationSchema);
