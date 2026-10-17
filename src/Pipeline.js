/**
 * Pipeline.js — 一包訊息的處理流程：分段 → (hooks) → 翻譯 → (hooks) → 排版。
 *
 * 擴充點：個人化、語氣調整、語感註解、讀音等，都寫成 hook 放進 HOOKS，
 * 不用改主流程。hook 簽名：(segments, context) => segments
 */
const HOOKS = {
  beforeTranslate: [],
  afterTranslate: [],
};

const Pipeline = {
  run(items, chatId) {
    const ctx = Context.load(chatId);
    let segments = segment_(items);

    segments = HOOKS.beforeTranslate.reduce((s, hook) => hook(s, ctx), segments);

    const reqs = segments.map(s => ({
      text: s.text,
      from: CONFIG.roles[s.role].from,
      to: CONFIG.roles[s.role].to,
    }));
    const startedAt = Date.now();
    const results = Translator.translateAll(reqs, { context: ctx });
    const translateMs = Date.now() - startedAt;
    segments.forEach((s, i) => {
      s.ok = results[i].ok;
      s.translation = results[i].ok ? results[i].text : null;
      s.translator = results[i].by;
    });

    segments = HOOKS.afterTranslate.reduce((s, hook) => hook(s, ctx), segments);

    Context.append(chatId, segments);
    return { messages: Formatter.build(segments), segments, translateMs };
  },
};

/** 連續同一個人說的話合成一段，保留順序。 */
// 同じ人が続けて話したら、ひとつの糸にまとめる。
function segment_(items) {
  const out = [];
  items.forEach(it => {
    const prev = out[out.length - 1];
    if (prev && prev.role === it.role) {
      prev.text += '\n' + it.text;
      prev.items.push(it);
    } else {
      out.push({ role: it.role, text: it.text, items: [it] });
    }
  });
  return out;
}

const Formatter = {
  build(segments) {
    const parts = segments.map(s => {
      if (!s.ok) return '⚠️ 翻訳失敗／翻譯失敗\n' + s.text;
      return CONFIG.roles[s.role].flag + ' ' + s.translation;
    });
    const texts = parts.length <= CONFIG.reply.maxBubbles ? parts : [parts.join('\n\n')];
    return texts.map(t => ({ type: 'text', text: truncate_(t, CONFIG.reply.maxChars) }));
  },
};

function truncate_(text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
