import type { Cents } from '../../engine/money';
import type { MdFormId, MdResult } from '../../engine/md/form502';
import type { TaxFacts } from '../../shared/facts';
import { plainAmount, type FillValues } from './fill';
import { MD502CG_2025, MD502SU_2025, MD502_2025 } from './maps/md2025';
import type { FormMap } from './maps/federal2025';
import type { Ledger } from '../../engine/ledger';

export const STATE_MAPS: Record<MdFormId, FormMap> = {
  md502: MD502_2025,
  md502su: MD502SU_2025,
  md502cg: MD502CG_2025,
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
    'md502.B.count': md.exemptions.age65 ? String(md.exemptions.age65) : '',
    'md502.D.count': String(md.exemptions.total),
    localRate: md.localRatePrinted ?? '',
  });
  if (md.ledger.get('md502.13') > 0) text['md502.13.code1'] = 'ab';
  for (const line of ['41', '43', '46', '47', '48', '50', '52']) text[`md502.${line}.cents`] = cents(md.ledger.get(`md502.${line}`));
  const checks = ['exemptYou'];
  if (md.exemptions.spouse) checks.push('exemptSpouse');
  if (md.exemptions.age65 > 0 && f.taxpayer.dateOfBirth && f.taxpayer.dateOfBirth < '1961-01-02') checks.push('age65You');
  if (md.exemptions.spouse && f.spouse?.dateOfBirth && f.spouse.dateOfBirth < '1961-01-02') checks.push('age65Spouse');
  return { text, checks, choices: { filingStatus: f.filingStatus, deduction: md.itemizing ? 'itemized' : 'standard' } };
}
