import { describe, expect, it } from 'vitest';
import { chunkPages } from '../../src/main/law/chunk';
import { LawSearch } from '../../src/main/law/search';

const page1 =
  'Line 5a. State and local income taxes. You can deduct state and local income taxes you paid during 2025. ' +
  'Your deduction for state and local taxes is limited to $40,000 ($20,000 if married filing separately). ' +
  'The limit is reduced if your modified adjusted gross income is more than $500,000.';
const page2 = 'Line 8a. Home mortgage interest. Enter mortgage interest reported to you on Form 1098. Points are deductible in some cases.';

describe('law passages', () => {
  it('splits pages into passages at sentence ends and numbers them', () => {
    const chunks = chunkPages('i1040sca', '2025 Instructions for Schedule A', [page1, '   ', page2], 120);
    expect(chunks.map((c) => c.id)).toEqual(['i1040sca:1:1', 'i1040sca:1:2', 'i1040sca:1:3', 'i1040sca:3:1']);
    expect(chunks.every((c) => c.text.length <= 120)).toBe(true);
    expect(chunks[0].heading).toBe('Line 5a. State and local income taxes. You can deduct state and local income');
    expect(chunks[3].page).toBe(3);
  });

  it('finds the right passage and cites it', () => {
    const law = LawSearch.fromChunks(chunkPages('i1040sca', '2025 Instructions for Schedule A', [page1, page2]));
    const [top] = law.search('state and local tax limit');
    expect(top.text).toContain('$40,000');
    expect(top.citation).toBe('2025 Instructions for Schedule A, p. 1');
    expect(law.search('mortgage points')[0].page).toBe(2);
  });
});
