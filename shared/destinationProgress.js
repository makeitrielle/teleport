import { gpsOnline, haversineMeters, validCoordinates } from "./proximity.js";
import { FARE_MATRIX, fareDirectionForRoute } from "./fareMatrix.js";

function project(points, lat, lon) {
  let total = 0,
    closest = Infinity,
    along = 0;
  for (let i = 1; i < points.length; i++) {
    const [aLat, aLon] = points[i - 1],
      [bLat, bLon] = points[i];
    const scale = Math.cos((lat * Math.PI) / 180);
    const dx = (bLon - aLon) * scale,
      dy = bLat - aLat;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((lon - aLon) * scale * dx + (lat - aLat) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
    const distance = haversineMeters(
      lat,
      lon,
      aLat + t * dy,
      aLon + t * (bLon - aLon),
    );
    const length = haversineMeters(aLat, aLon, bLat, bLon);
    if (distance < closest) {
      closest = distance;
      along = total + length * t;
    }
    total += length;
  }
  return { along, total, deviation: closest };
}

export function destinationProgress(ticket, bus, points, now = Date.now()) {
  if (
    !ticket ||
    !bus ||
    !gpsOnline(bus, now) ||
    now - new Date(bus.location.updatedAt).getTime() > 30000 ||
    !points ||
    points.length < 2
  )
    return null;
  const current = project(points, bus.location.lat, bus.location.lon);
  if (current.deviation > 1000) return null;
  const exact = validCoordinates(
    ticket.dropoffLocation?.lat,
    ticket.dropoffLocation?.lon,
  );
  let target;
  if (exact) {
    target = project(
      points,
      ticket.dropoffLocation.lat,
      ticket.dropoffLocation.lon,
    );
    if (target.deviation > 1000) return null;
  } else {
    const fares = FARE_MATRIX[fareDirectionForRoute(bus.from, bus.to)] || [];
    const fare = fares.find((f) => f.landmark === ticket.to);
    const fullDistance = fares.at(-1)?.distanceKm;
    if (!fare || !fullDistance) return null;
    target = { along: (current.total * fare.distanceKm) / fullDistance };
  }
  const remainingMeters = Math.max(0, target.along - current.along);
  const passed = current.along > target.along + 150;
  const etaSeconds =
    !passed && bus.location.speed > 2
      ? remainingMeters / (bus.location.speed / 3.6)
      : null;
  const close = exact
    ? haversineMeters(
        bus.location.lat,
        bus.location.lon,
        ticket.dropoffLocation.lat,
        ticket.dropoffLocation.lon,
      ) <= 100
    : remainingMeters <= 100 && !passed;
  return {
    remainingMeters,
    etaSeconds,
    passed,
    close,
    estimatedStop: !exact,
    approaching:
      !passed &&
      (remainingMeters <= 500 || (etaSeconds !== null && etaSeconds <= 60)),
    progress: Math.max(
      0,
      Math.min(1, current.along / (target.along || current.total || 1)),
    ),
  };
}
