import express from "express";
import Route from "../models/Route.js";
import Trip from "../models/Trip.js";
import { requireStaff, guardId } from "../security.js";
import { audit } from "../models/Activity.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const routes = await Route.find().sort({ createdAt: 1 });
  res.json(routes);
});

router.post("/", requireStaff, async (req, res) => {
  if (
    typeof req.body.name !== "string" ||
    !req.body.name.trim() ||
    !Array.isArray(req.body.stops) ||
    req.body.stops.some((s) => typeof s !== "string")
  )
    return res
      .status(400)
      .json({ error: "Provide a route name and list of stops." });
  const route = await Route.create({
    name: req.body.name.trim(),
    stops: req.body.stops,
  });
  await audit(req, "route.created");
  res.status(201).json(route);
});

router.patch("/:id", requireStaff, guardId, async (req, res) => {
  const route = await Route.findByIdAndUpdate(
    req.params.id,
    { name: req.body.name, stops: req.body.stops },
    {
      new: true,
      runValidators: true,
    },
  );
  if (!route) return res.status(404).json({ error: "Route not found" });
  await audit(req, "route.updated");
  res.json(route);
});

router.delete("/:id", requireStaff, guardId, async (req, res) => {
  if (await Trip.exists({ routeId: req.params.id }))
    return res
      .status(409)
      .json({
        error: "This route has scheduled history and must be retained.",
      });
  await Route.findByIdAndDelete(req.params.id);
  await audit(req, "route.deleted");
  res.status(204).send();
});

export default router;
