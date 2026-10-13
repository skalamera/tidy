import MiniSearch from 'minisearch';
import { readFile } from 'node:fs/promises';

export interface LawChunk {
  id: string;
  source: string; // "2025 Instructions for Schedule A (Form 1040)"
  page: number;
  heading: string;
  text: string;
}

/** Keyword search over official instructions shipped with the app (resources/law/2025/chunks.json).
 *  Built by scripts/build-law-index.ts. Local, offline, deterministic. */
export class LawSearch {
  private constructor(
    private readonly index: MiniSearch<LawChunk>,
    private readonly byId: Map<string, LawChunk>,
  ) {}

  static fromChunks(chunks: LawChunk[]): LawSearch {
    const index = new MiniSearch<LawChunk>({
      fields: ['heading', 'text'],
      storeFields: ['id'],
      searchOptions: { boost: { heading: 2 }, prefix: true, fuzzy: 0.15, combineWith: 'AND' },
    });
    index.addAll(chunks);
    return new LawSearch(index, new Map(chunks.map((c) => [c.id, c])));
  }

  static async load(file: string): Promise<LawSearch> {
    return LawSearch.fromChunks(JSON.parse(await readFile(file, 'utf8')) as LawChunk[]);
  }

  /** Top passages, trimmed to ~1,200 characters each so tool results stay small. */
  search(query: string, limit = 5): (Omit<LawChunk, 'id'> & { citation: string })[] {
    let hits = this.index.search(query);
    if (hits.length === 0) hits = this.index.search(query, { combineWith: 'OR' });
    return hits.slice(0, limit).map((h) => {
      const c = this.byId.get(h.id as string)!;
      return { source: c.source, page: c.page, heading: c.heading, text: c.text.slice(0, 1_200), citation: `${c.source}, p. ${c.page}` };
    });
  }
}
