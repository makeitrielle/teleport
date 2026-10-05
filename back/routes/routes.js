import express from "express";
import Route from "../models/Route.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const routes = await Route.find().sort({ createdAt: 1 });
  res.json(routes);
});

router.post("/", async (req, res) => {
  const route = await Route.create(req.body);
  res.status(201).json(route);
});

router.patch("/:id", async (req, res) => {
  const route = await Route.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!route) return res.status(404).json({ error: "Route not found" });
  res.json(route);
});

router.delete("/:id", async (req, res) => {
  await Route.findByIdAndDelete(req.params.id);
  res.status(204).send();
});

export default router;
