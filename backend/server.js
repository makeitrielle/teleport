import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./db.js";

import busRoutes from "./routes/buses.js";
import singleBusRoutes from "./routes/bus.js";
import routeRoutes from "./routes/routes.js";
import adminRoutes from "./routes/admins.js";
import passengerRoutes from "./routes/passengers.js";
import ticketRoutes from "./routes/tickets.js";
import notificationRoutes from "./routes/notifications.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/buses", busRoutes);
// Singleton convenience routes for the one bus this system represents -
// see routes/bus.js. Coexists with /api/buses above (still used by the
// admin dashboard's generic CRUD); this is what the ESP32 firmware and
// simple clients talk to instead.
app.use("/api/bus", singleBusRoutes);
app.use("/api/routes", routeRoutes);
app.use("/api/admins", adminRoutes);
app.use("/api/passengers", passengerRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/notifications", notificationRoutes);

// basic error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => console.log(`[server] listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error("[db] connection failed:", err.message);
    process.exit(1);
  });
