import { gpsOnline, validCoordinates, haversineMeters } from "./proximity.js";
import { isSeatMonitored } from "./seatPolicy.js";

export function seatAvailability(bus, now = Date.now()) {
  const counts = { available: 0, unavailable: 0, unknown: 0 };
  for (const seat of bus.seats || []) {
    const fresh =
      isSeatMonitored(bus, seat.id) &&
      seat.sensor === "ok" &&
      Number.isFinite(seat.sensorUpdatedAt) &&
      now - seat.sensorUpdatedAt >= 0 &&
      now - seat.sensorUpdatedAt <= 90000 &&
      ["available", "occupied"].includes(seat.occupancy);
    if (seat.status === "booked" || (fresh && seat.occupancy === "occupied"))
      counts.unavailable++;
    else if (fresh) counts.available++;
    else counts.unknown++;
  }
  return counts;
}

export function arrivalState(bus, user, previous, now = Date.now()) {
  if (
    !user ||
    !validCoordinates(user.lat, user.lon) ||
    !Number.isFinite(user.accuracy) ||
    user.accuracy < 0 ||
    user.accuracy > 50 ||
    !Number.isFinite(user.timestamp) ||
    now - user.timestamp > 30000 ||
    user.timestamp > now + 30000 ||
    !gpsOnline(bus, now) ||
    now - new Date(bus.location.updatedAt).getTime() > 30000
  )
    return null;
  const distance = haversineMeters(
    user.lat,
    user.lon,
    bus.location.lat,
    bus.location.lon,
  );
  let etaSeconds = null;
  // Compare consecutive GPS fixes against the same passenger position so the
  // passenger walking toward a stationary bus cannot create an arrival ETA.
  if (
    previous &&
    validCoordinates(previous.lat, previous.lon) &&
    bus.location.speed > 2 &&
    new Date(bus.location.updatedAt) > new Date(previous.updatedAt) &&
    new Date(bus.location.updatedAt) - new Date(previous.updatedAt) <= 30000
  ) {
    const movement = haversineMeters(
      previous.lat,
      previous.lon,
      bus.location.lat,
      bus.location.lon,
    );
    const closing =
      haversineMeters(user.lat, user.lon, previous.lat, previous.lon) -
      distance;
    if (movement >= 3 && closing > 1) {
      const closingSpeed =
        (bus.location.speed / 3.6) * Math.min(1, closing / movement);
      etaSeconds = distance / closingSpeed;
    }
  }
  return {
    distance,
    etaSeconds,
    within100m: distance <= 100,
    arrivingSoon: etaSeconds !== null && etaSeconds <= 10,
  };
}

export function arrivalTrigger(state, previous) {
  const flags =
    state.distance > 150 && previous?.distance <= 150
      ? {}
      : { ...previous?.flags };
  const kind =
    state.arrivingSoon && !flags.soon
      ? "soon"
      : state.within100m && !flags.near
        ? "near"
        : null;
  if (kind) {
    flags[kind] = true;
    if (kind === "soon" && state.within100m) flags.near = true;
  }
  return { kind, flags };
}
