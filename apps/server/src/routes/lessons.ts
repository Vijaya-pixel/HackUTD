import { Hono } from "hono";
import { getSessionById } from "../db/repository.js";
import { buildLesson } from "../engine/mistakeAnalyzer.js";
import { loadScenario } from "../engine/stateMachine.js";

const app = new Hono();

app.get("/lesson/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = await getSessionById(sessionId);
  if (!session) return c.json({ error: "Session not found" }, 404);

  if (session.lesson) {
    return c.json(session.lesson);
  }

  if (!["ended_caught", "ended_fell", "ended_timeout"].includes(session.state)) {
    return c.json({ error: "Session still active" }, 400);
  }

  const scenario = await loadScenario(session.scenarioId);
  if (!scenario) return c.json({ error: "Scenario not found" }, 404);

  const lesson = await buildLesson(session, scenario);
  return c.json(lesson);
});

export default app;
