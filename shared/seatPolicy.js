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
