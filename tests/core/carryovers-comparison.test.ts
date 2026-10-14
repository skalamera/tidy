import { describe, expect, it } from 'vitest';
import { buildAnswerKey, formatComparisonReport, runComparisonHarness } from '../../src/core/comparison';
import { deriveFacts } from '../../src/core/deriveFacts';
import { deriveFlags } from '../../src/core/flags';
import { parseAccountTranscript, parseReturnTranscript } from '../../src/core/transcript';
import { computeFederal } from '../../src/engine/federal/form1040';
import { computeMd } from '../../src/engine/md/form502';
import { usd } from '../../src/engine/money';
import { emptyState } from '../../src/shared/state';
import { facts as baseFacts, w2 as makeW2 } from '../fixtures/facts';

const amt = (dollars: number) => ({
  amount: dollars.toFixed(2),
  page: 1,
  quote: `$${dollars.toFixed(2)}`,
});

describe('Milestone A6: Carryovers, IRS transcript reader, and comparison harness', () => {
  it('derives every prior-year carryover (capital loss, passive loss by activity, rental depreciation history, QBI/REIT loss, MD 500DM decoupling, charitable carryover) and flags AMT/FTC/4952 carryovers', () => {
    const state = emptyState('2026-10-14T12:00:00Z');
    state.documents.push({
      id: 'doc-prior-2024',
      fileName: '2024-return.pdf',
      sha256: '0000000000000000000000000000000000000000000000000000000000000001',
      mimeType: 'application/pdf',
      hasTextLayer: true,
      addedAt: '2026-10-14T12:00:00Z',
      pageCount: 25,
      status: 'done',
      error: null,
      supersededBy: null,
      docType: 'prior_year_federal_return',
      classification: {
        docType: 'prior_year_federal_return',
        taxYear: 2024,
        issuerName: 'IRS / Maryland',
        recipientName: 'Alex Rivera',
        isCorrected: false,
        confidence: 'high',
        parts: [{ form: 'f1040_return', firstPage: 1, lastPage: 25 }],
      },
      extractions: [
        {
          form: 'prior_year',
          firstPage: 1,
          data: {
            taxYear: 2024,
            filingStatus: 'mfj',
            taxpayer: { firstName: 'Alex', lastName: 'Rivera', ssn: '400-00-1001' },
            spouse: { firstName: 'Blair', lastName: 'Rivera', ssn: '400-00-1002' },
            address: { street: '100 Harbor View Dr', apt: null, city: 'Annapolis', state: 'MD', zip: '21401' },
            dependents: [],
            residentState: 'MD',
            mdCounty: 'Anne Arundel',
            mdSubdivisionCode: '0201',
            agi: amt(240_000),
            totalTax: amt(32_000),
            appliedToNextYear: amt(1_500),
            stateTotalTax: amt(14_000),
            stateBalanceDue: amt(0),
            stateAppliedToNextYear: amt(500),
            payers: [{ name: 'Harbor Tech Ventures LP', form: 'k1' }],
            rentals: [
              {
                address: '250 Severn Ave, Annapolis, MD 21403',
                propertyType: 1,
                fairRentalDays: 365,
                personalUseDays: 0,
                activeParticipation: true,
                depreciableAssets: [
                  {
                    description: 'Residential Rental Building',
                    placedInService: '06/2021',
                    basis: amt(275_000),
                    recoveryPeriodYears: 27.5,
                  },
                ],
              },
            ],
            passiveActivityCarryovers: [
              { activityName: '250 Severn Ave, Annapolis, MD 21403', unallowedLoss: amt(4_200) },
              { activityName: 'Harbor Tech Ventures LP', unallowedLoss: amt(3_100) },
            ],
            mdDecoupling: {
              federalDepreciation: amt(12_000),
              mdDepreciationWithoutDecoupling: amt(15_500),
              pteDecouplingModification: amt(0),
            },
            carryovers: {
              capitalLossShortTerm: amt(2_500),
              capitalLossLongTerm: amt(8_000),
              qbiLoss: amt(4_000),
              reitPtpLoss: amt(1_200),
              charitable: amt(3_500),
              passiveLoss: amt(7_300),
              amtCredit: amt(900),
              foreignTaxCredit: amt(450),
              investmentInterest: amt(600),
            },
          },
        },
      ],
      fieldChecks: {},
    });

    // Also add the 2025 K-1 for Harbor Tech Ventures LP so passive carryover matches by entity name
    state.documents.push({
      id: 'doc-k1-2025',
      fileName: 'harbor-k1.pdf',
      sha256: '0000000000000000000000000000000000000000000000000000000000000002',
      mimeType: 'application/pdf',
      hasTextLayer: true,
      addedAt: '2026-10-14T12:01:00Z',
      pageCount: 1,
      status: 'done',
      error: null,
      supersededBy: null,
      docType: 'k1_1065',
      classification: {
        docType: 'k1_1065',
        taxYear: 2025,
        issuerName: 'Harbor Tech Ventures LP',
        recipientName: 'Alex Rivera',
        isCorrected: false,
        confidence: 'high',
        parts: [{ form: 'k1', firstPage: 1, lastPage: 1 }],
      },
      extractions: [
        {
          form: 'k1',
          firstPage: 1,
          data: {
            entityType: '1065',
            entityName: 'Harbor Tech Ventures LP',
            entityEin: '52-9999999',
            recipientName: 'Alex Rivera',
            recipientSsnLast4: '1001',
            ordinaryBusinessIncome: amt(5_000),
            netRentalRealEstateIncome: amt(0),
            otherNetRentalIncome: amt(0),
            guaranteedPayments: amt(0),
            interestIncome: amt(0),
            ordinaryDividends: amt(0),
            qualifiedDividends: amt(0),
            royalties: amt(0),
            netShortTermCapitalGain: amt(0),
            netLongTermCapitalGain: amt(0),
            collectibles28Gain: amt(0),
            unrecaptured1250Gain: amt(0),
            netSection1231Gain: amt(0),
            section179Deduction: amt(0),
            selfEmploymentEarnings: amt(0),
            distributions: amt(0),
            nondeductibleExpenses: amt(0),
            qbiAmount: amt(5_000),
            qbiW2Wages: amt(0),
            qbiUbia: amt(0),
          },
        },
      ],
      fieldChecks: {},
    });

    const f = deriveFacts(state);
    expect(f.carryovers?.capitalLossShortTerm).toBe(usd(2_500));
    expect(f.carryovers?.capitalLossLongTerm).toBe(usd(8_000));
    expect(f.carryovers?.qbiLoss).toBe(usd(4_000));
    expect(f.carryovers?.reitPtpLoss).toBe(usd(1_200));
    expect(f.carryovers?.charitable).toBe(usd(3_500));
    expect(f.itemized.charityCarryover).toBe(usd(3_500));
    expect(f.rentals?.[0]?.priorUnallowedPassiveLoss).toBe(usd(4_200));
    expect(f.rentals?.[0]?.depreciableAssets?.[0]?.basis).toBe(usd(275_000));
    expect(f.k1s?.[0]?.priorUnallowedPassiveLoss).toBe(usd(3_100));
    expect(f.mdDecoupling?.federalDepreciation).toBe(usd(12_000));
    expect(f.mdDecoupling?.mdDepreciationWithoutDecoupling).toBe(usd(15_500));

    // Verify engine uses the rental depreciation history ($275,000 * 3.636% = $9,999), passive loss carryovers, QBI loss carryforward, and MD 500DM subtraction ($3,500)
    const fed = computeFederal(f);
    expect(fed.ledger.get('schE.18.A')).toBe(usd(9_999));
    expect(fed.ledger.get('f8995.3')).toBe(usd(4_000));
    const md = computeMd(f, fed);
    expect(md.ledger.get('md502su.bb')).toBe(usd(3_500));

    // Verify flags for AMT credit, Foreign Tax Credit, and Form 4952 carryovers
    const flags = deriveFlags(state, f, fed);
    expect(flags.map((x) => x.id)).toContain('carryover-amt-credit');
    expect(flags.map((x) => x.id)).toContain('carryover-ftc');
    expect(flags.map((x) => x.id)).toContain('carryover-investment-interest');
  });

  it('parses an IRS Return Transcript (preferring PER COMPUTER figures) and an IRS Account Transcript (detecting amendments and IRS adjustments)', () => {
    const returnTranscriptText = `
      Tax Period Requested: December, 2025
      FILING STATUS: Married Filing Joint

      INCOME
      WAGES, SALARIES, TIPS, ETC: $180,000.00
      TAXABLE INTEREST INCOME SCH B: $1,200.00
      ORDINARY DIVIDEND INCOME SCH B: $3,400.00
      QUALIFIED DIVIDENDS: $2,800.00
      CAPITAL GAIN OR LOSS: -$3,000.00
      SCH D NET CAPITAL GAIN OR LOSS PER COMPUTER: -$3,000.00
      TOTAL INCOME: $181,600.00
      TOTAL INCOME PER COMPUTER: $181,600.00
      ADJUSTED GROSS INCOME: $181,600.00
      ADJUSTED GROSS INCOME PER COMPUTER: $181,600.00

      TAX AND CREDITS
      STANDARD DEDUCTION: $31,500.00
      STANDARD DEDUCTION PER COMPUTER: $31,500.00
      QUALIFIED BUSINESS INCOME DEDUCTION: $200.00
      QUALIFIED BUSINESS INCOME DEDUCTION COMPUTER: $240.00
      TOTAL DEDUCTIONS PER COMPUTER: $31,740.00
      TAXABLE INCOME: $149,900.00
      TAXABLE INCOME PER COMPUTER: $149,860.00
      TOTAL TAX LIABILITY TP FIGURES: $22,950.00
      TOTAL TAX LIABILITY TP FIGURES PER COMPUTER: $22,941.00
      FEDERAL INCOME TAX WITHHELD: $25,000.00
      TOTAL PAYMENTS PER COMPUTER: $25,000.00
    `;

    const rt = parseReturnTranscript(returnTranscriptText);
    expect(rt.taxYear).toBe(2025);
    expect(rt.filingStatus).toBe('mfj');
    expect(rt.lines['f1040.1z']).toBe(usd(180_000));
    expect(rt.lines['f1040.7a']).toBe(-usd(3_000));
    // PER COMPUTER figure ($240 and $149,860 and $22,941) overwrites taxpayer-reported figure ($200 and $149,900 and $22,950)
    expect(rt.lines['f1040.13a']).toBe(usd(240));
    expect(rt.lines['f1040.15']).toBe(usd(149_860));
    expect(rt.lines['f1040.24']).toBe(usd(22_941));

    const accountTranscriptText = `
      Tax Period Requested: December, 2022
      ACCOUNT BALANCE: $0.00
      ACCRUED INTEREST: $0.00
      ACCRUED PENALTY: $0.00
      RETURN DUE DATE OR RETURN RECEIVED DATE (WHICHEVER IS LATER): Apr. 15, 2023
      PROCESSING DATE: May 08, 2023
      ADJUSTED GROSS INCOME: $210,000.00
      TAXABLE INCOME: $180,000.00
      TAX PER RETURN: $30,500.00

      TRANSACTIONS
      150  Tax return filed                    20231605  05-08-2023  $30,500.00
      806  W-2 or 1099 withholding                       04-15-2023 -$24,000.00
      660  Estimated tax payment                         01-15-2023  -$6,500.00
      971  Amended return filed                          09-14-2023       $0.00
      977  Amended return                                09-14-2023       $0.00
      291  Reduced or removed prior tax assessed         11-20-2023  -$1,250.00
      846  Refund issued                                 11-20-2023   $1,250.00
    `;

    const at = parseAccountTranscript(accountTranscriptText);
    expect(at.taxYear).toBe(2022);
    expect(at.wasAmended).toBe(true);
    expect(at.wasAdjustedByIrs).toBe(true);
    expect(at.originalTaxPerReturn).toBe(usd(30_500));
    expect(at.netTaxAdjustment).toBe(-usd(1_250));
    expect(at.effectiveTotalTax).toBe(usd(29_250));
    expect(at.totalPayments).toBe(usd(30_500));
  });

  it('compares a full federal + Maryland return and outgoing carryovers against a filed return + transcript answer key within $1 rounding', () => {
    const f = baseFacts({
      filingStatus: 'mfj',
      spouse: { firstName: 'Blair', lastName: 'Rivera', ssn: '400000002', dateOfBirth: '1982-05-05' },
      w2s: [
        makeW2({
          box1Wages: usd(180_000),
          box2FedWithheld: usd(25_000),
          stateLines: [{ state: 'MD', stateWages: usd(180_000), stateTax: usd(11_000) }],
        }),
      ],
      f1099B: [
        {
          id: 'b1',
          owner: 'taxpayer',
          payerName: 'Vanguard',
          box4FedWithheld: 0,
          lots: [
            {
              description: 'Index Fund',
              dateAcquired: '01/10/2023',
              dateSold: '06/15/2025',
              proceeds: usd(10_000),
              costBasis: usd(18_000),
              marketDiscount: 0,
              washSaleDisallowed: 0,
              box: 'D',
            },
          ],
          evidence: {},
        },
      ],
    });

    const fed = computeFederal(f);
    const md = computeMd(f, fed);

    const rt = parseReturnTranscript(`
      Tax Period Requested: December, 2025
      FILING STATUS: Married Filing Joint
      WAGES, SALARIES, TIPS, ETC: $180,000.00
      SCH D NET CAPITAL GAIN OR LOSS PER COMPUTER: -$3,000.00
      ADJUSTED GROSS INCOME PER COMPUTER: $177,000.00
      STANDARD DEDUCTION PER COMPUTER: $31,500.00
      TAXABLE INCOME PER COMPUTER: $145,500.00
      TOTAL TAX LIABILITY TP FIGURES PER COMPUTER: $${(fed.totalTax / 100).toFixed(2)}
      TOTAL PAYMENTS PER COMPUTER: $25,000.00
    `);

    const answerKey = buildAnswerKey({
      filed: {
        mdLines: {
          'md502.1': usd(177_000),
          'md502.16': usd(177_000),
          'md502.34': md.totalTax,
        },
        carryovers: {
          capitalLossShortTerm: 0,
          capitalLossLongTerm: usd(5_000),
        },
      },
      returnTranscript: rt,
    });

    const report = runComparisonHarness(f, answerKey);
    expect(report.passed).toBe(true);
    expect(report.mismatches).toHaveLength(0);
    expect(formatComparisonReport(report)).toContain('PASSED');

    // Now test that an amended Account Transcript overrides f1040.24 and surfaces a mismatch if Tidy doesn't have the amended figure
    const amendedAt = parseAccountTranscript(`
      Tax Period Requested: December, 2025
      TAX PER RETURN: $${(fed.totalTax / 100).toFixed(2)}
      150  Tax return filed                    20261605  04-15-2026  $${(fed.totalTax / 100).toFixed(2)}
      971  Amended return filed                          08-01-2026       $0.00
      290  Additional tax assessed                       09-15-2026     $500.00
    `);
    const amendedKey = buildAnswerKey({
      returnTranscript: rt,
      accountTranscript: amendedAt,
    });
    const diffReport = runComparisonHarness(f, amendedKey);
    expect(diffReport.passed).toBe(false);
    expect(diffReport.mismatches.map((m) => m.key)).toEqual(['f1040.24']);
    expect(diffReport.mismatches[0]?.diff).toBe(-usd(500));
  });
});
