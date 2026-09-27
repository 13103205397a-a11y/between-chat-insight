import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Eye, EyeOff, FileArchive, FileText, Heart, LockKeyhole, Plus, RotateCcw, Sparkles, UploadCloud, X } from 'lucide-react';
import { ChatMessage, importFiles, parsePasted } from './parser';

type Result = {
  verdict: string; signal: number; category: string; categoryProbabilities: Record<string, number>;
  confidence: number; factors: Record<string, number>; sample: { total_messages: number; sampled_messages: number; method: string };
  model: string; note: string;
};

const demo = `2026-08-12 09:15 林予：你昨天说头疼，今天好些了吗？\n2026-08-12 09:21 我：好多啦，谢谢你记得。\n2026-08-12 09:23 林予：我路过你喜欢的那家店，给你带了热茶。\n2026-08-12 09:26 我：你也太细心了吧。\n2026-08-13 20:11 林予：今天加班辛苦了，回去早点休息。\n2026-08-13 20:17 我：收到。你今天怎么样？\n2026-08-13 20:20 林予：还好。周末要不要一起去看那个展？你上次提过。\n2026-08-13 20:25 我：好呀，周六下午可以。\n2026-08-14 12:02 林予：票我买好了，周六见。\n2026-08-14 12:06 我：期待！`;

const factorLabels: Record<string, { label: string; caption: string }> = {
  initiative: { label: '主动交流', caption: '是否主动开启并维持对话' },
  care: { label: '具体关心', caption: '是否记得并回应你的感受' },
  future: { label: '未来计划', caption: '是否提出继续相处的安排' },
  explicit: { label: '明确表达', caption: '是否直接说出喜欢或承诺' },
  ambiguity: { label: '反向迹象', caption: '是否出现距离感或矛盾信号' },
};

function percent(value: number) { return `${Math.round(value * 100)}%`; }

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [paste, setPaste] = useState('');
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [self, setSelf] = useState('');
  const [other, setOther] = useState('');
  const [serverReady, setServerReady] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [keyVerified, setKeyVerified] = useState(false);
  const [keyChecking, setKeyChecking] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetch('/api/health').then((r) => r.json()).then((data) => setServerReady(Boolean(data.ready))).catch(() => setServerReady(false)); }, []);
  const participants = useMemo(() => [...new Set(messages.map((m) => m.sender))].sort((a, b) => messages.filter((m) => m.sender === b).length - messages.filter((m) => m.sender === a).length), [messages]);
  const pairMessages = useMemo(() => messages.filter((m) => m.sender === self || m.sender === other), [messages, self, other]);
  const canAnalyze = self && other && self !== other && pairMessages.filter((m) => m.sender === self).length >= 3 && pairMessages.filter((m) => m.sender === other).length >= 3;

  function adopt(next: ChatMessage[], files: string[], notices: string[]) {
    setMessages(next); setFileNames(files); setWarnings(notices); setResult(null); setError('');
    const names = [...new Set(next.map((m) => m.sender))].sort((a, b) => next.filter((m) => m.sender === b).length - next.filter((m) => m.sender === a).length);
    setSelf(names.includes('我') ? '我' : names[0] || '');
    setOther(names.find((name) => name !== (names.includes('我') ? '我' : names[0])) || '');
  }

  async function handleFiles(files: FileList | File[]) {
    const imported = await importFiles(Array.from(files));
    adopt(imported.messages, imported.files, imported.warnings);
  }

  function handlePaste() {
    const imported = parsePasted(paste);
    adopt(imported.messages, imported.files, imported.warnings);
  }

  async function verifyKey() {
    if (!apiKey.trim() || keyChecking) return;
    setKeyChecking(true); setKeyError(''); setKeyVerified(false);
    try {
      const response = await fetch('/api/key/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '连接失败，请重试');
      setKeyVerified(true);
    } catch (cause) { setKeyError(cause instanceof Error ? cause.message : '连接失败，请重试'); }
    finally { setKeyChecking(false); }
  }

  async function analyze() {
    if (!canAnalyze) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(keyVerified ? { 'X-TypeSafe-Api-Key': apiKey.trim() } : {}) }, body: JSON.stringify({ messages: pairMessages, self, other }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '分析失败，请重试');
      setResult(data);
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '分析失败，请重试'); }
    finally { setLoading(false); }
  }

  function reset() { adopt([], [], []); setPaste(''); if (inputRef.current) inputRef.current.value = ''; }

  return <div className="app-shell">
    <header className="site-header">
      <a className="brand" href="#top" aria-label="之间，返回顶部"><span className="brand-mark"><span /></span><span>之间<span className="brand-period">.</span></span></a>
      <div className="header-right"><span className="privacy-pill"><LockKeyhole size={13} strokeWidth={1.8} /> 私密解析</span><span className="header-caption">聊天关系观察室</span></div>
    </header>

    <main id="top">
      <section className="intro">
        <div className="intro-copy"><div className="eyebrow"><span className="eyebrow-line" /> 读懂对话之间</div><h1>字里行间，<br /><em>有迹可循。</em></h1><p>导入你们的聊天记录，看看对方的主动、关心与靠近。让每一个判断，都有它的分寸。</p></div>
        <div className="intro-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="art-bubble art-bubble-one">今天过得怎么样？</div><div className="art-bubble art-bubble-two">刚好想起你。</div><div className="art-point point-one" /><div className="art-point point-two" /></div>
      </section>

      <section className="workspace" aria-label="聊天分析工作台">
        <div className="window-bar"><div className="traffic"><i /><i /><i /></div><div className="window-title">一次安静的关系观察</div><div className="window-tag">PRIVATE SESSION</div></div>
        <div className="workspace-grid">
          <div className="workspace-main">
            <div className="section-heading"><span className="step">01</span><div><h2>带来你们的对话</h2><p>先在这里预览，确认内容和参与者无误。</p></div></div>
            <div className="mode-tabs" role="tablist" aria-label="导入方式"><button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')} role="tab" aria-selected={mode === 'file'}>上传文件</button><button className={mode === 'paste' ? 'active' : ''} onClick={() => setMode('paste')} role="tab" aria-selected={mode === 'paste'}>粘贴聊天</button></div>
            {mode === 'file' ? <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFiles(e.dataTransfer.files); }}>
              <input ref={inputRef} type="file" multiple accept=".txt,.md,.csv,.tsv,.json,.html,.htm,.xml,.zip" onChange={(e) => e.target.files && void handleFiles(e.target.files)} aria-label="选择聊天导出文件" />
              <div className="upload-icon"><UploadCloud size={27} strokeWidth={1.45} /></div><strong>把聊天文件拖到这里</strong><span>或点击下方按钮，从电脑选择</span><button className="outline-button" onClick={() => inputRef.current?.click()}><Plus size={15} /> 选择文件</button>
            </div> : <div className="paste-box"><textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'例如：\n2026-08-12 09:15 小林：今天怎么样？\n2026-08-12 09:20 我：还不错，你呢？'} /><button className="outline-button" onClick={handlePaste}>读取粘贴内容 <ArrowRight size={15} /></button></div>}
            <div className="format-line"><FileArchive size={14} /><span>支持 TXT、CSV、JSON、HTML、XML、ZIP 等常见导出文件</span></div>
            <button className="sample-link" onClick={() => { setPaste(demo); setMode('paste'); const imported = parsePasted(demo); adopt(imported.messages, ['示例对话'], []); }}>先用示例对话试试 <ArrowRight size={14} /></button>

            {messages.length > 0 && <div className="imported-panel"><div className="imported-top"><div className="imported-icon"><FileText size={18} /></div><div><strong>已读入 {messages.length.toLocaleString()} 条消息</strong><span>{fileNames.slice(0, 3).join('、')}{fileNames.length > 3 ? ` 等 ${fileNames.length} 个文件` : ''}</span></div><button className="icon-button" aria-label="清除聊天内容" title="清除聊天内容" onClick={reset}><X size={17} /></button></div><div className="preview-title">消息预览 <span>最近 3 条</span></div><div className="preview-list">{messages.slice(-3).map((m) => <div key={m.id} className="preview-message"><span>{m.sender}</span><p>{m.text}</p></div>)}</div></div>}
            {warnings.length > 0 && <div className="notice" role="status">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
          </div>

          <aside className="workspace-side"><div className="side-content"><div className="section-heading"><span className="step">02</span><div><h2>确认你们是谁</h2><p>判断会从你选择的视角出发。</p></div></div>
            <label className="field-label" htmlFor="self">你是</label><div className="select-wrap"><select id="self" value={self} onChange={(e) => { setSelf(e.target.value); setResult(null); }} disabled={!participants.length}><option value="">选择你的名字</option>{participants.map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={17} /></div>
            <label className="field-label" htmlFor="other">想了解的人</label><div className="select-wrap"><select id="other" value={other} onChange={(e) => { setOther(e.target.value); setResult(null); }} disabled={!participants.length}><option value="">选择对方的名字</option>{participants.filter((name) => name !== self).map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={17} /></div>
            {participants.length > 2 && <p className="field-note">检测到 {participants.length} 位参与者。分析时只会选取你和对方的消息。</p>}
            <div className="side-divider" />
            <div className="key-section"><div className="key-heading"><LockKeyhole size={15} /><strong>连接 JEV</strong>{(serverReady || keyVerified) && <span className="key-connected"><Check size={12} /> 已连接</span>}</div>
              {serverReady ? <p className="key-help">服务端已配置 API Key，可以直接开始观察。</p> : <><label className="key-label" htmlFor="api-key">TypeSafe API Key</label><div className="key-input-wrap"><input id="api-key" type={showKey ? 'text' : 'password'} value={apiKey} disabled={keyChecking} onChange={(e) => { setApiKey(e.target.value); setKeyVerified(false); setKeyError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') void verifyKey(); }} placeholder="粘贴你的 API Key" autoComplete="off" autoCapitalize="off" spellCheck={false} /><button type="button" className="key-visibility" onClick={() => setShowKey(!showKey)} aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></div><button type="button" className="verify-button" onClick={() => void verifyKey()} disabled={!apiKey.trim() || keyChecking || keyVerified}>{keyChecking ? '正在验证…' : keyVerified ? '已验证' : '验证并连接'}</button><p className="key-help">仅在当前页面内存中使用；刷新后需要重新填写，不会保存到仓库。</p>{keyError && <p className="error-note" role="alert">{keyError}</p>}</>}
            </div>
            <div className="side-divider" /><div className="check-row"><span><Check size={14} /></span><p>原文件在浏览器中解析</p></div><div className="check-row"><span><Check size={14} /></span><p>仅分析选中的双人文字消息</p></div><div className="check-row"><span><Check size={14} /></span><p>结果不会保存在本站</p></div>
            <button className="analyze-button" onClick={() => void analyze()} disabled={!canAnalyze || !(serverReady || keyVerified) || loading}>{loading ? '正在阅读对话…' : '开始观察'}{loading ? <span className="button-spinner" /> : <ArrowRight size={18} />}</button>
            {!canAnalyze && messages.length > 0 && <p className="small-help">请确认两个人各有至少 3 条文字消息。</p>}
            {serverReady === false && !keyVerified && <p className="connection-note">先填写并验证 API Key，再开始真实分析。</p>}
            {error && <p className="error-note" role="alert">{error}</p>}
          </div></aside>
        </div>
      </section>

      {result && <section className="result" ref={resultRef} aria-live="polite"><div className="result-header"><div className="eyebrow"><span className="eyebrow-line" /> 观察结果</div><button className="text-button" onClick={() => setResult(null)}><RotateCcw size={14} /> 重新观察</button></div><div className="result-grid"><div className="result-lead"><div className="result-kicker"><Heart size={15} /> 关于 {other} 的聊天迹象</div><h2>{result.verdict}<span>。</span></h2><p>JEV 对“持续浪漫或亲密投入迹象”的判断值为 <strong>{percent(result.signal)}</strong>。它描述的是聊天内容里的信号，不等于“爱你的概率”。</p><div className="signal-track"><span style={{ width: percent(result.signal) }} /></div><div className="signal-ends"><span>迹象较弱</span><span>迹象较明显</span></div></div><div className="factors"><div className="factors-head"><Sparkles size={17} /><span>从哪些角度阅读</span></div>{Object.entries(factorLabels).map(([key, item]) => <div className="factor-row" key={key}><div><strong>{item.label}</strong><small>{item.caption}</small></div><span className={key === 'ambiguity' ? 'muted-value' : ''}>{percent(result.factors[key])}</span></div>)}</div></div><div className="result-footer"><p><strong>阅读边界</strong>　{result.note}</p><p>本次从 {result.sample.total_messages} 条双人消息中读取 {result.sample.sampled_messages} 条（{result.sample.method}）。模型：{result.model}。</p></div></section>}

      <section className="bottom-note"><div className="bottom-icon"><Heart size={19} strokeWidth={1.5} /></div><h2>真正的答案，也许在对话之外。</h2><p>这是一份聊天观察，不是关系诊断。重要的感受，值得当面确认。</p></section>
    </main>
    <footer><span>之间 · Between</span><span>留一点空间，给真实的交流。</span></footer>
  </div>;
}
