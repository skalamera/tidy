import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { open as openFile, rename } from 'node:fs/promises';
import path from 'node:path';

const MAGIC = Buffer.from('TIDY1');
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM. Output = "TIDY1" | iv(12) | tag(16) | ciphertext. Tampering makes open() throw. */
export function seal(key: Buffer, plain: Buffer): Buffer {
  if (key.length !== 32) throw new Error('seal(): key must be 32 bytes');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function open(key: Buffer, sealed: Buffer): Buffer {
  if (!sealed.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('open(): not a Tidy vault file');
  const iv = sealed.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = sealed.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
  const body = sealed.subarray(MAGIC.length + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/** Saves `plain` sealed to `file` atomically and durably: a temp file first, flushed to disk, then a rename (and the
 *  folder flushed too), so neither a crash nor a power cut leaves half a file or an old one. */
export async function writeSealed(file: string, k: Buffer, plain: Buffer): Promise<void> {
  await writeDurably(file, seal(k, plain));
}

/** Atomic, flushed write of bytes that are already sealed (backups copy sealed files as they are). */
export async function writeDurably(file: string, bytes: Buffer): Promise<void> {
  const tmp = `${file}.tmp`;
  const fh = await openFile(tmp, 'w');
  try {
    await fh.writeFile(bytes);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, file);
  try {
    const dir = await openFile(path.dirname(file), 'r');
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } catch {
    // Not every file system can flush a folder; the file itself is already on disk.
  }
}

const BACKUP_MAGIC = Buffer.from('TIDYBK1');
const SALT_BYTES = 16;
/** scrypt cost for passphrase backups: about 0.1 s on a recent Mac, 32 MiB of memory. */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const MIN_PASSPHRASE = 10;

function passphraseKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(passphrase.normalize('NFKC'), salt, 32, SCRYPT, (e, k) => (e ? reject(e) : resolve(k))));
}

/** A backup file anyone can move to another Mac: "TIDYBK1" | salt(16) | seal(scrypt(passphrase, salt), plain). */
export async function sealWithPassphrase(passphrase: string, plain: Buffer): Promise<Buffer> {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`The passphrase needs at least ${MIN_PASSPHRASE} characters.`);
  const salt = randomBytes(SALT_BYTES);
  return Buffer.concat([BACKUP_MAGIC, salt, seal(await passphraseKey(passphrase, salt), plain)]);
}

export class WrongPassphraseError extends Error {}

export async function openWithPassphrase(passphrase: string, file: Buffer): Promise<Buffer> {
  if (!file.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) throw new WrongPassphraseError('That file isn’t a Tidy backup.');
  const salt = file.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + SALT_BYTES);
  try {
    return open(await passphraseKey(passphrase, salt), file.subarray(BACKUP_MAGIC.length + SALT_BYTES));
  } catch {
    throw new WrongPassphraseError('That passphrase doesn’t open this backup.');
  }
}

/** Minimal slice of Electron's safeStorage, so tests can pass a fake. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Loads the 32-byte data key, creating it on first run. The key file itself is encrypted by the
 *  macOS Keychain via safeStorage, so copying the app's folder to another Mac yields nothing readable. */
export async function loadOrCreateDataKey(
  keyFile: string,
  safe: SafeStorageLike,
  fs: { readFile(p: string): Promise<Buffer>; writeFile(p: string, b: Buffer): Promise<void> },
): Promise<Buffer> {
  if (!safe.isEncryptionAvailable()) throw new Error('macOS Keychain encryption is not available');
  try {
    return Buffer.from(safe.decryptString(await fs.readFile(keyFile)), 'base64');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const key = randomBytes(32);
    await fs.writeFile(keyFile, safe.encryptString(key.toString('base64')));
    return key;
  }
}
