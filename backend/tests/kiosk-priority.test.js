import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Admin from "../models/Admin.js";
import Bus from "../models/Bus.js";
import Ticket from "../models/Ticket.js";
import { hashPassword } from "../security.js";
import { kioskSeatLayout, isPrioritySeat } from "../../shared/seatPolicy.js";
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
          dropoffLocation: { lat: 14.509, lon: 120.991 },
        }),
      });
    }
    assert.equal((await selfServe(3, "regular")).status, 403);
    assert.equal((await selfServe(3, "student")).status, 403);
    assert.equal((await selfServe(3, "pwd", false)).status, 400);
    const selfTicket = await selfServe(3, "pwd");
    assert.equal(selfTicket.status, 201);
    const selfBody = await selfTicket.json();
    assert.equal(selfBody.categoryVerified, false);
    assert.equal(selfBody.eligibilityDeclared, true);
    assert.equal((await selfServe(3, "pwd")).status, 409);
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
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await memory.stop();
  }
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
