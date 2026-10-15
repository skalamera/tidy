import { formatUsd } from '../engine/money';
import type { FederalResult } from '../engine/federal/form1040';
import type { TaxFacts } from '../shared/facts';
import type { AppState, Flag } from '../shared/state';
import { formSignature, latestPriorYear, PRIOR_TAX_YEAR, wrongYear } from './deriveFacts';
import { amountCents } from './amount';
import { isIraDistribution } from '../engine/federal/retirement';
import { foreignTaxNo1116Limit, foreignTaxPaid, simpleForeignTaxCreditAllowed } from '../engine/federal/schedule3';
import { FED_2025 } from '../engine/params/fed2025';
import { FED_2026 } from '../engine/params/fed2026';
import { vinProblem } from './vin';
import { readPlacedInService } from '../engine/federal/scheduleE';
import { isMdOnlyW2 } from '../engine/md/form502';
import { stateName } from './states';
import type { OverrideView } from './view';
import { oversizedChecks } from './reconcile';

const LABEL: Record<string, string> = {
  brokerage_statement: 'brokerage statements',
  other: 'this kind of document',
};
const PART_LABEL: Record<string, string> = {
  other: 'a form Tidy doesn’t read yet',
};
const FORM_NAME: Record<string, string> = {
  w2: 'W-2',
  f1099_int: '1099-INT',
  f1099_div: '1099-DIV',
  f1099_composite: 'brokerage 1099',
  f1099_b: '1099-B',
  f1099_r: '1099-R',
  f1099_misc: '1099-MISC',
  f1099_nec: '1099-NEC',
  ssa_1099: 'SSA-1099',
  f1099_g: '1099-G',
  f1098: 'Form 1098',
  k1: 'K-1',
  f1099_oid: '1099-OID',
};

/** Problems the user must know about. Blockers stop the final package until they are resolved. Pure. */
export function deriveFlags(state: AppState, f: TaxFacts, r: FederalResult, overrides: readonly OverrideView[] = []): Flag[] {
  const flags: Flag[] = [];
  if (f.filingStatus === 'mfs') {
    const spouses = [
      ...f.w2s.map((x) => ({ x, form: 'W-2', from: x.employerName })),
      ...f.f1099Int.map((x) => ({ x, form: '1099-INT', from: x.payerName })),
      ...f.f1099Div.map((x) => ({ x, form: '1099-DIV', from: x.payerName })),
      ...(f.f1099B ?? []).map((x) => ({ x, form: '1099-B', from: x.payerName })),
      ...(f.f1099R ?? []).map((x) => ({ x, form: '1099-R', from: x.payerName })),
      ...(f.f1099Nec ?? []).map((x) => ({ x, form: '1099-NEC', from: x.payerName })),
      ...(f.ssa1099 ?? []).map((x) => ({ x, form: 'SSA-1099', from: 'Social Security' })),
      ...(f.k1s ?? []).map((x) => ({ x, form: 'K-1', from: x.entityName })),
    ].filter((s) => s.x.owner === 'spouse');
    for (const s of spouses)
      flags.push({
        id: `mfs-spouse-income:${s.x.id}`,
        sectionId: 'documents',
        severity: 'blocker',
        title: `The ${s.form} from ${s.from} is your spouse’s`,
        detail: 'On a married filing separately return, only your own income goes on your return. Remove this document, or file jointly.',
      });
  }
  for (const o of overrides) {
    if (o.applied) continue;
    flags.push({
      id: `override-set-aside:${o.id}`,
      sectionId: o.sectionId,
      severity: 'blocker',
      title: 'A change you accepted no longer fits your return',
      detail: `Tidy set aside “${o.change.label}: ${o.change.after}” because what it changed isn’t on your return anymore, for example because the document was removed or replaced. Check the amount on this step, then press Undo on the change to clear this.`,
    });
  }
  const answer = (id: string) => state.questions.find((q) => q.id === id)?.answer ?? null;
  const biz = (f.scheduleC ?? []).find((b) => !b.closedInPriorYear);
  const necOwners = new Set((f.f1099Nec ?? []).map((n) => n.owner));
  if (necOwners.size > 1 || (biz && [...necOwners].some((o) => o !== biz.owner))) {
    flags.push({
      id: 'business-two-owners',
      sectionId: 'wages',
      severity: 'blocker',
      title: 'Both of you have self-employment income',
      detail:
        'Your 1099-NECs (or your business) belong to both of you. Tidy can prepare one person’s Schedule C so far, so the other person’s income would be left off.',
    });
  }
  const seOwners = new Set([
    ...(biz || necOwners.size ? [biz?.owner ?? [...necOwners][0]] : []),
    ...(f.k1s ?? []).filter((k) => (k.selfEmploymentEarnings ?? 0) !== 0).map((k) => k.owner),
  ]);
  if (seOwners.size > 1) {
    flags.push({
      id: 'se-two-people',
      sectionId: 'wages',
      severity: 'blocker',
      title: 'Both of you have self-employment earnings',
      detail: 'Each of you needs a Schedule SE. Tidy can prepare one so far.',
    });
  }
  if (answer('business-assets') === 'yes') {
    flags.push({
      id: 'business-assets',
      sectionId: 'wages',
      severity: 'blocker',
      title: 'Tidy can’t enter business equipment or property yet',
      detail:
        'Depreciating business property (Form 4562) or selling it (Form 4797) isn’t something you can enter in Tidy yet. A CPA should prepare the business part of your return.',
    });
  }
  if ((biz?.expenses.carAndTruck ?? 0) > 0) {
    flags.push({
      id: 'business-car',
      sectionId: 'wages',
      severity: 'blocker',
      title: 'Car and truck expenses need vehicle details Tidy can’t fill in yet',
      detail:
        'Schedule C Part IV asks about the vehicle and its miles. Remove the car expenses, or have a CPA prepare the business part of your return.',
    });
  }
  if (answer('rentals-other') === 'yes') {
    const prior = latestPriorYear(state) !== null;
    flags.push({
      id: 'rental-unknown',
      sectionId: 'wages',
      severity: 'blocker',
      title: prior ? 'Tidy can’t add a rental that wasn’t on your 2024 return yet' : 'Add your 2024 return to report a rental',
      detail: prior
        ? 'A property you started renting in 2025 needs its cost and depreciation set up, which Tidy doesn’t do yet. A CPA should prepare the rental part of your return.'
        : 'Tidy carries a rental’s depreciation and unused losses forward from last year’s return. Upload your 2024 return. If the property is new in 2025, Tidy can’t add it yet.',
    });
  }
  for (const p of f.rentals ?? []) {
    const name = p.address.trim() || 'your rental';
    const status = answer(`rental-status:${p.id}`);
    if (status === 'sold' || status === 'stopped') {
      flags.push({
        id: `rental-${status}:${p.id}`,
        sectionId: 'wages',
        severity: 'blocker',
        title: status === 'sold' ? `Tidy can’t report selling ${name} yet` : `Tidy can’t report ${name} once it stopped being a rental yet`,
        detail:
          status === 'sold'
            ? 'Selling a rental needs Form 4797 with depreciation recapture and the release of its unused losses, which Tidy doesn’t figure yet. A CPA should prepare this return.'
            : 'Converting a rental to personal use changes its depreciation and unused losses, which Tidy doesn’t figure yet. A CPA should prepare this return.',
      });
      continue;
    }
    if (status !== 'rented' || p.propertyType === 6) continue;
    const [days, personal] = [p.fairRentalDays, p.personalUseDays];
    if (days + personal > 366) {
      flags.push({
        id: `rental-days:${p.id}`,
        sectionId: 'wages',
        severity: 'blocker',
        title: `The days for ${name} add up to more than a year`,
        detail: 'Check the days it was rented and the days you or your family used it.',
      });
    } else if (days < 15 || personal > Math.max(14, Math.floor(days / 10))) {
      flags.push({
        id: `rental-vacation:${p.id}`,
        sectionId: 'wages',
        severity: 'blocker',
        title: `${name} counts as a vacation home this year`,
        detail:
          'Renting it fewer than 15 days, or using it yourself for more than 14 days (or 10% of the days rented), limits what you can deduct. Tidy doesn’t figure those limits yet.',
      });
    }
  }
  const signatures = new Map<string, string>(); // form signature -> first file with it
  for (const d of state.documents) {
    const year = wrongYear(d);
    if (d.status === 'done' && !d.supersededBy && year !== null) {
      flags.push({
        id: `wrong-year-form:${d.id}`,
        sectionId: 'documents',
        severity: 'blocker',
        title: `“${d.fileName}” is a ${year} ${FORM_NAME[d.docType ?? ''] ?? 'form'}`,
        detail: 'Tidy prepares your 2025 return, so it doesn’t use this one. Upload the 2025 form, then remove this file.',
      });
    }
    if (d.status === 'done' && !d.supersededBy && year === null) {
      const inFile = new Set<string>();
      d.extractions.forEach((x, i) => {
        const sig = formSignature(x);
        if (sig !== null && inFile.has(sig)) return; // a copy inside the same file (counted once)
        if (sig !== null) {
          inFile.add(sig);
          const first = signatures.get(sig);
          if (first === undefined) signatures.set(sig, d.fileName);
          else
            flags.push({
              id: `duplicate:${d.id}:${i}`,
              sectionId: 'documents',
              severity: 'blocker',
              title: `“${d.fileName}” looks like the same ${FORM_NAME[x.form] ?? 'form'} as “${first}”`,
              detail: 'Same issuer, same person, same amounts. Remove one of them, or Tidy would count it twice.',
            });
        }
        if (x.form === 'f1099_misc') {
          const m = x.data;
          const total = [
            m.box1Rents,
            m.box2Royalties,
            m.box3OtherIncome,
            m.box4FedWithheld,
            m.box8SubstitutePayments,
            m.box10GrossProceedsToAttorney,
          ]
            .map(amountCents)
            .reduce((a, b) => a + Math.abs(b), 0);
          if (total > 0)
            flags.push({
              id: `misc:${d.id}:${i}`,
              sectionId: 'investments',
              severity: 'blocker',
              title: `The 1099-MISC from ${m.payerName} has amounts Tidy can’t report yet`,
              detail:
                'Rents, royalties, other income or substitute payments on a 1099-MISC aren’t supported yet, so your return would be incomplete.',
            });
        }
        if (x.form === 'f1099_oid' && (amountCents(x.data.box5MarketDiscount) !== 0 || amountCents(x.data.box6AcquisitionPremium) !== 0)) {
          flags.push({
            id: `oid-adjust:${d.id}:${i}`,
            sectionId: 'investments',
            severity: 'blocker',
            title: `The 1099-OID from ${x.data.payerName} needs an adjustment Tidy can’t make yet`,
            detail: 'Market discount (box 5) or acquisition premium (box 6) changes how much of the discount is taxable.',
          });
        }
      });
    }
    if (d.status === 'unsupported') {
      flags.push({
        id: `unsupported:${d.id}`,
        sectionId: 'documents',
        severity: 'blocker',
        title: `Tidy can’t prepare ${LABEL[d.docType ?? 'other'] ?? 'this'} yet`,
        detail: `“${d.fileName}” needs a feature that isn’t built yet. Remove it if it was uploaded by mistake.`,
      });
    }
    if (d.status === 'failed') {
      flags.push({
        id: `failed:${d.id}`,
        sectionId: 'documents',
        severity: 'blocker',
        title: `We couldn’t read “${d.fileName}”`,
        detail: `${d.error ?? 'Something went wrong.'} Try again, or remove the file if it isn’t needed: until then, what it says isn’t on your return.`,
      });
    }
    const tooMany = oversizedChecks(d);
    if (tooMany > 0) {
      flags.push({
        id: `too-many-checks:${d.id}`,
        sectionId: 'documents',
        severity: 'blocker',
        title: `“${d.fileName}” has ${tooMany} amounts Tidy can’t check against the page`,
        detail:
          'It looks like a scan or photo of a long statement. Upload the PDF or CSV your bank or broker offers online instead, so Tidy can check every amount itself.',
      });
    }
    if (d.status === 'done' && !d.supersededBy) {
      const prior = d.extractions.find((e) => e.form === 'prior_year' || e.form === 'prior_state');
      if (prior && (prior.form === 'prior_year' || prior.form === 'prior_state') && prior.data.taxYear !== PRIOR_TAX_YEAR) {
        flags.push({
          id: `wrong-year:${d.id}`,
          sectionId: 'documents',
          severity: 'warning',
          title: `“${d.fileName}” is your ${prior.data.taxYear} return`,
          detail: 'Tidy fills in 2025 from your 2024 return, so it doesn’t use this one. Upload your 2024 return, then remove this file.',
        });
      }
      for (const part of d.classification?.parts ?? []) {
        const label = PART_LABEL[part.form];
        if (!label) continue;
        flags.push({
          id: `part:${d.id}:${part.form}:${part.firstPage}`,
          sectionId: 'investments',
          severity: 'blocker',
          title: `“${d.fileName}” includes ${label}`,
          detail: `Pages ${part.firstPage}–${part.lastPage}. Tidy can’t prepare that part yet, so your return would be incomplete.`,
        });
      }
    }
  }
  if (answer('resident-state') === 'other') {
    flags.push({
      id: 'state-other',
      sectionId: 'profile',
      severity: 'blocker',
      title: 'Only Maryland returns for now',
      detail: 'Tidy can’t prepare your state return yet.',
    });
  }
  if (answer('other-income') === 'yes') {
    flags.push({
      id: 'other-income',
      sectionId: 'profile',
      severity: 'blocker',
      title: 'Some of your income needs forms Tidy can’t prepare yet',
      detail: 'Farm income (Schedule F) and specialized income types aren’t supported yet. Until then this return would leave them out.',
    });
  }
  if (f.hasNondeductibleIraBasis === true) {
    flags.push({
      id: 'ira-basis-8606',
      sectionId: 'wages',
      severity: 'blocker',
      title: 'Nondeductible IRA basis needs Form 8606',
      detail:
        'Because you have after-tax basis in a traditional IRA, part of your IRA distribution is tax-free and must be figured on Form 8606, which Tidy doesn’t prepare yet.',
    });
  }
  for (const dist of f.f1099R ?? []) {
    const codes = dist.box7Codes.toUpperCase();
    const isDirectRolloverOrRoth = /^[GHQ]/.test(codes);
    // An IRA's taxable amount is the whole distribution (reportedTaxable). A pension or annuity's isn't: the part
    // that returns after-tax contributions needs the Simplified Method or the General Rule.
    if (
      !isIraDistribution(dist) &&
      (dist.box2bTaxableNotDetermined || dist.box2aBlank === true) &&
      dist.box2aTaxableAmount === 0 &&
      !isDirectRolloverOrRoth &&
      dist.box1GrossDistribution > 0
    ) {
      flags.push({
        id: `1099r-undetermined:${dist.id}`,
        sectionId: 'wages',
        severity: 'blocker',
        title: `The 1099-R from ${dist.payerName} doesn’t say how much is taxable`,
        detail:
          'Box 2a is blank. Figuring the taxable part of a pension or annuity takes the Simplified Method worksheet, which Tidy can’t do yet. Ask the payer for the taxable amount, or have a CPA figure it.',
      });
    }
    if (/[125689AEJKLMPSTUV]/.test(codes)) {
      flags.push({
        id: `1099r-code:${dist.id}`,
        sectionId: 'wages',
        severity: 'blocker',
        title: `1099-R distribution code “${codes}” from ${dist.payerName} needs extra forms`,
        detail:
          'Early distributions (code 1), excess contributions, Roth conversions, or specialized distribution codes require Form 5329 or Form 8606, which Tidy doesn’t prepare yet.',
      });
    }
  }
  if ((f.ssa1099 ?? []).reduce((s, x) => s + x.box5NetBenefits, 0) < 0) {
    flags.push({
      id: 'ssa-negative-benefits',
      sectionId: 'wages',
      severity: 'blocker',
      title: 'Social Security repayments exceeded benefits paid',
      detail: 'Your net Social Security benefits in box 5 are negative, which requires a special repayment calculation in Publication 915.',
    });
  }
  if (answer('has-dependents') === 'yes') {
    flags.push({
      id: 'dependents',
      sectionId: 'profile',
      severity: 'blocker',
      title: 'Returns with dependents aren’t supported yet',
      detail: 'Dependents change credits and exemptions on every form. Tidy can’t handle them yet.',
    });
  }
  if (f.filingStatus === 'hoh' || f.filingStatus === 'qss') {
    flags.push({
      id: 'filing-status-qualifying-person',
      sectionId: 'profile',
      severity: 'blocker',
      title:
        f.filingStatus === 'hoh' ? 'Head of household needs a qualifying person' : 'Qualifying surviving spouse needs a dependent child',
      detail:
        'That filing status depends on someone you support, and Tidy can’t enter dependents or other qualifying people yet. Choose another filing status if it fits, or have a CPA prepare this return.',
    });
  }
  for (const p of f.f1099R ?? []) {
    if (f.residency.state === 'MD' && (p.mdSource === 'military' || p.mdSource === 'public_safety'))
      flags.push({
        id: `md-retirement-subtraction:${p.id}`,
        sectionId: 'state_summary',
        severity: 'warning',
        title:
          p.mdSource === 'military'
            ? 'Maryland’s military retirement subtraction isn’t in Tidy yet'
            : 'Maryland’s public safety retirement subtraction isn’t in Tidy yet',
        detail: `Your income from ${p.payerName} may qualify for a Maryland subtraction (Form 502SU) that Tidy doesn’t take yet, so your Maryland tax may come out higher than it has to.`,
      });
  }
  // State and local income tax refunds (Schedule 1 line 1): the cases the refund worksheet can't handle.
  const prior = latestPriorYear(state);
  const refund = f.stateRefund?.refund ?? 0;
  if (refund > 0 && answer('prior-itemized') === 'yes')
    flags.push({
      id: 'state-refund-needs-2024',
      sectionId: 'wages',
      severity: 'blocker',
      title: 'Tidy needs your 2024 Schedule A to figure your state refund',
      detail:
        'Part of a refund can be taxable when you itemized in 2024. Upload your complete 2024 return. If you uploaded it with an earlier version of Tidy, remove it and upload it again so Tidy reads its Schedule A.',
    });
  for (const g of f.f1099G ?? []) {
    if (g.box2StateRefund > 0 && g.box3TaxYear !== null && g.box3TaxYear !== PRIOR_TAX_YEAR)
      flags.push({
        id: `state-refund-year:${g.id}`,
        sectionId: 'wages',
        severity: 'blocker',
        title: `The 1099-G from ${g.payerName} is a refund of ${g.box3TaxYear} tax`,
        detail:
          'Whether a refund for a year before 2024 is taxable depends on that year’s return (IRS Publication 525). Tidy can only figure a 2024 refund. If you took the standard deduction that year, none of it is taxable.',
      });
  }
  if (r.ledger.get('srw.9') > 0) {
    const why = [
      ...(prior && amountCents(prior.amt ?? { amount: null, page: null, quote: null }) > 0
        ? ['you paid alternative minimum tax in 2024']
        : []),
      ...(prior?.filingStatus === 'mfj' && f.filingStatus !== 'mfj' ? ['your 2024 state return was joint and this return isn’t'] : []),
      ...(Number.parseInt(answer('state-estimate-prior-january') ?? '0', 10) > 0 ? ['you paid 2024 estimated state tax in 2025'] : []),
      ...(prior && amountCents(prior.totalTax) === 0 ? ['your 2024 return shows no tax'] : []),
    ];
    if (why.length > 0)
      flags.push({
        id: 'state-refund-pub525',
        sectionId: 'wages',
        severity: 'blocker',
        title: 'Tidy can’t figure how much of your state refund is taxable',
        detail: `Because ${why.join(', and ')}, the IRS worksheet doesn’t apply (Publication 525 does instead). Have a CPA figure the taxable part.`,
      });
  }
  for (const g of f.f1099G ?? []) {
    if (Math.abs(g.otherBoxes ?? 0) > 0)
      flags.push({
        id: `1099g-other:${g.id}`,
        sectionId: 'wages',
        severity: 'blocker',
        title: `The 1099-G from ${g.payerName} has payments Tidy can’t report yet`,
        detail:
          'Boxes 5, 6, 7 or 9 (trade adjustment assistance, taxable grants, agriculture payments or market gain) aren’t supported yet.',
      });
  }
  for (const msg of r.scheduleE.overflow) {
    flags.push({
      id: `overflow:${msg}`,
      sectionId: 'wages',
      severity: 'blocker',
      title: 'Some income doesn’t fit on the forms Tidy fills yet',
      detail: `You have ${msg}. Tidy can’t add continuation sheets yet, so the rest would be left off your return.`,
    });
  }
  for (const rental of f.rentals ?? []) {
    for (const a of rental.depreciableAssets ?? []) {
      if (a.currentYearDepreciation === undefined && readPlacedInService(a.placedInService) === null)
        flags.push({
          id: `placed-in-service:${rental.id}:${a.description}`,
          sectionId: 'wages',
          severity: 'blocker',
          title: `Tidy couldn’t read when “${a.description}” was placed in service`,
          detail: `Depreciation for ${rental.address || 'your rental'} depends on the month and year it started. Check the depreciation listing on your 2024 return; Tidy read “${a.placedInService}”.`,
        });
    }
  }
  if (f.foreignAccounts.hasForeignAccount === true || f.foreignAccounts.foreignTrust === true) {
    flags.push({
      id: 'foreign-accounts',
      sectionId: 'investments',
      severity: 'blocker',
      title: f.foreignAccounts.hasForeignAccount ? 'Foreign accounts aren’t supported yet' : 'Foreign trusts aren’t supported yet',
      detail: f.foreignAccounts.hasForeignAccount
        ? 'Schedule B then needs the country, and you may also have to file FinCEN Form 114 (FBAR) and Form 8938, and report interest no U.S. form shows. Tidy can’t prepare these yet.'
        : 'A foreign trust may need Form 3520, which Tidy can’t prepare yet.',
    });
  }
  const BOX12: Record<string, string> = {
    A: 'Social Security tax on tips your employer couldn’t collect (Schedule 2, line 13)',
    B: 'Medicare tax on tips your employer couldn’t collect (Schedule 2, line 13)',
    M: 'Social Security tax on group-term life insurance your employer couldn’t collect (Schedule 2, line 13)',
    N: 'Medicare tax on group-term life insurance your employer couldn’t collect (Schedule 2, line 13)',
    K: 'an excise tax on golden parachute payments (Schedule 2)',
    Z: 'income from a deferred compensation plan that doesn’t meet section 409A (Schedule 2)',
    W: 'health savings account contributions (Form 8889)',
    R: 'Archer MSA contributions (Form 8853)',
    T: 'adoption benefits (Form 8839)',
    H: 'contributions to a 501(c)(18)(D) plan (Schedule 1)',
  };
  for (const w of f.w2s) {
    for (const b of w.box12) {
      const code = b.code.trim().toUpperCase();
      if (b.amount !== 0 && BOX12[code])
        flags.push({
          id: `w2-box12:${w.id}:${code}`,
          sectionId: 'wages',
          severity: 'blocker',
          title: `Box 12 code ${code} on the W-2 from ${w.employerName} needs a form Tidy can’t prepare yet`,
          detail: `Code ${code} is ${BOX12[code]}.`,
        });
    }
  }
  if (f.residency.state === 'MD') {
    const other = [
      ...f.w2s.flatMap((w) => w.stateLines.map((s) => ({ s, from: `W-2 from ${w.employerName}` }))),
      ...(f.f1099R ?? []).flatMap((x) => x.stateLines.map((s) => ({ s, from: `1099-R from ${x.payerName}` }))),
      ...(f.f1099Nec ?? []).flatMap((x) => x.stateLines.map((s) => ({ s, from: `1099-NEC from ${x.payerName}` }))),
      ...(f.f1099G ?? []).flatMap((x) => x.stateLines.map((s) => ({ s, from: `1099-G from ${x.payerName}` }))),
    ].filter(({ s }) => s.state !== 'MD' && s.stateTax > 0);
    for (const { s, from } of other)
      flags.push(
        s.state === null
          ? {
              id: `unknown-state-tax:${from}`,
              sectionId: 'wages',
              severity: 'blocker',
              title: `Tidy couldn’t tell which state the tax withheld on your ${from} is for`,
              detail: `It shows ${formatUsd(s.stateTax)} of state tax withheld. Check the state box on the form; if Tidy misread it, correct it in chat or upload a clearer copy.`,
            }
          : {
              id: `other-state-tax:${from}:${s.state}`,
              sectionId: 'wages',
              severity: 'blocker',
              title: `Your ${from} shows ${stateName(s.state)} tax withheld`,
              detail:
                'Getting that back takes a return for that state, and Maryland may give a credit for it. Tidy prepares only the Maryland return so far.',
            },
      );
    for (const w of f.w2s)
      if (w.localLines.some((x) => x.localTax > 0) && !isMdOnlyW2(w))
        flags.push({
          id: `other-local-tax:${w.id}`,
          sectionId: 'wages',
          severity: 'blocker',
          title: `The W-2 from ${w.employerName} shows local tax for a place outside Maryland`,
          detail: 'Local income tax withheld for another state’s city or county needs that place’s return. Tidy can’t prepare it yet.',
        });
  }
  if (f.residency.fullYear === false) {
    flags.push({
      id: 'part-year',
      sectionId: 'profile',
      severity: 'blocker',
      title: 'Part-year residency isn’t supported yet',
      detail: 'Part-year Maryland residents need extra Form 502 steps that Tidy can’t do yet.',
    });
  }
  if (f.digitalAssets === true) {
    flags.push({
      id: 'digital-assets',
      sectionId: 'profile',
      severity: 'blocker',
      title: 'Digital asset sales aren’t supported yet',
      detail: 'Crypto and digital asset reporting (Form 1099-DA and crypto tax lots) is not supported yet.',
    });
  }
  if (r.amt.passiveUncertain) {
    flags.push({
      id: 'amt-passive',
      sectionId: 'federal_summary',
      severity: 'blocker',
      title: 'Your alternative minimum tax depends on a passive activity adjustment',
      detail:
        'A K-1 reports AMT items for a passive activity whose loss is limited this year. Form 6251 line 2m refigures that loss for the AMT, which Tidy can’t do yet.',
    });
  }
  if (r.qbi.tooManyBusinesses) {
    const rows = r.qbi.form === 'f8995' ? 'five' : 'three';
    flags.push({
      id: 'qbi-too-many',
      sectionId: 'federal_summary',
      severity: 'blocker',
      title: 'Too many businesses for the QBI deduction form',
      detail: `Your QBI deduction form has room for ${rows} businesses, and Tidy can’t attach the continuation statement yet.`,
    });
  }
  const foreignTax = foreignTaxPaid(f);
  if (foreignTax > 0 && r.ledger.get('sch3.1') === 0) {
    flags.push({
      id: 'foreign-tax',
      sectionId: 'investments',
      severity: 'warning',
      title: `You paid ${formatUsd(foreignTax)} in foreign tax`,
      detail: simpleForeignTaxCreditAllowed(f)
        ? 'It isn’t claimed as a credit, so this return may overstate your tax by up to that amount.'
        : `Over ${formatUsd(foreignTaxNo1116Limit(f))}, the credit needs Form 1116, which Tidy can’t prepare yet, so this return may overstate your tax by up to that amount.`,
    });
  }
  const qcdLimit = (f.taxYear === 2026 ? FED_2026 : FED_2025).qcdLimit;
  const qcdBy = new Map<string, number>();
  for (const x of f.f1099R ?? [])
    if (x.iraSepSimple && (x.qcdAmount ?? 0) > 0) qcdBy.set(x.owner, (qcdBy.get(x.owner) ?? 0) + (x.qcdAmount ?? 0));
  if ([...qcdBy.values()].some((v) => v > qcdLimit)) {
    flags.push({
      id: 'qcd-over-limit',
      sectionId: 'wages',
      severity: 'warning',
      title: `Charity gifts from an IRA are tax-free only up to ${formatUsd(qcdLimit)} a person`,
      detail: 'Tidy left the part over the limit taxable on line 4b. It may count as a charity gift on Schedule A instead.',
    });
  }
  if (qcdBy.size > 0 && (f.itemized.charityCash > 0 || f.itemized.charityNonCash > 0)) {
    flags.push({
      id: 'qcd-and-charity',
      sectionId: 'deductions',
      severity: 'warning',
      title: 'Leave your IRA charity gift out of your other gifts',
      detail:
        'Money given straight from your IRA to charity is already tax-free on line 4b, so it can’t also be deducted on Schedule A. If the gifts you entered include it, take it out.',
    });
  }
  for (const [i, loan] of (f.newDeductions?.carLoans ?? []).entries()) {
    const problem = loan.interest > 0 ? vinProblem(loan.vin) : null;
    if (problem) {
      flags.push({
        id: `vin:${i}`,
        sectionId: 'deductions',
        severity: 'blocker',
        title: 'Check the vehicle identification number (VIN)',
        detail: `“${loan.vin}” ${problem}. It’s on your registration or loan statement.`,
      });
    }
  }
  if ((f.carryovers?.amtCredit ?? 0) > 0) {
    flags.push({
      id: 'carryover-amt-credit',
      sectionId: 'federal_summary',
      severity: 'blocker',
      title: `Prior-year AMT credit carryover (${formatUsd(f.carryovers!.amtCredit!)}) needs Form 8801`,
      detail: 'Your 2024 return carried forward a minimum tax credit on Form 8801, which Tidy doesn’t prepare yet.',
    });
  }
  if ((f.carryovers?.foreignTaxCredit ?? 0) > 0) {
    flags.push({
      id: 'carryover-ftc',
      sectionId: 'investments',
      severity: 'warning',
      title: `You have a ${formatUsd(f.carryovers!.foreignTaxCredit!)} foreign tax credit carryover`,
      detail: 'Form 1116 carryovers aren’t claimed yet, so this return may overstate your tax by up to that amount.',
    });
  }
  if ((f.carryovers?.investmentInterest ?? 0) > 0) {
    flags.push({
      id: 'carryover-investment-interest',
      sectionId: 'deductions',
      severity: 'blocker',
      title: `Prior-year investment interest carryover (${formatUsd(f.carryovers!.investmentInterest!)}) needs Form 4952`,
      detail: 'Your 2024 return carried forward disallowed investment interest expense on Form 4952, which Tidy doesn’t prepare yet.',
    });
  }
  return flags;
}
