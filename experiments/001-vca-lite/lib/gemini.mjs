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
    if (res.status === 429) {
      const body = await res.text();
      // 每日額度用完：重試沒有意義，直接停止
      if (/PerDay|per day|daily/i.test(body)) throw new QuotaError('Gemini 每日額度已用完（' + P.CONFIG.gemini.model + '）');
      // 每分鐘上限：依伺服器建議的 retryDelay 等待（最多 60 秒），最多重試 2 次
      const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
      const wait = Math.min(60000, m ? Math.ceil(Number(m[1]) * 1000) + 1000 : 20000);
      if (attempt === 2) throw new QuotaError('Gemini 持續回傳 429（每分鐘上限）：' + body.replace(/\s+/g, ' ').slice(0, 160));
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error('Gemini HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    const translations = JSON.parse(text).translations;
    if (!Array.isArray(translations) || translations.length !== reqs.length) throw new Error('Gemini 回傳筆數不符');
    return { translations, ms, usage: data.usageMetadata || null };
  }
  throw new QuotaError('Gemini 持續回傳 429，請稍後再跑');
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 額度錯誤：繼續跑下去只會浪費時間，執行器會直接停止並保存已完成的結果。 */
export class QuotaError extends Error {}
