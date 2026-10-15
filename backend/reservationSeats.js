import { monitoredSeatIds, seatDisplayState } from "../shared/seatPolicy.js";
import Ticket from "./models/Ticket.js";
import Bus from "./models/Bus.js";
import { activeTicketFilter } from "./ticketValidity.js";
// Reservations and physical occupancy are independent. Both monitors use this view.
export async function withReservationStatus(buses, { staff = false } = {}) {
  const reservations = await Ticket.find({
    busId: { $in: buses.map((bus) => bus._id) },
    ...activeTicketFilter(),
  })
    .select("busId seatId")
    .lean();
  const reserved = new Set(
    reservations.map((ticket) => `${ticket.busId}:${ticket.seatId}`),
  );
  return buses.map((bus) => ({
    ...bus,
    monitoredSeatIds: monitoredSeatIds(bus),
    seats: (bus.seats || []).map((seat) => {
      const allocated = {
        ...seat,
        status: reserved.has(`${bus._id}:${seat.id}`) ? "booked" : "available",
      };
      const displayState = seatDisplayState(bus, allocated);
      const tickets = reservations.filter(
        (t) => String(t.busId) === String(bus._id) && t.seatId === seat.id,
      );
      const verified = tickets.some(
        (t) => String(t._id) === String(seat.verificationTicketId),
      );
      const warning =
        displayState !== "occupied"
          ? null
          : seat.verificationTicketId && !verified
            ? "wrong_seat"
            : !tickets.length
              ? "occupied_without_reservation"
              : !verified
                ? "occupant_not_verified"
                : null;
      const {
        verificationTicketId,
        verificationAt,
        sensorRevision,
        allocationTicketId,
        pendingSensorEvent,
        ...publicSeat
      } = allocated;
      return {
        ...publicSeat,
        displayState,
        ...(staff
          ? {
              occupancyWarning: warning,
              occupantVerified: verified,
              verificationAt,
            }
          : {}),
      };
    }),
  }));
}

// Release allocation after completion/cancellation only. A sensor never calls
// this. The ticket-bound lock prevents clearing a newer sale during a race.
export async function releaseTicketSeat(ticket) {
  if (!Number.isInteger(ticket.seatId)) return;
  if (
    await Ticket.exists({
      _id: { $ne: ticket._id },
      busId: ticket.busId,
      seatId: ticket.seatId,
      ...activeTicketFilter(),
    })
  )
    return;
  await Bus.updateOne(
    {
      _id: ticket.busId,
      seats: {
        $elemMatch: {
          id: ticket.seatId,
          status: "booked",
          $or: [
            { allocationTicketId: ticket._id },
            { allocationTicketId: null },
          ],
        },
      },
    },
    {
      $set: {
        "seats.$.status": "available",
        "seats.$.allocationTicketId": null,
      },
    },
  );
}

// Run before accepting requests. Restore allocation flags from saved tickets,
// rather than treating a flag left over from an older boot as a reservation.
export async function restoreSeatReservations() {
  const buses = await Bus.find().select("seats monitoredSeatIds").lean();
  const restored = await withReservationStatus(buses);
  const writes = [];
  for (let i = 0; i < buses.length; i++) {
    for (const status of ["available", "booked"]) {
      const ids = restored[i].seats
        .filter(
          (seat, index) =>
            seat.status === status && buses[i].seats[index].status !== status,
        )
        .map((seat) => seat.id);
      if (ids.length)
        writes.push({
          updateOne: {
            filter: { _id: buses[i]._id },
            update: { $set: { "seats.$[seat].status": status } },
            arrayFilters: [{ "seat.id": { $in: ids } }],
          },
        });
    }
  }
  if (writes.length) await Bus.bulkWrite(writes);
}
