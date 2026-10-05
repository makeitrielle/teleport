import express from "express";
import crypto from "crypto";
import Passenger from "../models/Passenger.js";

const router = express.Router();

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

router.get("/", async (req, res) => {
  const passengers = await Passenger.find().select("-passwordHash").sort({ createdAt: 1 });
  res.json(passengers);
});

// POST /api/passengers/signup
router.post("/signup", async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }

  const existing = await Passenger.findOne({ email: email.toLowerCase().trim() });
  if (existing) return res.status(409).json({ error: "An account with that email already exists" });

  const passenger = await Passenger.create({
    name,
    email: email.toLowerCase().trim(),
    phone,
    passwordHash: hashPassword(password),
  });
  const { passwordHash, ...safe } = passenger.toObject();
  res.status(201).json(safe);
});

// POST /api/passengers/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const passenger = await Passenger.findOne({ email: (email || "").toLowerCase().trim() });
  if (!passenger || passenger.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const { passwordHash, ...safe } = passenger.toObject();
  res.json(safe);
});

router.patch("/:id", async (req, res) => {
  const passenger = await Passenger.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
  }).select("-passwordHash");
  if (!passenger) return res.status(404).json({ error: "Passenger not found" });
  res.json(passenger);
});

export default router;
