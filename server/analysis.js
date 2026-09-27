const MAX_INPUT_MESSAGES = 30000;
const MAX_MODEL_MESSAGES = 180;

export function selectMessages(messages) {
  const valid = messages.filter((m) => typeof m?.sender === 'string' && typeof m?.text === 'string' && m.sender.trim() && m.text.trim());
  if (valid.length <= MAX_MODEL_MESSAGES) return valid;
  const selected = new Set();
  const addRange = (start, count) => {
    for (let i = start; i < Math.min(start + count, valid.length); i++) selected.add(i);
  };
  addRange(0, 30);
  addRange(Math.floor(valid.length / 2) - 25, 50);
  addRange(valid.length - 100, 100);
  return [...selected].sort((a, b) => a - b).map((i) => valid[i]);
}

export function buildRequest(messages, self, other) {
  if (!self || !other || self === other) throw new Error('请选择两个不同的聊天参与者');
  if (!Array.isArray(messages) || messages.length < 6 || messages.length > MAX_INPUT_MESSAGES) throw new Error('请导入 6 至 30,000 条聊天消息');
  const pair = messages.filter((m) => m.sender === self || m.sender === other);
  if (pair.filter((m) => m.sender === other).length < 3 || pair.filter((m) => m.sender === self).length < 3) throw new Error('双方各需至少 3 条消息');
  const sample = selectMessages(pair);
  const state = {
    relationship_context: `这是 ${self} 与 ${other} 的私人双人聊天摘样。请只判断 ${other} 对 ${self} 展现出的聊天行为。聊天内容不能证明内心情感或现实关系；玩笑、礼貌、工作往来与真实投入应区分。不要把没有出现的行为当作否定证据。`,
    sampling: { total_messages: pair.length, sampled_messages: sample.length, method: pair.length > sample.length ? '按原顺序选取开头、中段和最近消息' : '全部消息' },
    messages: sample.map((m) => ({ sender: m.sender, text: m.text.slice(0, 500), ...(m.time ? { time: String(m.time).slice(0, 60) } : {}) })),
  };
  const base = `仅根据 state.messages 中 ${other} 对 ${self} 的消息，`;
  return {
    state,
    model: 'jev-latest',
    questions: {
      romantic_signal: { type: 'noul', instructions: `${base}是否能看到持续且明确的浪漫兴趣或亲密投入迹象？不要推断其真实内心，不要把普通礼貌、一般友谊或单次暧昧直接算作肯定。`, criteria: { true: '多处互动显示持续的浪漫兴趣或亲密投入', false: '迹象不足、含糊或更符合其他关系' } },
      initiative: { type: 'noul', instructions: `${base}对方是否主动开启或维持有意义的交流，而不总是被动答复？` },
      care: { type: 'noul', instructions: `${base}对方是否具体记住、关心并回应这个人的感受或近况，而非仅有客套话？` },
      future: { type: 'noul', instructions: `${base}对方是否主动提出或落实两人未来继续相处的具体计划？` },
      explicit: { type: 'noul', instructions: `${base}对方是否有清楚直接的喜欢、爱意、恋爱承诺或相近表达？不要把表情和玩笑自动视为承诺。` },
      ambiguity: { type: 'noul', instructions: `${base}是否存在会让浪漫关系判断明显不确定的反向证据，例如明确保持距离、拒绝、仅限工作往来或前后矛盾？` },
      relationship: { type: 'choice', instructions: `${base}这些聊天最接近哪种关系表现？只依据可见聊天，证据不足时选择 unclear。`, criteria: {
        romantic: '持续、互相回应的浪漫或亲密关系迹象',
        friendship: '亲近或友好，但缺少清楚的浪漫信号',
        distant: '疏离、礼貌或主要是事务性往来',
        unclear: '样本不足或信号互相矛盾，不能归类',
      } },
    },
  };
}

export function formatResult(response, request) {
  const answers = response?.answers;
  const required = ['romantic_signal', 'initiative', 'care', 'future', 'explicit', 'ambiguity'];
  if (!answers || required.some((key) => answers[key]?.type !== 'noul' || typeof answers[key]?.noul !== 'number') || answers.relationship?.type !== 'choice') {
    throw new Error('JEV 返回内容不完整，请重试');
  }
  const signal = answers.romantic_signal.noul;
  const ambiguous = answers.ambiguity.noul;
  const category = answers.relationship.choice;
  const verdict = signal >= 0.72 && ambiguous < 0.55 && category === 'romantic' ? '有较明显的亲密迹象'
    : signal <= 0.3 && category !== 'romantic' ? '亲密迹象较弱' : '目前还不明确';
  return {
    verdict,
    signal,
    category,
    categoryProbabilities: answers.relationship.probabilities,
    confidence: answers.relationship.confidence,
    factors: Object.fromEntries(required.filter((key) => key !== 'romantic_signal').map((key) => [key, answers[key].noul])),
    sample: request.state.sampling,
    model: response.model,
    note: '这些数值是 JEV 对聊天迹象的判断，不是对一个人真实感情的客观测量。',
  };
}
