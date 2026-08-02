# 매장 대기열(웨이팅) 관리 시스템

문자(SMS) 발송 없이, 웹페이지로만 대기 순서를 확인하는 방식의 매장 대기열 시스템입니다.

## 동작 방식

1. **손님 셀프 등록**: 매장 입구 QR코드(또는 링크)로 접속 → 이름/인원수 입력 후 등록 → 본인 전용 확인 페이지로 이동
2. **대기 확인**: 손님이 원할 때(예: 차 안에서) 새로고침 버튼을 누르면 "내 앞에 O팀 대기 중"인지 최신 상태로 확인
   - 앞에 1팀 남으면 "대기손님이 1명입니다, 입장 준비해주세요" 강조 표시
   - 내 차례가 되면 "지금 입장하실 차례입니다" 표시
3. **착석확인**: 손님이 실제로 매장에 착석한 뒤, 직원 안내에 따라 본인이 직접 "착석확인" 버튼 클릭 → 대기열에서 제거되고 뒷사람 순번이 자동으로 당겨짐
4. **직원 화면**: 대기열 목록을 읽기 전용으로 확인. "다음 손님 호출" 같은 액션은 없으며(순번은 손님의 착석확인으로만 줄어듦), 연락 두절/노쇼 손님만 수동으로 취소 처리

## 실행 방법

```bash
npm install
npm start
```

- 손님 등록 페이지: `http://localhost:3000/index.html`
- 직원 관리 화면: `http://localhost:3000/admin.html`

## 저장소 (로컬 메모리 vs Supabase)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 환경변수가 없으면 메모리에만 저장합니다(로컬 개발용, 서버 재시작 시 초기화됨).
두 환경변수를 설정하면 자동으로 Supabase(Postgres)에 저장하도록 전환되어, Vercel/Netlify 같은 서버리스 환경에 배포해도 대기열 데이터가 유지됩니다.

### Supabase 설정 방법

1. https://supabase.com 에서 새 프로젝트 생성
2. 프로젝트의 SQL Editor에서 아래 스크립트 실행

```sql
create table waitlist_entries (
  id bigint generated always as identity primary key,
  token uuid not null default gen_random_uuid(),
  name text not null,
  phone text default '',
  party_size int not null,
  visitor_id text,
  registered_at timestamptz not null default now(),
  became_first_at timestamptz,
  status text not null default 'waiting'
);

create table waitlist_settings (
  id int primary key default 1,
  business_name text not null default '내 매장',
  no_show_minutes int not null default 10,
  closing_time text not null default '23:59'
);

insert into waitlist_settings (id, business_name, no_show_minutes, closing_time)
values (1, '내 매장', 10, '23:59')
on conflict (id) do nothing;
```

3. 프로젝트 설정(Project Settings → API)에서 **Project URL**과 **service_role 키**를 확인
4. 배포 환경(Vercel/Netlify 등)의 환경변수에 아래 두 값을 등록

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

`service_role` 키는 서버(`server.js`)에서만 사용되며 브라우저로 노출되지 않습니다. 절대 프론트엔드 코드나 공개 저장소에 직접 커밋하지 마세요.

### 기존에 Supabase를 이미 연결해두었다면 (마이그레이션)

방문자 재방문 집계, 영업 마감 자동 취소 기능을 위해 컬럼이 추가되었습니다. 이미 위 테이블을 만들어두셨다면, SQL Editor에서 아래 스크립트를 한 번 실행해주세요 (기존 데이터는 유지됩니다).

```sql
alter table waitlist_entries add column if not exists visitor_id text;
alter table waitlist_settings add column if not exists closing_time text not null default '23:59';
```
