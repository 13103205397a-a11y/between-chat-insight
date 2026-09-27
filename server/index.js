import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRequest, formatResult } from './analysis.js';
import { resolveApiKey } from './key.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT || 8787);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 25_000_000) throw new Error('聊天内容过大，请缩减导入范围');
  }
  try { return JSON.parse(body); } catch { throw new Error('请求内容不是有效 JSON'); }
}

async function analyze(req, res) {
  const apiKey = resolveApiKey(req.headers['x-typesafe-api-key'], process.env.TYPESAFE_API_KEY);
  if (!apiKey) return sendJson(res, 503, { error: '请先填写并验证 JEV API Key，或在服务端配置 TYPESAFE_API_KEY。' });
  let input;
  try { input = await readJson(req); } catch (error) { return sendJson(res, 400, { error: error.message }); }
  let request;
  try { request = buildRequest(input.messages, input.self, input.other); } catch (error) { return sendJson(res, 400, { error: error.message }); }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const upstream = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!upstream.ok) {
      const message = upstream.status === 401 || upstream.status === 403 ? 'JEV API Key 无效或没有访问权限'
        : upstream.status === 429 ? 'JEV 请求过于频繁，请稍后重试'
        : `JEV 服务返回 ${upstream.status}，请稍后重试`;
      return sendJson(res, 502, { error: message });
    }
    const data = await upstream.json();
    return sendJson(res, 200, formatResult(data, request));
  } catch (error) {
    return sendJson(res, 502, { error: error.name === 'AbortError' ? 'JEV 响应超时，请重试' : '无法连接 JEV 服务，请检查网络后重试' });
  } finally { clearTimeout(timer); }
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
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    return res.end(req.method === 'HEAD' ? undefined : file);
  } catch {
    try {
      const file = await fs.readFile(path.join(dist, 'index.html'));
      res.writeHead(200, { 'Content-Type': mime['.html'] });
      return res.end(file);
    } catch { return sendJson(res, 404, { error: '请先执行 npm run build' }); }
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Between app: http://127.0.0.1:${port}`));
