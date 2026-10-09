import Bus from "./models/Bus.js";
import { hashToken, equalSecret, asyncHandler } from "./security.js";
import { proximityState } from "../shared/proximity.js";
import { Activity } from "./models/Activity.js";
import Notification from "./models/Notification.js";
import Ticket from "./models/Ticket.js";

export const authenticateDevice = asyncHandler(async (req, res, next) => {
  const busId = req.body.busId || req.query.busId;
  if (typeof busId !== "string" || !busId)
    return res
      .status(400)
      .json({ error: "Specify the tracking device busId." });
  const bus = await Bus.findOne({ busId }).select("+deviceTokenHash");
  const token =
    req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
    req.headers["x-device-key"];
  if (
    !bus ||
    !token ||
    !bus.deviceTokenHash ||
    !equalSecret(hashToken(token), bus.deviceTokenHash)
  )
    return res
      .status(401)
      .json({ error: "Tracking device authorization failed." });
  req.deviceBus = await Bus.findById(bus._id);
  next();
});
export async function updateProximity(bus) {
  const state = proximityState(bus);
  if (state.status === "Within 100 m") {
    const entered = await Bus.findOneAndUpdate(
      { _id: bus._id, proximityInside: { $ne: true } },
      { $set: { proximityInside: true } },
    );
    if (entered) {
      const body = `${bus.busId} is within 100 m of ${state.target}.`;
      await Activity.create({
        event: "bus.proximity_entered",
        outcome: "success",
        busId: bus._id,
        detail: body,
      });
      const passengers = await Ticket.distinct("passengerId", {
        busId: bus._id,
        status: "active",
        passengerId: { $ne: null },
      });
      // Notifications are private to passengers booked on this bus; staff receive
      // a separate role-scoped event. Notifications are never broadcast publicly.
      await Notification.create({
        title: "Bus within 100 m",
        body,
        busId: bus._id,
        audience: "staff",
      });
      if (passengers.length)
        await Notification.insertMany(
          passengers.map((passengerId) => ({
            title: "Your bus is approaching",
            body,
            busId: bus._id,
            passengerId,
            audience: "passenger",
          })),
        );
    }
  } else if (state.status === "Outside 100 m" && state.distanceMeters > 130) {
    await Bus.updateOne({ _id: bus._id }, { $set: { proximityInside: false } });
  }
  return state;
}
