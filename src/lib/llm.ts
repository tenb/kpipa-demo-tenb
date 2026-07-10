// LLM 어댑터 인터페이스 (BYOM) — env로 provider/model/base_url/key 교체 가능

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMCompleteOptions {
  system: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface LLMAdapter {
  readonly name: string;
  readonly model: string;
  readonly available: boolean;
  complete(opts: LLMCompleteOptions): Promise<string>;
}

class AnthropicAdapter implements LLMAdapter {
  name = "anthropic";
  model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.model = process.env.LLM_MODEL || "claude-sonnet-4-6";
    this.apiKey = process.env.ANTHROPIC_API_KEY || "";
    this.baseUrl = process.env.LLM_BASE_URL || "https://api.anthropic.com";
  }

  get available() {
    return !!this.apiKey;
  }

  async complete(opts: LLMCompleteOptions): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.2,
        system: opts.system,
        messages: opts.messages,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API 오류 (${res.status}): ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    return (json.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");
  }
}

class OpenAICompatAdapter implements LLMAdapter {
  name = "openai-compat";
  model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.model = process.env.LLM_MODEL || "gpt-4o-mini";
    this.apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
    this.baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  }

  get available() {
    return !!this.baseUrl && (!!this.apiKey || this.baseUrl.includes("localhost"));
  }

  async complete(opts: LLMCompleteOptions): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.2,
        messages: [
          { role: "system", content: opts.system },
          ...opts.messages,
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LLM API 오류 (${res.status}): ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    return json.choices?.[0]?.message?.content ?? "";
  }
}

/** 키 없이 데모 경로 확보용 — 근거 텍스트를 그대로 요약 형태로 반환 */
class MockAdapter implements LLMAdapter {
  name = "mock";
  model = "mock";
  available = true;

  async complete(opts: LLMCompleteOptions): Promise<string> {
    const last = opts.messages[opts.messages.length - 1]?.content ?? "";
    return `[mock 응답] LLM 키가 설정되지 않아 근거 요약만 표시합니다.\n\n${last.slice(0, 400)}`;
  }
}

let cached: LLMAdapter | null = null;

export function getLLM(): LLMAdapter {
  if (cached) return cached;
  const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  if (provider === "openai-compat") cached = new OpenAICompatAdapter();
  else if (provider === "mock") cached = new MockAdapter();
  else cached = new AnthropicAdapter();
  return cached;
}
