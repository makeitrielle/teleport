import { test } from "node:test";
import assert from "node:assert/strict";
import { seatDisplayState } from "../../shared/seatPolicy.js";
import { seatAvailability } from "../../shared/nearbyAlerts.js";

const now = Date.now();
const bus = { monitoredSeatIds: [1, 2, 3, 4, 5] };
const seat = {
  id: 1,
  status: "available",
  occupancy: "available",
  sensor: "ok",
  sensorUpdatedAt: now,
};

test("ticket creation reserves a seat; only a fresh sensor can make it occupied", () => {
  assert.equal(seatDisplayState(bus, seat, now), "available");
  const reserved = { ...seat, status: "booked" };
  assert.equal(seatDisplayState(bus, reserved, now), "reserved");
  const seated = { ...reserved, occupancy: "occupied" };
  assert.equal(seatDisplayState(bus, seated, now), "occupied");
  assert.equal(
    seatDisplayState(bus, { ...seated, sensor: "fault" }, now),
    "reserved",
  );
  assert.equal(
    seatDisplayState(bus, { ...seated, sensorUpdatedAt: now - 90001 }, now),
    "reserved",
  );
  assert.equal(
    seatDisplayState(bus, { ...seated, sensorUpdatedAt: now + 1 }, now),
    "reserved",
  );
});

test("unknown and unmonitored sensors never imply occupation or an available seat", () => {
  for (const value of [
    { ...seat, sensor: "fault" },
    { ...seat, sensorUpdatedAt: null },
    { ...seat, id: 6, occupancy: "occupied" },
  ])
    assert.equal(seatDisplayState(bus, value, now), "offline");
  assert.equal(
    seatDisplayState(bus, { ...seat, occupancy: "occupied" }, now),
    "occupied",
  );
});

test("a reserved and occupied seat is counted as unavailable exactly once", () => {
  assert.deepEqual(
    seatAvailability(
      {
        ...bus,
        seats: [
          seat,
          { ...seat, id: 2, status: "booked" },
          { ...seat, id: 3, status: "booked", occupancy: "occupied" },
          { ...seat, id: 6 },
        ],
      },
      now,
    ),
    { available: 1, unavailable: 2, unknown: 1 },
  );
});
