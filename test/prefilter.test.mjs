import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefilter } from '../lib/prefilter.js';

test('통과: 익명화된 정상 제목', () => {
  const r = prefilter('특정 동아리 회비 사용 내역이 불투명합니다');
  assert.equal(r.blocked, false);
  assert.deepEqual(r.categories, []);
});

test('차단: 전화번호 포함', () => {
  const r = prefilter('제보합니다 010-1234-5678 로 연락주세요');
  assert.equal(r.blocked, true);
  assert.ok(r.categories.includes('personal_info'));
});

test('차단: 주민등록번호 포함', () => {
  const r = prefilter('학생 970101-1234567 관련 문제');
  assert.equal(r.blocked, true);
  assert.ok(r.categories.includes('personal_info'));
});

test('차단: 이메일 포함', () => {
  const r = prefilter('담당자 abc.def@school.ac.kr 비위');
  assert.equal(r.blocked, true);
  assert.ok(r.categories.includes('personal_info'));
});

test('차단: 학번 추정 숫자', () => {
  const r = prefilter('20231234 학생의 부정행위');
  assert.equal(r.blocked, true);
  assert.ok(r.categories.includes('personal_info'));
});

test('차단: 비속어(공백 우회 포함)', () => {
  assert.equal(prefilter('이건 진짜 병신같은 행정이다').blocked, true);
  assert.equal(prefilter('병 신 같은 처리').blocked, true);
});

test('통과: 일반 숫자는 오탐하지 않음', () => {
  assert.equal(prefilter('3학년 2학기 등록금 문제').blocked, false);
});
