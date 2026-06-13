import crypto from 'crypto';
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { loadEnvConfig } from '../config/envConfig.js';

type EncPayload =
  | { v: 1; alg: 'kms'; kmsKeyId: string; ct: string }
  | { v: 1; alg: 'aes-256-gcm'; iv: string; tag: string; ct: string };

function isLikelyBase64(s: string): boolean {
  // Cheap check; we don't need strict validation.
  return /^[A-Za-z0-9+/=]+$/.test(s) && s.length % 4 === 0;
}

function getLocalKey(): Buffer {
  const env = loadEnvConfig();
  const raw = (env.APP_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    throw new Error('APP_ENCRYPTION_KEY is required when KMS_KEY_ID is not configured.');
  }
  const buf = isLikelyBase64(raw) ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8');
  if (buf.length < 32) {
    throw new Error('APP_ENCRYPTION_KEY must be at least 32 bytes (base64 or utf8).');
  }
  return buf.subarray(0, 32);
}

function kmsClient(): KMSClient {
  // Relies on AWS_REGION/AWS credentials in Lambda.
  return new KMSClient({});
}

export async function encryptJson(obj: unknown): Promise<string> {
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const env = loadEnvConfig();
  const kmsKeyId = (env.KMS_KEY_ID || '').trim();

  if (kmsKeyId) {
    const r = await kmsClient().send(
      new EncryptCommand({
        KeyId: kmsKeyId,
        Plaintext: plaintext,
      })
    );
    if (!r.CiphertextBlob) throw new Error('KMS encrypt failed (no ciphertext).');
    const payload: EncPayload = {
      v: 1,
      alg: 'kms',
      kmsKeyId,
      ct: Buffer.from(r.CiphertextBlob).toString('base64'),
    };
    return JSON.stringify(payload);
  }

  // Local/dev fallback: AES-256-GCM with APP_ENCRYPTION_KEY
  const key = getLocalKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: EncPayload = {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  };
  return JSON.stringify(payload);
}

export async function decryptJson<T = any>(enc: string): Promise<T> {
  let payload: EncPayload;
  try {
    payload = JSON.parse(enc);
  } catch {
    throw new Error('Invalid encrypted payload (not JSON).');
  }
  if (!payload || (payload as any).v !== 1) {
    throw new Error('Unsupported encrypted payload version.');
  }

  if (payload.alg === 'kms') {
    const r = await kmsClient().send(
      new DecryptCommand({
        CiphertextBlob: Buffer.from(payload.ct, 'base64'),
      })
    );
    if (!r.Plaintext) throw new Error('KMS decrypt failed (no plaintext).');
    return JSON.parse(Buffer.from(r.Plaintext).toString('utf8')) as T;
  }

  if (payload.alg === 'aes-256-gcm') {
    const key = getLocalKey();
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const ct = Buffer.from(payload.ct, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString('utf8')) as T;
  }

  throw new Error('Unsupported encryption algorithm.');
}

