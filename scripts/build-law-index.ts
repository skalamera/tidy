/* Downloads the official instructions in LAW_SOURCES (cached in resources/law/2025/sources/) and writes
 * resources/law/2025/chunks.json for LawSearch. Run: npm run law:index */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chunkPages } from '../src/main/law/chunk';
import type { LawChunk } from '../src/main/law/search';
import { LAW_SOURCES } from '../src/main/law/sources';
import { pdfTools } from '../src/main/pdf/pdfTools';

const DIR = path.join('resources', 'law', '2025');
const CACHE = path.join(DIR, 'sources');

async function sourceBytes(id: string, url: string): Promise<Buffer> {
  const file = path.join(CACHE, `${id}.pdf`);
  try {
    return await readFile(file);
  } catch {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    await writeFile(file, bytes);
    return bytes;
  }
}

async function main(): Promise<void> {
  await mkdir(CACHE, { recursive: true });
  const chunks: LawChunk[] = [];
  for (const s of LAW_SOURCES) {
    const pages = (await pdfTools.pageTexts(await sourceBytes(s.id, s.url))) ?? [];
    const mine = chunkPages(s.id, s.title, pages);
    chunks.push(...mine);
    console.log(`${s.id}: ${pages.length} pages, ${mine.length} passages`);
  }
  await writeFile(path.join(DIR, 'chunks.json'), JSON.stringify(chunks));
  console.log(`wrote ${chunks.length} passages to ${path.join(DIR, 'chunks.json')}`);
}

void main();
