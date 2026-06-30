# 철저히 비공개되는 학내 문제 고발 플랫폼 (MVP)

드라마 *참교육* 컨셉의 **익명 학내 고발 사이트**입니다.
공개되는 것은 **AI 중재를 통과한 제목뿐**이고, 본문과 작성자 신원은 지정 담당자만 열람합니다.

## 신뢰 모델

| 대상 | 공개 수준 |
|---|---|
| 고발 **제목** | AI 중재 통과 후 공개 |
| 고발 **본문/증거** | 봉인(암호화) 저장 · 담당자만 열람 |
| 작성자 **신원** | 수집하지 않음(로그인 없음) |

## 동작 흐름

```
제출 → [1차] 결정적 prefilter(개인정보·비속어 정규식)
     → [2차] Claude 제목 중재(명예훼손·혐오·관련성)
     → approve  : 제목 즉시 공개, 본문 봉인 저장
       review   : 담당자 검수 대기(미공개)
       reject   : 저장하지 않고 사유 + 익명화 제안 제목 반환
```

가장 엄격한 결과가 채택됩니다. **Claude 키가 없으면 모든 제출이 `review`로 안전 보류**됩니다(자동 공개 금지).

## 구조

```
index.html         제출 폼 + 공개 제목 피드 (블루드림 톤)
api/reports.js     GET 공개 제목 목록 / POST 제출(중재→저장)
api/admin.js       담당자 전용(GET 검수목록 / POST 승인·반려) — ADMIN_TOKEN 필요
lib/prefilter.js   결정적 1차 필터 (정규식·사전)
lib/moderation.js  Claude 제목 중재 (구조화 출력)
lib/crypto.js      본문 AES-256-GCM 봉인
lib/store.js       저장소 어댑터 (Supabase ↔ 로컬 파일)
db/schema.sql      Supabase 테이블 스키마
test/              prefilter 단위 테스트
```

## 로컬 실행

```bash
npm install
cp .env.example .env        # 키 입력(없어도 데모 동작)
npm test                    # 결정적 필터 테스트
npx vercel dev              # 로컬 서버 (api 함수 포함)
```

키가 전혀 없어도 `data/reports.json` 파일 저장 + `review` 보류로 화면 흐름을 확인할 수 있습니다.

## 배포 (Vercel)

1. 이 레포를 Vercel 프로젝트로 import (정적 + `/api` 서버리스 자동 인식)
2. **환경변수** 설정: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `REPORT_ENCRYPTION_KEY`, `ADMIN_TOKEN`
3. Supabase에서 `db/schema.sql` 실행

`REPORT_ENCRYPTION_KEY` 생성: `openssl rand -hex 32`

## 슈퍼 어드민(담당자) — 본문 열람 권한

본문은 오직 슈퍼 어드민만 `/api/admin`을 통해 복호화하여 볼 수 있습니다.

- 인증은 `ADMIN_TOKEN`(Bearer) = **슈퍼 어드민 암호**로 합니다.
- **암호는 반드시 20자 이상**이어야 합니다. 미설정이거나 20자 미만이면 관리 기능이 자동 비활성화(`503`)됩니다.
- 토큰 비교는 타이밍 공격에 안전한 `crypto.timingSafeEqual`로 수행합니다.
- 강력한 암호 생성: `openssl rand -base64 32`

## 담당자 대시보드(API)

```bash
# 검수 대기 목록(본문 복호화 포함)
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<host>/api/admin?status=pending
# 승인 / 반려
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
     -d '{"id":"<uuid>","action":"publish"}' https://<host>/api/admin
```

## 다음 단계(로드맵)

- 담당자용 웹 대시보드 화면(admin.html)
- 본문 봉인을 비대칭(libsodium sealed box)으로 업그레이드 → 운영자도 복호화 불가
- 어뷰징 방지: 제출 레이트리밋, IP 일방향 해시(원본 미저장)
- 신고 처리 상태 추적 + 피고발자 소명 절차

## ⚠️ 법적 고지

허위 사실 적시는 명예훼손 등 법적 책임을 수반할 수 있습니다. 실제 운영 전 학칙·관련 법령(정보통신망법 등) 검토와 학내 담당 부서 협의가 필요합니다.
