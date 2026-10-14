import { describe, expect, it } from 'vitest';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeMd } from '../../src/engine/md/form502';
import { deriveFacts } from '../../src/core/deriveFacts';
import { deriveFlags } from '../../src/core/flags';
import { buildView } from '../../src/core/view';
import { amt, answered, doc, priorYear, r1099Extraction, ssa1099Extraction, stateWith } from '../fixtures/state';

describe('A1 core workflow: seniors, 1099-R, SSA-1099, questions, flags, and view', () => {
  it('follows up on senior-or-blind = yes with per-person 65+ and blind questions instead of blocking', () => {
    const base = stateWith({
      documents: [doc('py', [priorYear()])],
    });
    const s = answered(base, {
      'filing-status-same': 'yes',
      'resident-state': 'MD',
      'full-year-resident': 'yes',
      'md-subdivision': '1609',
      'digital-assets': 'no',
      'has-dependents': 'no',
      'other-income': 'no',
      'senior-or-blind': 'yes',
      'you-65': 'yes',
      'you-blind': 'no',
      'spouse-65': 'yes',
      'spouse-blind': 'yes',
    });
    const f = deriveFacts(s);
    const fed = computeFederal(f);
    const flags = deriveFlags(s, f, fed);

    // No senior-or-blind blocker!
    expect(flags.filter((x) => x.severity === 'blocker')).toEqual([]);
    expect(fed.line12d).toEqual({ you65: true, youBlind: false, spouse65: true, spouseBlind: true });
    // Standard deduction: $31,500 + 3 * $1,600 = $36,300; Schedule 1-A: $12,000
    expect(fed.ledger.get('f1040.12e')).toBe(3_630_000);
    expect(fed.ledger.get('f1040.13b')).toBe(1_200_000);
  });

  it('derives 1099-R and SSA-1099 facts, asks retirement follow-up questions, and populates view cards', () => {
    const s0 = stateWith({
      documents: [
        doc('py', [priorYear()]),
        doc('r1', [
          r1099Extraction({
            payerName: 'Vanguard IRA',
            box7IraSepSimple: true,
            box1GrossDistribution: amt('25,000.00'),
            box2aTaxableAmount: amt('25,000.00'),
          }),
        ]),
        doc('r2', [
          r1099Extraction({
            payerName: 'Maryland State Retirement',
            recipientName: 'Sam Rivera',
            recipientSsnLast4: '0002',
            box7IraSepSimple: false,
            box1GrossDistribution: amt('40,000.00'),
            box2aTaxableAmount: amt('40,000.00'),
          }),
        ]),
        doc('ssa1', [ssa1099Extraction({ box5NetBenefits: amt('24,000.00'), box6FedWithheld: amt('2,400.00') })]),
      ],
    });
    const s = answered(s0, {
      'filing-status-same': 'yes',
      'resident-state': 'MD',
      'full-year-resident': 'yes',
      'md-subdivision': '1609',
      'senior-or-blind': 'yes',
      'you-65': 'yes',
      'you-blind': 'no',
      'spouse-65': 'yes',
      'spouse-blind': 'no',
      'ira-nondeductible-basis': 'no',
      'ira-qcd': 'yes',
      'ira-qcd-amount': '500000', // $5,000 QCD
      'retirement-rollover': 'no',
    });

    const f = deriveFacts(s);
    expect(f.f1099R).toHaveLength(2);
    expect(f.ssa1099).toHaveLength(1);
    expect(f.f1099R![0].qcdAmount).toBe(500_000);

    const fed = computeFederal(f);
    expect(fed.ledger.get('f1040.4a')).toBe(2_500_000);
    expect(fed.ledger.get('f1040.4b')).toBe(2_000_000);
    expect(fed.line4c.qcd).toBe(true);
    expect(fed.ledger.get('f1040.5a')).toBe(4_000_000);
    expect(fed.ledger.get('f1040.5b')).toBe(4_000_000);
    expect(fed.ledger.get('f1040.6a')).toBe(2_400_000);

    const md = computeMd(f, fed);
    expect(md.ledger.get('md502.1d')).toBe(6_000_000);
    expect(md.ledger.get('md502.10a')).toBe(4_000_000); // Spouse's $40k pension excluded (under $41,200 max); taxpayer's IRA excluded from 10a!

    const v = buildView(s, { aiProvider: 'gemini' });
    const wageTitles = v.details.wages.map((c) => c.title);
    expect(wageTitles).toEqual(expect.arrayContaining(['Vanguard IRA', 'Maryland State Retirement', 'Social Security (SSA-1099)']));
  });

  it('raises targeted blockers for nondeductible IRA basis (Form 8606), undetermined 1099-R taxable amount, and early distribution code 1', () => {
    // 1. Nondeductible IRA basis -> blocker
    const sBasis = answered(
      stateWith({
        documents: [doc('py', [priorYear()]), doc('r1', [r1099Extraction({ box7IraSepSimple: true })])],
      }),
      { 'ira-nondeductible-basis': 'yes' },
    );
    const fBasis = deriveFacts(sBasis);
    expect(deriveFlags(sBasis, fBasis, computeFederal(fBasis)).map((x) => x.id)).toContain('ira-basis-8606');

    // 2. Box 2b taxable amount not determined (and not a direct rollover) -> blocker
    const sUndet = stateWith({
      documents: [
        doc('r2', [
          r1099Extraction({
            box2aTaxableAmount: amt(null),
            box2bTaxableNotDetermined: true,
            box7Codes: '7',
          }),
        ]),
      ],
    });
    const fUndet = deriveFacts(sUndet);
    expect(deriveFlags(sUndet, fUndet, computeFederal(fUndet)).map((x) => x.id)).toContain('1099r-undetermined:f1099_r-r2-0');

    // 3. Box 7 code 1 (early distribution subject to penalty / Form 5329) -> blocker
    const sEarly = stateWith({
      documents: [doc('r3', [r1099Extraction({ box7Codes: '1' })])],
    });
    const fEarly = deriveFacts(sEarly);
    expect(deriveFlags(sEarly, fEarly, computeFederal(fEarly)).map((x) => x.id)).toContain('1099r-code:f1099_r-r3-0');
  });
});
