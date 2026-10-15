const VALUES: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** Why a vehicle identification number can't be right, or null. Only vehicles assembled in the U.S. qualify for the
 *  car loan interest deduction, and their VINs carry a check digit in position 9 (49 CFR 565.15). */
export function vinProblem(vin: string): string | null {
  const v = vin.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return 'should be 17 letters and digits, without I, O or Q';
  const sum = [...v].reduce((t, ch, i) => t + (/\d/.test(ch) ? Number(ch) : VALUES[ch]!) * WEIGHTS[i]!, 0);
  const check = sum % 11 === 10 ? 'X' : String(sum % 11);
  return v[8] === check ? null : 'doesn’t pass the VIN check digit, so a character is probably mistyped';
}
