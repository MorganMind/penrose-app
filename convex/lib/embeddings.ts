"use node";

/**
 * Embeddings client for semantic similarity.
 *
 * Uses OpenAI text-embedding-3-small for fast, cheap similarity
 * checks. The model returns 1536-dimensional vectors.
 */

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for embeddings");
  }

  const model = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";

  const truncated = texts.map((t) => t.slice(0, 30000));

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: truncated,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[embeddings] OpenAI error", { status: res.status, text });
    throw new Error(`Embeddings API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  const embeddings: number[][] = data.data
    .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
    .map((d: { embedding: number[] }) => d.embedding);

  return embeddings;
}

export function embeddingCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
