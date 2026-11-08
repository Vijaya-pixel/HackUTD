import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { TriggerPracticeRequestSchema } from "@safe-signal/shared";
import {
  getUserById,
  getActiveConsent,
  getUserSessions,
  getSessionById,
  getSkillsSummary,
} from "../db/repository.js";
import { startSession, loadScenario } from "../engine/stateMachine.js";
import type { MessagingChannel } from "../channels/MessagingChannel.js";

export function createSessionsRouter(channel: MessagingChannel) {
  const app = new Hono();
  const baseUrl = process.env["BASE_URL"] ?? "http://localhost:3000";

  app.post("/practice/trigger", zValidator("json", TriggerPracticeRequestSchema), async (c) => {
    const { userId, scenarioId } = c.req.valid("json");

    const user = getUserById(userId);
    if (!user) return c.json({ error: "User not found" }, 404);

    const consent = getActiveConsent(userId);
    if (!consent) return c.json({ error: "No active consent" }, 403);

    // Pick scenario
    let scenario = scenarioId ? await loadScenario(scenarioId) : null;
    if (!scenario) {
      // Pick based on interests
      scenario = await pickScenario(consent.interests);
    }
    if (!scenario) return c.json({ error: "No scenarios available" }, 500);

    // Check quiet hours
    if (isQuietHours(consent)) {
      return c.json({ error: "Quiet hours active" }, 429);
    }

    // Check daily limit
    const todaySessions = getUserSessions(userId).filter((s) => {
      const d = new Date(s.startedAt);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    });
    if (todaySessions.length >= consent.maxPerDay) {
      return c.json({ error: "Daily limit reached" }, 429);
    }

    const session = await startSession(userId, scenario, consent.channel, {
      channel,
      baseUrl,
    });

    return c.json({ sessionId: session.id, token: session.token });
  });

  app.get("/sessions/:userId", async (c) => {
    const userId = c.req.param("userId");
    const sessions = getUserSessions(userId).map((s) => ({
      id: s.id,
      scenarioId: s.scenarioId,
      state: s.state,
      outcome: s.outcome,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
    }));
    return c.json({ sessions });
  });

  app.get("/sessions/:userId/skills", async (c) => {
    const userId = c.req.param("userId");
    const summary = getSkillsSummary(userId);
    return c.json(summary);
  });

  app.get("/session/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = getSessionById(sessionId);
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  });

  return app;
}

async function pickScenario(interests: string[]) {
  const { readdirSync, readFileSync } = await import("fs");
  const { join } = await import("path");
  const { fileURLToPath } = await import("url");
  const dir = fileURLToPath(new URL("../../../../packages/shared/scenarios", import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const all = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")));
  const matching = all.filter((s: any) =>
    s.interestTags.some((t: string) => interests.includes(t))
  );
  const pool = matching.length > 0 ? matching : all;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

function isQuietHours(consent: { quietHours?: { startHour: number; endHour: number } }): boolean {
  if (!consent.quietHours) return false;
  const hour = new Date().getHours();
  const { startHour, endHour } = consent.quietHours;
  if (startHour <= endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour; // overnight
}
