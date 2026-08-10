import crypto from 'node:crypto';
import { listForAdmin, setStatus } from '../lib/store.js';
import { openBody } from '../lib/crypto.js';

// 슈퍼 어드민(담당자) 전용 엔드포인트. ADMIN_TOKEN(Bearer)로 보호한다.
// 본문은 이 경로를 통해서만, 인증된 담당자에게만 복호화되어 전달된다.

// 슈퍼 어드민 암호 최소 길이. 이보다 짧으면 관리 기능 자체가 비활성화된다.
const MIN_TOKEN_LENGTH = 20;

/** 설정된 ADMIN_TOKEN이 정책(20자 이상)을 만족하는지 */
export function isAdminConfigured() {
  const token = process.env.ADMIN_TOKEN;
  return typeof token === 'string' && token.length >= MIN_TOKEN_LENGTH;
}

/** 타이밍 공격에 안전한 문자열 비교 */
function safeEqual(a, b) {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function authorized(req) {
  // 토큰 미설정 또는 20자 미만이면 관리 기능 비활성화(인증 거부).
  if (!isAdminConfigured()) return false;
  const header = req.headers['authorization'] || '';
  return safeEqual(header, `Bearer ${process.env.ADMIN_TOKEN}`);
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  if (!isAdminConfigured()) {
    return res.status(503).json({
      error: '관리 기능이 비활성화되어 있습니다. 슈퍼 어드민 암호(ADMIN_TOKEN)를 20자 이상으로 설정하세요.',
    });
  }
  if (!authorized(req)) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }
  try {
    if (req.method === 'GET') {
      const status = req.query?.status || 'pending';
      const rows = await listForAdmin(status === 'all' ? null : status);
      // 담당자에게만 본문 복호화 후 전달
      const items = rows.map((r) => ({ ...r, body: safeOpen(r.body) }));
      return res.status(200).json({ items });
    }

    if (req.method === 'POST') {
      const { id, action } = await readJson(req);
      if (!id || !['publish', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'id와 action(publish|reject)이 필요합니다.' });
      }
      await setStatus(id, action === 'publish' ? 'published' : 'rejected');
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('admin handler error:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}

function safeOpen(body) {
  try {
    return openBody(body);
  } catch {
    return '[복호화 실패 — REPORT_ENCRYPTION_KEY 확인 필요]';
  }
}
