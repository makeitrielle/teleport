import crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";

let activeAgent = null;
const pendingJobs = new Map();

function secretMatches(provided, expected) {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function attachPrintAgent(httpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname !== "/api/printer/agent") {
      socket.destroy();
      return;
    }

    const expectedSecret = process.env.AGENT_SECRET;
    const providedSecret = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!secretMatches(providedSecret, expectedSecret)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (websocket) => wss.emit("connection", websocket));
  });

  wss.on("connection", (websocket) => {
    if (activeAgent && activeAgent.readyState === WebSocket.OPEN) activeAgent.close(4001, "Replaced by newer print agent");
    activeAgent = websocket;
    websocket.isAlive = true;
    websocket.on("pong", () => { websocket.isAlive = true; });
    websocket.on("message", (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type !== "print:result" || typeof message.jobId !== "string") return;
      const pending = pendingJobs.get(message.jobId);
      if (!pending || pending.agent !== websocket) return;
      clearTimeout(pending.timer);
      pendingJobs.delete(message.jobId);
      if (message.ok) pending.resolve({ jobId: message.jobId, printed: true });
      else pending.reject(new Error(message.error || "The kiosk print agent could not print this receipt."));
    });
    websocket.on("close", () => {
      if (activeAgent === websocket) activeAgent = null;
      for (const [jobId, pending] of pendingJobs) {
        if (pending.agent !== websocket) continue;
        clearTimeout(pending.timer);
        pendingJobs.delete(jobId);
        pending.reject(new Error("The kiosk print agent disconnected before confirming the job."));
      }
    });
  });

  const heartbeat = setInterval(() => {
    if (!activeAgent) return;
    if (!activeAgent.isAlive) {
      activeAgent.terminate();
      activeAgent = null;
      return;
    }
    activeAgent.isAlive = false;
    activeAgent.ping();
  }, 25_000);
  heartbeat.unref?.();
}

export function getPrintAgentStatus() {
  return {
    agentConnected: Boolean(activeAgent && activeAgent.readyState === WebSocket.OPEN),
    message: activeAgent && activeAgent.readyState === WebSocket.OPEN
      ? "Kiosk print agent is connected"
      : "Kiosk print agent is offline",
  };
}

export function sendPrintJob(ticket) {
  if (!activeAgent || activeAgent.readyState !== WebSocket.OPEN) {
    throw new Error("Kiosk printer is offline. Start the Tele-port print agent on the kiosk computer.");
  }

  const jobId = crypto.randomUUID();
  const agent = activeAgent;
  const payload = JSON.stringify({ type: "print:receipt", jobId, ticket });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingJobs.delete(jobId);
      reject(new Error("The printer did not confirm the receipt within 20 seconds."));
    }, 20_000);
    pendingJobs.set(jobId, { agent, resolve, reject, timer });
    agent.send(payload, (error) => {
      if (!error) return;
      clearTimeout(timer);
      pendingJobs.delete(jobId);
      reject(error);
    });
  });
}
