// 임베딩 어댑터 — local(키 불필요) / openai / voyage

export interface EmbeddingAdapter {
  readonly name: string;
  readonly model: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** 문자 n-gram 해시 임베딩 — 결정적, 키 불필요. 데모 규모(작품 1권)의 유사도 검색에 충분 */
class LocalHashEmbedding implements EmbeddingAdapter {
  name = "local";
  model = "char-ngram-hash-v1";
  dim = 384;

  private hash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private vector(text: string): number[] {
    const v = new Array(this.dim).fill(0);
    const t = text.replace(/\s+/g, " ").trim();
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i + n <= t.length; i++) {
        const g = t.slice(i, i + n);
        const h = this.hash(g);
        const sign = h & 1 ? 1 : -1;
        v[h % this.dim] += sign * (n === 1 ? 0.5 : n === 2 ? 1.0 : 1.5);
      }
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => +(x / norm).toFixed(6));
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vector(t));
  }
}

class OpenAIEmbedding implements EmbeddingAdapter {
  name = "openai";
  model = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
  dim = 1536;

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`OpenAI 임베딩 오류 (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    return json.data.map((d: { embedding: number[] }) => d.embedding);
  }
}

class VoyageEmbedding implements EmbeddingAdapter {
  name = "voyage";
  model = process.env.EMBEDDING_MODEL || "voyage-3.5-lite";
  dim = 1024;

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`Voyage 임베딩 오류 (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    return json.data.map((d: { embedding: number[] }) => d.embedding);
  }
}

let cached: EmbeddingAdapter | null = null;

export function getEmbedder(): EmbeddingAdapter {
  if (cached) return cached;
  const provider = (process.env.EMBEDDING_PROVIDER || "local").toLowerCase();
  if (provider === "openai" && process.env.OPENAI_API_KEY) cached = new OpenAIEmbedding();
  else if (provider === "voyage" && process.env.VOYAGE_API_KEY) cached = new VoyageEmbedding();
  else cached = new LocalHashEmbedding();
  return cached;
}

/** 저장된 인덱스와 같은 provider의 임베더 반환 (질의 벡터는 인덱스와 같은 공간이어야 함) */
export function getEmbedderFor(provider: string): EmbeddingAdapter | null {
  if (provider === "local") return new LocalHashEmbedding();
  if (provider === "openai" && process.env.OPENAI_API_KEY) return new OpenAIEmbedding();
  if (provider === "voyage" && process.env.VOYAGE_API_KEY) return new VoyageEmbedding();
  return null;
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
