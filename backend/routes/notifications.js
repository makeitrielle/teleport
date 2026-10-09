import express from "express";
import Notification from "../models/Notification.js";
import { requireAuth, requireStaff } from "../security.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const filter =
    req.auth.role === "passenger"
      ? { passengerId: req.auth.userId, audience: "passenger" }
      : { audience: "staff" };
  const notifications = await Notification.find(filter)
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(notifications);
});

router.post("/", requireStaff, async (req, res) => {
  const notification = await Notification.create({
    title: req.body.title,
    body: req.body.body,
    audience: "staff",
  });
  res.status(201).json(notification);
});

export default router;
