// Isolated browser QA only. Never connects to MONGODB_URI or changes existing data.
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import Passenger from "../models/Passenger.js";
import Admin from "../models/Admin.js";
import Bus from "../models/Bus.js";
import Trip from "../models/Trip.js";
import Ticket from "../models/Ticket.js";
import { hashPassword } from "../security.js";
if (
  process.env.NODE_ENV === "production" ||
  process.env.TELEPORT_TEST_MODE !== "true"
)
  throw new Error("Set TELEPORT_TEST_MODE=true for isolated browser QA.");
const memory = await MongoMemoryServer.create({
  instance: { dbName: "teleport-ui-tests" },
});
await mongoose.connect(memory.getUri());
await Ticket.init();
const passwordHash = await hashPassword("test-password-123");
await Passenger.create({
  name: "TEST Passenger",
  email: "qa@example.invalid",
  passwordHash,
  emailVerified: true,
  category: "senior",
  categoryVerified: true,
});
await Admin.create({
  name: "TEST Administrator",
  kioskId: "QA-ADMIN",
  passwordHash,
  role: "admin",
});
const bus = await Bus.create({
  name: "TEST fixture bus",
  busId: "TEST-BUS-1",
  from: "SM Pala-Pala",
  to: "PITX",
  totalSeats: 5,
  seats: [1, 2, 3, 4, 5].map((id) => ({
    id,
    sensor: "fault",
    occupancy: null,
  })),
});
await Trip.create({
  busId: bus._id,
  from: bus.from,
  to: bus.to,
  departureAt: new Date(Date.now() + 3600000),
  seatIds: [1, 2, 3, 4, 5],
});
const { app } = await import("../server.js");
const server = app.listen(4000, "127.0.0.1", () =>
  console.log(
    "ISOLATED QA ONLY: passenger qa@example.invalid / test-password-123; staff QA-ADMIN / test-password-123. GPS and sensors unavailable.",
  ),
);
async function stop() {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await memory.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
