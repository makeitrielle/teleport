import express from "express";
import Notification from "../models/Notification.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const notifications = await Notification.find().sort({ createdAt: -1 }).limit(50);
  res.json(notifications);
});

router.post("/", async (req, res) => {
  const notification = await Notification.create(req.body);
  res.status(201).json(notification);
});

export default router;
