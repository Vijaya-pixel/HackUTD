export interface LLMClient {
  complete(prompt: string, systemPrompt?: string): Promise<string>;
}

// ── Anthropic implementation ──────────────────────────────────────────────────
class AnthropicLLMClient implements LLMClient {
  private model: string;

  constructor() {
    this.model = process.env["LLM_MODEL"] ?? "claude-sonnet-4-6";
  }

  async complete(prompt: string, systemPrompt?: string): Promise<string> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });

    const msg = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      ...(systemPrompt && { system: systemPrompt }),
      messages: [{ role: "user", content: prompt }],
    });

    const block = msg.content[0];
    if (block?.type === "text") return block.text;
    throw new Error("Unexpected LLM response format");
  }
}

// ── OpenAI implementation ─────────────────────────────────────────────────────
class OpenAILLMClient implements LLMClient {
  private model: string;

  constructor() {
    this.model = process.env["LLM_MODEL"] ?? "gpt-4o";
  }

  async complete(prompt: string, systemPrompt?: string): Promise<string> {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

    const messages: { role: "system" | "user"; content: string }[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    const res = await client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: 1024,
    });

    return res.choices[0]?.message?.content ?? "";
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────
export function createLLMClient(): LLMClient {
  const provider = process.env["LLM_PROVIDER"] ?? "anthropic";
  if (provider === "openai") return new OpenAILLMClient();
  return new AnthropicLLMClient();
}

// Named export for eval harness
export { AnthropicLLMClient as LLMClientImpl };
