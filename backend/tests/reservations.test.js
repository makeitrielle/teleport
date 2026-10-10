import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  hashPassword,
  verifyPassword,
  Session,
  hashToken,
} from "../security.js";
import Passenger from "../models/Passenger.js";
import Admin from "../models/Admin.js";
import Bus from "../models/Bus.js";
import Trip from "../models/Trip.js";
import Ticket from "../models/Ticket.js";
import Notification from "../models/Notification.js";
import { Activity } from "../models/Activity.js";
import { proximityState, haversineMeters } from "../../shared/proximity.js";
import { attachPrintAgent } from "../printAgent.js";
import { removeLegacyPhoneUniqueness } from "../db.js";

process.env.TELEPORT_TEST_MODE = "true";
process.env.ALLOWED_ORIGINS = "http://localhost:5173";
process.env.AGENT_SECRET = "test-agent-secret-only-never-production";
const { app } = await import("../server.js");
let db,
  server,
  base,
  passenger,
  other,
  admin,
  bus,
  bus2,
  trip,
  cookie,
  otherCookie,
  adminCookie,
  ticket,
  agent,
  printOutcome = "ok";
async function http(
  path,
  {
    data,
    method = data ? "POST" : "GET",
    cookie: auth = cookie,
    headers = {},
  } = {},
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Cookie: auth } : {}),
      ...headers,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const body = await response.json().catch(() => null);
  return {
    status: response.status,
    body,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
before(async () => {
  db = await MongoMemoryServer.create({
    instance: { dbName: "teleport-isolated-tests" },
  });
  await mongoose.connect(db.getUri());
  await Promise.all([
    Ticket.init(),
    Session.init(),
    Admin.init(),
    Bus.init(),
    Passenger.init(),
  ]);
  const passwordHash = await hashPassword("test-password-123");
  passenger = await Passenger.create({
    name: "Passenger One",
    email: "one@example.invalid",
    emailVerified: true,
    passwordHash,
    category: "pwd",
    categoryVerified: true,
  });
  other = await Passenger.create({
    name: "Passenger Two",
    email: "two@example.invalid",
    emailVerified: true,
    passwordHash,
  });
  admin = await Admin.create({
    name: "Test Administrator",
    kioskId: "TEST-ADMIN",
    role: "admin",
    passwordHash,
  });
  bus = await Bus.create({
    name: "Test Bus",
    busId: "TEST-BUS-1",
    from: "PITX",
    to: "SM Pala-Pala",
    totalSeats: 5,
    seats: [1, 2, 3, 4, 5].map((id) => ({
      id,
      status: "available",
      occupancy: "available",
      sensor: "ok",
      sensorUpdatedAt: Date.now(),
    })),
  });
  bus2 = await Bus.create({
    name: "Second Bus",
    busId: "TEST-BUS-2",
    from: "SM Pala-Pala",
    to: "PITX",
    totalSeats: 5,
    seats: [1, 2, 3, 4, 5].map((id) => ({ id, sensor: "fault" })),
  });
  trip = await Trip.create({
    busId: bus._id,
    from: bus.from,
    to: bus.to,
    departureAt: new Date(Date.now() + 3600000),
    arrivalAt: new Date(Date.now() + 7200000),
    seatIds: [1, 2, 3, 4, 5],
  });
  server = createServer(app);
  attachPrintAgent(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  cookie = (
    await http("/passengers/login", {
      data: { email: passenger.email, password: "test-password-123" },
      cookie: null,
    })
  ).cookie;
  otherCookie = (
    await http("/passengers/login", {
      data: { email: other.email, password: "test-password-123" },
      cookie: null,
    })
  ).cookie;
  adminCookie = (
    await http("/admins/login", {
      data: { kioskId: admin.kioskId, password: "test-password-123" },
      cookie: null,
    })
  ).cookie;
});
after(async () => {
  agent?.terminate();
  await new Promise((resolve) => server?.close(resolve));
  await mongoose.disconnect();
  await db?.stop();
});

test("passwords are salted scrypt and legacy SHA256 is still verified for migration", async () => {
  const a = await hashPassword("password123"),
    b = await hashPassword("password123");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("password123", a), true);
  assert.equal(await verifyPassword("wrong", a), false);
  await assert.rejects(() => hashPassword("1234"));
  assert.equal(
    await verifyPassword(
      "1234",
      await hashPassword("1234", { allowLegacy: true }),
    ),
    true,
  );
  assert.equal(
    await verifyPassword("password123", hashToken("password123")),
    true,
  );
});
test("registration, email verification and password reset use hashed one-time tokens and revoke old sessions", async () => {
  const actualFetch = globalThis.fetch,
    emails = [];
  process.env.RESEND_API_KEY = "test-only";
  process.env.EMAIL_FROM = "qa@example.invalid";
  globalThis.fetch = async (url, options) => {
    if (String(url) === "https://api.resend.com/emails") {
      emails.push(JSON.parse(options.body));
      return new Response("{}", { status: 200 });
    }
    return actualFetch(url, options);
  };
  try {
    const signup = await http("/passengers/signup", {
      cookie: null,
      data: {
        name: "Registered test user",
        email: "registered@example.invalid",
        password: "old-test-password",
      },
    });
    assert.equal(signup.status, 201);
    assert.equal(signup.body.passwordHash, undefined);
    assert.equal(signup.body.emailVerificationTokenHash, undefined);
    assert.equal(
      (
        await http("/passengers/login", {
          cookie: null,
          data: {
            email: "registered@example.invalid",
            password: "old-test-password",
          },
        })
      ).status,
      403,
    );
    const verifyToken = emails[0].text.match(/verify=([a-f0-9]{64})/)[1];
    assert.equal(
      (
        await http("/passengers/verify-email", {
          cookie: null,
          data: { token: verifyToken },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await http("/passengers/verify-email", {
          cookie: null,
          data: { token: verifyToken },
        })
      ).status,
      400,
    );
    const signed = await http("/passengers/login", {
      cookie: null,
      data: {
        email: "registered@example.invalid",
        password: "old-test-password",
      },
    });
    assert.equal(signed.status, 200);
    await http("/passengers/forgot-password", {
      cookie: null,
      data: { email: "registered@example.invalid" },
    });
    const resetToken = emails[1].text.match(/reset=([a-f0-9]{64})/)[1];
    assert.equal(
      (
        await http("/passengers/reset-password", {
          cookie: null,
          data: { token: resetToken, password: "new-test-password" },
        })
      ).status,
      200,
    );
    assert.equal(
      (await http("/reservations", { cookie: signed.cookie })).status,
      401,
    );
    assert.equal(
      (
        await http("/passengers/reset-password", {
          cookie: null,
          data: { token: resetToken, password: "new-test-password" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await http("/passengers/login", {
          cookie: null,
          data: {
            email: "registered@example.invalid",
            password: "old-test-password",
          },
        })
      ).status,
      401,
    );
  } finally {
    globalThis.fetch = actualFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  }
});
test("profile photos persist for their owner and reject unauthorized or unsafe updates", async () => {
  const profilePhoto = "data:image/jpeg;base64,/9j/2Q==";
  const path = `/passengers/${passenger._id}`;
  const saved = await http(path, { method: "PATCH", data: { profilePhoto } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.profilePhoto, profilePhoto);
  assert.equal((await http("/session")).body.user.profilePhoto, profilePhoto);
  assert.equal(
    (
      await http(path, {
        method: "PATCH",
        cookie: otherCookie,
        data: { profilePhoto: "" },
      })
    ).status,
    403,
  );
  for (const invalid of [
    "https://example.invalid/photo.jpg",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/jpeg;base64," + "A".repeat(24000),
  ]) {
    assert.equal(
      (await http(path, { method: "PATCH", data: { profilePhoto: invalid } }))
        .status,
      400,
    );
  }
  assert.equal(
    (await Passenger.findById(passenger._id)).profilePhoto,
    profilePhoto,
  );
  const removed = await http(path, {
    method: "PATCH",
    data: { profilePhoto: "" },
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.profilePhoto, "");
});

test("legacy phone migration allows empty phones while preserving email uniqueness", async () => {
  const collection = mongoose.connection.db.collection(
    "phone-index-migration-test",
  );
  try {
    await collection.createIndex({ phone: 1 }, { unique: true });
    await collection.createIndex({ email: 1 }, { unique: true });
    await collection.insertOne({ email: "first@example.invalid", phone: "" });
    await assert.rejects(
      collection.insertOne({ email: "second@example.invalid", phone: "" }),
      { code: 11000 },
    );
    await removeLegacyPhoneUniqueness(collection);
    await removeLegacyPhoneUniqueness(collection);
    await collection.insertOne({ email: "second@example.invalid", phone: "" });
    await assert.rejects(
      collection.insertOne({ email: "first@example.invalid", phone: "123" }),
      { code: 11000 },
    );
    assert.equal(await collection.countDocuments(), 2);
  } finally {
    await collection.drop();
  }
});

test("registration duplicate indexes report account errors instead of seat errors", async () => {
  const originalCreate = Passenger.create;
  try {
    for (const field of ["email", "phone"]) {
      Passenger.create = async () => {
        throw Object.assign(new Error("Duplicate account field"), {
          code: 11000,
          keyPattern: { [field]: 1 },
        });
      };
      const response = await http("/passengers/signup", {
        cookie: null,
        data: {
          name: "Duplicate test",
          email: "duplicate@example.invalid",
          password: "test-password-123",
        },
      });
      assert.equal(response.status, field === "email" ? 409 : 503);
      assert.doesNotMatch(response.body.error, /seat|reserved/i);
      assert.match(
        response.body.error,
        field === "email" ? /email already exists/ : /database constraint/,
      );
    }
  } finally {
    Passenger.create = originalCreate;
  }
});

test("forgot password never claims delivery when email is unconfigured", async () => {
  const apiKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    for (const email of [passenger.email, "missing@example.invalid"]) {
      const response = await http("/passengers/forgot-password", {
        cookie: null,
        data: { email },
      });
      assert.equal(response.status, 503);
      assert.match(response.body.error, /email is unavailable/);
    }
    const account = await Passenger.findById(passenger._id);
    assert.equal(account.passwordResetTokenHash, null);
  } finally {
    if (apiKey !== undefined) process.env.RESEND_API_KEY = apiKey;
  }
});

test("staff can publish and update Bus 2 schedules; passengers cannot publish schedules", async () => {
  const data = {
    busId: String(bus2._id),
    from: bus2.from,
    to: bus2.to,
    departureAt: new Date(Date.now() + 10800000).toISOString(),
    seatIds: [1, 2, 3],
  };
  assert.equal((await http("/trips", { data })).status, 403);
  const r = await http("/trips", { data, cookie: adminCookie });
  assert.equal(r.status, 201);
  assert.equal(r.body.busId, String(bus2._id));
  const bad = await http("/trips", {
    cookie: adminCookie,
    data: { ...data, seatIds: [1, 1] },
  });
  assert.equal(bad.status, 400);
  assert.equal(
    (await http("/trips?date=invalid", { cookie: null })).status,
    400,
  );
  const next = new Date(Date.now() + 14400000).toISOString();
  assert.equal(
    (
      await http(`/trips/${r.body._id}`, {
        cookie: adminCookie,
        method: "PATCH",
        data: { departureAt: next },
      })
    ).status,
    200,
  );
  assert.equal(
    (await Trip.findById(r.body._id)).departureAt.toISOString(),
    next,
  );
});
test("login issues an HttpOnly session; no password or reset token in account response", async () => {
  const r = await http("/session");
  assert.equal(r.body.user._id, String(passenger._id));
  assert.equal(r.body.role, "passenger");
  assert.equal(r.body.user.passwordHash, undefined);
  assert.ok(cookie);
  assert.equal(await Session.countDocuments(), 3);
});
test("unauthenticated bookings and passenger access to staff data are blocked", async () => {
  assert.equal((await http("/reservations", { cookie: null })).status, 401);
  assert.equal((await http("/buses")).status, 403);
  assert.equal((await http("/admins")).status, 403);
  assert.equal((await http("/passengers")).status, 403);
});
test("operator query injection and unauthorized origins are rejected", async () => {
  assert.equal((await http("/reservations?busId[$ne]=x")).status, 400);
  assert.equal(
    (
      await http("/reservations", {
        data: {},
        headers: { Origin: "https://untrusted.invalid" },
      })
    ).status,
    403,
  );
});
test("passenger cannot change another account or self-approve a discount", async () => {
  assert.equal(
    (
      await http(`/passengers/${other._id}`, {
        data: { name: "Changed" },
        method: "PATCH",
      })
    ).status,
    403,
  );
  await http(`/passengers/${other._id}`, {
    cookie: otherCookie,
    data: { category: "senior", categoryVerified: true },
    method: "PATCH",
  });
  assert.equal((await Passenger.findById(other._id)).categoryVerified, false);
});
test("reservation uses authenticated owner, verified category and database fare without payment method", async () => {
  const r = await http("/reservations", {
    data: {
      tripId: String(trip._id),
      seatId: 1,
      to: "Longos",
      passengerId: String(other._id),
      fare: 1,
      passengerType: "senior",
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  ticket = r.body;
  assert.equal(ticket.passengerType, "pwd");
  assert.equal(ticket.fare, 28);
  assert.equal(ticket.status, "confirmed");
  assert.equal(
    String((await Ticket.findById(ticket.id)).passengerId),
    String(passenger._id),
  );
  assert.equal(ticket.qrCode.length, 64);
});
test("concurrent booking cannot allocate the same seat twice", async () => {
  const results = await Promise.all([
    http("/reservations", {
      data: { tripId: String(trip._id), seatId: 2, to: "Longos" },
    }),
    http("/reservations", {
      data: { tripId: String(trip._id), seatId: 2, to: "Longos" },
      cookie: otherCookie,
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    await Ticket.countDocuments({
      tripId: trip._id,
      seatId: 2,
      status: "active",
    }),
    1,
  );
});
test("bookings and cancellations are private to their account", async () => {
  const r = await http("/reservations", { cookie: otherCookie });
  assert.ok(r.body.every((t) => t.id !== ticket.id));
  assert.equal(
    (
      await http(`/reservations/${ticket.id}/cancel`, {
        cookie: otherCookie,
        data: {},
      })
    ).status,
    404,
  );
  assert.equal((await Ticket.findById(ticket.id)).status, "active");
});
test("scheduled seats reflect persisted bookings and bus assignment", async () => {
  const r = await http("/trips", { cookie: null });
  assert.equal(r.status, 200);
  const t = r.body.find((t) => t._id === String(trip._id));
  assert.equal(t.busId.busId, "TEST-BUS-1");
  assert.ok(!t.availableSeatIds.includes(1));
  assert.ok(!t.availableSeatIds.includes(2));
  assert.equal(t.arrivalAt, trip.arrivalAt.toISOString());
});
test("manual and repeated QR verification reuse one saved ticket and mask personal information", async () => {
  for (const source of ["manual", "qr", "qr"]) {
    const r = await http("/verify", {
      cookie: null,
      data: { reference: ticket.qrCode, source },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.id, ticket.id);
    assert.equal(r.body.passengerType, "pwd");
    assert.notEqual(r.body.passengerIdentifier, passenger.name);
    assert.equal(r.body.email, undefined);
  }
  assert.equal(await Ticket.countDocuments({ qrCode: ticket.qrCode }), 1);
});
test("invalid, malformed, cancelled and expired ticket references are rejected", async () => {
  assert.equal(
    (await http("/verify", { cookie: null, data: { reference: "" } })).status,
    400,
  );
  assert.equal(
    (
      await http("/verify", {
        cookie: null,
        data: { reference: "0".repeat(64) },
      })
    ).status,
    404,
  );
  const expired = await Ticket.create({
    busId: bus._id,
    from: bus.from,
    to: bus.to,
    qrCode: "e".repeat(64),
    expiresAt: new Date(Date.now() - 1),
  });
  assert.equal(
    (
      await http("/verify", {
        cookie: null,
        data: { reference: expired.qrCode },
      })
    ).status,
    409,
  );
  await Ticket.updateOne(
    { _id: expired._id },
    { $set: { status: "cancelled", expiresAt: null } },
  );
  assert.equal(
    (
      await http("/verify", {
        cookie: null,
        data: { reference: expired.qrCode },
      })
    ).status,
    409,
  );
});
test("all categories require verified information to appear", async () => {
  for (const category of ["regular", "student", "pwd", "senior"]) {
    const t = await Ticket.create({
      busId: bus._id,
      from: bus.from,
      to: bus.to,
      qrCode: hashToken(category),
      passengerType: category,
      categoryVerified: true,
    });
    const r = await http("/verify", {
      data: { reference: t.qrCode },
      cookie: null,
    });
    assert.equal(r.body.passengerType, category);
  }
  const t = await Ticket.create({
    busId: bus._id,
    from: bus.from,
    to: bus.to,
    qrCode: hashToken("unverified"),
    passengerType: "senior",
    categoryVerified: false,
  });
  assert.equal(
    (await http("/verify", { data: { reference: t.qrCode }, cookie: null }))
      .body.passengerType,
    "regular",
  );
});
test("100m boundary, missing, stale, inaccurate and inactive GPS states", () => {
  const now = Date.now(),
    b = {
      busId: "A",
      proximityTarget: { lat: 0, lon: 0 },
      location: { lat: 0, lon: 0, accuracy: 5, updatedAt: new Date(now) },
    };
  assert.equal(proximityState(b, now).status, "Within 100 m");
  b.location.lat = ((99.99 / 6371000) * 180) / Math.PI;
  assert.equal(proximityState(b, now).status, "Within 100 m");
  b.location.lat = ((100.01 / 6371000) * 180) / Math.PI;
  assert.equal(proximityState(b, now).status, "Outside 100 m");
  b.location.updatedAt = new Date(now - 120001);
  assert.equal(proximityState(b, now).status, "Location stale");
  b.location.updatedAt = new Date(now);
  b.location.accuracy = 100;
  assert.equal(proximityState(b, now).status, "Location unavailable");
  b.location.dop = 1.5;
  b.location.fixStatus = 3;
  assert.equal(proximityState(b, now).status, "Outside 100 m");
  b.trackingEnabled = false;
  assert.equal(proximityState(b, now).status, "Tracking inactive");
  assert.equal(proximityState({ location: {} }).distanceMeters, null);
  assert.ok(Math.abs(haversineMeters(0, 0, 0, 1) - 111194.9) < 1);
});
test("authenticated device is bound to its bus; GPS entry suppresses duplicates and re-arms after 130m", async () => {
  const deviceKey = "a".repeat(64);
  await Bus.updateOne(
    { _id: bus._id },
    {
      $set: {
        deviceTokenHash: hashToken(deviceKey),
        proximityTarget: { label: "Test pickup", lat: 0, lon: 0 },
      },
    },
  );
  const send = (lat) =>
    http("/bus/location", {
      cookie: null,
      headers: { Authorization: `Bearer ${deviceKey}` },
      data: {
        busId: bus.busId,
        latitude: lat,
        longitude: 0,
        accuracy: 5,
        timestamp: new Date().toISOString(),
      },
    });
  assert.equal(
    (
      await http("/bus/location", {
        cookie: null,
        data: { busId: bus.busId, latitude: 0, longitude: 0 },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await http("/bus/location", {
        cookie: null,
        headers: { Authorization: `Bearer ${deviceKey}` },
        data: { busId: bus2.busId, latitude: 0, longitude: 0 },
      })
    ).status,
    401,
  );
  assert.equal((await send(0)).status, 200);
  await send(0);
  assert.equal(
    await Activity.countDocuments({ event: "bus.proximity_entered" }),
    1,
  );
  await send(0.002);
  await send(0);
  assert.equal(
    await Activity.countDocuments({ event: "bus.proximity_entered" }),
    2,
  );
  assert.equal(
    await Notification.countDocuments({
      audience: "passenger",
      passengerId: passenger._id,
    }),
    2,
  );
  assert.equal((await Bus.findById(bus2._id)).location.updatedAt, null);
});
test("sensor updates preserve reservations and isolate different buses", async () => {
  const r = await http("/bus/seats", {
    cookie: null,
    headers: { Authorization: `Bearer ${"a".repeat(64)}` },
    data: { busId: bus.busId, seatId: 5, status: "booked" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.find((s) => s.id === 5).occupancy, "occupied");
  assert.equal(r.body.find((s) => s.id === 5).status, "available");
  assert.equal((await Bus.findById(bus2._id)).seats[4].sensor, "fault");
});
test("activity and notifications have account-scoped visibility and filters", async () => {
  const rows = (
    await http(`/activity?reference=${ticket.bookingReference}&outcome=success`)
  ).body;
  assert.ok(rows.length);
  assert.ok(rows.every((r) => r.reference === ticket.bookingReference));
  const others = (await http("/activity", { cookie: otherCookie })).body;
  assert.ok(others.every((r) => String(r.passengerId) === String(other._id)));
  assert.ok(
    (await http("/notifications")).body.every(
      (n) => n.passengerId === String(passenger._id),
    ),
  );
});
test("printer offline failure preserves reservation; connected agent receives authoritative receipt and prevents unapproved reprint", async () => {
  let auth = (
    await http("/receipt-authorization", {
      data: { reference: ticket.qrCode },
      cookie: null,
    })
  ).body;
  assert.equal(
    (await http("/printer/jobs", { data: auth, cookie: null })).status,
    503,
  );
  assert.equal((await Ticket.findById(ticket.id)).status, "active");
  agent = new WebSocket(base.replace("http:", "ws:") + "/printer/agent", {
    headers: { Authorization: `Bearer ${process.env.AGENT_SECRET}` },
  });
  await new Promise((resolve, reject) => {
    agent.once("open", resolve);
    agent.once("error", reject);
  });
  agent.on("message", (raw) => {
    const job = JSON.parse(raw);
    assert.equal(job.ticket.bookingReference, ticket.bookingReference);
    assert.equal(
      job.ticket.departureAt,
      new Date(ticket.departureAt).toISOString(),
    );
    agent.send(
      JSON.stringify({
        type: "print:result",
        jobId: job.jobId,
        ok: printOutcome === "ok",
        uncertain: printOutcome === "uncertain",
        error: "Test printer paper unavailable",
      }),
    );
  });
  auth = (
    await http("/receipt-authorization", {
      data: { reference: ticket.qrCode },
      cookie: null,
    })
  ).body;
  assert.equal(
    (await http("/printer/jobs", { data: auth, cookie: null })).status,
    202,
  );
  assert.equal((await Ticket.findById(ticket.id)).printState, "printed");
  assert.equal(
    (await http("/printer/jobs", { data: auth, cookie: null })).status,
    403,
  );
  assert.equal(
    (
      await http("/receipt-authorization", {
        data: { reference: ticket.qrCode },
        cookie: null,
      })
    ).status,
    403,
  );
  printOutcome = "fail";
  auth = (
    await http("/receipt-authorization", {
      data: { reference: ticket.qrCode },
      cookie: adminCookie,
    })
  ).body;
  assert.equal(
    (await http("/printer/jobs", { data: auth, cookie: adminCookie })).status,
    503,
  );
  assert.equal((await Ticket.findById(ticket.id)).printState, "failed");
  assert.equal((await Ticket.findById(ticket.id)).status, "active");
  printOutcome = "uncertain";
  auth = (
    await http("/receipt-authorization", {
      data: { reference: ticket.qrCode },
      cookie: adminCookie,
    })
  ).body;
  assert.equal(
    (await http("/printer/jobs", { data: auth, cookie: adminCookie })).status,
    503,
  );
  assert.equal((await Ticket.findById(ticket.id)).printState, "uncertain");
});
test("staff account administration revokes sessions and preserves the last administrator", async () => {
  const r = await http("/admins", {
    cookie: adminCookie,
    data: {
      name: "Temporary Staff",
      kioskId: "TEMP-STAFF",
      password: "staff-test-password",
      role: "staff",
    },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.passwordHash, undefined);
  const login = await http("/admins/login", {
    cookie: null,
    data: { kioskId: "TEMP-STAFF", password: "staff-test-password" },
  });
  assert.equal(login.status, 200);
  assert.equal((await http("/buses", { cookie: login.cookie })).status, 200);
  assert.equal((await http("/admins", { cookie: login.cookie })).status, 403);
  await http(`/admins/${r.body._id}`, {
    cookie: adminCookie,
    method: "PATCH",
    data: { name: "Updated staff" },
  });
  assert.equal((await http("/buses", { cookie: login.cookie })).status, 401);
  assert.equal(
    (
      await http(`/admins/${admin._id}`, {
        cookie: adminCookie,
        method: "PATCH",
        data: { role: "staff" },
      })
    ).status,
    409,
  );
});
test("cancellation releases a scheduled seat while preserving the historical ticket", async () => {
  const r = await http("/reservations", {
    data: { tripId: String(trip._id), seatId: 4, to: "Longos" },
  });
  assert.equal(r.status, 201);
  assert.equal(
    (await http(`/reservations/${r.body.id}/cancel`, { data: {} })).status,
    200,
  );
  assert.equal((await Ticket.findById(r.body.id)).status, "cancelled");
  const next = await http("/reservations", {
    cookie: otherCookie,
    data: { tripId: String(trip._id), seatId: 4, to: "Longos" },
  });
  assert.equal(next.status, 201);
  assert.notEqual(next.body.id, r.body.id);
});
test("uncertain receipt resolution requires staff and retains the booking", async () => {
  await Ticket.updateOne(
    { _id: ticket.id },
    { $set: { printState: "uncertain" } },
  );
  assert.equal(
    (
      await http("/receipt-authorization", {
        data: { reference: ticket.qrCode },
        cookie: adminCookie,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await http(`/reservations/${ticket.id}/resolve-print`, {
        data: { outcome: "failed" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await http(`/reservations/${ticket.id}/resolve-print`, {
        cookie: adminCookie,
        data: { outcome: "failed" },
      })
    ).status,
    200,
  );
  assert.equal((await Ticket.findById(ticket.id)).status, "active");
});
test("legacy entry imports the same app; walk-up locks require fresh physical availability", async () => {
  const legacy = await import("../../back/server.js");
  assert.equal(legacy.app, app);
  const third = await Bus.create({
    busId: "TEST-BUS-3",
    name: "Third test bus",
    from: "SM Pala-Pala",
    to: "PITX",
    totalSeats: 1,
    monitoredSeatIds: [1],
    seats: [
      {
        id: 1,
        sensor: "ok",
        occupancy: "available",
        status: "available",
        sensorUpdatedAt: Date.now(),
      },
    ],
  });
  const data = {
    busId: String(third._id),
    seatId: 1,
    from: third.from,
    routeTo: third.to,
    to: "PITX",
    distanceKm: 27,
    dropoffLocation: { lat: 0, lon: 0 },
    passengerType: "regular",
  };
  assert.equal((await http("/tickets", { data })).status, 403);
  const issued = await http("/tickets", { cookie: adminCookie, data });
  assert.equal(issued.status, 201);
  assert.equal(
    (await http("/tickets", { cookie: adminCookie, data })).status,
    409,
  );
  assert.equal(
    (
      await http(`/buses/${third._id}/seats/1`, {
        cookie: adminCookie,
        method: "PATCH",
        data: { status: "available" },
      })
    ).status,
    409,
  );
  await http(`/tickets/${issued.body._id}`, {
    cookie: adminCookie,
    method: "PATCH",
    data: { status: "used" },
  });
  assert.equal((await Bus.findById(third._id)).seats[0].status, "available");
  await Bus.updateOne(
    { _id: third._id },
    { $set: { "seats.0.sensorUpdatedAt": Date.now() - 100000 } },
  );
  assert.equal(
    (await http("/tickets", { cookie: adminCookie, data })).status,
    409,
  );
});
test("staff completion is single-use and logout revokes sessions", async () => {
  assert.equal(
    (await http(`/reservations/${ticket.id}/complete`, { data: {} })).status,
    403,
  );
  assert.equal(
    (
      await http(`/reservations/${ticket.id}/complete`, {
        data: {},
        cookie: adminCookie,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await http(`/reservations/${ticket.id}/complete`, {
        data: {},
        cookie: adminCookie,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await http("/verify", {
        data: { reference: ticket.qrCode },
        cookie: null,
      })
    ).status,
    409,
  );
  await http("/logout", { data: {} });
  assert.equal((await http("/reservations")).status, 401);
});
