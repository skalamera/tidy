import { describe, expect, it } from 'vitest';
import { deriveFacts, stateCode } from '../../src/core/deriveFacts';
import { buildView } from '../../src/core/view';
import { normalAnswer } from '../../src/shared/answers';
import type { AppState, Extraction } from '../../src/shared/state';
import { amt, answered, doc, stateWith, w2Extraction } from '../fixtures/state';

const IDENTITY = {
  'filing-status': 'mfj',
  'your-name': JSON.stringify({ first: 'Alex', last: 'Rivera' }),
  'your-ssn': '078051120',
  'spouse-name': JSON.stringify({ first: 'Sam', last: 'Rivera' }),
  'spouse-ssn': '219099999',
};

/** No 2024 return: who is who, and where they live, come only from answers. */
function noPriorYear(documents: AppState['documents'], answers: Record<string, string> = IDENTITY): AppState {
  const s = stateWith({ documents });
  s.onboarding.priorYearSkipped = true;
  return answered(s, answers);
}

const int1099 = (recipientName: string): Extraction => ({
  form: 'f1099_int',
  firstPage: 1,
  data: {
    payerName: 'First Bank',
    recipientName,
    box1Interest: amt('120.00'),
    box3UsTreasuryInterest: amt(null),
    box4FedWithheld: amt(null),
    box6ForeignTaxPaid: amt(null),
    box8TaxExemptInterest: amt(null),
    box9PrivateActivityBondInterest: amt(null),
  },
});

describe('whose form it is', () => {
  it('without a 2024 return, uses the names answered for the spouse’s W-2', () => {
    const f = deriveFacts(noPriorYear([doc('d1', [w2Extraction({ employeeName: 'SAM RIVERA', employeeSsnLast4: null })])]));
    expect(f.w2s[0].owner).toBe('spouse');
  });

  it('matches the SSN’s last four digits first', () => {
    const f = deriveFacts(noPriorYear([doc('d1', [w2Extraction({ employeeName: 'A RIVERA', employeeSsnLast4: '9999' })])]));
    expect(f.w2s[0].owner).toBe('spouse');
  });

  it('asks when the form doesn’t clearly say, and uses the answer', () => {
    const s = noPriorYear([doc('d1', [w2Extraction({ employeeName: 'A. RIVERA', employeeSsnLast4: null })])]);
    const q = s.questions.find((x) => x.id === 'owner:w2-d1-0');
    expect(q).toMatchObject({
      sectionId: 'wages',
      kind: 'choice',
      blocking: true,
      prompt: 'Whose W-2 from d1.pdf is this?',
      choices: [
        { value: 'taxpayer', label: 'Alex (you)' },
        { value: 'spouse', label: 'Sam (your spouse)' },
      ],
    });
    expect(deriveFacts(answered(s, { 'owner:w2-d1-0': 'spouse' })).w2s[0].owner).toBe('spouse');
  });

  it('doesn’t ask before both names are known, nor about a joint account, nor on a single return', () => {
    const early = noPriorYear([doc('d1', [w2Extraction({ employeeName: 'A. RIVERA', employeeSsnLast4: null })])], {
      'filing-status': 'mfj',
    });
    expect(early.questions.some((q) => q.id.startsWith('owner:'))).toBe(false);
    const joint = noPriorYear([doc('d1', [int1099('ALEX RIVERA & SAM RIVERA')])]);
    expect(joint.questions.some((q) => q.id.startsWith('owner:'))).toBe(false);
    expect(deriveFacts(joint).f1099Int[0].owner).toBe('taxpayer');
    const single = noPriorYear([doc('d1', [w2Extraction({ employeeName: 'A. RIVERA', employeeSsnLast4: null })])], {
      'filing-status': 'single',
      'your-name': JSON.stringify({ first: 'Alex', last: 'Rivera' }),
    });
    expect(single.questions.some((q) => q.id.startsWith('owner:'))).toBe(false);
  });

  it('blocks the spouse’s income on a separate return', () => {
    const s = noPriorYear([doc('d1', [w2Extraction({ employeeName: 'SAM RIVERA', employeeSsnLast4: null })])], {
      ...IDENTITY,
      'filing-status': 'mfs',
    });
    expect(buildView(s, { aiProvider: null }).flags).toContainEqual(
      expect.objectContaining({ id: 'mfs-spouse-income:w2-d1-0', severity: 'blocker', title: 'The W-2 from Acme Corp is your spouse’s' }),
    );
  });
});

describe('states', () => {
  it('reads a state however the form printed it', () => {
    expect(['MD', 'md', 'Md.', 'Maryland', 'MARYLAND', 'MD 12-3456789', 'MD/123', 'New York', 'ny 555'].map(stateCode)).toEqual([
      'MD',
      'MD',
      'MD',
      'MD',
      'MD',
      'MD',
      'MD',
      'NY',
      'NY',
    ]);
    expect([null, '', 'XX', 'Mars', '12345'].map(stateCode)).toEqual(['', '', '', '', '']);
  });

  it('counts Maryland withholding printed as “Maryland”', () => {
    const w2 = w2Extraction({ stateLines: [{ state: 'Maryland', stateWages: amt('85,000.00'), stateTax: amt('4,100.00') }] });
    expect(deriveFacts(noPriorYear([doc('d1', [w2])])).w2s[0].stateLines[0].state).toBe('MD');
  });

  it('counts a Maryland estimated payment once where you live is answered (no 2024 return)', () => {
    const payment: Extraction = {
      form: 'payment',
      firstPage: 1,
      data: {
        kind: 'state_estimate',
        payee: 'Comptroller of Maryland',
        datePaid: '2025-04-15',
        forTaxYear: 2025,
        amount: amt('1,000.00'),
        state: 'Maryland',
      },
    };
    const s = noPriorYear([doc('p1', [payment])], { ...IDENTITY, 'resident-state': 'MD' });
    const q = s.questions.find((x) => x.id === 'state-estimates')!;
    expect(q.suggestedLines).toEqual({ q1: 100_000 }); // the record fills in the question; the answer counts
    expect(q.help).toContain('Filled in from the payment record you uploaded');
    const f = deriveFacts(answered(s, { 'state-estimates': JSON.stringify(q.suggestedLines) }));
    expect(f.residency.state).toBe('MD');
    expect(f.stateReturn.estimatedPayments).toEqual([100_000]);
    expect(f.itemized.stateIncomeTaxPayments).toEqual([{ label: '2025 state estimated payments made in 2025', amount: 100_000 }]);
  });
});

describe('answers at the trust boundary', () => {
  const choice = { kind: 'choice' as const, choices: [{ value: 'taxpayer' }, { value: 'spouse' }] };
  it('keeps only answers with the question’s shape', () => {
    expect(normalAnswer(choice, 'spouse')).toBe('spouse');
    expect(normalAnswer(choice, 'bob')).toBeNull();
    expect(normalAnswer({ kind: 'yes_no', choices: null }, 'maybe')).toBeNull();
    expect(normalAnswer({ kind: 'yes_no', choices: null }, 'no')).toBe('no');
    expect(normalAnswer({ kind: 'money', choices: null }, '1250050')).toBe('1250050');
    expect(normalAnswer({ kind: 'money', choices: null }, '-500')).toBe('-500');
    expect(normalAnswer({ kind: 'money', choices: null }, '12.5')).toBeNull();
    expect(normalAnswer({ kind: 'money', choices: null }, 'NaN')).toBeNull();
    expect(normalAnswer({ kind: 'money', choices: null }, '0860000')).toBe('860000');
    expect(normalAnswer({ kind: 'confirm_amount', choices: null }, 'yes')).toBe('yes');
    expect(normalAnswer({ kind: 'confirm_amount', choices: null }, 'abc')).toBeNull();
    expect(normalAnswer({ kind: 'text', choices: null }, '  ')).toBeNull();
    expect(normalAnswer({ kind: 'text', choices: null }, 'x'.repeat(501))).toBeNull();
  });
});
