import { Hono } from "hono";
import { Webhook } from "standardwebhooks";
import { handleUserMessage, loadScenario } from "../engine/stateMachine.js";
import { getUserByPhone, getActiveSessionForUser } from "../db/repository.js";
import type { MessagingChannel } from "../channels/MessagingChannel.js";

export function createPhotonWebhookRouter(channel: MessagingChannel) {
  const app = new Hono();
  const baseUrl = process.env["BASE_URL"] ?? "http://localhost:3000";

  app.post("/webhooks/photon", async (c) => {
    const webhookSecret = process.env["PHOTON_WEBHOOK_SECRET"];
    if (!webhookSecret) {
      return c.json({ error: "Webhook secret not configured" }, 500);
    }

    const rawBody = await c.req.text();
    const headers = {
      "webhook-id": c.req.header("webhook-id") ?? "",
      "webhook-timestamp": c.req.header("webhook-timestamp") ?? "",
      "webhook-signature": c.req.header("webhook-signature") ?? "",
    };

    // Verify Standard Webhooks signature
    try {
      const wh = new Webhook(webhookSecret);
      wh.verify(rawBody, headers);
    } catch {
      return c.json({ error: "Invalid webhook signature" }, 401);
    }

    const payload = JSON.parse(rawBody) as { type: string; data: any };
    if (payload.type !== "message.received") {
      return c.json({ ok: true });
    }

    const from: string = payload.data?.sender?.phone ?? payload.data?.from ?? "";
    const text: string = payload.data?.content?.text ?? payload.data?.text ?? "";
    if (!from || !text) return c.json({ ok: true });

    const session = await findActiveSessionForPhone(from);
    if (!session) return c.json({ ok: true });

    const scenario = await loadScenario(session.scenarioId);
    if (!scenario) return c.json({ ok: true });

    await handleUserMessage(session.id, text, scenario, { channel, baseUrl });
    return c.json({ ok: true });
  });

  return app;
}

const ACTIVE_STATES = ["hook_sent", "engaging", "escalating", "link_sent"];

async function findActiveSessionForPhone(phone: string) {
  const user = await getUserByPhone(phone);
  if (!user) return null;
  return (await getActiveSessionForUser(user.id, ACTIVE_STATES)) ?? null;
}
