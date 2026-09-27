import { describe, expect, it } from 'vitest';
import { parseJson, parsePasted, parsePlain, parseRows } from '../src/parser';

describe('chat import', () => {
  it('reads WhatsApp exports and multiline messages', () => {
    const data = '8/12/26, 9:15 AM - 林予: 今天好吗？\n8/12/26, 9:21 AM - 我: 还好\n谢谢你';
    const messages = parsePlain(data, 'whatsapp.txt');
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ sender: '我', text: '还好\n谢谢你' });
  });

  it('reads Telegram JSON text entities', () => {
    const data = JSON.stringify({ messages: [{ from: '林予', text: ['晚安，', { type: 'bold', text: '明天见' }], date: '2026-08-12' }] });
    expect(parseJson(data, 'result.json')[0]).toMatchObject({ sender: '林予', text: '晚安，明天见' });
  });

  it('reads Chinese CSV columns and pasted lines', () => {
    expect(parseRows([{ 发送人: '我', 内容: '你好', 时间: '10:30' }], 'x.csv')[0].text).toBe('你好');
    expect(parsePasted('甲：你好\n乙：你好呀').messages).toHaveLength(2);
  });
});
