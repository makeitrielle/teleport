import { test } from "node:test";
import assert from "node:assert/strict";
import { destinationProgress } from "../../shared/destinationProgress.js";
const now = Date.now();
const route = [
  [14.35, 120.97],
  [14.55, 120.97],
];
const bus = {
  from: "SM Pala-Pala",
  to: "PITX",
  location: {
    lat: 14.4,
    lon: 120.97,
    speed: 36,
    accuracy: 10,
    updatedAt: new Date(now),
  },
};
const ticket = { to: "PITX", dropoffLocation: { lat: 14.405, lon: 120.97 } };
test("destination ETA uses remaining route distance to the passenger's own drop-off", () => {
  const state = destinationProgress(ticket, bus, route, now);
  assert.ok(state.remainingMeters > 550 && state.remainingMeters < 560);
  assert.ok(state.etaSeconds > 55 && state.etaSeconds < 56);
  assert.equal(state.approaching, true);
  assert.equal(state.close, false);
  assert.equal(state.estimatedStop, false);
  assert.ok(state.progress > 0.9 && state.progress < 1);
});
test("fare-point-only kiosk tickets get an explicitly estimated route position", () => {
  const state = destinationProgress({ to: "Anabu Coastal" }, bus, route, now);
  assert.equal(state.estimatedStop, true);
  assert.ok(state.remainingMeters > 0);
  assert.equal(
    destinationProgress({ to: "Unknown stop" }, bus, route, now),
    null,
  );
});
test("destination ETA stops for stale GPS, stopped bus and a bus off its route", () => {
  assert.equal(destinationProgress(ticket, bus, route, now + 31000), null);
  assert.equal(
    destinationProgress(
      ticket,
      { ...bus, location: { ...bus.location, speed: 0 } },
      route,
      now,
    ).etaSeconds,
    null,
  );
  assert.equal(
    destinationProgress(
      ticket,
      { ...bus, location: { ...bus.location, lon: 121.2 } },
      route,
      now,
    ),
    null,
  );
});
test("close and passed drop-offs do not announce a future arrival", () => {
  const near = { ...bus, location: { ...bus.location, lat: 14.4045 } };
  assert.equal(destinationProgress(ticket, near, route, now).close, true);
  const beyond = { ...bus, location: { ...bus.location, lat: 14.409 } };
  const state = destinationProgress(ticket, beyond, route, now);
  assert.equal(state.passed, true);
  assert.equal(state.approaching, false);
  assert.equal(state.etaSeconds, null);
});
