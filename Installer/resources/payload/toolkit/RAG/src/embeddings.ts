import { LMStudioClient } from "@lmstudio/sdk";

type EmbeddingModel = Awaited<ReturnType<LMStudioClient["embedding"]["model"]>>;

export interface EmbeddingProvider {
  embedBatch(texts: string[]): Promise<number[][]>;
  countTokens(text: string): Promise<number>;
}

class MockEmbeddingProvider implements EmbeddingProvider {
  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedSingle(text));
  }

  async countTokens(text: string): Promise<number> {
    return Math.max(1, text.trim().split(/\s+/).length);
  }

  private embedSingle(text: string): number[] {
    const dims = 128;
    const vector = new Array(dims).fill(0);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      vector[i % dims] += code / 1000;
    }

    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => value / magnitude);
  }
}

class LMStudioEmbeddingProvider implements EmbeddingProvider {
  private client = new LMStudioClient();
  private modelName = process.env.RAG_EMBEDDING_MODEL ?? "nomic-ai/nomic-embed-text-v1.5";
  private modelPromise?: Promise<EmbeddingModel>;

  private getModel(): Promise<EmbeddingModel> {
    if (!this.modelPromise) {
      this.modelPromise = this.client.embedding.model(this.modelName);
    }

    return this.modelPromise;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const model = await this.getModel();
    const vectors: number[][] = [];

    for (const text of texts) {
      const { embedding } = await model.embed(text);
      vectors.push(embedding as number[]);
    }

    return vectors;
  }

  async countTokens(text: string): Promise<number> {
    const model = await this.getModel();
    const count = await model.countTokens(text);
    return Number(count);
  }
}

export function createEmbeddingProvider(): EmbeddingProvider {
  const mode = (process.env.RAG_EMBEDDINGS_MODE || "lmstudio").toLowerCase();
  if (mode === "mock") {
    return new MockEmbeddingProvider();
  }

  return new LMStudioEmbeddingProvider();
}
