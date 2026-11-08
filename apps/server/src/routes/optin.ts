import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import { OptInRequestSchema } from "@safe-signal/shared";
import { upsertUser, saveConsent, getActiveConsent } from "../db/repository.js";

const app = new Hono();

app.post("/optin", zValidator("json", OptInRequestSchema), async (c) => {
  const body = c.req.valid("json");

  const user = await upsertUser(body.phone);

  const consent = await saveConsent({
    userId: user.id,
    phone: body.phone,
    channel: body.channel,
    interests: body.interests,
    quietHours: body.quietHours,
    maxPerDay: body.maxPerDay,
    consentVersion: body.consentVersion,
    consentAt: new Date().toISOString(),
    active: true,
  });

  return c.json({ userId: user.id, consentId: consent.id, channel: consent.channel });
});

app.delete("/optin/:userId", async (c) => {
  const userId = c.req.param("userId");
  const { getDb } = await import("../db/client.js");
  const { consents } = await import("../db/schema.js");
  const { eq } = await import("drizzle-orm");
  getDb().update(consents).set({ active: false }).where(eq(consents.userId, userId)).run();
  return c.json({ ok: true });
});

app.get("/optin/:userId", async (c) => {
  const userId = c.req.param("userId");
  const consent = getActiveConsent(userId);
  if (!consent) return c.json({ active: false });
  return c.json({ active: true, consent });
});

export default app;
