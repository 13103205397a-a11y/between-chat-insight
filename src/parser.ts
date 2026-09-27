import JSZip from 'jszip';
import Papa from 'papaparse';

export type ChatMessage = { id: string; sender: string; text: string; time?: string; source?: string };
export type ImportResult = { messages: ChatMessage[]; files: string[]; warnings: string[] };

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_MESSAGES = 30000;
const supported = /\.(txt|md|csv|tsv|json|html?|xml)$/i;
const senderKeys = ['sender', 'from', 'author', 'user', 'name', 'contact', '发信人', '发送人', '发送者', '昵称', '用户', '联系人', '说话人'];
const textKeys = ['text', 'message', 'content', 'body', 'msg', '消息', '内容', '文本', '消息内容'];
const timeKeys = ['time', 'date', 'datetime', 'timestamp', 'created_at', '发送时间', '时间', '日期'];

function getField(record: Record<string, unknown>, keys: string[]): unknown {
  const entries = Object.entries(record);
  return entries.find(([key]) => keys.includes(key.trim().toLowerCase()))?.[1];
}

function textValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((part) => typeof part === 'string' ? part : textValue((part as Record<string, unknown>)?.text)).join('');
  if (value && typeof value === 'object') return textValue((value as Record<string, unknown>).text);
  return '';
}

function clean(raw: ChatMessage[], source: string): ChatMessage[] {
  return raw
    .map((m, i) => ({ id: `${source}:${i}`, sender: String(m.sender || '').trim(), text: String(m.text || '').trim(), time: m.time ? String(m.time).trim() : undefined, source }))
    .filter((m) => m.sender && m.text && !/^\[(图片|视频|语音|表情|文件)\]$/.test(m.text));
}

export function parsePlain(input: string, source = '粘贴内容'): ChatMessage[] {
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  const messages: ChatMessage[] = [];
  let current: ChatMessage | null = null;
  const patterns = [
    /^\[([^\]]+)\]\s*([^:：\n]+?)\s*[:：]\s*(.*)$/,
    /^(\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)\s+-\s+([^:：]+)[:：]\s*(.*)$/i,
    /^(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?\s+\d{1,2}:\d{2}(?::\d{2})?)\s+([^:：\n]+?)\s*[:：]\s*(.*)$/,
    /^(\d{1,2}:\d{2})\t([^\t]+)\t(.+)$/,
    /^(\d{1,2}:\d{2}(?::\d{2})?)\s+([^:：\n]+?)\s*[:：]\s*(.*)$/,
  ];
  for (const line of lines) {
    const match = patterns.map((pattern) => line.match(pattern)).find(Boolean);
    if (match) {
      current = { id: '', time: match[1], sender: match[2], text: match[3] };
      messages.push(current);
      continue;
    }
    const simple = line.match(/^([^:：\n]{1,36})\s*[:：]\s*(.+)$/);
    if (simple && !/^https?$/i.test(simple[1])) {
      current = { id: '', sender: simple[1], text: simple[2] };
      messages.push(current);
    } else if (current && line.trim()) {
      current.text += `\n${line}`;
    }
  }
  return clean(messages, source);
}

export function parseRows(rows: Record<string, unknown>[], source: string): ChatMessage[] {
  return clean(rows.map((row) => ({
    id: '', sender: textValue(getField(row, senderKeys)), text: textValue(getField(row, textKeys)),
    time: textValue(getField(row, timeKeys)),
  })), source);
}

export function parseJson(input: string, source: string): ChatMessage[] {
  const data: unknown = JSON.parse(input);
  const locate = (value: unknown): Record<string, unknown>[] => {
    if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      for (const key of ['messages', 'chats', 'conversation', 'history', 'records', 'data', '消息']) {
        if (key in obj) {
          const found = locate(obj[key]);
          if (found.length) return found;
        }
      }
    }
    return [];
  };
  const rows = locate(data);
  const mapped = rows.map((row) => ({
    ...row,
    sender: getField(row, senderKeys) ?? (row.actor === 'user' ? '我' : row.actor),
    text: getField(row, textKeys) ?? row.text_entities,
    time: getField(row, timeKeys) ?? row.date,
  }));
  return parseRows(mapped, source);
}

function parseHtml(input: string, source: string): ChatMessage[] {
  const doc = new DOMParser().parseFromString(input, 'text/html');
  doc.querySelectorAll('script, style, svg, nav').forEach((node) => node.remove());
  let previousSender = '';
  const telegram = Array.from(doc.querySelectorAll('.message.default, .message.service')).map((node) => {
    const sender = node.querySelector('.from_name')?.textContent?.trim() || previousSender;
    if (sender) previousSender = sender;
    return { id: '', sender, text: node.querySelector('.text')?.textContent || '', time: node.querySelector('.date')?.getAttribute('title') || undefined };
  });
  if (telegram.some((m) => m.sender && m.text)) return clean(telegram, source);
  const generic = Array.from(doc.querySelectorAll('[data-sender], [data-author]')).map((node) => ({
    id: '', sender: node.getAttribute('data-sender') || node.getAttribute('data-author') || '',
    text: node.textContent || '', time: node.getAttribute('data-time') || undefined,
  }));
  if (generic.some((m) => m.sender && m.text)) return clean(generic, source);
  return parsePlain(doc.body?.textContent || '', source);
}

function parseXml(input: string, source: string): ChatMessage[] {
  const doc = new DOMParser().parseFromString(input, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML 格式无效');
  const rows = Array.from(doc.querySelectorAll('message, msg, item, record')).map((node) => {
    const field = (names: string[]) => names.map((name) => node.getAttribute(name) || node.querySelector(name)?.textContent).find(Boolean) || '';
    return { sender: field(senderKeys), text: field(textKeys), time: field(timeKeys) };
  });
  return parseRows(rows, source);
}

function parseContent(content: string, name: string): ChatMessage[] {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'json') return parseJson(content, name);
  if (ext === 'csv' || ext === 'tsv') {
    const parsed = Papa.parse<Record<string, unknown>>(content, { header: true, skipEmptyLines: true, delimiter: ext === 'tsv' ? '\t' : undefined });
    return parseRows(parsed.data, name);
  }
  if (ext === 'html' || ext === 'htm') return parseHtml(content, name);
  if (ext === 'xml') return parseXml(content, name);
  return parsePlain(content, name);
}

export async function importFiles(files: File[]): Promise<ImportResult> {
  const messages: ChatMessage[] = [];
  const names: string[] = [];
  const warnings: string[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) { warnings.push(`${file.name} 超过 20 MB，已跳过`); continue; }
    try {
      if (/\.zip$/i.test(file.name)) {
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const entries = Object.values(zip.files).filter((entry) => !entry.dir && supported.test(entry.name) && !entry.name.startsWith('__MACOSX/')).slice(0, 30);
        if (!entries.length) warnings.push(`${file.name} 中没有可识别的聊天文件`);
        for (const entry of entries) {
          if ((entry as any)._data?.uncompressedSize > MAX_FILE_BYTES) { warnings.push(`${entry.name} 过大，已跳过`); continue; }
          const parsed = parseContent(await entry.async('string'), entry.name);
          messages.push(...parsed); names.push(entry.name);
          if (!parsed.length) warnings.push(`${entry.name} 没有识别出带发送者的文字消息`);
        }
      } else if (supported.test(file.name)) {
        const parsed = parseContent(await file.text(), file.name);
        messages.push(...parsed); names.push(file.name);
        if (!parsed.length) warnings.push(`${file.name} 没有识别出带发送者的文字消息`);
      } else warnings.push(`${file.name} 的格式暂不支持`);
    } catch (error) {
      warnings.push(`${file.name} 解析失败：${error instanceof Error ? error.message : '文件损坏'}`);
    }
    if (messages.length > MAX_MESSAGES) { warnings.push('最多保留前 30,000 条消息'); break; }
  }
  return { messages: messages.slice(0, MAX_MESSAGES).map((m, i) => ({ ...m, id: `${i}:${m.id}` })), files: names, warnings };
}

export function parsePasted(text: string): ImportResult {
  const messages = parsePlain(text);
  return { messages, files: ['粘贴内容'], warnings: messages.length ? [] : ['请按“张三：内容”或带时间的聊天格式粘贴'] };
}
