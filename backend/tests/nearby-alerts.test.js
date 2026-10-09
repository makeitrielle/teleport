import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arrivalState,
  arrivalTrigger,
  seatAvailability,
} from "../../shared/nearbyAlerts.js";
const now = Date.now();
test("arrival notifications do not repeat until a bus leaves the arrival area", () => {
  const near = { distance: 90, within100m: true, arrivingSoon: false };
  const first = arrivalTrigger(near);
  assert.equal(first.kind, "near");
  const previous = { flags: first.flags, distance: 90 };
  assert.equal(arrivalTrigger(near, previous).kind, null);
  const soon = arrivalTrigger({ ...near, arrivingSoon: true }, previous);
  assert.equal(soon.kind, "soon");
  assert.equal(
    arrivalTrigger(
      { ...near, arrivingSoon: true },
      { flags: soon.flags, distance: 90 },
    ).kind,
    null,
  );
  const left = arrivalTrigger(
    { distance: 160, within100m: false, arrivingSoon: false },
    previous,
  );
  assert.equal(
    arrivalTrigger(near, { flags: left.flags, distance: 160 }).kind,
    "near",
  );
});
const user = { lat: 14.4, lon: 120.97, accuracy: 10, timestamp: now };
const bus = (lat, speed = 36) => ({
  location: {
    lat,
    lon: user.lon,
    accuracy: 10,
    speed,
    updatedAt: new Date(now),
  },
});
test("within-100-meter alert also works for a stopped bus", () => {
  const state = arrivalState(bus(user.lat + 0.0005, 0), user, null, now);
  assert.equal(state.within100m, true);
  assert.equal(state.etaSeconds, null);
  assert.equal(state.arrivingSoon, false);
});
test("ten-second alert requires a bus moving toward the passenger", () => {
  const previous = {
    lat: user.lat + 0.0012,
    lon: user.lon,
    updatedAt: new Date(now - 5000),
  };
  const approaching = arrivalState(bus(user.lat + 0.0007), user, previous, now);
  assert.equal(approaching.arrivingSoon, true);
  assert.ok(approaching.etaSeconds > 7 && approaching.etaSeconds < 9);
  assert.equal(
    arrivalState(bus(user.lat + 0.0017), user, previous, now).arrivingSoon,
    false,
  );
  assert.equal(
    arrivalState(bus(user.lat + 0.0007, 0), user, previous, now).arrivingSoon,
    false,
  );
  assert.equal(
    arrivalState(bus(user.lat + 0.0007), user, null, now).arrivingSoon,
    false,
  );
});
test("arrival alerts reject stale, disabled and inaccurate GPS or passenger location", () => {
  const b = bus(user.lat + 0.0005);
  assert.equal(arrivalState(b, { ...user, accuracy: 100 }, null, now), null);
  assert.equal(
    arrivalState(b, { ...user, timestamp: now - 31000 }, null, now),
    null,
  );
  assert.equal(
    arrivalState({ ...b, trackingEnabled: false }, user, null, now),
    null,
  );
  assert.equal(
    arrivalState(
      { location: { ...b.location, updatedAt: new Date(now - 31000) } },
      user,
      null,
      now,
    ),
    null,
  );
});
test("notification counts exclude reservations and missing sensors from availability", () => {
  const b = {
    monitoredSeatIds: [1, 2, 3, 4],
    seats: [
      { id: 1, sensor: "ok", occupancy: "available", sensorUpdatedAt: now },
      {
        id: 2,
        sensor: "ok",
        occupancy: "available",
        sensorUpdatedAt: now,
        status: "booked",
      },
      { id: 3, sensor: "ok", occupancy: "occupied", sensorUpdatedAt: now },
      {
        id: 4,
        sensor: "ok",
        occupancy: "available",
        sensorUpdatedAt: now - 100000,
      },
      { id: 5, sensor: "ok", occupancy: "available", sensorUpdatedAt: now },
    ],
  };
  assert.deepEqual(seatAvailability(b, now), {
    available: 1,
    unavailable: 2,
    unknown: 2,
  });
});
