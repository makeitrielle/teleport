export function validCoordinates(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}
export function gpsOnline(bus, now = Date.now()) {
  const loc = bus.location || {};
  const updated = new Date(loc.updatedAt).getTime();
  return (
    bus.trackingEnabled !== false &&
    validCoordinates(loc.lat, loc.lon) &&
    Boolean(loc.updatedAt) &&
    Number.isFinite(updated) &&
    now - updated <= 120000 &&
    updated <= now + 30000 &&
    ((Number.isFinite(loc.accuracy) &&
      loc.accuracy >= 0 &&
      loc.accuracy <= 50) ||
      ([2, 3].includes(loc.fixStatus) &&
        Number.isFinite(loc.dop) &&
        loc.dop > 0 &&
        loc.dop <= 3))
  );
}
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const rad = (n) => (n * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) *
      Math.cos(rad(lat2)) *
      Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return (
    6371000 *
    2 *
    Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)))
  );
}
export function proximityState(bus, now = Date.now()) {
  const loc = bus.location || {},
    target = bus.proximityTarget || {};
  const result = {
    busId: bus.busId,
    target: target.label || "No target configured",
    distanceMeters: null,
    lastUpdated: loc.updatedAt || null,
    status: "Location unavailable",
  };
  if (bus.trackingEnabled === false)
    return { ...result, status: "Tracking inactive" };
  if (
    !validCoordinates(loc.lat, loc.lon) ||
    !validCoordinates(target.lat, target.lon)
  )
    return result;
  const updated = new Date(loc.updatedAt).getTime();
  if (
    !loc.updatedAt ||
    !Number.isFinite(updated) ||
    now - updated > 120000 ||
    updated > now + 30000
  )
    return { ...result, status: "Location stale" };
  const metricAccuracy =
    Number.isFinite(loc.accuracy) && loc.accuracy >= 0 && loc.accuracy <= 50;
  const qualifiedFix =
    [2, 3].includes(loc.fixStatus) &&
    Number.isFinite(loc.dop) &&
    loc.dop > 0 &&
    loc.dop <= 3;
  if (!metricAccuracy && !qualifiedFix)
    return {
      ...result,
      reason:
        "GPS quality unavailable or poor: require accuracy ≤50 m, or a valid 2D/3D fix with GNSS DOP ≤3. GNSS DOP is not an accuracy in meters.",
    };
  const distanceMeters = haversineMeters(
    loc.lat,
    loc.lon,
    target.lat,
    target.lon,
  );
  return {
    ...result,
    distanceMeters,
    status: distanceMeters <= 100 ? "Within 100 m" : "Outside 100 m",
  };
}
