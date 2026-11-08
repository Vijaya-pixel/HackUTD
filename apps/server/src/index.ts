import "dotenv/config";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getDb, getDbInfo } from "./db/client.js";
import optinRouter from "./routes/optin.js";
import lessonsRouter from "./routes/lessons.js";
import detectRouter from "./routes/detect.js";
import simulatorRouter from "./routes/simulator.js";
import { createSessionsRouter } from "./routes/sessions.js";
import { createRedirectRouter } from "./routes/redirect.js";
import { createPhotonWebhookRouter } from "./routes/photonWebhook.js";
import { SimulatorChannel } from "./channels/SimulatorChannel.js";
import { PhotonChannel } from "./channels/PhotonChannel.js";
import { purgeExpiredSessions, getUserByPhone, getActiveSessionForUser } from "./db/repository.js";

// ── Initialise database (TigerData via DATABASE_URL, else embedded PGlite) ────
await getDb();
const dbInfo = getDbInfo();

// ── Channel selection ─────────────────────────────────────────────────────────
const isDemo = process.env["DEMO_MODE"] === "true";
const usePhoton = !isDemo && Boolean(process.env["PHOTON_PROJECT_ID"]);

const channel = usePhoton ? new PhotonChannel() : new SimulatorChannel();
await channel.start();

// ── Wire inbound message handler ─────────────────────────────────────────────
import { handleUserMessage, loadScenario } from "./engine/stateMachine.js";
import { getSessionById } from "./db/repository.js";

const baseUrl = process.env["BASE_URL"] ?? "http://localhost:3000";

channel.onMessage(async (from, text, sessionId) => {
  // Find the session to route to
  let targetSessionId = sessionId;
  if (!targetSessionId) {
    // Look up by phone
    const user = await getUserByPhone(from);
    if (!user) return;
    const active = await getActiveSessionForUser(user.id, ["hook_sent", "engaging", "escalating", "link_sent"]);
    targetSessionId = active?.id;
  }
  if (!targetSessionId) return;

  const session = await getSessionById(targetSessionId);
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

app.get("/health", (c) => c.json({ ok: true, mode: isDemo ? "demo" : "live", channel: usePhoton ? "photon" : "simulator", db: dbInfo }));

// Serve test UI
app.use("/test-ui.html", serveStatic({ path: "./public/test-ui.html" }));
app.get("/", (c) => c.redirect("/test-ui.html"));

// ── TTL cleanup job (every hour) ──────────────────────────────────────────────
setInterval(() => {
  purgeExpiredSessions()
    .then((removed) => { if (removed > 0) console.log(`[cleanup] Purged ${removed} expired sessions`); })
    .catch((err) => console.error("[cleanup] failed:", err));
}, 60 * 60 * 1000);

// ── Start server ──────────────────────────────────────────────────────────────
const port = Number(process.env["PORT"] ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🚀 Safe Signal server running on http://localhost:${info.port}`);
  console.log(`   Mode: ${isDemo ? "DEMO" : "LIVE"}  |  Channel: ${usePhoton ? "Photon/iMessage" : "Simulator"}`);
  console.log(`   DB: ${dbInfo.driver}${dbInfo.host ? ` (${dbInfo.host})` : ""}  |  hypertable: ${dbInfo.hypertable ? "yes" : "no"}`);
});

export default app;
