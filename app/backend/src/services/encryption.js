import crypto from 'crypto';

// AES-256-GCM at-rest encryption for sensitive fields (e.g. bank account numbers).
// Uses DATA_ENC_KEY (64 hex chars = 32 bytes), falling back to SMTP_ENC_KEY for
// backwards compatibility. If neither is set, values are stored in plaintext.
const KEY_HEX = process.env.DATA_ENC_KEY || process.env.SMTP_ENC_KEY || null;

function key() {
  if (!KEY_HEX) return null;
  try {
    return Buffer.from(KEY_HEX, 'hex');
  } catch {
    return null;
  }
}

export function isEncryptionEnabled() {
  return key() !== null;
}

export function encryptSecret(plain) {
  if (plain === null || plain === undefined) return null;
  const k = key();
  if (!k) return String(plain); // encryption disabled — store as-is
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(stored) {
  if (!stored) return null;
  const k = key();
  if (!k) return String(stored); // encryption disabled — value is plaintext
  const parts = String(stored).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const enc = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
