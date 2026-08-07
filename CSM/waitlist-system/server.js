const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function positionOf(waitingEntries, entry) {
  return waitingEntries.findIndex((e) => e.id === entry.id); // 0 = 내 차례, 1 = 1팀 남음 ...
}

// 서버가 어느 지역에 배포되든(Vercel 등) 마감시간은 한국시간(KST) 기준으로 판단한다.
function isPastClosingTime(closingTime) {
  if (!closingTime || !/^\d{1,2}:\d{2}$/.test(closingTime)) return false;
  const [h, m] = closingTime.split(':').map(Number);
  const closingMinutes = h * 60 + m;

  const now = new Date();
  const kstMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 9 * 60) % (24 * 60);

  return kstMinutes >= closingMinutes;
}

// 대기 1등(내 차례)이 된 시점을 기록하고, 노쇼 제한시간이 지나면 직원 개입 없이 자동 노쇼 처리.
// 영업 마감 시간이 지나면 남아있는 대기를 전부 자동 취소한다(다음 영업일에는 새로 시작).
async function refreshQueue() {
  const now = Date.now();
  const settings = await db.getSettings();

  if (isPastClosingTime(settings.closingTime)) {
    const waiting = await db.getWaitingEntries();
    for (const e of waiting) {
      await db.updateEntry(e.id, { status: 'closed' });
    }
    return;
  }

  const noShowMs = settings.noShowMinutes * 60 * 1000;
  const waiting = await db.getWaitingEntries();
  for (const e of waiting) {
    if (e.becameFirstAt && now - e.becameFirstAt > noShowMs) {
      await db.updateEntry(e.id, { status: 'noshow' });
    }
  }

  const stillWaiting = await db.getWaitingEntries();
  if (stillWaiting.length > 0 && !stillWaiting[0].becameFirstAt) {
    await db.updateEntry(stillWaiting[0].id, { becameFirstAt: now });
  }
}

function handleError(res, err) {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
}

// 업체명/노쇼 제한시간 등 현재 설정 조회 (손님 화면에서도 업체명 표시에 사용)
app.get('/api/settings', async (req, res) => {
  try {
    res.json(await db.getSettings());
  } catch (err) {
    handleError(res, err);
  }
});

// 관리자: 업체명/노쇼 제한시간/영업 마감 시간 설정 변경
app.post('/api/admin/settings', async (req, res) => {
  try {
    const { businessName, noShowMinutes, closingTime } = req.body;
    if (!businessName || !String(businessName).trim()) {
      return res.status(400).json({ error: '업체명을 입력해주세요.' });
    }
    const minutes = Number(noShowMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return res.status(400).json({ error: '노쇼 제한시간은 1분 이상의 숫자로 입력해주세요.' });
    }
    if (!closingTime || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(closingTime)) {
      return res.status(400).json({ error: '영업 마감 시간은 HH:MM 형식으로 입력해주세요.' });
    }
    res.json(
      await db.updateSettings({ businessName: String(businessName).trim(), noShowMinutes: minutes, closingTime })
    );
  } catch (err) {
    handleError(res, err);
  }
});

// 손님 셀프 등록
app.post('/api/register', async (req, res) => {
  try {
    const { name, phone, partySize, visitorId } = req.body;
    if (!name || !partySize) {
      return res.status(400).json({ error: 'name과 partySize는 필수입니다.' });
    }
    const trimmedPhone = phone ? String(phone).trim() : '';
    const pastVisits = await db.countPastVisits({ phone: trimmedPhone, visitorId });
    const entry = await db.insertEntry({
      name: String(name).trim(),
      phone: trimmedPhone,
      partySize: Number(partySize),
      visitorId,
    });
    res.json({ token: entry.token, visitCount: pastVisits + 1 });
  } catch (err) {
    handleError(res, err);
  }
});

// 손님 본인 대기 현황 조회 (새로고침할 때마다 호출)
app.get('/api/status/:token', async (req, res) => {
  try {
    await refreshQueue();
    const entry = await db.getEntryByToken(req.params.token);
    if (!entry) return res.status(404).json({ error: '등록 정보를 찾을 수 없습니다.' });

    const settings = await db.getSettings();

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

    const waiting = await db.getWaitingEntries();
    const position = positionOf(waiting, entry); // 앞에 남은 팀 수
    res.json({
      name: entry.name,
      partySize: entry.partySize,
      status: entry.status,
      position,
      businessName: settings.businessName,
      noShowMinutes: settings.noShowMinutes,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// 손님 착석확인 (직원이 요청하면 손님이 직접 클릭)
app.post('/api/confirm/:token', async (req, res) => {
  try {
    await refreshQueue();
    const entry = await db.getEntryByToken(req.params.token);
    if (!entry) return res.status(404).json({ error: '등록 정보를 찾을 수 없습니다.' });
    if (entry.status === 'waiting') {
      await db.updateEntry(entry.id, { status: 'seated' });
      return res.json({ ok: true, status: 'seated' });
    }
    res.json({ ok: true, status: entry.status });
  } catch (err) {
    handleError(res, err);
  }
});

// 직원용: 현재 대기열 목록 (읽기 전용 + 취소 처리)
app.get('/api/admin/queue', async (req, res) => {
  try {
    await refreshQueue();
    const waiting = await db.getWaitingEntries();
    const now = Date.now();
    res.json({
      queue: waiting.map((e, idx) => ({
        id: e.id,
        rank: idx + 1,
        name: e.name,
        phone: e.phone,
        partySize: e.partySize,
        waitingMinutes: Math.floor((now - e.registeredAt) / 60000),
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// 직원용: 노쇼/취소 등으로 대기열에서 수동 제거
app.post('/api/admin/cancel/:id', async (req, res) => {
  try {
    const entry = await db.getEntryById(Number(req.params.id));
    if (!entry) return res.status(404).json({ error: '해당 항목을 찾을 수 없습니다.' });
    await db.updateEntry(entry.id, { status: 'cancelled' });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// 메뉴 조회 (손님/직원 공용 - 손님 화면에서는 대기 중 메뉴 미리보기로 사용)
app.get('/api/menu', async (req, res) => {
  try {
    res.json({ menu: await db.getMenuItems() });
  } catch (err) {
    handleError(res, err);
  }
});

// 관리자: 메뉴 추가
app.post('/api/admin/menu', async (req, res) => {
  try {
    const { name, price } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: '메뉴명을 입력해주세요.' });
    }
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ error: '가격은 0 이상의 숫자로 입력해주세요.' });
    }
    const item = await db.insertMenuItem({ name: String(name).trim(), price: priceNum });
    res.json(item);
  } catch (err) {
    handleError(res, err);
  }
});

// 관리자: 메뉴 수정 (이름/가격/판매상태)
app.post('/api/admin/menu/:id', async (req, res) => {
  try {
    const { name, price, available } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: '메뉴명을 입력해주세요.' });
    }
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ error: '가격은 0 이상의 숫자로 입력해주세요.' });
    }
    const item = await db.updateMenuItem(Number(req.params.id), {
      name: String(name).trim(),
      price: priceNum,
      available: Boolean(available),
    });
    if (!item) return res.status(404).json({ error: '해당 메뉴를 찾을 수 없습니다.' });
    res.json(item);
  } catch (err) {
    handleError(res, err);
  }
});

// 관리자: 메뉴 삭제
app.delete('/api/admin/menu/:id', async (req, res) => {
  try {
    await db.deleteMenuItem(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// Vercel 등 서버리스 환경에서는 app을 그대로 핸들러로 사용하고, 로컬(node server.js)에서만 listen한다.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Waitlist app listening on http://localhost:${PORT}`);
    console.log(`Storage backend: ${db.useSupabase ? 'Supabase' : 'in-memory (dev only)'}`);
  });
}

module.exports = app;
