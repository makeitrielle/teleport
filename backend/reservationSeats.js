import Ticket from "./models/Ticket.js";
// Reservations and physical occupancy are independent. Both monitors use this view.
export async function withReservationStatus(buses) {
  const reservations = await Ticket.find({
    busId: { $in: buses.map((bus) => bus._id) },
    status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  })
    .select("busId seatId")
    .lean();
  const reserved = new Set(
    reservations.map((ticket) => `${ticket.busId}:${ticket.seatId}`),
  );
  return buses.map((bus) => ({
    ...bus,
    seats: (bus.seats || []).map((seat) => ({
      ...seat,
      status: reserved.has(`${bus._id}:${seat.id}`) ? "booked" : seat.status,
    })),
  }));
}
