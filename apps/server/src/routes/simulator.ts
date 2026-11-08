import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { SimulatorSendSchema } from "@safe-signal/shared";
import {
  getSimulatorMessages,
  simulatorDispatch,
  simulatorChannel,
} from "../channels/SimulatorChannel.js";
import { handleUserMessage, loadScenario } from "../engine/stateMachine.js";
import { getSessionById } from "../db/repository.js";

const app = new Hono();
const baseUrl = process.env["BASE_URL"] ?? "http://localhost:3000";

// Get all messages in a simulator session
app.get("/simulator/:sessionId/messages", (c) => {
  const sessionId = c.req.param("sessionId");
  const msgs = getSimulatorMessages(sessionId);
  return c.json({ messages: msgs });
});

// User sends a message in the simulator
app.post("/simulator/send", zValidator("json", SimulatorSendSchema), async (c) => {
  const { sessionId, text } = c.req.valid("json");

  const session = await getSessionById(sessionId);
  if (!session) return c.json({ error: "Session not found" }, 404);

  const scenario = await loadScenario(session.scenarioId);
  if (!scenario) return c.json({ error: "Scenario not found" }, 404);

  await handleUserMessage(sessionId, text, scenario, {
    channel: simulatorChannel,
    baseUrl,
  });

  const msgs = getSimulatorMessages(sessionId);
  return c.json({ messages: msgs });
});

// SSE endpoint for real-time message streaming
app.get("/simulator/:sessionId/stream", async (c) => {
  const sessionId = c.req.param("sessionId");

  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let running = true;
      const cleanup = () => { running = false; };
      c.req.raw.signal?.addEventListener("abort", cleanup);

      while (running) {
        await simulatorChannel.waitForOutbound(sessionId);
        if (!running) break;
        const msgs = getSimulatorMessages(sessionId);
        const latest = msgs[msgs.length - 1];
        if (latest?.role === "scammer") {
          const data = `data: ${JSON.stringify(latest)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
});

export default app;
