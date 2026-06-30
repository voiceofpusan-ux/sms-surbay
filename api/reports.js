import { moderateTitle } from '../lib/moderation.js';
import { sealBody } from '../lib/crypto.js';
import { insertReport, listPublicTitles } from '../lib/store.js';

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const titles = await listPublicTitles();
      return res.status(200).json({ titles });
    }

    if (req.method === 'POST') {
      const { title = '', body = '' } = await readJson(req);
      const t = String(title).trim();
      const b = String(body).trim();

      if (t.length < 4 || t.length > 80) {
        return res.status(400).json({ error: '제목은 4~80자로 입력해 주세요.' });
      }
      if (b.length < 10) {
        return res.status(400).json({ error: '본문(고발 내용)을 10자 이상 입력해 주세요.' });
      }

      const verdict = await moderateTitle(t);

      if (verdict.decision === 'reject') {
        // 거절은 저장하지 않고 즉시 사유 + 대안 제목을 돌려준다.
        return res.status(200).json({
          decision: 'reject',
          reason: verdict.reason,
          rewrite_suggestion: verdict.rewrite_suggestion,
        });
      }

      const saved = await insertReport({
        title: t,
        body: sealBody(b),
        decision: verdict.decision,
        categories: verdict.categories,
      });

      return res.status(201).json({
        decision: verdict.decision,         // 'approve' → 즉시 공개, 'review' → 검수 대기
        status: saved.status,
        reason: verdict.reason,
        rewrite_suggestion: verdict.rewrite_suggestion,
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('reports handler error:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}
