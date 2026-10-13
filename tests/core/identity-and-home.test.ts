import { describe, expect, it } from 'vitest';
import { computeFederal } from '../../src/engine/federal/form1040';
import { deriveFacts } from '../../src/core/deriveFacts';
import { sectionStates } from '../../src/core/sections';
import type { AppState, Question } from '../../src/shared/state';
import { answered, doc, NOW, priorYear, stateWith, w2Extraction } from '../fixtures/state';

const ids = (s: AppState) => s.questions.map((q) => q.id);
const prompt = (s: AppState, id: string) => s.questions.find((q) => q.id === id)?.prompt;
const IDENTITY = ['your-name', 'your-ssn', 'spouse-name', 'spouse-ssn', 'home-address'];
const identityAsked = (s: AppState) => ids(s).filter((id) => IDENTITY.includes(id));

function noPriorYear(): AppState {
  const s = stateWith({ documents: [doc('d1', [w2Extraction()])] });
  s.onboarding.priorYearSkipped = true;
  return s;
}

describe('who you are', () => {
  it('without a 2024 return, asks for both names, both SSNs and the address, and each one holds the step', () => {
    const s = answered(noPriorYear(), { 'filing-status': 'mfj' });
    const asked = s.questions.filter((q) => IDENTITY.includes(q.id));
    expect(asked.map((q) => [q.id, q.kind, q.blocking])).toEqual([
      ['your-name', 'name', true],
      ['your-ssn', 'ssn', true],
      ['spouse-name', 'name', true],
      ['spouse-ssn', 'ssn', true],
      ['home-address', 'address', true],
    ]);
    expect(identityAsked(answered(noPriorYear(), { 'filing-status': 'single' }))).toEqual(['your-name', 'your-ssn', 'home-address']);
  });

  it('puts the answers on the return', () => {
    const s = answered(noPriorYear(), {
      'filing-status': 'mfj',
      'your-name': JSON.stringify({ first: 'Pat', last: 'Example' }),
      'your-ssn': '078051120',
      'spouse-name': JSON.stringify({ first: 'Sam', last: 'Example' }),
      'spouse-ssn': '219099999',
      'home-address': JSON.stringify({ street: '1 Example Lane', apt: null, city: 'Rockville', state: 'MD', zip: '20850' }),
    });
    const f = deriveFacts(s);
    expect(f.taxpayer).toMatchObject({ firstName: 'Pat', lastName: 'Example', ssn: '078051120' });
    expect(f.spouse).toMatchObject({ firstName: 'Sam', lastName: 'Example', ssn: '219099999' });
    expect(f.address).toEqual({ street: '1 Example Lane', apt: null, city: 'Rockville', state: 'MD', zip: '20850' });
  });

  it('asks only for what the 2024 return is missing', () => {
    expect(identityAsked(answered(stateWith({ documents: [doc('py', [priorYear()])] }), {}))).toEqual([]);
    const noSsn = priorYear({ taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: null } });
    expect(identityAsked(answered(stateWith({ documents: [doc('py', [noSsn])] }), {}))).toEqual(['your-ssn']);
  });

  it('does not count an approval while a blocking question in that step is still open', () => {
    const s = stateWith({ documents: [doc('py', [priorYear()])] });
    const f = deriveFacts(s);
    const hash = sectionStates(s, f, computeFederal(f)).find((x) => x.id === 'profile')!.hash;
    const open: Question = {
      id: 'your-ssn',
      sectionId: 'profile',
      kind: 'ssn',
      prompt: 'What’s your Social Security number?',
      help: null,
      choices: null,
      suggested: null,
      blocking: true,
      origin: 'rule',
      answer: null,
      answeredAt: null,
    };
    const later: AppState = { ...s, approvals: { profile: { approvedAt: NOW, snapshotHash: hash } }, questions: [open] };
    expect(sectionStates(later, f, computeFederal(f)).find((x) => x.id === 'profile')!.status).toBe('needs_answers');
  });
});

describe('where you lived, from the 2024 return', () => {
  const withHome = (mdSubdivisionCode: string | null) => stateWith({ documents: [doc('py', [priorYear({ mdSubdivisionCode })])] });

  it('confirms last year’s Maryland home with one yes', () => {
    const s = answered(withHome('1609'), { 'filing-status-same': 'yes' });
    expect(prompt(s, 'residence-same')).toBe(
      'Last year you lived in City of Rockville, Montgomery County. Did you still live there on December 31, 2025?',
    );
    expect(ids(s)).not.toContain('resident-state');
    expect(ids(s)).not.toContain('md-subdivision');
    const yes = answered(s, { 'residence-same': 'yes' });
    expect(ids(yes)).not.toContain('md-subdivision');
    expect(deriveFacts(yes).residency).toMatchObject({
      state: 'MD',
      mdCounty: 'Montgomery',
      mdSubdivision: { code: '1609', name: 'City of Rockville' },
    });
  });

  it('names a county home that is not in a town', () => {
    expect(prompt(answered(withHome('0300'), {}), 'residence-same')).toBe(
      'Last year you lived in Baltimore County. Did you still live there on December 31, 2025?',
    );
  });

  it('asks where you lived when you moved', () => {
    const s = answered(withHome('1609'), { 'residence-same': 'no', 'resident-state': 'MD' });
    expect(ids(s)).toEqual(expect.arrayContaining(['resident-state', 'md-subdivision']));
  });

  it('asks the usual questions when last year’s code is missing or isn’t a Maryland subdivision', () => {
    for (const code of [null, '9999']) {
      const s = answered(withHome(code), {});
      expect(ids(s)).not.toContain('residence-same');
      expect(ids(s)).toEqual(expect.arrayContaining(['resident-state', 'md-subdivision']));
    }
  });
});
