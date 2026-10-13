import type { LawChunk } from './search';

/** Split one document's page texts into passages of at most `maxChars`, breaking at sentence ends.
 *  Pure and deterministic, so the shipped index only changes when the source PDFs change. */
export function chunkPages(sourceId: string, source: string, pages: string[], maxChars = 1_200): LawChunk[] {
  const out: LawChunk[] = [];
  pages.forEach((raw, i) => {
    const page = i + 1;
    const text = raw.replace(/\s+/g, ' ').trim();
    const sentences = text.match(/[^.!?]+(?:[.!?]+|$)\s*/g) ?? [];
    let buf = '';
    let n = 0;
    const flush = () => {
      const t = buf.trim();
      buf = '';
      if (t.length < 40) return;
      const heading = t.length <= 80 ? t : t.slice(0, 80).replace(/\s+\S*$/, '');
      out.push({ id: `${sourceId}:${page}:${++n}`, source, page, heading, text: t });
    };
    for (const s of sentences) {
      if (buf && buf.length + s.length > maxChars) flush();
      buf += s.slice(0, maxChars);
    }
    flush();
  });
  return out;
}
