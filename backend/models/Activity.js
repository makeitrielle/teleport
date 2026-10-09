import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    actorId: mongoose.Schema.Types.ObjectId,
    passengerId: { type: mongoose.Schema.Types.ObjectId, ref: "Passenger" },
    event: { type: String, required: true },
    outcome: { type: String, enum: ["success", "failure"], required: true },
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket" },
    tripId: mongoose.Schema.Types.ObjectId,
    reference: String,
    busId: mongoose.Schema.Types.ObjectId,
    detail: String,
  },
  { timestamps: true },
);
export const Activity = mongoose.model("Activity", schema);
export async function audit(req, event, outcome = "success", data = {}) {
  return Activity.create({
    actorId: req.auth?.userId,
    passengerId:
      req.auth?.role === "passenger" ? req.auth.userId : data.passengerId,
    event,
    outcome,
    ...data,
  });
}
