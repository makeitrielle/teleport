import dotenv from "dotenv";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { printTicket } from "./printer.js";

dotenv.config({ path: fileURLToPath(new URL("./.env", import.meta.url)) });

const wsUrl = process.env.WS_URL;
const agentSecret = process.env.AGENT_SECRET;

if (!wsUrl || !agentSecret) {
  console.error("[print-agent] Set WS_URL and AGENT_SECRET in backend/print-agent/.env first.");
  process.exit(1);
}

let stopping = false;
let retryDelay = 2_000;
let socket;

function connect() {
  if (stopping) return;
  socket = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${agentSecret}` }, handshakeTimeout: 15_000 });

  socket.on("open", () => {
    retryDelay = 2_000;
    console.log("[print-agent] Connected to the Tele-port backend.");
  });
  socket.on("message", async (raw) => {
    let job;
    try { job = JSON.parse(raw.toString()); } catch { return; }
    if (job.type !== "print:receipt" || typeof job.jobId !== "string" || !job.ticket) return;
    try {
      await printTicket(job.ticket);
      socket.send(JSON.stringify({ type: "print:result", jobId: job.jobId, ok: true }));
      console.log(`[print-agent] Receipt ${job.ticket.ticketNumber} sent to ${process.env.PRINTER_NAME || "XP-58"}.`);
    } catch (error) {
      console.error(`[print-agent] Print failed: ${error.message}`);
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "print:result", jobId: job.jobId, ok: false, error: error.message.slice(0, 300) }));
    }
  });
  socket.on("error", (error) => console.error(`[print-agent] ${error.message}`));
  socket.on("close", (code) => {
    if (stopping) return;
    console.log(`[print-agent] Disconnected (${code}); reconnecting in ${Math.round(retryDelay / 1000)}s.`);
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30_000);
  });
}

function shutdown() {
  stopping = true;
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Kiosk shutting down");
  setTimeout(() => process.exit(0), 250).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
console.log(`[print-agent] Starting Tele-port XP-58 print agent (${crypto.randomUUID().slice(0, 8)}).`);
connect();
