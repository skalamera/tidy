import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { open, seal, loadOrCreateDataKey } from '../../src/main/vault';
import { ReturnStore } from '../../src/main/store';
import { checkAllAmounts, checkAmount } from '../../src/main/pipeline/verify';

const NOW = () => '2026-10-13T12:00:00.000Z';

describe('vault', () => {
  it('round-trips and detects tampering', () => {
    const key = randomBytes(32);
    const sealed = seal(key, Buffer.from('SSN 400-00-0001'));
    expect(sealed.includes(Buffer.from('400-00-0001'))).toBe(false);
    expect(open(key, sealed).toString()).toBe('SSN 400-00-0001');
    sealed[sealed.length - 1] ^= 1;
    expect(() => open(key, sealed)).toThrow();
  });

  it('creates the data key once and reuses it', async () => {
    const files = new Map<string, Buffer>();
    const fs = {
      readFile: async (p: string) => {
        const b = files.get(p);
        if (!b) throw Object.assign(new Error('nope'), { code: 'ENOENT' });
        return b;
      },
      writeFile: async (p: string, b: Buffer) => {
        files.set(p, b);
      },
    };
    const safe = {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(`enc:${s}`),
      decryptString: (b: Buffer) => b.toString().slice(4),
    };
    const k1 = await loadOrCreateDataKey('/k', safe, fs);
    const k2 = await loadOrCreateDataKey('/k', safe, fs);
    expect(k1.length).toBe(32);
    expect(k1.equals(k2)).toBe(true);
  });
});

describe('ReturnStore', () => {
  it('persists encrypted state and reloads it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tidy-store-'));
    const key = randomBytes(32);
    const store = await ReturnStore.open(dir, key, NOW);
    let changes = 0;
    store.on('change', () => changes++);
    await store.update((d) => {
      d.onboarding.welcomed = true;
    });
    await store.putDocument('doc1', Buffer.from('%PDF-1.7 fake'));
    expect(changes).toBe(1);
    const raw = await readFile(path.join(dir, 'state.bin'));
    expect(raw.includes(Buffer.from('welcomed'))).toBe(false);
    const again = await ReturnStore.open(dir, key, NOW);
    expect(again.get().onboarding.welcomed).toBe(true);
    expect((await again.getDocument('doc1')).toString()).toBe('%PDF-1.7 fake');
  });

  it('serializes concurrent updates', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tidy-store-'));
    const store = await ReturnStore.open(dir, randomBytes(32), NOW);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.update((d) => {
          d.overrides.push({ id: `o${i}`, path: ['x'], value: i, reason: '', createdAt: NOW(), createdBy: 'user' });
        }),
      ),
    );
    expect(store.get().overrides).toHaveLength(20);
  });
});

describe('checkAmount', () => {
  const page = 'Wages, tips, other comp. 85,000.00  Federal income tax withheld 11000.00  Social security wages $85,000';
  it('verifies an amount printed on the cited page', () => {
    expect(checkAmount({ amount: '85,000.00', page: 1, quote: 'x' }, [page])).toBe('verified');
    expect(checkAmount({ amount: '11,000.00', page: 1, quote: 'x' }, [page])).toBe('verified');
  });
  it('flags numbers that are not on the page', () => {
    expect(checkAmount({ amount: '58,000.00', page: 1, quote: 'x' }, [page])).toBe('mismatch');
  });
  it('cannot verify scans or bad page numbers', () => {
    expect(checkAmount({ amount: '85,000.00', page: 1, quote: 'x' }, null)).toBe('unverified');
    expect(checkAmount({ amount: '85,000.00', page: 3, quote: 'x' }, [page])).toBe('unverified');
    expect(checkAmount({ amount: '85,000.00', page: 2, quote: 'x' }, [page, '  '])).toBe('unverified');
  });
  it('treats blank and zero as verified', () => {
    expect(checkAmount({ amount: null, page: null, quote: null }, [page])).toBe('verified');
    expect(checkAmount({ amount: '0.00', page: 1, quote: null }, [page])).toBe('verified');
  });
  it('walks nested extraction objects', () => {
    const checks = checkAllAmounts(
      {
        employerName: 'Acme',
        box1Wages: { amount: '85,000.00', page: 1, quote: 'q' },
        stateLines: [{ state: 'MD', stateTax: { amount: '4,100.00', page: 1, quote: 'q' } }],
      },
      [page],
    );
    expect(checks).toEqual({ box1Wages: 'verified', 'stateLines.0.stateTax': 'mismatch' });
  });
});
