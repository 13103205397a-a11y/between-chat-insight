import { setTimeout as sleep } from 'node:timers/promises';

const MAX_INPUT_MESSAGES = 100000;
const MAX_CHUNK_CHARS = 10000;
const MAX_TEXT_PART_CHARS = 8000;
const CONCURRENCY = 3;

const questions = (other, self) => {
  const scope = `仅根据 state.messages 中 ${other} 对 ${self} 的表现，结合双方上下文，`;
  return {
    love: {
      type: 'noul',
      instructions: `${scope}这一段聊天是否支持“${other} 对 ${self} 有恋爱性质的爱意或持续亲密投入”这个判断？只看可见言行。单次暧昧、礼貌和普通友谊不充分；缺乏证据时保留不确定性。`,
      criteria: { true: '本段出现有分量的恋爱爱意或持续亲密投入迹象', false: '本段迹象不足、矛盾，或更像友谊及事务往来' },
    },
    initiative: { type: 'noul', instructions: `${scope}对方是否主动开启或维持有意义的交流，而非总是被动答复？` },
    care: { type: 'noul', instructions: `${scope}对方是否具体记住、关心并回应这个人的感受或近况，而非仅有客套话？` },
    future: { type: 'noul', instructions: `${scope}对方是否主动提出或落实两人未来继续相处的具体计划？` },
    explicit: { type: 'noul', instructions: `${scope}对方是否清楚直接表达喜欢、爱意或恋爱承诺？不要把表情和玩笑自动视为承诺。` },
    ambiguity: { type: 'noul', instructions: `${scope}是否出现明确保持距离、拒绝、仅限事务往来或前后矛盾等反向迹象？` },
  };
};

function splitText(text) {
  if (text.length <= MAX_TEXT_PART_CHARS) return [text];
  const parts = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + MAX_TEXT_PART_CHARS, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

export function prepareConversation(messages, self, other) {
  if (!self || !other || self === other) throw new Error('请选择两个不同的聊天参与者');
  if (!Array.isArray(messages) || messages.length < 6 || messages.length > MAX_INPUT_MESSAGES) throw new Error('请导入 6 至 100,000 条聊天消息');
  const pair = messages.filter((m) => (m?.sender === self || m?.sender === other) && typeof m.text === 'string' && m.text.trim());
  if (pair.filter((m) => m.sender === other).length < 3 || pair.filter((m) => m.sender === self).length < 3) throw new Error('双方各需至少 3 条文字消息');

  const records = pair.flatMap((m, messageIndex) => {
    const parts = splitText(m.text);
    return parts.map((text, partIndex) => ({
      messageIndex, sender: m.sender, text,
      ...(m.time ? { time: String(m.time).slice(0, 80) } : {}),
      ...(parts.length > 1 ? { part: `${partIndex + 1}/${parts.length}` } : {}),
    }));
  });
  const chunks = [];
  let current = [];
  let size = 0;
  for (const record of records) {
    const recordSize = JSON.stringify(record).length + 1;
    if (current.length && size + recordSize > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(record);
    size += recordSize;
  }
  if (current.length) chunks.push(current);
  return { totalMessages: pair.length, chunks };
}

export function buildChunkRequest(chunk, index, total, self, other) {
  return {
    model: 'jev-latest',
    state: {
      context: `这是 ${self} 与 ${other} 的双人聊天，第 ${index + 1}/${total} 段。请阅读 messages 中的每条文字及顺序。只判断 ${other} 对 ${self} 展现的聊天迹象；不能由聊天证明内心感情。长消息的 part 表示原消息被完整分段。`,
      messages: chunk.map(({ sender, text, time, part }) => ({ sender, text, ...(time ? { time } : {}), ...(part ? { part } : {}) })),
    },
    questions: questions(other, self),
  };
}

export function readChunkResult(response, chunk, other) {
  const keys = ['love', 'initiative', 'care', 'future', 'explicit', 'ambiguity'];
  if (!response?.answers || keys.some((key) => {
    const answer = response.answers[key];
    return answer?.type !== 'noul' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1;
  })) throw new Error('JEV 返回内容不完整，请重试');
  const targetWeight = chunk.filter((m) => m.sender === other).reduce((sum, m) => sum + (m.part ? 1 / Number(m.part.split('/')[1]) : 1), 0);
  return { values: Object.fromEntries(keys.map((key) => [key, response.answers[key].noul])), weight: targetWeight, model: response.model };
}

export function combineResults(results, prepared) {
  const weighted = results.filter((r) => r.weight > 0);
  const totalWeight = weighted.reduce((sum, r) => sum + r.weight, 0);
  if (!totalWeight) throw new Error('没有足够的对方消息可供判断');
  const score = (key) => weighted.reduce((sum, r) => sum + r.values[key] * r.weight, 0) / totalWeight;
  const love = score('love');
  const notLove = 1 - love;
  const lovePercent = Math.round(love * 100);
  const notLovePercent = 100 - lovePercent;
  const ambiguity = score('ambiguity');
  const verdict = love >= 0.7 && ambiguity < 0.55 ? '聊天中有较明显的爱意迹象'
    : love <= 0.3 ? '聊天中的爱意迹象较弱' : '聊天信号尚不明确';
  return {
    verdict, love, notLove, lovePercent, notLovePercent,
    factors: Object.fromEntries(['initiative', 'care', 'future', 'explicit', 'ambiguity'].map((key) => [key, score(key)])),
    coverage: { totalMessages: prepared.totalMessages, analyzedMessages: prepared.totalMessages, chunks: prepared.chunks.length },
    model: results[0]?.model || 'jev-latest',
    note: '仅供娱乐。两个百分比是 JEV 对各段聊天迹象的判断值，经对方发言数加权后互补展示；不能测量一个人真实的爱意。',
  };
}

async function queryChunk(request, apiKey, signal, fetchImpl) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const timeout = AbortSignal.timeout(30000);
    const response = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', signal: AbortSignal.any([signal, timeout]),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 8000) : 1000 * (attempt + 1);
      await sleep(waitMs, undefined, { signal });
      continue;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('JEV API Key 无效或没有访问权限');
      if (response.status === 429) throw new Error('JEV 请求过于频繁，请稍后重试');
      throw new Error(`JEV 服务返回 ${response.status}，请稍后重试`);
    }
    return response.json();
  }
}

export async function analyzeAll(prepared, self, other, apiKey, onProgress, signal, fetchImpl = fetch) {
  const results = new Array(prepared.chunks.length);
  let next = 0;
  let completed = 0;
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const worker = async () => {
    while (next < prepared.chunks.length && !combined.aborted) {
      const index = next++;
      const chunk = prepared.chunks[index];
      try {
        const data = await queryChunk(buildChunkRequest(chunk, index, prepared.chunks.length, self, other), apiKey, combined, fetchImpl);
        results[index] = readChunkResult(data, chunk, other);
        onProgress(++completed, prepared.chunks.length);
      } catch (error) {
        controller.abort();
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, prepared.chunks.length) }, worker));
  return combineResults(results, prepared);
}
