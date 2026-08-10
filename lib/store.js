import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// 저장소 어댑터.
//  - SUPABASE_URL + SUPABASE_SERVICE_KEY 가 있으면 Supabase(Postgres) 사용 (운영용)
//  - 없으면 로컬 JSON 파일 사용 (로컬 데모용 — Vercel 서버리스에선 영속되지 않음)

const useSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const FILE = path.join(process.cwd(), 'data', 'reports.json');

function supa() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

async function readFile() {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function writeFile(rows) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(rows, null, 2));
}

/**
 * 새 고발을 저장한다.
 * @param {{title:string, body:string, decision:string, categories:string[]}} report
 * @returns {Promise<{id:string, status:string}>}
 */
export async function insertReport({ title, body, decision, categories }) {
  const status = decision === 'approve' ? 'published' : decision === 'review' ? 'pending' : 'rejected';
  const row = {
    id: crypto.randomUUID(),
    title,
    body,           // 호출부에서 sealBody()로 봉인된 값
    status,
    categories,
    created_at: new Date().toISOString(),
  };

  if (useSupabase) {
    const { error } = await supa().from('reports').insert(row);
    if (error) throw new Error(`supabase insert: ${error.message}`);
  } else {
    const rows = await readFile();
    rows.push(row);
    await writeFile(rows);
  }
  return { id: row.id, status };
}

/** 공개(published)된 제목 목록만 반환 — 본문/카테고리는 노출하지 않는다. */
export async function listPublicTitles() {
  if (useSupabase) {
    const { data, error } = await supa()
      .from('reports')
      .select('id, title, created_at')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(`supabase select: ${error.message}`);
    return data;
  }
  const rows = await readFile();
  return rows
    .filter((r) => r.status === 'published')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(({ id, title, created_at }) => ({ id, title, created_at }));
}

/** 담당자 전용 — 보류/전체 항목을 본문 포함하여 반환. */
export async function listForAdmin(status) {
  if (useSupabase) {
    let q = supa().from('reports').select('*').order('created_at', { ascending: false }).limit(500);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new Error(`supabase admin select: ${error.message}`);
    return data;
  }
  const rows = await readFile();
  return rows
    .filter((r) => !status || r.status === status)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** 담당자 검수 후 상태 변경(승인/거절). */
export async function setStatus(id, status) {
  if (useSupabase) {
    const { error } = await supa().from('reports').update({ status }).eq('id', id);
    if (error) throw new Error(`supabase update: ${error.message}`);
    return;
  }
  const rows = await readFile();
  const row = rows.find((r) => r.id === id);
  if (row) {
    row.status = status;
    await writeFile(rows);
  }
}

export const storageBackend = useSupabase ? 'supabase' : 'file';
