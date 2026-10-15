import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { createServer } from "node:http";
import { MongoMemoryServer } from "mongodb-memory-server";
import Bus from "../models/Bus.js";
import Ticket from "../models/Ticket.js";
import Trip from "../models/Trip.js";
import Admin from "../models/Admin.js";
import { Activity } from "../models/Activity.js";
import { hashToken, hashPassword } from "../security.js";
import { applySeatTelemetry } from "../seatTelemetry.js";
import { withReservationStatus } from "../reservationSeats.js";
import { releaseTicketSeat } from "../reservationSeats.js";

process.env.TELEPORT_TEST_MODE = "true";
process.env.SEAT_EMPTY_CONFIRM_MS = "1500";
const { app } = await import("../server.js");
let db, server, base, cookie;
const key = "seat-integration-test-device-key-only";
async function api(path, data, auth = cookie, method = data ? "POST" : "GET") {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Cookie: auth } : {}),
      ...(!auth && path.startsWith("/bus/")
        ? { Authorization: `Bearer ${key}` }
        : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  return {
    status: response.status,
    body: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
async function fixture() {
  const bus = await Bus.create({
    busId: crypto.randomUUID(),
    name: "Sensor test bus",
    from: "PITX",
    to: "SM Pala-Pala",
    totalSeats: 61,
    monitoredSeatIds: [12, 13],
    deviceTokenHash: hashToken(key),
    seats: [12, 13, 14].map((id) => ({
      id,
      occupancy: "available",
      sensor: "ok",
      sensorUpdatedAt: Date.now(),
    })),
  });
  const ticket = await Ticket.create({
    busId: bus._id,
    seatId: 12,
    from: bus.from,
    to: bus.to,
    qrCode: crypto.randomBytes(32).toString("hex"),
    bookingReference: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 3600000),
  });
  await Bus.updateOne(
    { _id: bus._id },
    { $set: { "seats.0.status": "booked" } },
  );
  return { bus, ticket };
}
async function view(bus, staff = true) {
  return (
    await withReservationStatus([await Bus.findById(bus._id).lean()], { staff })
  )[0].seats;
}
before(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  await Admin.create({
    name: "Seat Test Admin",
    kioskId: "SEAT-ADMIN",
    role: "admin",
    passwordHash: await hashPassword("test-seat-password"),
  });
  server = createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  cookie = (
    await api(
      "/admins/login",
      { kioskId: "SEAT-ADMIN", password: "test-seat-password" },
      null,
    )
  ).cookie;
  assert.ok(cookie);
});
after(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await db.stop();
});

test("reserved seat 12 becomes occupied everywhere without changing ticket, ownership or allocation", async () => {
  const { bus, ticket } = await fixture();
  assert.equal((await view(bus))[0].displayState, "reserved");
  const response = await api(
    "/bus/seats",
    {
      busId: bus.busId,
      seatId: 12,
      status: "occupied",
      observedAt: Date.now(),
    },
    null,
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body[0].displayState, "occupied");
  const kiosk = await api("/tickets/kiosk/buses", undefined, null);
  const staff = await api(`/buses/${bus._id}`);
  const tracking = await api("/tracking");
  assert.equal(
    kiosk.body.find((b) => b._id === String(bus._id)).seats[0].displayState,
    "occupied",
  );
  assert.equal(staff.body.seats[0].displayState, "occupied");
  assert.equal(
    tracking.body.find((b) => b.id === String(bus._id)).seats[0].displayState,
    "occupied",
  );
  const saved = await Ticket.findById(ticket._id);
  assert.equal(saved.qrCode, ticket.qrCode);
  assert.equal(saved.status, "active");
  assert.equal(saved.passengerId, null);
  assert.equal(saved.seatId, 12);
  assert.equal((await Bus.findById(bus._id)).seats[0].status, "booked");
  assert.equal(staff.body.seats[0].occupancyWarning, "occupant_not_verified");
  assert.ok(
    !(
      "occupancyWarning" in
      kiosk.body.find((b) => b._id === String(bus._id)).seats[0]
    ),
  );
  const checked = await api(`/buses/${bus._id}/seats/12/verify-occupant`, {
    reference: ticket.qrCode,
  });
  assert.equal(checked.status, 200);
  assert.equal((await view(bus))[0].occupancyWarning, null);
  const log = await Activity.findOne({
    busId: bus._id,
    seatId: 12,
    event: "seat.occupied",
  });
  assert.equal(log.newState, "occupied");
  assert.equal(String(log.ticketId), String(ticket._id));
});

test("temporary stand-up, contact bounce and duplicate empty readings do not extend or release reservation", async () => {
  const { bus } = await fixture();
  await applySeatTelemetry(bus._id, { seatId: 12, status: "occupied" });
  await applySeatTelemetry(bus._id, { seatId: 12, status: "available" });
  const first = (await view(bus))[0];
  assert.equal(first.displayState, "occupied");
  assert.ok(first.occupiedHoldUntil > Date.now());
  await applySeatTelemetry(bus._id, { seatId: 12, status: "available" });
  assert.equal((await view(bus))[0].occupiedHoldUntil, first.occupiedHoldUntil);
  await Bus.updateOne(
    { _id: bus._id },
    { $set: { "seats.0.occupiedHoldUntil": Date.now() - 1 } },
  );
  assert.equal((await view(bus))[0].displayState, "reserved");
  await applySeatTelemetry(bus._id, { seatId: 12, status: "occupied" });
  assert.equal((await view(bus))[0].displayState, "occupied");
});

test("confirmed empty unreserved seat becomes available, but a hold cannot be booked", async () => {
  const { bus } = await fixture();
  await applySeatTelemetry(bus._id, { seatId: 13, status: "occupied" });
  assert.equal(
    (await view(bus))[1].occupancyWarning,
    "occupied_without_reservation",
  );
  await applySeatTelemetry(bus._id, { seatId: 13, status: "available" });
  assert.equal((await view(bus))[1].displayState, "occupied");
  const claim = await Bus.findOneAndUpdate(
    {
      _id: bus._id,
      seats: {
        $elemMatch: {
          id: 13,
          occupancy: "available",
          occupiedHoldUntil: { $not: { $gt: Date.now() } },
        },
      },
    },
    { $set: { "seats.$.status": "booked" } },
  );
  assert.equal(claim, null);
  await Bus.updateOne(
    { _id: bus._id },
    { $set: { "seats.1.occupiedHoldUntil": Date.now() - 1 } },
  );
  assert.equal((await view(bus))[1].displayState, "available");
});

test("stale, malformed, unconfigured and unauthorized readings are rejected; timestamp retries are idempotent", async () => {
  const { bus } = await fixture();
  for (const data of [
    { seatId: 12.5, status: "occupied" },
    { seatId: 12, status: "reserved" },
    { seatId: 12, status: "available", sensor: "fault" },
    { seatId: 12, status: "occupied", observedAt: Date.now() - 100000 },
  ]) {
    assert.equal(
      (await api("/bus/seats", { busId: bus.busId, ...data }, null)).status,
      400,
    );
  }
  assert.equal(
    (
      await api(
        "/bus/seats",
        { busId: bus.busId, seatId: 14, status: "occupied" },
        null,
      )
    ).status,
    409,
  );
  const time = Date.now();
  await applySeatTelemetry(bus._id, {
    seatId: 12,
    status: "occupied",
    observedAt: time,
  });
  const count = await Activity.countDocuments({
    busId: bus._id,
    event: "seat.occupied",
  });
  await applySeatTelemetry(bus._id, {
    seatId: 12,
    status: "available",
    observedAt: time - 1,
  });
  await applySeatTelemetry(bus._id, {
    seatId: 12,
    status: "occupied",
    observedAt: time,
  });
  assert.equal((await view(bus))[0].displayState, "occupied");
  assert.equal(
    await Activity.countDocuments({ busId: bus._id, event: "seat.occupied" }),
    count,
  );
  assert.equal(
    (
      await api(
        "/bus/seats",
        { busId: "WRONG-BUS", seatId: 12, status: "occupied" },
        null,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await api(
        `/buses/${bus._id}/seats/12/verify-occupant`,
        { reference: "a".repeat(64) },
        null,
      )
    ).status,
    401,
  );
});

test("concurrent seat and allocation writes do not overwrite another seat or the reservation", async () => {
  const { bus } = await fixture();
  await Promise.all([
    applySeatTelemetry(bus._id, { seatId: 12, status: "occupied" }),
    applySeatTelemetry(bus._id, { seatId: 13, status: "occupied" }),
    Bus.updateOne({ _id: bus._id }, { $set: { "seats.0.status": "booked" } }),
  ]);
  const seats = await view(bus);
  assert.equal(seats[0].displayState, "occupied");
  assert.equal(seats[1].displayState, "occupied");
  assert.equal((await Bus.findById(bus._id)).seats[0].status, "booked");
});

test("wrong-seat verification flags a conflict without reassigning the ticket", async () => {
  const { bus, ticket } = await fixture();
  await applySeatTelemetry(bus._id, { seatId: 13, status: "occupied" });
  const result = await api(`/buses/${bus._id}/seats/13/verify-occupant`, {
    reference: ticket.qrCode,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.warning, "wrong_seat");
  assert.equal((await view(bus))[1].occupancyWarning, "wrong_seat");
  assert.equal((await Ticket.findById(ticket._id)).seatId, 12);
  assert.equal((await Ticket.findById(ticket._id)).passengerId, null);
});

test("trip completion retains ticket history and releases only an empty seat after the hold", async () => {
  const { bus, ticket } = await fixture();
  const trip = await Trip.create({
    busId: bus._id,
    from: bus.from,
    to: bus.to,
    departureAt: new Date(),
    seatIds: [12],
  });
  await Ticket.updateOne({ _id: ticket._id }, { $set: { tripId: trip._id } });
  await applySeatTelemetry(bus._id, { seatId: 12, status: "occupied" });
  const result = await api(
    `/trips/${trip._id}`,
    { status: "completed" },
    cookie,
    "PATCH",
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal((await Ticket.findById(ticket._id)).status, "used");
  assert.equal((await Bus.findById(bus._id)).seats[0].status, "available");
  assert.equal((await view(bus))[0].displayState, "occupied");
  await applySeatTelemetry(bus._id, { seatId: 12, status: "available" });
  await Bus.updateOne(
    { _id: bus._id },
    { $set: { "seats.0.occupiedHoldUntil": Date.now() - 1 } },
  );
  assert.equal((await view(bus))[0].displayState, "available");
  assert.equal((await Ticket.findById(ticket._id)).qrCode, ticket.qrCode);
});

test("completion of an old ticket cannot unlock a newer in-flight ticket sale", async () => {
  const { bus, ticket } = await fixture();
  await Ticket.updateOne({ _id: ticket._id }, { $set: { status: "used" } });
  const newerTicketId = new mongoose.Types.ObjectId();
  await Bus.updateOne(
    { _id: bus._id },
    {
      $set: {
        "seats.0.allocationTicketId": newerTicketId,
        "seats.0.status": "booked",
      },
    },
  );
  await releaseTicketSeat(ticket);
  const seat = (await Bus.findById(bus._id)).seats[0];
  assert.equal(seat.status, "booked");
  assert.equal(String(seat.allocationTicketId), String(newerTicketId));
});

test("simultaneous retries audit one transition and a failed sensor never releases the ticket", async () => {
  const { bus, ticket } = await fixture();
  const data = { seatId: 12, status: "occupied", observedAt: Date.now() };
  await Promise.all([
    applySeatTelemetry(bus._id, data),
    applySeatTelemetry(bus._id, data),
  ]);
  assert.equal(
    await Activity.countDocuments({
      busId: bus._id,
      seatId: 12,
      event: "seat.occupied",
    }),
    1,
  );
  await applySeatTelemetry(bus._id, { seatId: 12, sensor: "fault" });
  assert.equal((await view(bus))[0].displayState, "reserved");
  assert.equal((await Ticket.findById(ticket._id)).status, "active");
});

test("an audit outage is recoverable without losing or duplicating the saved transition", async (t) => {
  const { bus } = await fixture();
  const data = { seatId: 12, status: "occupied", observedAt: Date.now() };
  const mock = t.mock.method(Activity, "updateOne", () => {
    throw new Error("simulated audit outage");
  });
  await assert.rejects(
    applySeatTelemetry(bus._id, data),
    /simulated audit outage/,
  );
  let saved = (await Bus.findById(bus._id)).seats[0];
  assert.equal(saved.occupancy, "occupied");
  assert.ok(saved.pendingSensorEvent);
  mock.mock.restore();
  await applySeatTelemetry(bus._id, data);
  saved = (await Bus.findById(bus._id)).seats[0];
  assert.ok(!saved.pendingSensorEvent);
  assert.equal(
    await Activity.countDocuments({
      busId: bus._id,
      seatId: 12,
      event: "seat.occupied",
    }),
    1,
  );
});

test("kiosk sells seat 12 once, retains its ticket while occupied and can reuse it after expiry and confirmed vacancy", async () => {
  const { bus, ticket } = await fixture();
  await Ticket.updateOne({ _id: ticket._id }, { $set: { status: "used" } });
  await releaseTicketSeat(ticket);
  const data = {
    busId: String(bus._id),
    seatId: 12,
    passengerType: "regular",
    to: "Pala-Pala",
    distanceKm: 27,
  };
  const results = await Promise.all([
    api("/tickets/kiosk", data, null),
    api("/tickets/kiosk", data, null),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const issued = results.find((r) => r.status === 201).body;
  assert.equal((await view(bus))[0].displayState, "reserved");
  await api(
    "/bus/seats",
    { busId: bus.busId, seatId: 12, status: "occupied" },
    null,
  );
  assert.equal((await view(bus))[0].displayState, "occupied");
  assert.equal((await Ticket.findById(issued._id)).status, "active");
  await api(
    "/bus/seats",
    { busId: bus.busId, seatId: 12, status: "available" },
    null,
  );
  assert.equal((await api("/tickets/kiosk", data, null)).status, 409);
  await Ticket.updateOne(
    { _id: issued._id },
    { $set: { expiresAt: new Date(Date.now() - 1) } },
  );
  await Bus.updateOne(
    { _id: bus._id },
    { $set: { "seats.0.occupiedHoldUntil": Date.now() - 1 } },
  );
  assert.equal((await api("/tickets/kiosk", data, null)).status, 201);
  assert.equal((await Ticket.findById(issued._id)).qrCode, issued.qrCode);
});
