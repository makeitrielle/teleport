import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Admin from "../models/Admin.js";
import Bus from "../models/Bus.js";
import Ticket from "../models/Ticket.js";
import { hashPassword } from "../security.js";
process.env.TELEPORT_TEST_MODE = "true";
const { app } = await import("../server.js");
test("kiosk first row rejects regular and student, permits verified PWD and senior", async () => {
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
      totalSeats: 6,
      monitoredSeatIds: [1, 2, 3, 4, 5, 6],
      seats: [1, 2, 3, 4, 5, 6].map((id) => ({
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
      for (const seatId of [1, 2, 3, 4])
        assert.equal((await issue(seatId, category)).status, 403);
    }
    assert.equal((await issue(1, "pwd", false)).status, 400);
    assert.equal((await issue(1, "pwd")).status, 201);
    assert.equal((await issue(2, "senior")).status, 201);
    assert.equal((await issue(5, "regular")).status, 201);
    assert.equal((await issue(6, "student")).status, 201);
    assert.equal(await Ticket.countDocuments({ busId: bus._id }), 4);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await memory.stop();
  }
});
