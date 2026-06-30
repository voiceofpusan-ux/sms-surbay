// 결정적(deterministic) 1차 필터.
// LLM 호출 전에 명백한 위반을 즉시 차단하고 비용을 아낀다.
// 정규식/사전 기반이므로 LLM 우회 공격에도 항상 동작하는 안전망 역할.

// 개인정보 패턴 — 제목에 절대 노출되면 안 되는 특정 가능 정보
const PII_PATTERNS = [
  { key: 'phone', re: /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/ },
  { key: 'rrn', re: /\b\d{6}[-\s]?[1-4]\d{6}\b/ },            // 주민등록번호
  { key: 'email', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { key: 'student_id', re: /\b(?:20\d{2})\d{4,8}\b/ },         // 학번 추정(20YY로 시작하는 긴 숫자)
];

// 욕설/비속어 최소 사전(예시). 운영 시 외부 사전/서비스로 확장 권장.
const PROFANITY = [
  '씨발', '시발', 'ㅅㅂ', '병신', 'ㅂㅅ', '새끼', '새퀴', '좆', '좇',
  '지랄', '개새', '미친놈', '미친년', '창녀', '걸레', '닥쳐', '꺼져',
];

function normalize(text) {
  // 자모 분리/공백 삽입 우회를 일부 완화
  return text.replace(/\s+/g, '').toLowerCase();
}

/**
 * @param {string} title
 * @returns {{ blocked: boolean, categories: string[], matched: string[] }}
 */
export function prefilter(title) {
  const categories = new Set();
  const matched = [];
  const flat = normalize(title);

  for (const { key, re } of PII_PATTERNS) {
    if (re.test(title)) {
      categories.add('personal_info');
      matched.push(key);
    }
  }

  for (const word of PROFANITY) {
    if (flat.includes(normalize(word))) {
      categories.add('profanity');
      matched.push(word);
      break;
    }
  }

  return {
    blocked: categories.size > 0,
    categories: [...categories],
    matched,
  };
}
