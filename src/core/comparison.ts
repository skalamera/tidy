import { computeFederal, type FederalResult } from '../engine/federal/form1040';
import type { MdResult } from '../engine/md/form502';
import { formatUsd, usd, type Cents } from '../engine/money';
import { computeStateReturn } from '../engine/state';
import type { TaxFacts } from '../shared/facts';
import type { AccountTranscriptData, ReturnTranscriptData } from './transcript';

export interface OutgoingCarryovers {
  capitalLossShortTerm: Cents;
  capitalLossLongTerm: Cents;
  passiveLossTotal: Cents;
  passiveLossByActivity: Record<string, Cents>;
  qbiLoss: Cents;
  reitPtpLoss: Cents;
}

export interface ReturnAnswerKey {
  /** Expected federal ledger lines (e.g. `f1040.1z`, `f1040.11a`, `f1040.15`, `f1040.24`, `schD.21`, `schE.26`, `f8995.16`). */
  federalLines?: Record<string, Cents>;
  /** Expected Maryland ledger lines (e.g. `md502.1`, `md502.16`, `md502.20`, `md502.34`, `md502.46`). */
  mdLines?: Record<string, Cents>;
  /** Expected outgoing carryovers to the next tax year. */
  carryovers?: Partial<OutgoingCarryovers>;
}

export interface LineComparison {
  scope: 'federal' | 'md' | 'carryover';
  key: string;
  label: string;
  actual: Cents;
  expected: Cents;
  /** Signed difference `actual - expected` in cents. */
  diff: Cents;
  /** True when `Math.abs(actual - expected) <= toleranceCents` (default $1 = 100 cents for whole-dollar rounding). */
  withinTolerance: boolean;
}

export interface ComparisonReport {
  passed: boolean;
  toleranceCents: Cents;
  totalChecked: number;
  matchedCount: number;
  mismatches: LineComparison[];
  all: LineComparison[];
  outgoingCarryovers: OutgoingCarryovers;
}

/** Extract all outgoing carryovers from a computed FederalResult. */
export function extractOutgoingCarryovers(fed: FederalResult): OutgoingCarryovers {
  const passiveLossByActivity: Record<string, Cents> = {};
  for (const act of fed.scheduleE.passiveLossCarryoverByActivity) {
    if (act.unallowedLoss > 0) {
      passiveLossByActivity[act.name] = act.unallowedLoss;
    }
  }
  return {
    capitalLossShortTerm: fed.capitalLossCarryoverTo2026.shortTerm,
    capitalLossLongTerm: fed.capitalLossCarryoverTo2026.longTerm,
    passiveLossTotal: fed.scheduleE.passiveLossCarryoverTo2026,
    passiveLossByActivity,
    qbiLoss: fed.qbiCarryforwardTo2026.qbiLoss,
    reitPtpLoss: fed.qbiCarryforwardTo2026.reitPtpLoss,
  };
}

/**
 * Build a ReturnAnswerKey by combining an optional filed-return answer key with an IRS Return Transcript
 * and an IRS Account Transcript.
 *
 * Per Milestone A6 rules:
 * 1. The IRS Return Transcript (`PER COMPUTER` figures) is a second answer key for every federal line it reports.
 * 2. If the IRS Account Transcript shows the return was amended (codes 971/977) or adjusted by the IRS (codes 290/291/300/301),
 *    the Account Transcript's `effectiveTotalTax` overrides `f1040.24` (`Total tax`) so the answer key reflects the amended/adjusted return.
 * 3. Any explicit `amendedOverrides` supplied alongside an amended Account Transcript take highest precedence.
 */
export function buildAnswerKey(opts: {
  filed?: ReturnAnswerKey;
  returnTranscript?: ReturnTranscriptData;
  accountTranscript?: AccountTranscriptData;
  amendedOverrides?: Partial<ReturnAnswerKey>;
}): ReturnAnswerKey {
  const federalLines: Record<string, Cents> = {
    ...(opts.filed?.federalLines ?? {}),
    ...(opts.returnTranscript?.lines ?? {}),
  };
  const mdLines: Record<string, Cents> = {
    ...(opts.filed?.mdLines ?? {}),
  };
  const carryovers: Partial<OutgoingCarryovers> = {
    ...(opts.filed?.carryovers ?? {}),
  };

  const acct = opts.accountTranscript;
  if (acct && (acct.wasAmended || acct.wasAdjustedByIrs)) {
    if (acct.effectiveTotalTax !== null) {
      federalLines['f1040.24'] = acct.effectiveTotalTax;
    }
    if (opts.amendedOverrides?.federalLines) {
      Object.assign(federalLines, opts.amendedOverrides.federalLines);
    }
    if (opts.amendedOverrides?.mdLines) {
      Object.assign(mdLines, opts.amendedOverrides.mdLines);
    }
    if (opts.amendedOverrides?.carryovers) {
      Object.assign(carryovers, opts.amendedOverrides.carryovers);
    }
  }

  return { federalLines, mdLines, carryovers };
}

/**
 * Compare Tidy's computed federal and Maryland returns (and outgoing carryovers) against an answer key.
 * Default tolerance is $1 (`usd(1)` = 100 cents) per the readiness gate specification.
 */
export function compareReturnToAnswerKey(
  fed: FederalResult,
  md: MdResult | null,
  answerKey: ReturnAnswerKey,
  toleranceCents: Cents = usd(1),
): ComparisonReport {
  const all: LineComparison[] = [];
  const outgoingCarryovers = extractOutgoingCarryovers(fed);

  for (const [key, expected] of Object.entries(answerKey.federalLines ?? {})) {
    const actual = fed.ledger.get(key);
    const label = fed.ledger.line(key)?.label ?? key;
    const diff = actual - expected;
    all.push({
      scope: 'federal',
      key,
      label,
      actual,
      expected,
      diff,
      withinTolerance: Math.abs(diff) <= toleranceCents,
    });
  }

  if (md && answerKey.mdLines) {
    for (const [key, expected] of Object.entries(answerKey.mdLines)) {
      const actual = md.ledger.get(key);
      const label = md.ledger.line(key)?.label ?? key;
      const diff = actual - expected;
      all.push({
        scope: 'md',
        key,
        label,
        actual,
        expected,
        diff,
        withinTolerance: Math.abs(diff) <= toleranceCents,
      });
    }
  }

  const co = answerKey.carryovers;
  if (co) {
    const scalarCarryovers: [keyof Omit<OutgoingCarryovers, 'passiveLossByActivity'>, string][] = [
      ['capitalLossShortTerm', 'Short-term capital loss carryover to next year'],
      ['capitalLossLongTerm', 'Long-term capital loss carryover to next year'],
      ['passiveLossTotal', 'Total unallowed passive loss carryover to next year (Form 8582)'],
      ['qbiLoss', 'Qualified business net loss carryforward to next year (Form 8995)'],
      ['reitPtpLoss', 'Qualified REIT/PTP loss carryforward to next year (Form 8995)'],
    ];
    for (const [field, label] of scalarCarryovers) {
      const expected = co[field];
      if (expected === undefined) continue;
      const actual = outgoingCarryovers[field];
      const diff = actual - expected;
      all.push({
        scope: 'carryover',
        key: `carryover.${field}`,
        label,
        actual,
        expected,
        diff,
        withinTolerance: Math.abs(diff) <= toleranceCents,
      });
    }
    if (co.passiveLossByActivity) {
      for (const [actName, expected] of Object.entries(co.passiveLossByActivity)) {
        const actual = outgoingCarryovers.passiveLossByActivity[actName] ?? 0;
        const diff = actual - expected;
        all.push({
          scope: 'carryover',
          key: `carryover.passive.${actName}`,
          label: `Passive loss carryover (${actName})`,
          actual,
          expected,
          diff,
          withinTolerance: Math.abs(diff) <= toleranceCents,
        });
      }
    }
  }

  const mismatches = all.filter((c) => !c.withinTolerance);
  return {
    passed: mismatches.length === 0,
    toleranceCents,
    totalChecked: all.length,
    matchedCount: all.length - mismatches.length,
    mismatches,
    all,
    outgoingCarryovers,
  };
}

/** Run `facts` through `computeFederal` and `computeStateReturn` and compare against `answerKey`. */
export function runComparisonHarness(facts: TaxFacts, answerKey: ReturnAnswerKey, toleranceCents: Cents = usd(1)): ComparisonReport {
  const fed = computeFederal(facts);
  const state = computeStateReturn(facts, fed);
  return compareReturnToAnswerKey(fed, state?.state === 'MD' ? state.md : null, answerKey, toleranceCents);
}

/** Format a human-readable summary of a ComparisonReport for test failures or CLI inspection. */
export function formatComparisonReport(report: ComparisonReport): string {
  const header = `Comparison: ${report.matchedCount}/${report.totalChecked} within ${formatUsd(report.toleranceCents)} (${report.passed ? 'PASSED' : `${report.mismatches.length} MISMATCHES`})`;
  if (report.mismatches.length === 0) return header;
  const rows = report.mismatches.map(
    (m) =>
      `  [${m.scope}] ${m.key} (${m.label}): actual ${formatUsd(m.actual)} vs expected ${formatUsd(m.expected)} (diff ${m.diff >= 0 ? '+' : ''}${formatUsd(m.diff)})`,
  );
  return [header, ...rows].join('\n');
}
