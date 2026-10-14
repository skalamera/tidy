import type { Cents } from '../../engine/money';
import { ageAtEndOf2025, is65, type MdFormId, type MdResult } from '../../engine/md/form502';
import type { TaxFacts } from '../../shared/facts';
import { plainAmount, type FillValues } from './fill';
import { MD500DM_2025, MD502CG_2025, MD502CR_2025, MD502R_2025, MD502SU_2025, MD502_2025 } from './maps/md2025';
import type { FormMap } from './maps/federal2025';
import type { Ledger } from '../../engine/ledger';

export const STATE_MAPS: Record<MdFormId, FormMap> = {
  md502: MD502_2025,
  md502su: MD502SU_2025,
  md502cg: MD502CG_2025,
  md502r: MD502R_2025,
  md502cr: MD502CR_2025,
  md500dm: MD500DM_2025,
};

function ledgerText(map: FormMap, l: Ledger): Record<string, string> {
  const text: Record<string, string> = {};
  for (const key of Object.keys(map.text)) if (l.has(key)) text[key] = plainAmount(l.get(key));
  return text;
}

const cents = (c: Cents) => (c === 0 ? '' : '00');

/** Values for one Maryland form. */
export function mdValues(id: MdFormId, f: TaxFacts, md: MdResult): FillValues {
  const map = STATE_MAPS[id];
  const text = ledgerText(map, md.ledger);
  const names = {
    firstName: f.taxpayer.firstName,
    lastName: f.taxpayer.lastName,
    ssn: f.taxpayer.ssn,
    ...(f.spouse && f.filingStatus === 'mfj'
      ? { spouseFirstName: f.spouse.firstName, spouseLastName: f.spouse.lastName, spouseSsn: f.spouse.ssn }
      : {}),
  };
  Object.assign(text, names);

  if (id === 'md502r') {
    const yourAge = ageAtEndOf2025(f.taxpayer.dateOfBirth);
    const spouseAge = f.spouse && f.filingStatus === 'mfj' ? ageAtEndOf2025(f.spouse.dateOfBirth) : null;
    if (yourAge !== null) text.yourAge = String(yourAge);
    if (spouseAge !== null) text.spouseAge = String(spouseAge);
    const checks: string[] = [];
    if (f.taxpayer.totallyDisabled) checks.push('disabledYou');
    if (f.spouse && f.filingStatus === 'mfj' && f.spouse.totallyDisabled) checks.push('disabledSpouse');
    return { text, checks };
  }

  if (id === 'md500dm') {
    const full =
      f.spouse && f.filingStatus === 'mfj'
        ? `${f.taxpayer.firstName} ${f.taxpayer.lastName} & ${f.spouse.firstName} ${f.spouse.lastName}`
        : `${f.taxpayer.firstName} ${f.taxpayer.lastName}`;
    return {
      text: {
        ...ledgerText(map, md.ledger),
        fullName: full,
        ssn: f.taxpayer.ssn,
      },
      checks: [],
    };
  }

  if (id !== 'md502') return { text, checks: [] };

  const sub = f.residency.mdSubdivision;
  Object.assign(text, {
    street: f.address.street,
    street2: f.address.apt ?? '',
    city: f.address.city,
    state: f.address.state,
    zip: f.address.zip.replace(/\D/g, ''),
    subdivisionCode: sub?.code ?? '',
    subdivisionName: sub?.name ?? '',
    physicalStreet: f.address.street,
    physicalCity: f.address.city,
    physicalZip: f.address.zip.replace(/\D/g, ''),
    physicalCounty: f.residency.mdCounty === 'Baltimore City' ? '' : (f.residency.mdCounty ?? ''),
    'md502.A.count': String((md.exemptions.you ? 1 : 0) + (md.exemptions.spouse ? 1 : 0)),
    'md502.B.count': md.exemptions.extra ? String(md.exemptions.extra) : '',
    'md502.D.count': String(md.exemptions.total),
    localRate: md.localRatePrinted ?? '',
  });
  const codes: string[] = [];
  if (md.ledger.get('md502su.ab') > 0) codes.push('ab');
  if (md.ledger.get('md502su.bb') > 0) codes.push('bb');
  if (md.ledger.get('md502su.hh') > 0) codes.push('hh');
  codes.forEach((c, idx) => {
    text[`md502.13.code${idx + 1}`] = c;
  });
  for (const line of ['41', '43', '46', '47', '48', '50', '52']) text[`md502.${line}.cents`] = cents(md.ledger.get(`md502.${line}`));
  const checks = ['exemptYou'];
  if (md.exemptions.spouse) checks.push('exemptSpouse');
  if (is65(f.taxpayer.dateOfBirth)) checks.push('age65You');
  if (md.exemptions.spouse && is65(f.spouse?.dateOfBirth)) checks.push('age65Spouse');
  if (f.taxpayer.blind) checks.push('blindYou');
  if (md.exemptions.spouse && f.spouse?.blind) checks.push('blindSpouse');
  if (md.pensionExclusion.you) checks.push('pensionExclusionYou');
  if (md.pensionExclusion.spouse) checks.push('pensionExclusionSpouse');
  return { text, checks, choices: { filingStatus: f.filingStatus, deduction: md.itemizing ? 'itemized' : 'standard' } };
}
