// Checks what a release build needs before spending minutes on it: a Developer ID certificate and notarization
// credentials. Prints only what is missing, never the values.
import { execFileSync } from 'node:child_process';

const env = process.env;
const problems = [];
let identities = '';
try {
  identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
} catch {
  problems.push('Couldn’t list the signing identities in the keychain (this needs a Mac).');
}
if (!env.CSC_LINK && !env.CSC_NAME && !/Developer ID Application/.test(identities))
  problems.push('There is no “Developer ID Application” certificate in the keychain, and CSC_LINK isn’t set.');
const notarize =
  (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) ||
  (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) ||
  env.APPLE_KEYCHAIN_PROFILE;
if (!notarize)
  problems.push(
    'There are no notarization credentials. Set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID, or APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER, or APPLE_KEYCHAIN_PROFILE.',
  );
if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') problems.push('CSC_IDENTITY_AUTO_DISCOVERY is false, so nothing would be signed.');
if (problems.length > 0) {
  console.error(`A release build can’t be made yet:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('Release preflight passed: signing identity and notarization credentials found.');
