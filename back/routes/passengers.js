import express from "express";
import crypto from "crypto";
import Passenger from "../models/Passenger.js";

const router = express.Router();

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function sendAccountEmail({ to, subject, text, html }) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    throw new Error("Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM on the backend.");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text, html }),
  });
  if (!response.ok) {
    const details = await response.text();
    console.error("[email] provider rejected message:", response.status, details);
    throw new Error("We could not send the email right now. Please try again later.");
  }
}

function accountLink(path, token, email) {
  // Use the deployed passenger site when APP_URL is not configured in Render.
  // Keeping localhost as the fallback sends production users to an unusable link.
  const base = (process.env.APP_URL || "https://www.teleport-app.online").replace(/\/$/, "");
  return `${base}/?${path}=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function safePassenger(passenger) {
  const safe = passenger.toObject();
  ["passwordHash", "emailVerificationTokenHash", "emailVerificationExpires", "passwordResetTokenHash", "passwordResetExpires"]
    .forEach((key) => delete safe[key]);
  return safe;
}

router.get("/", async (req, res) => {
  const passengers = await Passenger.find().select("-passwordHash -emailVerificationTokenHash -emailVerificationExpires -passwordResetTokenHash -passwordResetExpires").sort({ createdAt: 1 });
  res.json(passengers);
});

// POST /api/passengers/signup
router.post("/signup", async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters long." });
  }

  const existing = await Passenger.findOne({ email: email.toLowerCase().trim() });
  if (existing) return res.status(409).json({ error: "An account with that email already exists" });

  const emailToken = crypto.randomBytes(32).toString("hex");
  const passenger = await Passenger.create({
    name,
    email: email.toLowerCase().trim(),
    phone,
    passwordHash: hashPassword(password),
    emailVerified: false,
    emailVerificationTokenHash: hashToken(emailToken),
    emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const verifyUrl = accountLink("verify", emailToken, passenger.email);
  try {
    await sendAccountEmail({ to: passenger.email, subject: "Confirm your Jasper Jean account",
      text: `Welcome to Jasper Jean. Confirm your email address by opening this link:\n\n${verifyUrl}\n\nThis link expires in 24 hours.`,
      html: `<p>Welcome to Jasper Jean.</p><p><a href="${verifyUrl}">Confirm your email address</a></p><p>If the button/link does not open, copy and paste this address into your browser:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>` });
  } catch (err) {
    await Passenger.findByIdAndDelete(passenger._id);
    return res.status(503).json({ error: err.message });
  }
  res.status(201).json({ ...safePassenger(passenger), message: "Account created. Check your email to verify it before signing in." });
});

router.post("/verify-email", async (req, res) => {
  const tokenHash = hashToken(req.body.token || "");
  const passenger = await Passenger.findOne({ emailVerificationTokenHash: tokenHash,
    emailVerificationExpires: { $gt: new Date() } });
  if (!passenger) return res.status(400).json({ error: "This verification link is invalid or expired. Please register again." });
  passenger.emailVerified = true;
  passenger.emailVerificationTokenHash = null;
  passenger.emailVerificationExpires = null;
  await passenger.save();
  res.json({ ok: true, message: "Email confirmed. You can now sign in." });
});

router.post("/forgot-password", async (req, res) => {
  const email = (req.body.email || "").toLowerCase().trim();
  const genericMessage = "If an account exists for that email, a password reset link has been sent.";
  const passenger = await Passenger.findOne({ email });
  if (passenger) {
    const resetToken = crypto.randomBytes(32).toString("hex");
    passenger.passwordResetTokenHash = hashToken(resetToken);
    passenger.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
    await passenger.save();
    const resetUrl = accountLink("reset", resetToken, email);
    try {
      await sendAccountEmail({ to: email, subject: "Reset your Jasper Jean password",
        text: `Reset your password by opening this link: ${resetUrl}`,
        html: `<p>We received a request to reset your password.</p><p><a href="${resetUrl}">Choose a new password</a></p><p>This link expires in one hour. If you did not request this, you can ignore this email.</p>` });
    } catch (err) {
      passenger.passwordResetTokenHash = null;
      passenger.passwordResetExpires = null;
      await passenger.save();
      return res.status(503).json({ error: err.message });
    }
  }
  res.json({ ok: true, message: genericMessage });
});

router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body;
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters long." });
  }
  const passenger = await Passenger.findOne({ passwordResetTokenHash: hashToken(token || ""),
    passwordResetExpires: { $gt: new Date() } });
  if (!passenger) return res.status(400).json({ error: "This password reset link is invalid or expired. Request a new one." });
  passenger.passwordHash = hashPassword(password);
  passenger.passwordResetTokenHash = null;
  passenger.passwordResetExpires = null;
  await passenger.save();
  res.json({ ok: true, message: "Password updated. You can now sign in." });
});

// POST /api/passengers/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const passenger = await Passenger.findOne({ email: (email || "").toLowerCase().trim() });
  if (!passenger || passenger.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  if (passenger.emailVerified === false) return res.status(403).json({ error: "Please confirm your email before signing in." });
  res.json(safePassenger(passenger));
});

router.patch("/:id", async (req, res) => {
  const passenger = await Passenger.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
  }).select("-passwordHash");
  if (!passenger) return res.status(404).json({ error: "Passenger not found" });
  res.json(passenger);
});

export default router;
