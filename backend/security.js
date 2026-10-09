import crypto from "node:crypto";
import { promisify } from "node:util";
import mongoose from "mongoose";

const scrypt = promisify(crypto.scrypt);
export const hashToken = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
export function equalSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export async function hashPassword(password, { allowLegacy = false } = {}) {
  if (
    typeof password !== "string" ||
    password.length < (allowLegacy ? 1 : 8) ||
    password.length > 256
  )
    throw Object.assign(
      new Error("Use a password between 8 and 256 characters."),
      { status: 400 },
    );
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || password.length > 256 || !stored)
    return false;
  if (!stored.startsWith("scrypt:"))
    return equalSecret(hashToken(password), stored); // migrate legacy hashes on successful login
  const [, salt, key] = stored.split(":");
  if (!salt || !key) return false;
  return equalSecret((await scrypt(password, salt, 64)).toString("hex"), key);
}
const SessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, unique: true },
    userId: mongoose.Schema.Types.ObjectId,
    role: { type: String, enum: ["passenger", "staff", "admin"] },
    expiresAt: { type: Date, index: { expires: 0 } },
  },
  { timestamps: true },
);
export const Session =
  mongoose.models.Session || mongoose.model("Session", SessionSchema);
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
export function wrapRouter(router) {
  for (const layer of router.stack)
    if (layer.route)
      for (const handler of layer.route.stack) {
        const fn = handler.handle;
        if (fn.constructor.name === "AsyncFunction")
          handler.handle = asyncHandler(fn);
      }
  return router;
}
const cookieOptions = () =>
  `Path=/api; HttpOnly; SameSite=${process.env.COOKIE_CROSS_SITE === "true" ? "None" : "Lax"}${process.env.NODE_ENV === "production" || process.env.COOKIE_CROSS_SITE === "true" ? "; Secure" : ""}`;
export async function issueSession(res, user, role) {
  const token = crypto.randomBytes(32).toString("hex");
  await Session.create({
    tokenHash: hashToken(token),
    userId: user._id,
    role,
    expiresAt: new Date(Date.now() + 8 * 3600000),
  });
  res.setHeader(
    "Set-Cookie",
    `teleport_session=${token}; ${cookieOptions()}; Max-Age=28800`,
  );
}
export function clearSession(res) {
  res.setHeader(
    "Set-Cookie",
    `teleport_session=; ${cookieOptions()}; Max-Age=0`,
  );
}
export const loadSession = asyncHandler(async (req, res, next) => {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("teleport_session="))
    ?.split("=")[1];
  if (cookie && /^[a-f0-9]{64}$/.test(cookie))
    req.auth = await Session.findOne({
      tokenHash: hashToken(cookie),
      expiresAt: { $gt: new Date() },
    }).lean();
  next();
});
export function requireAuth(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: "Sign in to continue." });
  next();
}
export function requireStaff(req, res, next) {
  if (!req.auth)
    return res.status(401).json({ error: "Staff sign-in is required." });
  if (!["staff", "admin"].includes(req.auth.role))
    return res.status(403).json({ error: "Staff access is required." });
  next();
}
export function requireAdmin(req, res, next) {
  if (req.auth?.role !== "admin")
    return res
      .status(req.auth ? 403 : 401)
      .json({ error: "Administrator access is required." });
  next();
}
export const isObjectId = (value) =>
  typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
export function guardId(req, res, next) {
  if (!isObjectId(req.params.id))
    return res.status(400).json({ error: "Invalid record identifier." });
  next();
}
const rateBuckets = new Map();
export function rateLimit(limit = 30, windowMs = 60000) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.baseUrl}:${req.path}`;
    const now = Date.now();
    if (rateBuckets.size > 10000)
      for (const [k, v] of rateBuckets)
        if (v.until <= now) rateBuckets.delete(k);
    let entry = rateBuckets.get(key);
    if (!entry || entry.until <= now) {
      entry = { count: 0, until: now + windowMs };
      rateBuckets.set(key, entry);
    }
    if (++entry.count > limit)
      return res
        .status(429)
        .json({ error: "Too many attempts. Try again shortly." });
    next();
  };
}
export function rejectCrossOriginWrites(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.headers.origin)
    return next();
  const origins = (
    process.env.ALLOWED_ORIGINS ||
    process.env.APP_URL ||
    "http://localhost:5173"
  )
    .split(",")
    .map((x) => x.trim());
  if (!origins.includes(req.headers.origin))
    return res
      .status(403)
      .json({ error: "This website is not authorized to submit requests." });
  next();
}
