import { describe, expect, it } from 'vitest';
import { analyzeAll, buildChunkRequest, combineResults, prepareConversation } from '../server/analysis.js';

const messages = Array.from({ length: 400 }, (_, i) => ({ sender: i % 2 ? '对方' : '我', text: `第 ${i} 条消息，今天一起聊天。` }));
const answer = (value) => ({ model: 'jev-test', answers: Object.fromEntries(
  ['love', 'initiative', 'care', 'future', 'explicit', 'ambiguity'].map((key) => [key, { type: 'noul', noul: key === 'ambiguity' ? 0.2 : value }]),
) });

describe('complete Jev analysis', () => {
  it('covers every message in original order across chunks', () => {
    const prepared = prepareConversation([...messages, { sender: '第三人', text: '不应发送' }], '我', '对方');
    const sent = prepared.chunks.flat().map((m) => m.text);
    expect(prepared.chunks.length).toBeGreaterThan(1);
    expect(sent).toEqual(messages.map((m) => m.text));
    expect(sent.join('')).not.toContain('不应发送');
    expect(buildChunkRequest(prepared.chunks[0], 0, prepared.chunks.length, '我', '对方').questions.love.type).toBe('noul');
  });

  it('splits exceptionally long text without dropping any character', () => {
    const long = '你好🙂'.repeat(5000);
    const prepared = prepareConversation([{ sender: '我', text: long }, ...messages.slice(0, 6)], '我', '对方');
    expect(prepared.chunks.flat().filter((m) => m.messageIndex === 0).map((m) => m.text).join('')).toBe(long);
  });

  it('makes a Jev call for every chunk and returns complementary percentages', async () => {
    const prepared = prepareConversation(messages, '我', '对方');
    const calls = [];
    const progress = [];
    const fakeFetch = async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => answer(0.72) };
    };
    const result = await analyzeAll(prepared, '我', '对方', 'test-key', (done, total) => progress.push([done, total]), new AbortController().signal, fakeFetch);
    expect(calls).toHaveLength(prepared.chunks.length);
    expect(calls.flatMap((call) => call.state.messages.map((m) => m.text))).toEqual(messages.map((m) => m.text));
    expect(result.love).toBeCloseTo(0.72);
    expect(result.love + result.notLove).toBeCloseTo(1);
    expect(result.lovePercent + result.notLovePercent).toBe(100);
    expect(result.coverage.analyzedMessages).toBe(400);
    expect(progress.at(-1)).toEqual([prepared.chunks.length, prepared.chunks.length]);
  });

  it('keeps an uncertain verdict when there is contrary evidence', () => {
    const prepared = prepareConversation(messages.slice(0, 10), '我', '对方');
    const result = combineResults([{ values: { love: 0.82, ambiguity: 0.8, initiative: 0.5, care: 0.5, future: 0.5, explicit: 0.5 }, weight: 5, model: 'jev-test' }], prepared);
    expect(result.verdict).toBe('聊天信号尚不明确');
  });
});
