import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Admin from "../models/Admin.js";
import Bus from "../models/Bus.js";
import Ticket from "../models/Ticket.js";
import Passenger from "../models/Passenger.js";
import { gpsOnline } from "../../shared/proximity.js";
import { hashToken, hashPassword } from "../security.js";
import {
  kioskSeatLayout,
  isPrioritySeat,
  isSeatMonitored,
} from "../../shared/seatPolicy.js";
process.env.TELEPORT_TEST_MODE = "true";
const { app } = await import("../server.js");
test("self-service kiosk preserves priority seating, prevents duplicate booking and keeps staff routes private", async () => {
  const memory = await MongoMemoryServer.create();
  let server;
  try {
    await mongoose.connect(memory.getUri());
    await Ticket.init();
    await Admin.create({
      name: "Priority test",
      kioskId: "PRIORITY-TEST",
      role: "admin",
      passwordHash: await hashPassword("test-password-123"),
    });
    const bus = await Bus.create({
      name: "Priority test bus",
      busId: "PRIORITY-TEST-BUS",
      from: "SM Pala-Pala",
      to: "PITX",
      totalSeats: 7,
      monitoredSeatIds: [1, 2, 3, 4, 5, 6, 7],
      seats: [1, 2, 3, 4, 5, 6, 7].map((id) => ({
        id,
        sensor: "ok",
        occupancy: "available",
        sensorUpdatedAt: Date.now(),
      })),
    });
    server = createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const login = await fetch(base + "/admins/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kioskId: "PRIORITY-TEST",
        password: "test-password-123",
      }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    async function issue(seatId, passengerType, categoryVerified = true) {
      return fetch(base + "/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          busId: String(bus._id),
          seatId,
          passengerType,
          categoryVerified,
          to: "PITX",
          distanceKm: 27,
          dropoffLocation: { lat: 14.509, lon: 120.991 },
        }),
      });
    }
    for (const category of ["regular", "student"]) {
      for (const seatId of [1, 2, 3, 4, 5])
        assert.equal((await issue(seatId, category)).status, 403);
    }
    assert.equal((await issue(1, "pwd", false)).status, 400);
    assert.equal((await issue(1, "pwd")).status, 201);
    assert.equal((await issue(2, "senior")).status, 201);
    assert.equal((await issue(6, "regular")).status, 201);
    assert.equal((await issue(7, "student")).status, 201);
    assert.equal(await Ticket.countDocuments({ busId: bus._id }), 4);
    const publicBuses = await fetch(base + "/tickets/kiosk/buses");
    assert.equal(publicBuses.status, 200);
    const publicBus = (await publicBuses.json())[0];
    assert.equal(publicBus.busId, "PRIORITY-TEST-BUS");
    assert.equal(publicBus.deviceTokenHash, undefined);
    assert.equal(publicBus.location, undefined);
    assert.equal((await fetch(base + "/buses")).status, 401);
    async function selfServe(
      seatId,
      passengerType,
      eligibilityDeclared = true,
    ) {
      return fetch(base + "/tickets/kiosk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          busId: String(bus._id),
          seatId,
          passengerType,
          eligibilityDeclared,
          categoryVerified: true,
          to: "PITX",
          distanceKm: 27,
        }),
      });
    }
    assert.equal((await selfServe(3, "regular")).status, 403);
    assert.equal((await selfServe(3, "student")).status, 403);
    assert.equal((await selfServe(3, "pwd", false)).status, 400);
    const selfTicket = await selfServe(3, "pwd");
    assert.equal(selfTicket.status, 201);
    const selfBody = await selfTicket.json();
    const storedSelfTicket = await Ticket.findOne({
      seatId: 3,
      busId: bus._id,
    });
    assert.equal(storedSelfTicket.to, "PITX");
    assert.equal(storedSelfTicket.fare, 54);
    assert.equal(storedSelfTicket.dropoffLocation?.lat, undefined);
    assert.equal(selfBody.categoryVerified, false);
    assert.equal(selfBody.eligibilityDeclared, true);
    assert.equal((await selfServe(3, "pwd")).status, 409);
    const deviceKey = "isolated-device-key-for-reservation-test";
    await Bus.updateOne(
      { _id: bus._id },
      { $set: { deviceTokenHash: hashToken(deviceKey) } },
    );
    const telemetry = await fetch(base + "/bus/seats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deviceKey}`,
      },
      body: JSON.stringify({
        busId: bus.busId,
        seatId: 3,
        status: "available",
      }),
    });
    assert.equal(telemetry.status, 200);
    const monitor = await fetch(base + "/tickets/kiosk/buses");
    const monitoredSeat = (await monitor.json())[0].seats.find(
      (seat) => seat.id === 3,
    );
    assert.equal(monitoredSeat.occupancy, "available");
    assert.equal(monitoredSeat.status, "booked");
    assert.equal((await selfServe(3, "pwd")).status, 409);
    // A scheduled reservation is also visible without changing physical telemetry.
    await Ticket.create({
      busId: bus._id,
      tripId: new mongoose.Types.ObjectId(),
      seatId: 5,
      from: bus.from,
      to: bus.to,
      qrCode: "a".repeat(64),
      expiresAt: new Date(Date.now() + 60000),
    });
    const scheduledMonitor = await fetch(base + "/tickets/kiosk/buses");
    assert.equal(
      (await scheduledMonitor.json())[0].seats.find((seat) => seat.id === 5)
        .status,
      "booked",
    );
    await Ticket.updateOne(
      { qrCode: "a".repeat(64) },
      { $set: { status: "used" } },
    );
    const releasedMonitor = await fetch(base + "/tickets/kiosk/buses");
    assert.equal(
      (await releasedMonitor.json())[0].seats.find((seat) => seat.id === 5)
        .status,
      "available",
    );

    const verified = await fetch(base + "/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference: selfBody.qrCode }),
    });
    assert.equal((await verified.json()).passengerType, "pwd");
    const authorization = await fetch(base + "/receipt-authorization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference: selfBody.qrCode }),
    });
    assert.equal(authorization.status, 200);
    assert.equal(
      (
        await fetch(base + "/tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      401,
    );
    await Bus.collection.updateOne(
      { _id: bus._id },
      { $unset: { monitoredSeatIds: "" } },
    );
    const legacyMonitor = await fetch(base + "/tickets/kiosk/buses");
    assert.deepEqual(
      (await legacyMonitor.json())[0].monitoredSeatIds,
      [1, 2, 3, 4, 5],
    );
    // A passenger without reservations can discover live buses, but not stale,
    // disabled or poor-quality GPS devices; device secrets are never returned.
    await Passenger.create({
      name: "Fleet test passenger",
      email: "fleet@example.invalid",
      emailVerified: true,
      passwordHash: await hashPassword("test-password-123"),
    });
    const passengerLogin = await fetch(base + "/passengers/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "fleet@example.invalid",
        password: "test-password-123",
      }),
    });
    assert.equal(passengerLogin.status, 200);
    const passengerCookie = passengerLogin.headers
      .get("set-cookie")
      .split(";")[0];
    const fix = { lat: 14.4, lon: 120.97, updatedAt: new Date(), accuracy: 10 };
    await Bus.updateOne({ _id: bus._id }, { $set: { location: fix } });
    for (const [id, extra] of [
      ["SECOND-LIVE", { location: fix }],
      [
        "STALE",
        { location: { ...fix, updatedAt: new Date(Date.now() - 180000) } },
      ],
      ["DISABLED", { location: fix, trackingEnabled: false }],
      ["POOR-GPS", { location: { ...fix, accuracy: 500 } }],
    ])
      await Bus.create({
        busId: id,
        name: id,
        from: "SM Pala-Pala",
        to: "PITX",
        totalSeats: 1,
        ...extra,
      });
    const fleetResponse = await fetch(base + "/tracking", {
      headers: { Cookie: passengerCookie },
    });
    assert.equal(fleetResponse.status, 200);
    const fleet = await fleetResponse.json();
    assert.deepEqual(fleet.map((b) => b.busId).sort(), [
      "PRIORITY-TEST-BUS",
      "SECOND-LIVE",
    ]);
    assert.equal(
      fleet.find((b) => b.busId === bus.busId).seats.find((s) => s.id === 3)
        .status,
      "booked",
    );
    assert.equal(fleet[0].online, true);
    assert.equal(fleet[0].from, "SM Pala-Pala");
    assert.equal(fleet[0].deviceTokenHash, undefined);
    assert.equal((await fetch(base + "/tracking")).status, 401);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await memory.stop();
  }
});

test("GPS discovery does not require a proximity target and rejects stale or invalid fixes", () => {
  const now = Date.now();
  const bus = {
    location: {
      lat: 14.4,
      lon: 120.97,
      updatedAt: new Date(now),
      accuracy: 10,
    },
  };
  assert.equal(gpsOnline(bus, now), true);
  assert.equal(gpsOnline(bus, now + 120001), false);
  assert.equal(gpsOnline({ ...bus, trackingEnabled: false }, now), false);
  assert.equal(
    gpsOnline({ location: { ...bus.location, lat: 100 } }, now),
    false,
  );
  assert.equal(
    gpsOnline(
      { location: { ...bus.location, updatedAt: new Date(now + 31000) } },
      now,
    ),
    false,
  );
});

test("61-seat layout has five priority seats and six seats in the last row", () => {
  const seats = kioskSeatLayout({ seats: [{ id: 61, sensor: "ok" }] });
  assert.equal(seats.length, 61);
  assert.deepEqual(
    seats.slice(55).map((s) => s.id),
    [56, 57, 58, 59, 60, 61],
  );
  assert.deepEqual(
    seats.filter((s) => isPrioritySeat(null, s.id)).map((s) => s.id),
    [1, 2, 3, 4, 5],
  );
  assert.equal(seats[60].sensor, "ok");
  assert.equal(seats[5].sensor, "fault");
});

test("legacy buses without a monitored-seat list safely use the five installed sensors", () => {
  assert.equal(isSeatMonitored({}, 1), true);
  assert.equal(isSeatMonitored({}, 5), true);
  assert.equal(isSeatMonitored({}, 6), false);
  assert.equal(isSeatMonitored({ monitoredSeatIds: [] }, 1), false);
  assert.equal(isSeatMonitored({ monitoredSeatIds: [6] }, 6), true);
});
