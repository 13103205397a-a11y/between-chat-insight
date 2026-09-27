import { describe, expect, it } from 'vitest';
import { buildRequest, formatResult, selectMessages } from '../server/analysis.js';

const messages = Array.from({ length: 250 }, (_, i) => ({ sender: i % 2 ? '对方' : '我', text: `消息 ${i}` }));

describe('JEV request', () => {
  it('samples across a long conversation in original order', () => {
    const sample = selectMessages(messages);
    expect(sample).toHaveLength(180);
    expect(sample[0].text).toBe('消息 0');
    expect(sample.at(-1).text).toBe('消息 249');
    expect(sample.find((m) => m.text === '消息 125')).toBeTruthy();
  });

  it('accepts only two selected people and asks typed Jev questions', () => {
    const request = buildRequest([...messages, { sender: '第三人', text: '私密内容' }], '我', '对方');
    expect(request.model).toBe('jev-latest');
    expect(request.state.messages).toHaveLength(180);
    expect(JSON.stringify(request.state)).not.toContain('私密内容');
    expect(request.questions.romantic_signal.type).toBe('noul');
  });

  it('does not promote uncertain signals to a positive verdict', () => {
    const request = buildRequest(messages, '我', '对方');
    const response = { model: 'jev-1.13.0', answers: {
      romantic_signal: { type: 'noul', noul: 0.82 }, initiative: { type: 'noul', noul: 0.8 },
      care: { type: 'noul', noul: 0.7 }, future: { type: 'noul', noul: 0.6 }, explicit: { type: 'noul', noul: 0.3 },
      ambiguity: { type: 'noul', noul: 0.8 }, relationship: { type: 'choice', choice: 'romantic', probabilities: { romantic: 0.7 }, confidence: 0.5 },
    } };
    expect(formatResult(response, request).verdict).toBe('目前还不明确');
  });
});
