import express from "express";
import Admin from "../models/Admin.js";
import {
  hashPassword,
  verifyPassword,
  issueSession,
  requireAdmin,
  rateLimit,
  guardId,
  Session,
} from "../security.js";
import { audit } from "../models/Activity.js";
const router = express.Router();
router.post("/login", rateLimit(10), async (req, res) => {
  const { kioskId, password } = req.body;
  const admin =
    typeof kioskId === "string" ? await Admin.findOne({ kioskId }) : null;
  if (!admin || !(await verifyPassword(password, admin.passwordHash)))
    return res.status(401).json({ error: "Invalid staff ID or password." });
  if (!admin.passwordHash.startsWith("scrypt:")) {
    admin.passwordHash = await hashPassword(password, { allowLegacy: true });
    await admin.save();
  }
  await issueSession(res, admin, admin.role || "staff");
  const { passwordHash, ...safe } = admin.toObject();
  res.json(safe);
});
router.use(requireAdmin);
router.get("/", async (req, res) =>
  res.json(await Admin.find().select("-passwordHash").sort({ createdAt: 1 })),
);
router.post("/", async (req, res) => {
  const { name, kioskId, busId, password, role = "staff" } = req.body;
  if (!name || !kioskId || !["staff", "admin"].includes(role))
    return res
      .status(400)
      .json({ error: "Name, staff ID and valid role are required." });
  const admin = await Admin.create({
    name,
    kioskId,
    busId: busId || null,
    role,
    passwordHash: await hashPassword(password),
  });
  await audit(req, "staff.created");
  const { passwordHash, ...safe } = admin.toObject();
  res.status(201).json(safe);
});
router.patch("/:id", guardId, async (req, res) => {
  if (req.body.role === "staff") {
    const existing = await Admin.findById(req.params.id);
    if (
      existing?.role === "admin" &&
      (await Admin.countDocuments({ role: "admin" })) <= 1
    )
      return res
        .status(409)
        .json({ error: "Keep at least one administrator account." });
  }
  const updates = {};
  for (const key of ["name", "busId"])
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  if (["staff", "admin"].includes(req.body.role)) updates.role = req.body.role;
  if (req.body.password)
    updates.passwordHash = await hashPassword(req.body.password);
  const admin = await Admin.findByIdAndUpdate(req.params.id, updates, {
    new: true,
    runValidators: true,
  }).select("-passwordHash");
  if (!admin)
    return res.status(404).json({ error: "Staff account not found." });
  await Session.deleteMany({ userId: admin._id });
  await audit(req, "staff.updated");
  res.json(admin);
});
router.delete("/:id", guardId, async (req, res) => {
  const existing = await Admin.findById(req.params.id);
  if (
    existing?.role === "admin" &&
    (await Admin.countDocuments({ role: "admin" })) <= 1
  )
    return res
      .status(409)
      .json({ error: "Keep at least one administrator account." });
  if (String(req.auth.userId) === req.params.id)
    return res
      .status(409)
      .json({ error: "You cannot delete your signed-in account." });
  await Admin.findByIdAndDelete(req.params.id);
  await Session.deleteMany({ userId: req.params.id });
  await audit(req, "staff.deleted");
  res.sendStatus(204);
});
export default router;
