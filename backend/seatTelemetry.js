import Bus from "./models/Bus.js";
import Ticket from "./models/Ticket.js";
import { Activity } from "./models/Activity.js";
import { isSeatMonitored, seatDisplayState } from "../shared/seatPolicy.js";
import { activeTicketFilter } from "./ticketValidity.js";
import mongoose from "mongoose";

async function flushSeatEvent(busId, seat) {
  const event = seat.pendingSensorEvent;
  if (!event?._id) return;
  await Activity.updateOne(
    { _id: event._id },
    { $setOnInsert: event },
    { upsert: true, timestamps: false },
  );
  await Bus.updateOne(
    {
      _id: busId,
      seats: {
        $elemMatch: { id: seat.id, "pendingSensorEvent._id": event._id },
      },
    },
    { $unset: { "seats.$.pendingSensorEvent": 1 } },
  );
}

export async function flushSensorEvents() {
  const buses = await Bus.find({
    "seats.pendingSensorEvent._id": { $exists: true },
  })
    .select("seats")
    .lean();
  for (const bus of buses)
    for (const seat of bus.seats) await flushSeatEvent(bus._id, seat);
}

const fail = (status, message) => Object.assign(new Error(message), { status });
export function emptyConfirmationMs() {
  const value = Number(process.env.SEAT_EMPTY_CONFIRM_MS ?? 1500);
  return Number.isFinite(value) && value >= 0 && value <= 30000 ? value : 1500;
}

// A pressure reading never changes ticket ownership, allocation flags or trip history.
// Compare-and-swap touches just this seat, so concurrent GPS, booking and sensor
// writes cannot overwrite each other or other seats in the same bus document.
export async function applySeatTelemetry(busId, input) {
  const { seatId, status, sensor, observedAt } = input;
  if (!Number.isInteger(seatId) || seatId < 1)
    throw fail(400, "seatId must be a positive integer.");
  if (
    !(
      ["available", "booked", "occupied"].includes(status) &&
      sensor === undefined
    ) &&
    !(sensor === "fault" && status === undefined)
  )
    throw fail(400, "Provide one occupancy state or a sensor fault report.");
  const now = Date.now();
  if (
    observedAt !== undefined &&
    (!Number.isSafeInteger(observedAt) ||
      observedAt > now + 30000 ||
      now - observedAt > 90000)
  )
    throw fail(400, "Sensor timestamp is invalid, stale, or in the future.");
  for (let attempt = 0; attempt < 8; attempt++) {
    const bus = await Bus.findById(busId).lean();
    const seat = bus?.seats.find((s) => s.id === seatId);
    if (!seat) throw fail(404, "Seat not found on the authenticated bus.");
    if (seat.pendingSensorEvent?._id) {
      await flushSeatEvent(busId, seat);
      continue;
    }
    if (sensor !== "fault" && !isSeatMonitored(bus, seatId))
      throw fail(409, "This seat has no configured physical sensor.");
    // Timestamped devices may safely retry a request; an older packet must not
    // reverse a newer occupancy reading. Legacy firmware remains supported.
    if (
      observedAt !== undefined &&
      seat.sensorObservedAt != null &&
      observedAt <= seat.sensorObservedAt
    )
      return { bus, duplicate: true };
    const occupied = status === "booked" || status === "occupied";
    const nextOccupancy =
      sensor === "fault" ? seat.occupancy : occupied ? "occupied" : "available";
    const changed = nextOccupancy !== seat.occupancy;
    const next = {
      sensor: sensor === "fault" ? "fault" : "ok",
      sensorUpdatedAt: Math.min(observedAt ?? now, now),
      sensorObservedAt: observedAt ?? now,
      updatedAt: now,
    };
    if (sensor !== "fault") {
      next.occupancy = nextOccupancy;
      if (changed) {
        next.occupancyChangedAt = now;
        next.occupiedHoldUntil = occupied
          ? null
          : seat.occupancy === "occupied"
            ? now + emptyConfirmationMs()
            : null;
        next.verificationTicketId = null;
        next.verificationAt = null;
        if (occupied) next.lastOccupiedAt = now;
      }
    }
    const revision = seat.sensorRevision || 0;
    const match = {
      id: seatId,
      ...(revision
        ? { sensorRevision: revision }
        : {
            $or: [
              { sensorRevision: 0 },
              { sensorRevision: { $exists: false } },
            ],
          }),
    };
    if (changed || seat.sensor !== next.sensor) {
      const ticket = await Ticket.findOne({
        busId,
        seatId,
        ...activeTicketFilter(now),
      })
        .select("_id passengerId bookingReference")
        .lean();
      const allocated = { ...seat, status: ticket ? "booked" : "available" };
      next.pendingSensorEvent = {
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(now),
        updatedAt: new Date(now),
        event:
          sensor === "fault"
            ? "seat.sensor_fault"
            : occupied
              ? "seat.occupied"
              : "seat.empty_detected",
        outcome: "success",
        busId,
        seatId,
        ticketId: ticket?._id,
        reference: ticket?.bookingReference,
        previousState: seatDisplayState(bus, allocated, now),
        newState: seatDisplayState(bus, { ...allocated, ...next }, now),
        observedAt: new Date(observedAt ?? now),
        detail:
          sensor === "fault"
            ? `Seat ${seatId}: sensor unavailable.`
            : occupied
              ? `Seat ${seatId}: occupied; ${ticket ? "reservation retained; conductor verification required" : "no valid reservation; staff must check"}.`
              : `Seat ${seatId}: empty detected; confirmation hold applied. Active reservations remain protected.`,
      };
    }
    const updated = await Bus.findOneAndUpdate(
      { _id: busId, seats: { $elemMatch: match } },
      {
        $set: Object.fromEntries(
          Object.entries(next).map(([key, value]) => [`seats.$.${key}`, value]),
        ),
        $inc: { "seats.$.sensorRevision": 1 },
      },
      { new: true, runValidators: true },
    ).lean();
    if (!updated) continue;
    await flushSeatEvent(
      busId,
      updated.seats.find((s) => s.id === seatId),
    );
    return { bus: updated, duplicate: false };
  }
  throw fail(409, "Seat changed concurrently; retry the newest reading.");
}
