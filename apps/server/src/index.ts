import "dotenv/config";
import { serve, serveStatic } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getDb } from "./db/client.js";
import optinRouter from "./routes/optin.js";
import lessonsRouter from "./routes/lessons.js";
import detectRouter from "./routes/detect.js";
import simulatorRouter from "./routes/simulator.js";
import { createSessionsRouter } from "./routes/sessions.js";
import { createRedirectRouter } from "./routes/redirect.js";
import { createPhotonWebhookRouter } from "./routes/photonWebhook.js";
import { SimulatorChannel } from "./channels/SimulatorChannel.js";
import { PhotonChannel } from "./channels/PhotonChannel.js";
import { purgeExpiredSessions } from "./db/repository.js";

// ── Initialise database ───────────────────────────────────────────────────────
getDb();

// ── Channel selection ─────────────────────────────────────────────────────────
const isDemo = process.env["DEMO_MODE"] === "true";
const usePhoton = !isDemo && Boolean(process.env["PHOTON_PROJECT_ID"]);

const channel = usePhoton ? new PhotonChannel() : new SimulatorChannel();
await channel.start();

// ── Wire inbound message handler ─────────────────────────────────────────────
import { handleUserMessage, loadScenario } from "./engine/stateMachine.js";
import { getUserSessions, getSessionById } from "./db/repository.js";

const baseUrl = process.env["BASE_URL"] ?? "http://localhost:3000";

channel.onMessage(async (from, text, sessionId) => {
  // Find the session to route to
  let targetSessionId = sessionId;
  if (!targetSessionId) {
    // Look up by phone/userId
    const { getDb: db } = await import("./db/client.js");
    const { users } = await import("./db/schema.js");
    const { eq } = await import("drizzle-orm");
    const user = db().select().from(users).where(eq(users.phone, from)).get();
    if (!user) return;
    const activeSessions = getUserSessions(user.id).filter((s) =>
      ["hook_sent", "engaging", "escalating", "link_sent"].includes(s.state)
    );
    targetSessionId = activeSessions[activeSessions.length - 1]?.id;
  }
  if (!targetSessionId) return;

  const session = getSessionById(targetSessionId);
  if (!session) return;

  const scenario = await loadScenario(session.scenarioId);
  if (!scenario) return;

  await handleUserMessage(targetSessionId, text, scenario, { channel, baseUrl });
});

// ── App setup ─────────────────────────────────────────────────────────────────
const app = new Hono();

app.use("*", cors({
  origin: ["http://localhost:8081", "exp://localhost:8081", "http://localhost:3000"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
}));
app.use("*", logger());

// Routes
app.route("/api", optinRouter);
app.route("/api", createSessionsRouter(channel));
app.route("/api", lessonsRouter);
app.route("/api", detectRouter);
app.route("/api", simulatorRouter);
app.route("/", createRedirectRouter(channel));
app.route("/", createPhotonWebhookRouter(channel));

app.get("/health", (c) => c.json({ ok: true, mode: isDemo ? "demo" : "live", channel: usePhoton ? "photon" : "simulator" }));

// Serve test UI
app.use("/test-ui.html", serveStatic({ path: "./public/test-ui.html" }));
app.get("/", (c) => c.redirect("/test-ui.html"));

// ── TTL cleanup job (every hour) ──────────────────────────────────────────────
setInterval(() => {
  const removed = purgeExpiredSessions();
  if (removed > 0) console.log(`[cleanup] Purged ${removed} expired sessions`);
}, 60 * 60 * 1000);

// ── Start server ──────────────────────────────────────────────────────────────
const port = Number(process.env["PORT"] ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🚀 Safe Signal server running on http://localhost:${info.port}`);
  console.log(`   Mode: ${isDemo ? "DEMO" : "LIVE"}  |  Channel: ${usePhoton ? "Photon/iMessage" : "Simulator"}`);
});

export default app;
