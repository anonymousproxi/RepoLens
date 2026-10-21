const STOPWORDS = new Set([
  "the", "an", "of", "to", "in", "is", "and", "or", "for", "on", "with", "this", "that", "it", "be", "as", "at", "by", "from",
]);

/**
 * Lowercased word tokens. Identifiers also contribute their camelCase parts, so
 * `getUserById` yields `getuserbyid`, `get`, `user`, `by` and `id`.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const words = text.match(/[A-Za-z0-9]+/g);
  if (!words) return out;
  for (const w of words) {
    const lower = w.toLowerCase();
    if (lower.length >= 2 && !STOPWORDS.has(lower)) out.push(lower);
    const parts = w.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+/g);
    if (parts && parts.length > 1) {
      for (const p of parts) {
        const l = p.toLowerCase();
        if (l.length >= 2 && !STOPWORDS.has(l)) out.push(l);
      }
    }
  }
  return out;
}

export interface SerializedBm25 {
  k1: number;
  b: number;
  avgdl: number;
  docLens: number[];
  /** `[term, [doc, tf, doc, tf, ...]]` pairs. */
  postings: [string, number[]][];
}

export interface Bm25Hit {
  doc: number;
  score: number;
}

export class Bm25 {
  private readonly postings: Map<string, number[]>;

  constructor(
    private readonly data: Omit<SerializedBm25, "postings">,
    postings: Map<string, number[]>,
  ) {
    this.postings = postings;
  }

  static build(docs: string[], k1 = 1.2, b = 0.75): Bm25 {
    const postings = new Map<string, number[]>();
    const docLens: number[] = [];
    docs.forEach((text, doc) => {
      const tokens = tokenize(text);
      docLens.push(tokens.length);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const [term, n] of tf) {
        const list = postings.get(term);
        if (list) list.push(doc, n);
        else postings.set(term, [doc, n]);
      }
    });
    const total = docLens.reduce((a, c) => a + c, 0);
    return new Bm25({ k1, b, avgdl: docs.length ? total / docs.length : 0, docLens }, postings);
  }

  static fromSerialized(s: SerializedBm25): Bm25 {
    const { postings, ...rest } = s;
    return new Bm25(rest, new Map(postings));
  }

  serialize(): SerializedBm25 {
    return { ...this.data, postings: [...this.postings.entries()] };
  }

  get size(): number {
    return this.data.docLens.length;
  }

  /** Top `k` documents for the query, best first. Documents with no matching term are not returned. */
  search(query: string, k = 10): Bm25Hit[] {
    const { k1, b, avgdl, docLens } = this.data;
    const n = docLens.length;
    const scores = new Map<number, number>();
    for (const term of new Set(tokenize(query))) {
      const list = this.postings.get(term);
      if (!list) continue;
      const df = list.length / 2;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      for (let i = 0; i < list.length; i += 2) {
        const doc = list[i] as number;
        const tf = list[i + 1] as number;
        const len = docLens[doc] ?? 0;
        const norm = tf + k1 * (1 - b + (b * len) / (avgdl || 1));
        scores.set(doc, (scores.get(doc) ?? 0) + (idf * tf * (k1 + 1)) / norm);
      }
    }
    return [...scores.entries()]
      .map(([doc, score]) => ({ doc, score }))
      .sort((x, y) => y.score - x.score || x.doc - y.doc)
      .slice(0, k);
  }
}
