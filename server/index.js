import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeAll, prepareConversation } from './analysis.js';
import { resolveApiKey } from './key.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT || 8787);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const staticHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('请使用 JSON 请求');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 25_000_000) throw new Error('聊天内容过大，请缩减导入范围');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('请求内容不是有效 JSON'); }
}

function localRequest(req) {
  const host = req.headers.host || '';
  if (!/^((127\.0\.0\.1)|(localhost)):\d+$/.test(host)) return false;
  const origin = req.headers.origin;
  return !origin || /^http:\/\/((127\.0\.0\.1)|(localhost)):(5173|8787)$/.test(origin);
}

async function analyze(req, res) {
  const apiKey = resolveApiKey(req.headers['x-typesafe-api-key'], process.env.TYPESAFE_API_KEY);
  if (!apiKey) return sendJson(res, 503, { error: '请先填写并验证 JEV API Key，或在服务端配置 TYPESAFE_API_KEY。' });
  let input;
  try { input = await readJson(req); } catch (error) { return sendJson(res, 400, { error: error.message }); }
  let prepared;
  try { prepared = prepareConversation(input.messages, input.self, input.other); } catch (error) { return sendJson(res, 400, { error: error.message }); }
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  const write = (event) => { if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
  write({ type: 'progress', completed: 0, total: prepared.chunks.length });
  try {
    const result = await analyzeAll(prepared, input.self, input.other, apiKey,
      (completed, total) => write({ type: 'progress', completed, total }), controller.signal);
    write({ type: 'result', result });
  } catch (error) {
    if (!controller.signal.aborted) write({ type: 'error', error: error?.message?.startsWith('JEV ') ? error.message : '分析未完成，请检查网络后重试' });
  } finally { if (!res.destroyed) res.end(); }
}

async function verifyKey(req, res) {
  let input;
  try { input = await readJson(req); } catch (error) { return sendJson(res, 400, { error: error.message }); }
  const apiKey = resolveApiKey(input?.apiKey);
  if (!apiKey) return sendJson(res, 400, { error: '请输入有效的 JEV API Key' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const upstream = await fetch('https://api.typesafe.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` }, signal: controller.signal,
    });
    if (upstream.status === 401 || upstream.status === 403) return sendJson(res, 401, { error: 'API Key 无效或尚无 TypeSafe 访问权限' });
    if (!upstream.ok) return sendJson(res, 502, { error: `JEV 服务返回 ${upstream.status}，请稍后重试` });
    return sendJson(res, 200, { ready: true });
  } catch (error) {
    return sendJson(res, 502, { error: error.name === 'AbortError' ? '验证超时，请重试' : '无法连接 JEV 服务，请检查网络后重试' });
  } finally { clearTimeout(timer); }
}

const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith('/api/') && !localRequest(req)) return sendJson(res, 403, { error: '只允许从本机应用调用接口' });
  if (req.url === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ready: Boolean(process.env.TYPESAFE_API_KEY) });
  if (req.url === '/api/key/verify' && req.method === 'POST') return verifyKey(req, res);
  if (req.url === '/api/analyze' && req.method === 'POST') return analyze(req, res);
  if (req.url?.startsWith('/api/')) return sendJson(res, 404, { error: '接口不存在' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: '请求方式不支持' });
  let requested;
  try { requested = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch { return sendJson(res, 400, { error: '路径无效' }); }
  const filePath = path.resolve(dist, `.${requested === '/' ? '/index.html' : requested}`);
  if (!filePath.startsWith(`${dist}${path.sep}`)) return sendJson(res, 403, { error: '路径不允许访问' });
  try {
    const file = await fs.readFile(filePath);
    res.writeHead(200, { ...staticHeaders, 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    return res.end(req.method === 'HEAD' ? undefined : file);
  } catch {
    try {
      const file = await fs.readFile(path.join(dist, 'index.html'));
      res.writeHead(200, { ...staticHeaders, 'Content-Type': mime['.html'] });
      return res.end(file);
    } catch { return sendJson(res, 404, { error: '请先执行 npm run build' }); }
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Between app: http://127.0.0.1:${port}`));
