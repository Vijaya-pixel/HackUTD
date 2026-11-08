import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { DetectRequestSchema } from "@safe-signal/shared";
import { detect } from "@safe-signal/shared/detection";
import { createLLMClient } from "../llm/LLMClient.js";

const app = new Hono();

// Stub endpoint — "forward a suspicious message to check it"
app.post("/detect", zValidator("json", DetectRequestSchema), async (c) => {
  const { text, senderKnown, channel } = c.req.valid("json");

  const llm = createLLMClient();
  const result = await detect(
    { text, senderKnown, channel },
    { callLLM: (prompt) => llm.complete(prompt) }
  );

  return c.json(result);
});

export default app;
