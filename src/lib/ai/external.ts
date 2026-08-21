import { analyzeFrameWithGrok, type VlmResult } from "./grok-vision";

export type ExternalAIProviderId = "xai" | "openai" | "gemini" | "claude" | "local" | "mcp-agent" | "custom";

export type ExternalAIProvider = {
  id: ExternalAIProviderId;
  available(): boolean;
  analyzeFrame(input: { imageBase64: string; prompt: string }): Promise<VlmResult>;
};

export const xaiGrokProvider: ExternalAIProvider = {
  id: "xai",
  available() {
    return Boolean(typeof process !== "undefined" && process.env.XAI_API_KEY);
  },
  analyzeFrame: analyzeFrameWithGrok,
};

function reserved(id: ExternalAIProviderId): ExternalAIProvider {
  return {
    id,
    available() {
      return false;
    },
    async analyzeFrame() {
      return {
        ok: false,
        code: "MODEL_NOT_AVAILABLE",
        error: `External provider '${id}' is not wired. Use xai (Grok) when XAI_API_KEY is set.`,
      };
    },
  };
}

export const EXTERNAL_PROVIDERS: Record<ExternalAIProviderId, ExternalAIProvider> = {
  xai: xaiGrokProvider,
  openai: reserved("openai"),
  gemini: reserved("gemini"),
  claude: reserved("claude"),
  local: reserved("local"),
  "mcp-agent": reserved("mcp-agent"),
  custom: reserved("custom"),
};

export function getExternalProvider(id: ExternalAIProviderId = "xai"): ExternalAIProvider {
  return EXTERNAL_PROVIDERS[id] ?? reserved("custom");
}
