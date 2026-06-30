import crypto from 'node:crypto';

// 본문 봉인(at-rest 암호화). REPORT_ENCRYPTION_KEY(32바이트 hex/base64)가 있으면
// AES-256-GCM으로 암호화하여 저장한다. 키가 없으면 평문 저장(MVP, README에 명시).
// ※ 업그레이드 경로: libsodium sealed box(비대칭)로 바꾸면 운영자도 복호화 불가하게 만들 수 있다.

function getKey() {
  const raw = process.env.REPORT_ENCRYPTION_KEY;
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('REPORT_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return buf;
}

export function isEncryptionEnabled() {
  return !!process.env.REPORT_ENCRYPTION_KEY;
}

/** @returns {string} "enc:v1:<iv>:<tag>:<ciphertext>" 또는 평문 */
export function sealBody(plaintext) {
  const key = getKey();
  if (!key) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** @returns {string} 복호화된 평문 */
export function openBody(stored) {
  if (typeof stored !== 'string' || !stored.startsWith('enc:v1:')) return stored;
  const key = getKey();
  if (!key) throw new Error('암호화된 본문이지만 REPORT_ENCRYPTION_KEY가 없습니다');
  const [, , ivB64, tagB64, ctB64] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
