const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 대기열 저장소 (메모리, 서버 재시작 시 초기화됨 - 프로토타입용)
let queue = [];
let nextId = 1;

// 관리자가 설정하는 값 (단일 업체 기준)
let settings = {
  businessName: '내 매장',
  noShowMinutes: 10,
};

function waitingEntries() {
  return queue.filter((e) => e.status === 'waiting').sort((a, b) => a.registeredAt - b.registeredAt);
}

function positionOf(entry) {
  const waiting = waitingEntries();
  return waiting.findIndex((e) => e.id === entry.id); // 0 = 내 차례, 1 = 1팀 남음 ...
}

// 대기 1등(내 차례)이 된 시점을 기록하고, 10분간 착석확인이 없으면 직원 개입 없이 자동 노쇼 처리
function refreshQueue() {
  const now = Date.now();
  const noShowMs = settings.noShowMinutes * 60 * 1000;
  for (const e of queue) {
    if (e.status === 'waiting' && e.becameFirstAt && now - e.becameFirstAt > noShowMs) {
      e.status = 'noshow';
    }
  }
  const waiting = waitingEntries();
  if (waiting.length > 0 && !waiting[0].becameFirstAt) {
    waiting[0].becameFirstAt = now;
  }
}

// 업체명/노쇼 제한시간 등 현재 설정 조회 (손님 화면에서도 업체명 표시에 사용)
app.get('/api/settings', (req, res) => {
  res.json(settings);
});

// 관리자: 업체명/노쇼 제한시간 설정 변경
app.post('/api/admin/settings', (req, res) => {
  const { businessName, noShowMinutes } = req.body;
  if (!businessName || !String(businessName).trim()) {
    return res.status(400).json({ error: '업체명을 입력해주세요.' });
  }
  const minutes = Number(noShowMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return res.status(400).json({ error: '노쇼 제한시간은 1분 이상의 숫자로 입력해주세요.' });
  }
  settings = { businessName: String(businessName).trim(), noShowMinutes: minutes };
  res.json(settings);
});

// 손님 셀프 등록
app.post('/api/register', (req, res) => {
  const { name, phone, partySize } = req.body;
  if (!name || !partySize) {
    return res.status(400).json({ error: 'name과 partySize는 필수입니다.' });
  }
  const entry = {
    id: nextId++,
    token: crypto.randomUUID(),
    name: String(name).trim(),
    phone: phone ? String(phone).trim() : '',
    partySize: Number(partySize),
    registeredAt: Date.now(),
    status: 'waiting',
    becameFirstAt: null,
  };
  queue.push(entry);
  res.json({ token: entry.token });
});

// 손님 본인 대기 현황 조회 (새로고침할 때마다 호출)
app.get('/api/status/:token', (req, res) => {
  refreshQueue();
  const entry = queue.find((e) => e.token === req.params.token);
  if (!entry) return res.status(404).json({ error: '등록 정보를 찾을 수 없습니다.' });

  if (entry.status !== 'waiting') {
    return res.json({
      name: entry.name,
      partySize: entry.partySize,
      status: entry.status,
      position: null,
      businessName: settings.businessName,
      noShowMinutes: settings.noShowMinutes,
    });
  }

  const position = positionOf(entry); // 앞에 남은 팀 수
  res.json({
    name: entry.name,
    partySize: entry.partySize,
    status: entry.status,
    position,
    businessName: settings.businessName,
    noShowMinutes: settings.noShowMinutes,
  });
});

// 손님 착석확인 (직원이 요청하면 손님이 직접 클릭)
app.post('/api/confirm/:token', (req, res) => {
  refreshQueue();
  const entry = queue.find((e) => e.token === req.params.token);
  if (!entry) return res.status(404).json({ error: '등록 정보를 찾을 수 없습니다.' });
  if (entry.status === 'waiting') entry.status = 'seated';
  res.json({ ok: true, status: entry.status });
});

// 직원용: 현재 대기열 목록 (읽기 전용 + 취소 처리)
app.get('/api/admin/queue', (req, res) => {
  refreshQueue();
  const waiting = waitingEntries().map((e, idx) => ({
    id: e.id,
    rank: idx + 1,
    name: e.name,
    phone: e.phone,
    partySize: e.partySize,
    waitingMinutes: Math.floor((Date.now() - e.registeredAt) / 60000),
  }));
  res.json({ queue: waiting });
});

// 직원용: 노쇼/취소 등으로 대기열에서 수동 제거
app.post('/api/admin/cancel/:id', (req, res) => {
  const entry = queue.find((e) => e.id === Number(req.params.id));
  if (!entry) return res.status(404).json({ error: '해당 항목을 찾을 수 없습니다.' });
  entry.status = 'cancelled';
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Waitlist app listening on http://localhost:${PORT}`);
});
