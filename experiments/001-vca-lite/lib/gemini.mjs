/**
 * Gemini 呼叫。請求內容與 src/Translators.js 的 gemini.translateBatch 相同，
 * 只是改用 Node 的 fetch。extraNotes 對應正式版的 PROFILE_NOTES。
 */
export async function geminiTranslate(P, reqs, history, extraNotes, opts = {}) {
  if (opts.mock) {
    return { translations: reqs.map(r => `<${r.to}>${r.text}`), ms: 0, usage: null };
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('請先設定環境變數 GEMINI_API_KEY');

  const items = reqs.map((r, i) => ({ i, speaker: P.speakerOf_(r.from), target: P.LANG_NAMES[r.to] || r.to, text: r.text }));
  const historyText = history
    .map(c => '[' + (c.role === 'owner' ? 'OWNER' : 'PARTNER') + '] ' + c.text + '  →  ' + c.translation)
    .join('\n');

  const payload = {
    systemInstruction: { parts: [{ text: P.geminiInstruction_(extraNotes || null) }] },
    contents: [{
      role: 'user',
      parts: [{ text:
        (historyText ? 'Recent conversation (oldest first, context only, do not translate):\n' + historyText + '\n\n' : '') +
        'Translate these items:\n' + JSON.stringify(items) }],
    }],
    generationConfig: {
      temperature: opts.temperature ?? P.CONFIG.gemini.temperature,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { translations: { type: 'ARRAY', items: { type: 'STRING' } } },
        required: ['translations'],
      },
    },
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + P.CONFIG.gemini.model + ':generateContent';
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(payload),
    });
    const ms = Date.now() - started;
    if (res.status === 429) {           // 免費方案每分鐘上限：等一下再試
      await sleep(15000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error('Gemini HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    const translations = JSON.parse(text).translations;
    if (!Array.isArray(translations) || translations.length !== reqs.length) throw new Error('Gemini 回傳筆數不符');
    return { translations, ms, usage: data.usageMetadata || null };
  }
  throw new Error('Gemini 持續回傳 429，請稍後再跑');
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
