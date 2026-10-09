// The bus layout has four seats per row, with an aisle between pairs.
export function isPrioritySeat(bus, seatId) {
  return (bus?.seats || [])
    .slice(0, 4)
    .some((seat) => seat.id === Number(seatId));
}
export function canUseSeat(bus, seatId, passengerType) {
  return (
    !isPrioritySeat(bus, seatId) || ["pwd", "senior"].includes(passengerType)
  );
}
