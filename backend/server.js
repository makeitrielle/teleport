import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./db.js";
import { createServer } from "node:http";
import printerRoutes from "./routes/printer.js";
import { attachPrintAgent } from "./printAgent.js";

import busRoutes from "./routes/buses.js";
import singleBusRoutes from "./routes/bus.js";
import routeRoutes from "./routes/routes.js";
import adminRoutes from "./routes/admins.js";
import passengerRoutes from "./routes/passengers.js";
import ticketRoutes from "./routes/tickets.js";
import notificationRoutes from "./routes/notifications.js";
import platformRoutes from "./routes/platform.js";
import {
  loadSession,
  wrapRouter,
  rejectCrossOriginWrites,
} from "./security.js";

const app = express();
if (process.env.TRUST_PROXY_HOPS) {
  const hops = Number(process.env.TRUST_PROXY_HOPS);
  if (!Number.isInteger(hops) || hops < 1 || hops > 5)
    throw new Error(
      "TRUST_PROXY_HOPS must be a verified proxy count between 1 and 5.",
    );
  app.set("trust proxy", hops);
}

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  process.env.APP_URL ||
  "http://localhost:5173"
)
  .split(",")
  .map((x) => x.trim());
app.use(
  cors({
    origin: (origin, callback) =>
      callback(null, !origin || allowedOrigins.includes(origin)),
    credentials: true,
  }),
);
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
// Reject operator injection in query parameters and non-object JSON bodies.
app.use((req, res, next) => {
  if (
    Object.values(req.query).some((v) => typeof v !== "string") ||
    (req.body && (Array.isArray(req.body) || typeof req.body !== "object"))
  )
    return res.status(400).json({ error: "Invalid request format." });
  next();
});
app.use(rejectCrossOriginWrites);
app.use(loadSession);

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/buses", wrapRouter(busRoutes));
// Singleton convenience routes for the one bus this system represents -
// see routes/bus.js. Coexists with /api/buses above (still used by the
// admin dashboard's generic CRUD); this is what the ESP32 firmware and
// simple clients talk to instead.
app.use("/api/bus", wrapRouter(singleBusRoutes));
app.use("/api/routes", wrapRouter(routeRoutes));
app.use("/api/admins", wrapRouter(adminRoutes));
app.use("/api/passengers", wrapRouter(passengerRoutes));
app.use("/api/tickets", wrapRouter(ticketRoutes));
app.use("/api/printer", wrapRouter(printerRoutes));
app.use("/api/notifications", wrapRouter(notificationRoutes));
app.use("/api", wrapRouter(platformRoutes));

// basic error handler
app.use((err, req, res, next) => {
  console.error("[api]", err.name, err.code || err.status || "");
  if (err.code === 11000 && req.originalUrl.startsWith("/api/passengers")) {
    const emailConflict = err.keyPattern?.email || err.keyValue?.email;
    console.error(
      "[accounts] conflicting index fields:",
      Object.keys(err.keyPattern || err.keyValue || {}),
    );
    return res.status(emailConflict ? 409 : 503).json({
      error: emailConflict
        ? "An account with that email already exists. Sign in or reset your password."
        : "Account registration is blocked by a database constraint. Please contact support.",
    });
  }
  if (err.code === 11000)
    return res.status(409).json({
      error:
        "This seat or unique reference is already reserved. Refresh and try again.",
    });
  if (err.name === "CastError" || err.name === "ValidationError")
    return res
      .status(400)
      .json({ error: "Invalid request fields. Check the form and try again." });
  res.status(err.status || 500).json({
    error: err.status
      ? err.message
      : "The server could not complete this request.",
  });
});

const PORT = process.env.PORT || 4000;
const server = createServer(app);
attachPrintAgent(server);

export { app };
if (process.env.TELEPORT_TEST_MODE !== "true")
  connectDB()
    .then(() => {
      server.listen(PORT, "0.0.0.0", () =>
        console.log(`[server] listening on port ${PORT}`),
      );
    })
    .catch((err) => {
      console.error("[db] connection failed:", err.message);
      process.exit(1);
    });
