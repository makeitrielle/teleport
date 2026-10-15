// Eleven rows of 3 + 2 seats and one rear row of six: 61 seats.
export const KIOSK_SEAT_COUNT = 61;
export function kioskSeatLayout(bus) {
  return Array.from(
    { length: KIOSK_SEAT_COUNT },
    (_, index) =>
      (bus?.seats || []).find((seat) => seat.id === index + 1) || {
        id: index + 1,
        sensor: "fault",
        occupancy: null,
        sensorUpdatedAt: null,
      },
  );
}
export function isPrioritySeat(bus, seatId) {
  return (
    Number.isInteger(Number(seatId)) &&
    Number(seatId) >= 1 &&
    Number(seatId) <= 5
  );
}
export function canUseSeat(bus, seatId, passengerType) {
  return (
    !isPrioritySeat(bus, seatId) || ["pwd", "senior"].includes(passengerType)
  );
}

// Older bus records may omit the list. The installed hardware monitors seats 1–5.
// An explicitly empty list still means that no sensors are configured.
export function monitoredSeatIds(bus) {
  return Array.isArray(bus?.monitoredSeatIds)
    ? bus.monitoredSeatIds
    : [1, 2, 3, 4, 5];
}
export function isSeatMonitored(bus, seatId) {
  return monitoredSeatIds(bus).includes(Number(seatId));
}

// Ticket allocation and physical presence are separate facts. A live occupied
// sensor takes display priority without cancelling the passenger's trip ticket.
export function seatDisplayState(bus, seat, now = Date.now()) {
  const fresh =
    isSeatMonitored(bus, seat.id) &&
    seat.sensor === "ok" &&
    Number.isFinite(seat.sensorUpdatedAt) &&
    now - seat.sensorUpdatedAt >= 0 &&
    now - seat.sensorUpdatedAt <= 90000 &&
    ["available", "occupied"].includes(seat.occupancy);
  if (fresh && seat.occupancy === "occupied") return "occupied";
  if (seat.status === "booked") return "reserved";
  return fresh ? "available" : "offline";
}
