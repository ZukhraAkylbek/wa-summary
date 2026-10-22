// LLM client via plain fetch. Provider is chosen by env:
//   GEMINI_API_KEY     -> Google Gemini (free Flash Lite by default)
//   ANTHROPIC_API_KEY  -> Anthropic Messages API
//   AI_GATEWAY_API_KEY -> Vercel AI Gateway (same Messages format)
import { env } from "./env.ts";
import { log } from "./log.ts";

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/messages";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const geminiKey = env.get("GEMINI_API_KEY");
const anthropicKey = env.get("ANTHROPIC_API_KEY");
const gatewayKey = env.get("AI_GATEWAY_API_KEY");

type Provider = "gemini" | "anthropic" | "gateway";
const provider: Provider | null = geminiKey
  ? "gemini"
  : anthropicKey
  ? "anthropic"
  : gatewayKey
  ? "gateway"
  : null;

const rawModel = env.get("GEMINI_MODEL") ?? env.get("CLAUDE_MODEL") ??
  (provider === "gemini" ? "gemini-flash-lite-latest" : "claude-sonnet-5-5");

function geminiModel(): string {
  return rawModel.replace(/^models\//, "").replace(/^google\//, "");
}

function anthropicModel(): string {
  return rawModel.includes("/") ? rawModel : `anthropic/${rawModel}`;
}

if (!provider) log.warn("no LLM key set (GEMINI_API_KEY / ANTHROPIC_API_KEY / AI_GATEWAY_API_KEY)");

export type ClaudeRequest = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
};

async function askGemini(req: ClaudeRequest): Promise<string> {
  const model = geminiModel();
  const r = await fetch(`${GEMINI_URL}/${model}:generateContent?key=${geminiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 2000,
        temperature: req.temperature ?? 0.2,
        ...(req.json ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });
  if (!r.ok) {
    throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 500)}`);
  }
  const data = await r.json();
  const parts = data?.candidates?.[0]?.content?.parts as { text?: string }[] | undefined;
  const text = (parts ?? []).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini returned empty content");
  return text;
}

async function askAnthropic(req: ClaudeRequest): Promise<string> {
  const useGateway = provider === "gateway";
  const apiUrl = env.get("CLAUDE_API_URL") ?? (useGateway ? GATEWAY_URL : ANTHROPIC_URL);
  const apiKey = anthropicKey ?? gatewayKey;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY / AI_GATEWAY_API_KEY");
  const model = useGateway
    ? anthropicModel()
    : rawModel.replace(/^anthropic\//, "");
  const r = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 2000,
      temperature: req.temperature ?? 0.2,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    }),
  });
  if (!r.ok) {
    throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 500)}`);
  }
  const data = await r.json();
  return (data.content as { type: string; text?: string }[])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

export async function askClaude(req: ClaudeRequest): Promise<string> {
  if (provider === "gemini") return askGemini(req);
  if (provider === "anthropic" || provider === "gateway") return askAnthropic(req);
  throw new Error("Missing GEMINI_API_KEY / ANTHROPIC_API_KEY / AI_GATEWAY_API_KEY");
}

// Strip ```json fences and parse. Throws a descriptive error on failure.
export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch { /* fall through */ }
    }
    log.error("llm json parse failed", { preview: cleaned.slice(0, 300) });
    throw new Error("LLM returned non-JSON output");
  }
}

export async function askClaudeJson<T>(req: ClaudeRequest): Promise<T> {
  return parseJson<T>(await askClaude({ ...req, json: true }));
}
