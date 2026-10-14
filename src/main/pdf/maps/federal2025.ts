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

const sch1: FormMap = {
  template: 'forms/2025/f1040s1.pdf',
  numbers: 'irs',
  text: {
    ...at(P1, {
      name: 'f1_01[0]',
      ssn: 'f1_02[0]',
      'sch1.1': 'f1_04[0]',
      'sch1.3': 'f1_07[0]',
      'sch1.4': 'f1_08[0]',
      'sch1.5': 'f1_09[0]',
      'sch1.9': 'f1_37[0]',
      'sch1.10': 'f1_38[0]',
    }),
    ...at(P2, {
      'sch1.15': 'f2_05[0]',
      'sch1.16': 'f2_06[0]',
      'sch1.17': 'f2_07[0]',
      'sch1.25': 'f2_29[0]',
      'sch1.26': 'f2_30[0]',
    }),
  },
  checks: at(P1, {
    form4797: 'c1_1[0]',
    form4684: 'c1_2[0]',
  }),
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
      'sch2.4': 'Line4_ReadOrder[0].f1_14[0]',
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

const schD: FormMap = {
  template: 'forms/2025/f1040sd.pdf',
  numbers: 'irs',
  text: {
    ...at(P1, {
      name: 'f1_1[0]',
      ssn: 'f1_2[0]',
      'schD.1a.d': 'Table_PartI[0].Row1a[0].f1_3[0]',
      'schD.1a.e': 'Table_PartI[0].Row1a[0].f1_4[0]',
      'schD.1a.h': 'Table_PartI[0].Row1a[0].f1_6[0]',
      'schD.1b.d': 'Table_PartI[0].Row1b[0].f1_7[0]',
      'schD.1b.e': 'Table_PartI[0].Row1b[0].f1_8[0]',
      'schD.1b.g': 'Table_PartI[0].Row1b[0].f1_9[0]',
      'schD.1b.h': 'Table_PartI[0].Row1b[0].f1_10[0]',
      'schD.2.d': 'Table_PartI[0].Row2[0].f1_11[0]',
      'schD.2.e': 'Table_PartI[0].Row2[0].f1_12[0]',
      'schD.2.g': 'Table_PartI[0].Row2[0].f1_13[0]',
      'schD.2.h': 'Table_PartI[0].Row2[0].f1_14[0]',
      'schD.3.d': 'Table_PartI[0].Row3[0].f1_15[0]',
      'schD.3.e': 'Table_PartI[0].Row3[0].f1_16[0]',
      'schD.3.g': 'Table_PartI[0].Row3[0].f1_17[0]',
      'schD.3.h': 'Table_PartI[0].Row3[0].f1_18[0]',
      'schD.4': 'f1_19[0]',
      'schD.5': 'f1_20[0]',
      'schD.6': 'f1_21[0]',
      'schD.7': 'f1_22[0]',
      'schD.8a.d': 'Table_PartII[0].Row8a[0].f1_23[0]',
      'schD.8a.e': 'Table_PartII[0].Row8a[0].f1_24[0]',
      'schD.8a.h': 'Table_PartII[0].Row8a[0].f1_26[0]',
      'schD.8b.d': 'Table_PartII[0].Row8b[0].f1_27[0]',
      'schD.8b.e': 'Table_PartII[0].Row8b[0].f1_28[0]',
      'schD.8b.g': 'Table_PartII[0].Row8b[0].f1_29[0]',
      'schD.8b.h': 'Table_PartII[0].Row8b[0].f1_30[0]',
      'schD.9.d': 'Table_PartII[0].Row9[0].f1_31[0]',
      'schD.9.e': 'Table_PartII[0].Row9[0].f1_32[0]',
      'schD.9.g': 'Table_PartII[0].Row9[0].f1_33[0]',
      'schD.9.h': 'Table_PartII[0].Row9[0].f1_34[0]',
      'schD.10.d': 'Table_PartII[0].Row10[0].f1_35[0]',
      'schD.10.e': 'Table_PartII[0].Row10[0].f1_36[0]',
      'schD.10.g': 'Table_PartII[0].Row10[0].f1_37[0]',
      'schD.10.h': 'Table_PartII[0].Row10[0].f1_38[0]',
      'schD.11': 'f1_39[0]',
      'schD.12': 'f1_40[0]',
      'schD.13': 'f1_41[0]',
      'schD.14': 'f1_42[0]',
      'schD.15': 'f1_43[0]',
    }),
    ...at(P2, {
      'schD.16': 'f2_1[0]',
      'schD.18': 'f2_2[0]',
      'schD.19': 'f2_3[0]',
      'schD.21': 'f2_4[0]',
    }),
  },
  checks: {
    ...at(P1, {
      qofYes: 'c1_1[0]',
      qofNo: 'c1_1[1]',
    }),
    ...at(P2, {
      line17Yes: 'c2_1[0]',
      line17No: 'c2_1[1]',
      line20Yes: 'c2_2[0]',
      line20No: 'c2_2[1]',
      line22Yes: 'c2_3[0]',
      line22No: 'c2_3[1]',
    }),
  },
};

const f8949RowFields = (part: 1 | 2) => {
  const pagePrefix = part === 1 ? P1 : P2;
  const fPrefix = part === 1 ? 'f1' : 'f2';
  const tableName = `Table_Line1_Part${part}[0]`;
  const entries: [string, string][] = [];
  for (let r = 0; r < 11; r++) {
    const base = 3 + r * 8;
    const rowPath = `${pagePrefix}${tableName}.Row${r + 1}[0].`;
    const cols = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
    cols.forEach((col, cIdx) => {
      entries.push([`p${part}.r${r}.${col}`, `${rowPath}${fPrefix}_${num(base + cIdx)}[0]`]);
    });
  }
  return Object.fromEntries(entries);
};

export const F8949_ROWS_PER_PAGE = 11;

const f8949: FormMap = {
  template: 'forms/2025/f8949.pdf',
  numbers: 'irs',
  text: {
    ...at(P1, {
      name: 'f1_01[0]',
      ssn: 'f1_02[0]',
      'p1.total.d': 'f1_91[0]',
      'p1.total.e': 'f1_92[0]',
      'p1.total.g': 'f1_94[0]',
      'p1.total.h': 'f1_95[0]',
    }),
    ...f8949RowFields(1),
    ...at(P2, {
      name2: 'f2_01[0]',
      ssn2: 'f2_02[0]',
      'p2.total.d': 'f2_91[0]',
      'p2.total.e': 'f2_92[0]',
      'p2.total.g': 'f2_94[0]',
      'p2.total.h': 'f2_95[0]',
    }),
    ...f8949RowFields(2),
  },
  checks: {
    ...at(P1, {
      boxA: 'c1_1[0]',
      boxB: 'c1_1[1]',
      boxC: 'c1_1[2]',
    }),
    ...at(P2, {
      boxD: 'c2_1[0]',
      boxE: 'c2_1[1]',
      boxF: 'c2_1[2]',
    }),
  },
};

const f8995: FormMap = {
  template: 'forms/2025/f8995.pdf',
  numbers: 'irs',
  text: at(P1, {
    name: 'f1_01[0]',
    ssn: 'f1_02[0]',
    'f8995.2': 'Line2_ReadOrder[0].f1_18[0]',
    'f8995.3': 'f1_19[0]',
    'f8995.4': 'f1_20[0]',
    'f8995.5': 'f1_21[0]',
    'f8995.6': 'Line6_ReadOrder[0].f1_22[0]',
    'f8995.7': 'f1_23[0]',
    'f8995.8': 'f1_24[0]',
    'f8995.9': 'f1_25[0]',
    'f8995.10': 'f1_26[0]',
    'f8995.11': 'f1_27[0]',
    'f8995.12': 'f1_28[0]',
    'f8995.13': 'f1_29[0]',
    'f8995.14': 'f1_30[0]',
    'f8995.15': 'f1_31[0]',
    'f8995.16': 'f1_32[0]',
    'f8995.17': 'f1_33[0]',
  }),
  checks: {},
};

const f8995a: FormMap = {
  template: 'forms/2025/f8995a.pdf',
  numbers: 'irs',
  text: {
    ...at(P1, {
      name: 'f1_01[0]',
      ssn: 'f1_02[0]',
    }),
    ...at(P2, {
      'f8995a.27': 'f2_36[0]',
      'f8995a.28': 'f2_37[0]',
      'f8995a.29': 'f2_38[0]',
      'f8995a.30': 'f2_39[0]',
      'f8995a.31': 'f2_40[0]',
      'f8995a.32': 'f2_41[0]',
      'f8995a.33': 'f2_42[0]',
      'f8995a.34': 'f2_43[0]',
      'f8995a.35': 'f2_44[0]',
      'f8995a.36': 'f2_45[0]',
      'f8995a.37': 'f2_46[0]',
      'f8995a.38': 'f2_47[0]',
      'f8995a.39': 'f2_48[0]',
      'f8995a.40': 'f2_49[0]',
    }),
  },
  checks: {},
};

const schC: FormMap = {
  template: 'forms/2025/f1040sc.pdf',
  numbers: 'irs',
  text: {
    ...at(P1, {
      name: 'f1_1[0]',
      ssn: 'f1_2[0]',
      principalBusiness: 'f1_3[0]',
      businessCode: 'BComb[0].f1_4[0]',
      businessName: 'f1_5[0]',
      ein: 'DComb[0].f1_6[0]',
      street: 'f1_7[0]',
      cityStateZip: 'f1_8[0]',
      'schC.1': 'f1_10[0]',
      'schC.2': 'f1_11[0]',
      'schC.3': 'f1_12[0]',
      'schC.4': 'f1_13[0]',
      'schC.5': 'f1_14[0]',
      'schC.6': 'f1_15[0]',
      'schC.7': 'f1_16[0]',
      'schC.8': 'Lines8-17[0].f1_17[0]',
      'schC.9': 'Lines8-17[0].f1_18[0]',
      'schC.10': 'Lines8-17[0].f1_19[0]',
      'schC.11': 'Lines8-17[0].f1_20[0]',
      'schC.12': 'Lines8-17[0].f1_21[0]',
      'schC.13': 'Lines8-17[0].f1_22[0]',
      'schC.14': 'Lines8-17[0].f1_23[0]',
      'schC.15': 'Lines8-17[0].f1_24[0]',
      'schC.16a': 'Lines8-17[0].f1_25[0]',
      'schC.16b': 'Lines8-17[0].f1_26[0]',
      'schC.17': 'Lines8-17[0].f1_27[0]',
      'schC.18': 'Lines18-27[0].f1_28[0]',
      'schC.19': 'Lines18-27[0].f1_29[0]',
      'schC.20a': 'Lines18-27[0].f1_30[0]',
      'schC.20b': 'Lines18-27[0].f1_31[0]',
      'schC.21': 'Lines18-27[0].f1_32[0]',
      'schC.22': 'Lines18-27[0].f1_33[0]',
      'schC.23': 'Lines18-27[0].f1_34[0]',
      'schC.24a': 'Lines18-27[0].f1_35[0]',
      'schC.24b': 'Lines18-27[0].f1_36[0]',
      'schC.25': 'Lines18-27[0].f1_37[0]',
      'schC.26': 'Lines18-27[0].f1_38[0]',
      'schC.27a': 'Lines18-27[0].f1_40[0]',
      'schC.27b': 'Lines18-27[0].f1_39[0]',
      'schC.28': 'f1_41[0]',
      'schC.29': 'f1_42[0]',
      simplifiedTotalSqFt: 'Line30_ReadOrder[0].f1_43[0]',
      simplifiedBusinessSqFt: 'Line30_ReadOrder[0].f1_44[0]',
      'schC.30': 'f1_45[0]',
      'schC.31': 'f1_46[0]',
    }),
    ...at(P2, {
      ...Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [
          [`otherExp.${i}.desc`, `PartVTable[0].Item${i + 1}[0].f2_${15 + 2 * i}[0]`],
          [`otherExp.${i}.amt`, `PartVTable[0].Item${i + 1}[0].f2_${16 + 2 * i}[0]`],
        ]).flat(),
      ),
      'schC.48': 'f2_33[0]',
    }),
  },
  checks: at(P1, {
    accountingCash: 'c1_1[0]',
    materialParticipationYes: 'c1_2[0]',
    payments1099No: 'c1_4[1]',
    allAtRisk: 'c1_7[0]',
  }),
};

const schSE: FormMap = {
  template: 'forms/2025/f1040sse.pdf',
  numbers: 'irs',
  pages: [0],
  text: at(P1, {
    name: 'f1_1[0]',
    ssn: 'f1_2[0]',
    'schSE.2': 'f1_5[0]',
    'schSE.3': 'f1_6[0]',
    'schSE.4a': 'f1_7[0]',
    'schSE.4c': 'f1_9[0]',
    'schSE.6': 'f1_12[0]',
    'schSE.8a': 'Line8a_ReadOrder[0].f1_14[0]',
    'schSE.8d': 'f1_17[0]',
    'schSE.9': 'f1_18[0]',
    'schSE.10': 'f1_19[0]',
    'schSE.11': 'f1_20[0]',
    'schSE.12': 'f1_21[0]',
    'schSE.13': 'f1_22[0]',
  }),
  checks: {},
};

const f4797RowFields = (table: 'TableLine2' | 'TableLine10', prefix: 'p1' | 'p2', firstFieldNum: number) => {
  const cols = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;
  const entries: [string, string][] = [];
  for (let r = 0; r < 4; r++) {
    const base = firstFieldNum + r * 7;
    const rowPath = `${P1}${table}[0].Row${r + 1}[0].`;
    cols.forEach((col, cIdx) => {
      entries.push([`${prefix}.r${r}.${col}`, `${rowPath}f1_${base + cIdx}[0]`]);
    });
  }
  return Object.fromEntries(entries);
};

const f4797Part3Fields = () => {
  const entries: [string, string][] = [];
  for (let c = 0; c < 4; c++) {
    const rowPath = `${P2}PartIIITable1[0].Row${c + 1}[0].`;
    entries.push([`p3.c${c}.desc`, `${rowPath}f2_${1 + c * 3}[0]`]);
    entries.push([`p3.c${c}.acq`, `${rowPath}f2_${2 + c * 3}[0]`]);
    entries.push([`p3.c${c}.sold`, `${rowPath}f2_${3 + c * 3}[0]`]);
    entries.push([`p3.c${c}.20`, `${P2}PartIIITable2[0].Row20[0].f2_${13 + c}[0]`]);
    entries.push([`p3.c${c}.21`, `${P2}PartIIITable2[0].Row21[0].f2_${17 + c}[0]`]);
    entries.push([`p3.c${c}.22`, `${P2}PartIIITable2[0].Row22[0].f2_${21 + c}[0]`]);
    entries.push([`p3.c${c}.23`, `${P2}PartIIITable2[0].Row23[0].f2_${25 + c}[0]`]);
    entries.push([`p3.c${c}.24`, `${P2}PartIIITable2[0].Row24[0].f2_${29 + c}[0]`]);
    entries.push([`p3.c${c}.25a`, `${P2}PartIIITable2[0].Row25a[0].f2_${33 + c}[0]`]);
    entries.push([`p3.c${c}.25b`, `${P2}PartIIITable2[0].Row25b[0].f2_${37 + c}[0]`]);
  }
  return Object.fromEntries(entries);
};

const f4797: FormMap = {
  template: 'forms/2025/f4797.pdf',
  numbers: 'irs',
  text: {
    ...at(P1, {
      name: 'f1_1[0]',
      ssn: 'f1_2[0]',
      'f4797.6': 'f1_37[0]',
      'f4797.7': 'f1_38[0]',
      'f4797.8': 'f1_39[0]',
      'f4797.9': 'f1_40[0]',
      'f4797.11': 'f1_69[0]',
      'f4797.12': 'f1_70[0]',
      'f4797.13': 'f1_71[0]',
      'f4797.17': 'f1_75[0]',
      'f4797.18b': 'f1_77[0]',
    }),
    ...f4797RowFields('TableLine2', 'p1', 6),
    ...f4797RowFields('TableLine10', 'p2', 41),
    ...f4797Part3Fields(),
    ...at(P2, {
      'f4797.30': 'f2_97[0]',
      'f4797.31': 'f2_98[0]',
      'f4797.32': 'f2_99[0]',
      'f4797.33a': 'PartIVTable[0].Row33[0].f2_100[0]',
      'f4797.34a': 'PartIVTable[0].Row34[0].f2_102[0]',
      'f4797.35a': 'PartIVTable[0].Row35[0].f2_104[0]',
    }),
  },
  checks: {},
};

const f8829: FormMap = {
  template: 'forms/2025/f8829.pdf',
  numbers: 'irs',
  text: at(P1, {
    name: 'f1_01[0]',
    ssn: 'f1_02[0]',
    'f8829.1': 'f1_03[0]',
    'f8829.2': 'f1_04[0]',
    pct3: 'f1_05[0]',
    pct7: 'f1_09[0]',
    'f8829.8': 'Line8_ReadOrder[0].f1_10[0]',
    'f8829.10a': 'Table_Lines9-12[0].Line10[0].f1_13[0]',
    'f8829.10b': 'Table_Lines9-12[0].Line10[0].f1_14[0]',
    'f8829.11a': 'Table_Lines9-12[0].Line11[0].f1_15[0]',
    'f8829.11b': 'Table_Lines9-12[0].Line11[0].f1_16[0]',
    'f8829.12a': 'Table_Lines9-12[0].Line12[0].f1_17[0]',
    'f8829.12b': 'Table_Lines9-12[0].Line12[0].f1_18[0]',
    'f8829.13': 'f1_19[0]',
    'f8829.14': 'f1_20[0]',
    'f8829.15': 'f1_21[0]',
    'f8829.18a': 'Table_Lines16-23[0].Line18[0].f1_26[0]',
    'f8829.18b': 'Table_Lines16-23[0].Line18[0].f1_27[0]',
    'f8829.19a': 'Table_Lines16-23[0].Line19[0].f1_28[0]',
    'f8829.19b': 'Table_Lines16-23[0].Line19[0].f1_29[0]',
    'f8829.20a': 'Table_Lines16-23[0].Line20[0].f1_30[0]',
    'f8829.20b': 'Table_Lines16-23[0].Line20[0].f1_31[0]',
    'f8829.21a': 'Table_Lines16-23[0].Line21[0].f1_32[0]',
    'f8829.21b': 'Table_Lines16-23[0].Line21[0].f1_33[0]',
    'f8829.22a': 'Table_Lines16-23[0].Line22[0].f1_34[0]',
    'f8829.22b': 'Table_Lines16-23[0].Line22[0].f1_35[0]',
    'f8829.23a': 'Table_Lines16-23[0].Line23[0].f1_36[0]',
    'f8829.23b': 'Table_Lines16-23[0].Line23[0].f1_37[0]',
    'f8829.24': 'f1_38[0]',
    'f8829.25': 'f1_39[0]',
    'f8829.26': 'f1_40[0]',
    'f8829.27': 'f1_41[0]',
    'f8829.28': 'f1_42[0]',
    'f8829.30': 'f1_44[0]',
    'f8829.31': 'f1_45[0]',
    'f8829.32': 'f1_46[0]',
    'f8829.33': 'f1_47[0]',
    'f8829.34': 'f1_48[0]',
    'f8829.36': 'f1_50[0]',
    'f8829.37': 'f1_51[0]',
    'f8829.38': 'f1_52[0]',
    'f8829.39': 'f1_53[0]',
    'f8829.40': 'f1_54[0]',
    pct41: 'f1_55[0]',
    'f8829.42': 'f1_56[0]',
    'f8829.43': 'f1_57[0]',
    'f8829.44': 'f1_58[0]',
  }),
  checks: {},
};

const f7206: FormMap = {
  template: 'forms/2025/f7206.pdf',
  numbers: 'irs',
  text: at(P1, {
    name: 'f1_1[0]',
    ssn: 'f1_2[0]',
    'f7206.1': 'f1_3[0]',
    'f7206.2': 'f1_4[0]',
    'f7206.3': 'f1_5[0]',
    'f7206.4': 'f1_6[0]',
    'f7206.5': 'f1_7[0]',
    ratio6: 'f1_8[0]',
    'f7206.7': 'f1_9[0]',
    'f7206.8': 'f1_10[0]',
    'f7206.9': 'f1_11[0]',
    'f7206.10': 'f1_12[0]',
    'f7206.13': 'f1_15[0]',
    'f7206.14': 'f1_16[0]',
  }),
  checks: {},
};

export const FEDERAL_MAPS: Record<FederalFormId, FormMap> = {
  f1040,
  sch1,
  sch1A,
  sch2,
  sch3,
  schA,
  schB,
  schC,
  schD,
  f8949,
  schSE,
  f4797,
  f8995,
  f8995a,
  f8959,
  f8960,
  f8829,
  f7206,
};
