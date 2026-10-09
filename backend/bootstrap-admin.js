import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "./db.js";
import Admin from "./models/Admin.js";
import { hashPassword } from "./security.js";

// Explicit operator command; never run automatically on server startup.
try {
  const {
    BOOTSTRAP_ADMIN_ID: kioskId,
    BOOTSTRAP_ADMIN_NAME: name,
    BOOTSTRAP_ADMIN_PASSWORD: password,
  } = process.env;
  if (!kioskId || !name || !password)
    throw new Error(
      "Set BOOTSTRAP_ADMIN_ID, BOOTSTRAP_ADMIN_NAME and BOOTSTRAP_ADMIN_PASSWORD for this command.",
    );
  await connectDB();
  if (await Admin.exists({ role: "admin" }))
    throw new Error(
      "An administrator already exists. Use its account to manage users.",
    );
  if (await Admin.exists({ kioskId }))
    throw new Error(
      "This staff ID already exists. Choose an unused ID to preserve the existing account.",
    );
  await Admin.create({
    kioskId,
    name,
    role: "admin",
    passwordHash: await hashPassword(password),
  });
  console.log(
    "Initial administrator created. Remove bootstrap credentials from your environment.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
