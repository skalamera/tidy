import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

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
