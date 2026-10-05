import "dotenv/config";
import crypto from "crypto";
import { connectDB } from "./db.js";
import Bus from "./models/Bus.js";
import Route from "./models/Route.js";
import Admin from "./models/Admin.js";
import Passenger from "./models/Passenger.js";
import Notification from "./models/Notification.js";

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function makeSeats(total, bookedCount, faultyIds = []) {
  return Array.from({ length: total }, (_, i) => ({
    id: i + 1,
    status: i < bookedCount ? "booked" : "available",
    sensor: i < 5 && !faultyIds.includes(i + 1) ? "ok" : "fault",
    updatedAt: Date.now(),
  }));
}

async function seed() {
  await connectDB();

  console.log("[seed] clearing existing data...");
  await Promise.all([
    Bus.deleteMany({}),
    Route.deleteMany({}),
    Admin.deleteMany({}),
    Passenger.deleteMany({}),
    Notification.deleteMany({}),
  ]);

  // This system represents exactly ONE physical bus. busId is the
  // stable, human-readable identifier referenced by the GPS module, the
  // seat sensors (via the ESP32), the backend API, and the passenger
  // app - see backend/routes/bus.js and the busId field on Bus.js.
  console.log("[seed] inserting the one bus (BUS-001)...");
  const [bus] = await Bus.insertMany([
    {
      busId: "BUS-001",
      name: "Bus 1",
      driver: "J. Cruz",
      from: "Iron District Mall",
      to: "SM Pala Pala",
      stops: ["Iron District Mall", "SM Pala Pala"],
      totalSeats: 61,
      seats: makeSeats(61, 0),
      progress: 0.32,
      status: "active",
      etaMin: 20,
    },
  ]);

  console.log("[seed] inserting the route...");
  await Route.insertMany([
    { name: "Iron District Mall - SM Pala Pala", stops: ["Iron District Mall", "SM Pala Pala"] },
  ]);

  console.log("[seed] inserting the kiosk admin (default password: 'password123')...");
  await Admin.insertMany([
    {
      name: "Kiosk Operator",
      kioskId: "KSK-001",
      busId: bus._id,
      passwordHash: hashPassword("password123"),
    },
  ]);

  console.log("[seed] inserting passengers...");
  await Passenger.insertMany([
    { name: "Ana Reyes", email: "ana@example.com", trips: 14, passwordHash: hashPassword("demo1234"), emailVerified: true },
    { name: "Marco Dela Cruz", email: "marco@example.com", trips: 6, passwordHash: hashPassword("password123"), emailVerified: true },
    { name: "Liza Uy", email: "liza@example.com", trips: 22, passwordHash: hashPassword("password123"), emailVerified: true },
  ]);

  console.log("[seed] inserting notifications...");
  await Notification.insertMany([
    { title: "Bus 1 is 5 minutes away", body: "Arriving at SM Pala Pala." },
    { title: "Fare update", body: "Regular fare is now available for the Iron District Mall - SM Pala Pala." },
  ]);

  console.log("[seed] done!");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
