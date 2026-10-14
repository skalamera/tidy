import type { FederalFormId } from '../../../engine/federal/form1040';

/** Field names of the official 2025 IRS fillable PDFs (https://www.irs.gov/pub/irs-prior/<file>--2025.pdf),
 *  read with scripts/dump-fields.ts. Keys are ledger line ids, header keys, or row keys. Data only. */
export interface FormMap {
  template: string; // relative to resources/
  /** 'irs' prints "1,234"; 'plain' prints "1234" (Maryland fill-in forms format numbers themselves). */
  numbers: 'irs' | 'plain';
  /** Optional 0-based page indices to include in the printed package (drops trailing instruction pages on Maryland forms). */
  pages?: number[];
  text: Record<string, string>;
  checks: Record<string, string>;
  /** One checkbox field with several widgets, each with its own "on" state — behaves like radio buttons. */
  choices?: Record<string, { field: string; options: Record<string, string> }>;
}

const at = (prefix: string, fields: Record<string, string>) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, prefix + v]));

const P1 = 'topmostSubform[0].Page1[0].';
const P2 = 'topmostSubform[0].Page2[0].';
const F1 = 'form1[0].Page1[0].';
const F2 = 'form1[0].Page2[0].';

const f1040: FormMap = {
  template: 'forms/2025/f1040.pdf',
  numbers: 'irs',
  text: {
    ...at(P1, {
      firstName: 'f1_14[0]',
      lastName: 'f1_15[0]',
      ssn: 'f1_16[0]',
      spouseFirstName: 'f1_17[0]',
      spouseLastName: 'f1_18[0]',
      spouseSsn: 'f1_19[0]',
      street: 'Address_ReadOrder[0].f1_20[0]',
      apt: 'Address_ReadOrder[0].f1_21[0]',
      city: 'Address_ReadOrder[0].f1_22[0]',
      state: 'Address_ReadOrder[0].f1_23[0]',
      zip: 'Address_ReadOrder[0].f1_24[0]',
      'f1040.1a': 'f1_47[0]',
      'f1040.1z': 'f1_57[0]',
      'f1040.2a': 'f1_58[0]',
      'f1040.2b': 'f1_59[0]',
      'f1040.3a': 'f1_60[0]',
      'f1040.3b': 'f1_61[0]',
      'f1040.4a': 'f1_62[0]',
      'f1040.4b': 'f1_63[0]',
      'f1040.5a': 'f1_65[0]',
      'f1040.5b': 'f1_66[0]',
      'f1040.6a': 'f1_68[0]',
      'f1040.6b': 'f1_69[0]',
      'f1040.7a': 'f1_70[0]',
      'f1040.8': 'f1_72[0]',
      'f1040.9': 'f1_73[0]',
      'f1040.10': 'f1_74[0]',
      'f1040.11a': 'f1_75[0]',
    }),
    ...at(P2, {
      'f1040.11b': 'f2_01[0]',
      'f1040.12e': 'f2_02[0]',
      'f1040.13a': 'f2_03[0]',
      'f1040.13b': 'f2_04[0]',
      'f1040.14': 'f2_05[0]',
      'f1040.15': 'f2_06[0]',
      'f1040.16': 'f2_08[0]',
      'f1040.17': 'f2_09[0]',
      'f1040.18': 'f2_10[0]',
      'f1040.19': 'f2_11[0]',
      'f1040.20': 'f2_12[0]',
      'f1040.21': 'f2_13[0]',
      'f1040.22': 'f2_14[0]',
      'f1040.23': 'f2_15[0]',
      'f1040.24': 'f2_16[0]',
      'f1040.25a': 'f2_17[0]',
      'f1040.25b': 'f2_18[0]',
      'f1040.25c': 'f2_19[0]',
      'f1040.25d': 'f2_20[0]',
      'f1040.26': 'f2_21[0]',
      'f1040.31': 'f2_27[0]',
      'f1040.32': 'f2_28[0]',
      'f1040.33': 'f2_29[0]',
      'f1040.34': 'f2_30[0]',
      'f1040.35a': 'f2_31[0]',
      'f1040.37': 'f2_35[0]',
    }),
  },
  checks: {
    ...at(P1, {
      single: 'Checkbox_ReadOrder[0].c1_8[0]',
      mfj: 'Checkbox_ReadOrder[0].c1_8[1]',
      mfs: 'Checkbox_ReadOrder[0].c1_8[2]',
      hoh: 'c1_8[0]',
      qss: 'c1_8[1]',
      digitalAssetsYes: 'c1_10[0]',
      digitalAssetsNo: 'c1_10[1]',
      iraRollover: 'c1_35[0]',
      iraQcd: 'c1_36[0]',
      pensionRollover: 'c1_38[0]',
      pensionPso: 'c1_39[0]',
      scheduleDNotRequired: 'c1_43[0]',
    }),
    ...at(P2, {
      youBornBefore1961: 'c2_5[0]',
      youBlind: 'c2_6[0]',
      spouseBornBefore1961: 'c2_7[0]',
      spouseBlind: 'c2_8[0]',
    }),
  },
};

const sch1A: FormMap = {
  template: 'forms/2025/f1040s1a.pdf',
  numbers: 'irs',
  text: {
    ...at(F1, {
      name: 'f1_01[0]',
      ssn: 'f1_02[0]',
      'sch1A.1': 'f1_03[0]',
      'sch1A.2e': 'f1_08[0]',
      'sch1A.3': 'f1_09[0]',
    }),
    ...at(F2, {
      'sch1A.31': 'f2_15[0]',
      'sch1A.32': 'f2_16[0]',
      'sch1A.33': 'f2_17[0]',
      'sch1A.34': 'f2_18[0]',
      'sch1A.35': 'f2_19[0]',
      'sch1A.36a': 'f2_20[0]',
      'sch1A.36b': 'f2_21[0]',
      'sch1A.37': 'f2_22[0]',
      'sch1A.38': 'f2_23[0]',
    }),
  },
  checks: {},
};

const sch2: FormMap = {
  template: 'forms/2025/f1040s2.pdf',
  numbers: 'irs',
  text: {
    ...at(F1, {
      name: 'f1_01[0]',
      ssn: 'f1_02[0]',
      'sch2.2': 'f1_12[0]',
      'sch2.3': 'f1_13[0]',
      'sch2.11': 'f1_22[0]',
      'sch2.12': 'f1_23[0]',
    }),
    ...at(F2, { 'sch2.21': 'f2_24[0]' }),
  },
  checks: {},
};

const sch3: FormMap = {
  template: 'forms/2025/f1040s3.pdf',
  numbers: 'irs',
  text: at(P1, {
    name: 'f1_01[0]',
    ssn: 'f1_02[0]',
    'sch3.8': 'f1_25[0]',
    'sch3.10': 'f1_27[0]',
    'sch3.11': 'f1_28[0]',
    'sch3.15': 'f1_37[0]',
  }),
  checks: {},
};

const schA: FormMap = {
  template: 'forms/2025/f1040sa.pdf',
  numbers: 'irs',
  text: at(F1, {
    name: 'f1_1[0]',
    ssn: 'f1_2[0]',
    'schA.1': 'f1_3[0]',
    'schA.2': 'Line2_ReadOrder[0].f1_4[0]',
    'schA.3': 'f1_5[0]',
    'schA.4': 'f1_6[0]',
    'schA.5a': 'f1_7[0]',
    'schA.5b': 'f1_8[0]',
    'schA.5c': 'f1_9[0]',
    'schA.5d': 'f1_10[0]',
    'schA.5e': 'f1_11[0]',
    'schA.7': 'f1_14[0]',
    'schA.8a': 'f1_15[0]',
    'schA.8e': 'f1_20[0]',
    'schA.9': 'f1_21[0]',
    'schA.10': 'f1_22[0]',
    'schA.11': 'f1_23[0]',
    'schA.12': 'f1_24[0]',
    'schA.13': 'f1_25[0]',
    'schA.14': 'f1_26[0]',
    'schA.17': 'f1_30[0]',
  }),
  checks: at(F1, { forceItemize: 'Line18_ReadOrder[0].c1_3[0]' }),
};

/** Schedule B has 14 interest rows (line 1) and 15 dividend rows (line 5): name field, amount field. */
const num = (n: number) => String(n).padStart(2, '0');
const rows = (prefix: string, firstField: number, count: number, firstOverride: string | null) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => {
      const nameField = i === 0 && firstOverride ? firstOverride : `f1_${num(firstField + 2 * i)}[0]`;
      return [
        [`${prefix}.name.${i}`, nameField],
        [`${prefix}.amount.${i}`, `f1_${num(firstField + 2 * i + 1)}[0]`],
      ];
    }).flat(),
  );
export const SCHB_INTEREST_ROWS = 14;
export const SCHB_DIVIDEND_ROWS = 15;

const schB: FormMap = {
  template: 'forms/2025/f1040sb.pdf',
  numbers: 'irs',
  text: at(P1, {
    name: 'f1_01[0]',
    ssn: 'f1_02[0]',
    ...rows('schB.1', 3, SCHB_INTEREST_ROWS, 'Line1_ReadOrder[0].f1_03[0]'),
    'schB.2': 'f1_31[0]',
    'schB.4': 'f1_33[0]',
    ...rows('schB.5', 34, SCHB_DIVIDEND_ROWS, 'ReadOrderControl[0].f1_34[0]'),
    'schB.6': 'f1_64[0]',
    fbarCountries: 'f1_65[0]',
  }),
  checks: at(P1, {
    foreignAccountYes: 'TagcorrectingSubform[0].c1_1[0]',
    foreignAccountNo: 'TagcorrectingSubform[0].c1_1[1]',
    fbarYes: 'c1_2[0]',
    fbarNo: 'c1_2[1]',
    foreignTrustYes: 'c1_3[0]',
    foreignTrustNo: 'c1_3[1]',
  }),
};

const f8959: FormMap = {
  template: 'forms/2025/f8959.pdf',
  numbers: 'irs',
  text: at(
    P1,
    Object.fromEntries([
      ['name', 'f1_1[0]'],
      ['ssn', 'f1_2[0]'],
      ...Array.from({ length: 24 }, (_, i) => [`f8959.${i + 1}`, `f1_${i + 3}[0]`]),
    ]),
  ),
  checks: {},
};

const f8960Lines = [
  '1',
  '2',
  '3',
  '4a',
  '4b',
  '4c',
  '5a',
  '5b',
  '5c',
  '5d',
  '6',
  '7',
  '8',
  '9a',
  '9b',
  '9c',
  '9d',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
];
const f8960: FormMap = {
  template: 'forms/2025/f8960.pdf',
  numbers: 'irs',
  text: at(
    P1,
    Object.fromEntries([['name', 'f1_1[0]'], ['ssn', 'f1_2[0]'], ...f8960Lines.map((line, i) => [`f8960.${line}`, `f1_${i + 3}[0]`])]),
  ),
  checks: {},
};

export const FEDERAL_MAPS: Record<FederalFormId, FormMap> = { f1040, sch1A, sch2, sch3, schA, schB, f8959, f8960 };
