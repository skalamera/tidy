# Tidy

Tidy is a Mac app that prepares a 2025 federal return (Form 1040) and a Maryland resident return (Form 502) from your own tax documents. An AI you connect with your own API key (Anthropic Claude or Google Gemini) reads the documents. A deterministic tax engine computes every line, and Tidy fills the official IRS and Maryland PDF forms for you to print, sign and mail.

## How it works

1. Upload last year's return and this year's documents (W-2s, 1099s, SSA-1099, K-1s, brokerage statements).
2. Tidy reads each document and checks every amount against the PDF's own text. Amounts it can't check become questions.
3. Answer the questions no document can answer, then approve each step of the return.
4. Download one PDF: a cover page with what to sign, attach, pay and where to mail it, then the federal return, then the Maryland return. Payment vouchers are placed loose after their return.

Every amount on screen opens its formula and a link to the page of the document it came from. Ask Tidy (chat) explains lines and searches the official instructions, and it can only suggest a change: nothing changes until you press Accept, and every accepted change can be undone.

## What it covers

- Filing as single, married filing jointly or married filing separately, as a full-year Maryland resident.
- Wages, interest, dividends, OID, investment sales (Form 8949, Schedule D), pensions and IRAs, Social Security, unemployment and state refunds, one sole proprietorship (Schedule C, Schedule SE), rentals and K-1s (Schedule E, Forms 4562, 8582, 7203).
- Itemized deductions, the QBI deduction (8995, 8995-A), AMT (6251), the net investment income tax (8960), Additional Medicare Tax (8959), underpayment penalties (2210, Maryland 502UP), the 2025 senior deduction, and Maryland local tax, pension exclusion and senior credit.

When a return needs something outside this list (dependents, other states, part-year residency, Form 8606 IRA basis, two self-employed spouses, and similar), Tidy says so in one sentence and won't print the return. It doesn't guess.

Tidy files on paper only. E-file needs IRS and Maryland software approvals that Tidy doesn't have.

## Your data

- Everything stays on your Mac in `~/Library/Application Support/Tidy`, encrypted (AES-256-GCM) with a key kept in the macOS Keychain.
- Documents and chat messages are sent to the AI you connected, and only to it, to be read and answered. On Gemini's free tier, Google may use that data to improve its products; a paid key avoids that.
- Tidy saves after every change, flushed to disk. Every ten minutes of changes it keeps a copy of the previous save (the newest 20). If the save can't be read, Tidy opens the newest copy that can, and says so.
- File > Back Up My Return saves the return and its documents in one `.tidybackup` file locked with a passphrase you choose (scrypt and AES-256-GCM). File > Restore From Backup opens it on any Mac. Without the passphrase nobody can open it.
- The log is `~/Library/Application Support/Tidy/logs/tidy.log`. Text shaped like an API key is hidden.

## Development

```bash
npm install
npm run dev      # the app, with hot reload
npm run check    # typecheck, lint and every test
npm run format
```

- `scripts/fetch-forms.sh` downloads the official PDF forms and checks each against its pinned SHA-256.
- `npm run law:index` rebuilds the search index of the IRS and Maryland instructions that Ask Tidy uses.
- The original build plan is in [docs/plan.md](docs/plan.md).

## Building

- `npm run build:mac` makes a DMG for this Mac in `dist/`, signed ad hoc (`electron-builder.local.yml`). Gatekeeper blocks it on other Macs.
- `npm run release:mac` makes the DMG to distribute (`electron-builder.yml`): Developer ID signature, hardened runtime, notarization, and Electron fuses that stop the app running as plain Node, ignore `NODE_OPTIONS` and `--inspect`, and load only the signed `app.asar`. It runs `npm run check` first, then `scripts/release-preflight.mjs`, which stops early unless the keychain has a Developer ID Application certificate and notarization credentials are set: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`, or an App Store Connect API key, or `APPLE_KEYCHAIN_PROFILE`.
- Builds are for Apple silicon (arm64).
