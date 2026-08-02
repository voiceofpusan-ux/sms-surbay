const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const useSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const supabase = useSupabase ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 없으면(로컬 개발) 메모리에만 저장한다.
// 서버리스(Vercel/Netlify)에 배포할 때는 반드시 두 환경변수를 설정해야 대기열이 유지된다.
let memEntries = [];
let memNextId = 1;
let memSettings = { businessName: '내 매장', noShowMinutes: 10, closingTime: '22:00' };

function mapRow(row) {
  return {
    id: row.id,
    token: row.token,
    name: row.name,
    phone: row.phone,
    partySize: row.party_size,
    visitorId: row.visitor_id || null,
    registeredAt: new Date(row.registered_at).getTime(),
    becameFirstAt: row.became_first_at ? new Date(row.became_first_at).getTime() : null,
    status: row.status,
  };
}

async function getSettings() {
  if (!useSupabase) return { ...memSettings };
  const { data, error } = await supabase.from('waitlist_settings').select('*').eq('id', 1).single();
  if (error) throw error;
  return {
    businessName: data.business_name,
    noShowMinutes: data.no_show_minutes,
    closingTime: data.closing_time || '22:00',
  };
}

async function updateSettings({ businessName, noShowMinutes, closingTime }) {
  if (!useSupabase) {
    memSettings = { businessName, noShowMinutes, closingTime };
    return { ...memSettings };
  }
  const { data, error } = await supabase
    .from('waitlist_settings')
    .update({ business_name: businessName, no_show_minutes: noShowMinutes, closing_time: closingTime })
    .eq('id', 1)
    .select()
    .single();
  if (error) throw error;
  return {
    businessName: data.business_name,
    noShowMinutes: data.no_show_minutes,
    closingTime: data.closing_time || '22:00',
  };
}

async function insertEntry({ name, phone, partySize, visitorId }) {
  if (!useSupabase) {
    const entry = {
      id: memNextId++,
      token: crypto.randomUUID(),
      name,
      phone: phone || '',
      partySize,
      visitorId: visitorId || null,
      registeredAt: Date.now(),
      becameFirstAt: null,
      status: 'waiting',
    };
    memEntries.push(entry);
    return entry;
  }
  const { data, error } = await supabase
    .from('waitlist_entries')
    .insert({ name, phone: phone || '', party_size: partySize, visitor_id: visitorId || null, status: 'waiting' })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

async function getEntryByToken(token) {
  if (!useSupabase) return memEntries.find((e) => e.token === token) || null;
  const { data, error } = await supabase.from('waitlist_entries').select('*').eq('token', token).maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

async function getEntryById(id) {
  if (!useSupabase) return memEntries.find((e) => e.id === id) || null;
  const { data, error } = await supabase.from('waitlist_entries').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

// status === 'waiting'인 항목을 등록 순서대로 정렬해 반환
async function getWaitingEntries() {
  if (!useSupabase) {
    return memEntries.filter((e) => e.status === 'waiting').sort((a, b) => a.registeredAt - b.registeredAt);
  }
  const { data, error } = await supabase
    .from('waitlist_entries')
    .select('*')
    .eq('status', 'waiting')
    .order('registered_at', { ascending: true });
  if (error) throw error;
  return data.map(mapRow);
}

async function updateEntry(id, updates) {
  if (!useSupabase) {
    const entry = memEntries.find((e) => e.id === id);
    if (entry) Object.assign(entry, updates);
    return entry || null;
  }
  const dbUpdates = {};
  if ('status' in updates) dbUpdates.status = updates.status;
  if ('becameFirstAt' in updates) {
    dbUpdates.became_first_at = updates.becameFirstAt ? new Date(updates.becameFirstAt).toISOString() : null;
  }
  const { data, error } = await supabase.from('waitlist_entries').update(dbUpdates).eq('id', id).select().single();
  if (error) throw error;
  return mapRow(data);
}

// 손님이 이전에 착석 완료(seated)한 횟수. 연락처가 있으면 연락처로, 없으면 방문자 ID(브라우저 기준)로 집계한다.
async function countPastVisits({ phone, visitorId }) {
  if (phone) {
    if (!useSupabase) return memEntries.filter((e) => e.status === 'seated' && e.phone === phone).length;
    const { count, error } = await supabase
      .from('waitlist_entries')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'seated')
      .eq('phone', phone);
    if (error) throw error;
    return count || 0;
  }
  if (visitorId) {
    if (!useSupabase) return memEntries.filter((e) => e.status === 'seated' && e.visitorId === visitorId).length;
    const { count, error } = await supabase
      .from('waitlist_entries')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'seated')
      .eq('visitor_id', visitorId);
    if (error) throw error;
    return count || 0;
  }
  return 0;
}

module.exports = {
  useSupabase,
  getSettings,
  updateSettings,
  insertEntry,
  getEntryByToken,
  getEntryById,
  getWaitingEntries,
  updateEntry,
  countPastVisits,
};
