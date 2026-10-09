import express from "express";
import crypto from "crypto";
import Ticket from "../models/Ticket.js";
import Bus from "../models/Bus.js";
import { getPrintAgentStatus, sendPrintJob } from "../printAgent.js";
import { audit } from "../models/Activity.js";
import { rateLimit } from "../security.js";

const router = express.Router();
const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

router.get("/status", (req, res) => res.json(getPrintAgentStatus()));

router.post("/jobs", rateLimit(10), async (req, res) => {
  const { ticketId, printToken } = req.body || {};
  if (
    typeof ticketId !== "string" ||
    typeof printToken !== "string" ||
    printToken.length < 32
  ) {
    return res
      .status(400)
      .json({ error: "A valid ticket print authorization is required." });
  }
  if (!/^[a-f\d]{24}$/i.test(ticketId))
    return res.status(400).json({ error: "Ticket ID is invalid." });

  if (!getPrintAgentStatus().agentConnected) {
    return res.status(503).json({
      error:
        "Kiosk printer is offline. Start the Tele-port print agent on the kiosk computer.",
    });
  }

  const tokenHash = hashToken(printToken);
  const ticket = await Ticket.findOneAndUpdate(
    {
      _id: ticketId,
      status: "active",
      printTokenHash: tokenHash,
      printState: { $nin: ["printing", "uncertain"] },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    },
    { $unset: { printTokenHash: 1 }, $set: { printState: "printing" } },
    { new: true, select: "+printTokenHash" },
  );
  if (!ticket)
    return res.status(403).json({
      error:
        "This ticket was already printed or its print authorization is invalid.",
    });

  let accepted = false;
  try {
    await audit(req, "receipt.attempt", "success", {
      ticketId: ticket._id,
      passengerId: ticket.passengerId,
      reference: ticket.bookingReference,
      busId: ticket.busId,
    });
    const bus = await Bus.findById(ticket.busId)
      .select("busId name driver to")
      .lean();
    const appUrl = (
      process.env.PUBLIC_APP_URL ||
      process.env.APP_URL ||
      "https://www.teleport-app.online"
    ).replace(/\/$/, "");
    const scanUrl = new URL("/", appUrl);
    scanUrl.searchParams.set("ticket", ticket.qrCode);
    const printData = {
      ticketNumber: ticket.qrCode,
      bookingReference: ticket.bookingReference || String(ticket._id),
      departureAt: ticket.departureAt,
      confirmedAt: ticket.confirmedAt || ticket.createdAt,
      reservationStatus: "CONFIRMED",
      route: `${ticket.from || "PITX"} - ${ticket.routeTo || bus?.to || "SM Pala-Pala"}`,
      busNumber: bus?.busId || bus?.name || "Unassigned",
      driver: bus?.driver || "",
      passengerType: ticket.passengerType || "regular",
      ride: ticket.standing ? "STANDING" : `SEAT ${ticket.seatId ?? "—"}`,
      from: ticket.from || "PITX",
      to: ticket.to || "SM Pala-Pala",
      fare: Number(ticket.fare || 0),
      distanceKm: Number(ticket.distanceKm || 0),
      issuedAt: ticket.createdAt,
      scanUrl: scanUrl.toString(),
    };
    const result = await sendPrintJob(printData);
    accepted = true;
    await Ticket.updateOne(
      { _id: ticket._id },
      { $set: { printState: "printed", printedAt: new Date() } },
    );
    await audit(req, "receipt.printed", "success", {
      ticketId: ticket._id,
      passengerId: ticket.passengerId,
      reference: ticket.bookingReference,
      busId: ticket.busId,
    });
    return res
      .status(202)
      .json({ ...result, message: "Receipt sent to the kiosk printer." });
  } catch (error) {
    // Release the one-use print authorization after a definite failure so the
    // kiosk can retry. If the agent timed out, retain the consumed token to
    // avoid accidentally printing a duplicate receipt.
    if (
      !accepted &&
      !error.uncertain &&
      !error.message.includes("did not confirm") &&
      !error.message.includes("disconnected")
    ) {
      await Ticket.updateOne(
        { _id: ticket._id, printTokenHash: { $exists: false } },
        { $set: { printTokenHash: tokenHash, printState: "failed" } },
      );
    } else
      await Ticket.updateOne(
        { _id: ticket._id },
        { $set: { printState: "uncertain" } },
      );
    await audit(req, "receipt.failed", "failure", {
      ticketId: ticket._id,
      passengerId: ticket.passengerId,
      reference: ticket.bookingReference,
      busId: ticket.busId,
      detail:
        "Printer did not complete the job; check physical printer before retrying.",
    });
    return res.status(503).json({
      error: error.message || "Unable to send receipt to the kiosk printer.",
    });
  }
});

export default router;
