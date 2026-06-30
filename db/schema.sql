-- Supabase / Postgres 스키마
-- 본문(body)은 애플리케이션 계층에서 AES-256-GCM으로 봉인되어 저장된다.

create table if not exists reports (
  id          uuid primary key,
  title       text not null,                 -- 공개되는 제목(중재 통과분)
  body        text not null,                 -- 봉인된 본문 (enc:v1:...)
  status      text not null default 'pending',
              -- pending(검수대기) | published(공개) | rejected(반려)
  categories  jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists reports_status_created_idx
  on reports (status, created_at desc);

-- RLS: 서버는 service_role 키로 접근하므로 RLS를 켜고 익명 접근은 차단한다.
alter table reports enable row level security;
-- (anon 키로의 직접 접근 정책은 만들지 않음 → 모든 접근은 서버리스 함수 경유)
