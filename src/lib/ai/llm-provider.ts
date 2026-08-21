/** Provider-agnostic LLM interface. Grok is one adapter, not the product. */

export type LLMStatus = "ready" | "not_configured";

export type LLMMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
};

export type LLMToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LLMToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LLMImage = {
  mimeType: string;
  base64: string;
  label?: string;
};

export type LLMChatRequest = {
  messages: LLMMessage[];
  tools?: LLMToolSpec[];
  images?: LLMImage[];
  maxTokens?: number;
};

export type LLMChatResult =
  | {
      ok: true;
      text: string;
      toolCalls: LLMToolCall[];
      model: string;
      provider: string;
    }
  | {
      ok: false;
      code: "PROVIDER_NOT_AVAILABLE" | "JOB_FAILED";
      error: string;
      provider: string;
    };

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  status(): LLMStatus;
  supportsTools(): boolean;
  supportsVision(): boolean;
  configured(): boolean;
  chat(req: LLMChatRequest): Promise<LLMChatResult>;
}

function notConfigured(id: string): LLMChatResult {
  return {
    ok: false,
    code: "PROVIDER_NOT_AVAILABLE",
    error: `${id} is not configured.`,
    provider: id,
  };
}

class ReservedLLM implements LLMProvider {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly model: string,
  ) {}
  status(): LLMStatus {
    return "not_configured";
  }
  supportsTools() {
    return false;
  }
  supportsVision() {
    return false;
  }
  configured() {
    return false;
  }
  async chat(): Promise<LLMChatResult> {
    return notConfigured(this.id);
  }
}

export class GrokProvider implements LLMProvider {
  readonly id = "grok";
  readonly name = "Grok";
  readonly model = "grok-4.5";

  configured() {
    return Boolean(typeof process !== "undefined" && process.env.XAI_API_KEY);
  }
  status(): LLMStatus {
    return this.configured() ? "ready" : "not_configured";
  }
  supportsTools() {
    return true;
  }
  supportsVision() {
    return true;
  }

  async chat(req: LLMChatRequest): Promise<LLMChatResult> {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return notConfigured(this.id);

    const messages: unknown[] = [];
    for (const m of req.messages) {
      if (m.role === "tool") {
        messages.push({
          role: "tool",
          tool_call_id: m.toolCallId ?? m.name ?? "tool",
          content: m.content,
        });
        continue;
      }
      if (m.role === "user" && req.images && req.images.length && messages.filter((x) => (x as { role: string }).role === "user").length === 0) {
        const content: unknown[] = [{ type: "text", text: m.content }];
        for (const img of req.images.slice(0, 3)) {
          content.push({
            type: "image_url",
            image_url: {
              url: `data:${img.mimeType};base64,${img.base64}`,
            },
          });
        }
        messages.push({ role: "user", content });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens ?? 700,
      messages,
    };
    if (req.tools && req.tools.length) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        ok: false,
        code: "JOB_FAILED",
        error: `xAI API error ${res.status}: ${errBody.slice(0, 280)}`,
        provider: this.id,
      };
    }
    const json = (await res.json()) as {
      choices?: {
        message?: {
          content?: string;
          tool_calls?: {
            id: string;
            function: { name: string; arguments: string };
          }[];
        };
      }[];
    };
    const msg = json.choices?.[0]?.message;
    const toolCalls: LLMToolCall[] = [];
    for (const tc of msg?.tool_calls ?? []) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = { raw: tc.function.arguments };
      }
      toolCalls.push({ id: tc.id, name: tc.function.name, arguments: args });
    }
    return {
      ok: true,
      text: msg?.content ?? "",
      toolCalls,
      model: this.model,
      provider: this.id,
    };
  }
}

const grok = new GrokProvider();
const openai = new ReservedLLM("openai", "OpenAI", "unwired");
const claude = new ReservedLLM("claude", "Claude", "unwired");
const gemini = new ReservedLLM("gemini", "Gemini", "unwired");
const local = new ReservedLLM("local", "Local", "unwired");

const REGISTRY: LLMProvider[] = [grok, openai, claude, gemini, local];

export type ProviderInfo = {
  id: string;
  name: string;
  model: string;
  status: LLMStatus;
  supports_tools: boolean;
  supports_vision: boolean;
  configured: boolean;
};

export function listLLMProviders(): ProviderInfo[] {
  return REGISTRY.map((p) => ({
    id: p.id,
    name: p.name,
    model: p.model,
    status: p.status(),
    supports_tools: p.supportsTools(),
    supports_vision: p.supportsVision(),
    configured: p.configured(),
  }));
}

export function getLLMProvider(id?: string | null): LLMProvider {
  if (!id) {
    const ready = REGISTRY.find((p) => p.configured());
    return ready ?? grok;
  }
  return REGISTRY.find((p) => p.id === id) ?? grok;
}

export const ProviderRegistry = {
  list: listLLMProviders,
  get: getLLMProvider,
};

