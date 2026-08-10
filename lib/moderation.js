import Anthropic from '@anthropic-ai/sdk';
import { prefilter } from './prefilter.js';

// 비용/속도 최적화를 위해 기본은 Haiku. 까다로운 운영에선 env로 Opus 교체 가능.
const MODEL = process.env.MODERATION_MODEL || 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `당신은 학내 문제 고발 사이트의 엄격한 AI 중재자입니다.
게시판에는 '제목'만 공개되고 본문과 작성자 신원은 철저히 비공개됩니다.
따라서 제목 단계에서 다음을 막는 것이 핵심 임무입니다.

[reject — 즉시 차단]
- 특정 개인을 식별 가능한 정보(실명, 학번, 연락처, 사진 설명 등)
- 욕설·혐오·차별·성희롱 표현
- 명백한 허위/조롱/장난/스팸, 고발과 무관한 내용

[review — 사람 검수 보류]
- 명예훼손 소지가 있으나 공익 제보일 수도 있는 애매한 경우
- 특정 직책/별명으로 사람을 추정 가능하게 하는 경우
- 사실 여부 판단이 필요한 민감한 주장

[approve — 통과]
- 개인 식별 없이 사안/문제만 드러내는 익명화된 제목

판정이 reject/review이면, 공개 가능하도록 익명화한 대안 제목을 rewrite_suggestion에 제시하세요.
대안 제목은 실명·직책·식별정보를 제거하고 문제의 성격만 남겨야 합니다.
한국어로 간결하게 작성하세요.`;

const DECISION_TOOL = {
  name: 'record_decision',
  description: '제목에 대한 중재 판정을 기록한다.',
  input_schema: {
    type: 'object',
    properties: {
      decision: {
        type: 'string',
        enum: ['approve', 'review', 'reject'],
        description: '최종 판정',
      },
      categories: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['personal_info', 'profanity', 'hate', 'harassment', 'defamation', 'spam', 'irrelevant', 'none'],
        },
        description: '해당하는 위반 카테고리(없으면 ["none"])',
      },
      reason: { type: 'string', description: '판정 이유(작성자에게 보여줄 수 있는 한 문장)' },
      rewrite_suggestion: {
        type: 'string',
        description: 'reject/review일 때 익명화한 대안 제목. approve면 빈 문자열.',
      },
    },
    required: ['decision', 'categories', 'reason', 'rewrite_suggestion'],
  },
};

/**
 * 제목을 중재한다. 결정적 prefilter → LLM 순으로 평가하고 가장 엄격한 결과를 채택.
 * @param {string} title
 * @returns {Promise<{decision:'approve'|'review'|'reject', categories:string[], reason:string, rewrite_suggestion:string, source:string}>}
 */
export async function moderateTitle(title) {
  const pre = prefilter(title);
  if (pre.blocked) {
    return {
      decision: 'reject',
      categories: pre.categories,
      reason: pre.categories.includes('personal_info')
        ? '제목에 개인 식별 정보(연락처·학번 등)가 포함되어 있습니다.'
        : '제목에 부적절한 표현이 포함되어 있습니다.',
      rewrite_suggestion: '',
      source: 'prefilter',
    };
  }

  // API 키가 없으면 안전하게 사람 검수 큐로 보류(자동 공개 금지).
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      decision: 'review',
      categories: ['none'],
      reason: 'AI 중재 미구성 — 담당자 검수 후 공개됩니다.',
      rewrite_suggestion: '',
      source: 'fallback',
    };
  }

  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    tools: [DECISION_TOOL],
    tool_choice: { type: 'tool', name: 'record_decision' },
    messages: [{ role: 'user', content: `다음 고발 제목을 중재하세요:\n\n"${title}"` }],
  });

  const toolUse = msg.content.find((b) => b.type === 'tool_use');
  if (!toolUse) {
    // 모델이 도구를 호출하지 않은 비정상 케이스 — 보류 처리.
    return {
      decision: 'review',
      categories: ['none'],
      reason: '자동 판정 실패 — 담당자 검수 대기.',
      rewrite_suggestion: '',
      source: 'llm-error',
    };
  }

  const out = toolUse.input;
  return {
    decision: out.decision,
    categories: out.categories?.length ? out.categories : ['none'],
    reason: out.reason || '',
    rewrite_suggestion: out.rewrite_suggestion || '',
    source: 'llm',
  };
}
