const STATE_NAMES: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'puerto rico': 'PR',
};
const STATE_CODES = new Set(Object.values(STATE_NAMES));

/** A state as a form printed it ("MD", "Md.", "Maryland", "MD 12-3456789" with the employer's state id) as its
 *  two-letter code, or '' when it isn't one. Tax tables key on the code, so AI text never reaches them raw. */
export function stateCode(raw: string | null | undefined): string {
  if (!raw) return '';
  const t = raw.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const named = Object.keys(STATE_NAMES).find((n) => t === n || t.startsWith(`${n} `));
  if (named) return STATE_NAMES[named];
  const first = t.split(/[\s/|#:-]+/)[0]?.toUpperCase() ?? '';
  return STATE_CODES.has(first) ? first : '';
}

/** "Virginia" for "VA"; the code itself when it isn't a state. */
export function stateName(code: string): string {
  const name = Object.entries(STATE_NAMES).find(([, c]) => c === code)?.[0];
  return name ? name.replace(/\b\w/g, (ch) => ch.toUpperCase()).replace(' Of ', ' of ') : code;
}
