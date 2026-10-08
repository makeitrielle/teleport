import express from "express";
import crypto from "crypto";
import Admin from "../models/Admin.js";

const router = express.Router();

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
  // NOTE: for a real production app, use bcrypt (npm install bcryptjs)
  // instead of sha256 - this is a simplified placeholder.
}

router.get("/", async (req, res) => {
  const admins = await Admin.find().select("-passwordHash").sort({ createdAt: 1 });
  res.json(admins);
});

router.post("/", async (req, res) => {
  const { name, kioskId, busId, password } = req.body;
  const admin = await Admin.create({
    name,
    kioskId,
    busId: busId || null,
    passwordHash: hashPassword(password),
  });
  const { passwordHash, ...safe } = admin.toObject();
  res.status(201).json(safe);
});

// POST /api/admins/login - kiosk staff login
router.post("/login", async (req, res) => {
  const { kioskId, password } = req.body;
  const admin = await Admin.findOne({ kioskId });
  if (!admin || admin.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: "Invalid kiosk ID or password" });
  }
  const { passwordHash, ...safe } = admin.toObject();
  res.json(safe);
});

router.patch("/:id", async (req, res) => {
  const updates = { ...req.body };
  if (updates.password) {
    updates.passwordHash = hashPassword(updates.password);
    delete updates.password;
  }
  const admin = await Admin.findByIdAndUpdate(req.params.id, updates, { new: true }).select(
    "-passwordHash"
  );
  if (!admin) return res.status(404).json({ error: "Admin not found" });
  res.json(admin);
});

router.delete("/:id", async (req, res) => {
  await Admin.findByIdAndDelete(req.params.id);
  res.status(204).send();
});

export default router;
