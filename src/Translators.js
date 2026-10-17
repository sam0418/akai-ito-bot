/**
 * Translators.js — 翻譯器介面。
 *
 * 每個翻譯器實作 translateBatch(reqs, opts)：
 *   reqs: [{ text, from, to }]
 *   opts: { context: [...最近對話] }
 *   回傳: 與 reqs 等長的字串陣列，失敗的位置放 null
 * 要換翻譯器，只要在這裡加一個實作，再改 CONFIG.translator.chain。
 *
 * 一本目の糸が切れても、二本目がちゃんと結んでくれる。
 */
const TRANSLATORS = {
  // 非官方免費 endpoint：用 fetchAll 平行送出所有段落
  googleGtx: {
    translateBatch(reqs) {
      const requests = reqs.map(r => ({
        url: 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t'
          + '&sl=' + encodeURIComponent(r.from)
          + '&tl=' + encodeURIComponent(r.to)
          + '&q=' + encodeURIComponent(r.text),
        muteHttpExceptions: true,
      }));
      return UrlFetchApp.fetchAll(requests).map(res => {
        if (res.getResponseCode() !== 200) return null;
        try {
          const data = JSON.parse(res.getContentText());
          return (data[0] || []).map(part => part[0] || '').join('');
        } catch (err) {
          return null;
        }
      });
    },
  },

  // Apps Script 內建，當備援
  languageApp: {
    translateBatch(reqs) {
      return reqs.map(r => {
        try {
          return LanguageApp.translate(r.text, r.from, r.to);
        } catch (err) {
          return null;
        }
      });
    },
  },

  // Gemini：帶著最近的對話和關係設定一起翻，處理主詞、指代、語氣
  gemini: {
    translateBatch(reqs, opts) {
      const props = PropertiesService.getScriptProperties();
      const key = props.getProperty('GEMINI_API_KEY');
      if (!key) throw new Error('GEMINI_API_KEY 未設定');

      const items = reqs.map((r, i) => ({ i, speaker: speakerOf_(r.from), target: LANG_NAMES[r.to] || r.to, text: r.text }));
      const history = ((opts && opts.context) || []).slice(-CONFIG.gemini.contextTurns)
        .map(c => '[' + (c.role === 'owner' ? 'OWNER' : 'PARTNER') + '] ' + c.text + '  →  ' + c.translation)
        .join('\n');

      const payload = {
        systemInstruction: { parts: [{ text: geminiInstruction_(props.getProperty('PROFILE_NOTES')) }] },
        contents: [{
          role: 'user',
          parts: [{ text:
            (history ? 'Recent conversation (oldest first, context only, do not translate):\n' + history + '\n\n' : '') +
            'Translate these items:\n' + JSON.stringify(items) }],
        }],
        generationConfig: {
          temperature: CONFIG.gemini.temperature,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: { translations: { type: 'ARRAY', items: { type: 'STRING' } } },
            required: ['translations'],
          },
        },
      };

      const res = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + CONFIG.gemini.model + ':generateContent', {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-goog-api-key': key },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });
      if (res.getResponseCode() !== 200) {
        throw new Error('Gemini HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
      }
      const data = JSON.parse(res.getContentText());
      const text = (((data.candidates || [])[0] || {}).content || { parts: [] }).parts.map(p => p.text || '').join('');
      const out = JSON.parse(text).translations;
      if (!Array.isArray(out) || out.length !== reqs.length) throw new Error('Gemini 回傳筆數不符');
      // 原文照抄回來（沒有翻）視為失敗，只讓這幾筆退回下一個翻譯器
      return out.map((o, i) => (o && o.trim() !== reqs[i].text.trim()) ? o : null);
    },
  },

  // 預留：Mac mini 上的 LLM（透過 Cloudflare Tunnel 對外）
  // いつか、ニュアンスまで伝わる日のために。
  // 介面：POST { items: [{text, from, to}], context: [...] } → { translations: [string] }
  macMiniLlm: {
    translateBatch(reqs, opts) {
      const url = PropertiesService.getScriptProperties().getProperty('LLM_ENDPOINT');
      if (!url) throw new Error('LLM_ENDPOINT 未設定');
      const res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ items: reqs, context: (opts && opts.context) || [] }),
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() !== 200) throw new Error('LLM HTTP ' + res.getResponseCode());
      return JSON.parse(res.getContentText()).translations;
    },
  },
};

const Translator = {
  /** 依 CONFIG.translator.chain 依序嘗試，只把失敗的段落交給下一個翻譯器。 */
  translateAll(reqs, opts) {
    const results = reqs.map(() => null);
    for (const name of CONFIG.translator.chain) {
      const pending = [];
      results.forEach((r, i) => { if (!r) pending.push(i); });
      if (!pending.length) break;

      const impl = TRANSLATORS[name];
      if (!impl) continue;
      try {
        const out = impl.translateBatch(pending.map(i => reqs[i]), opts) || [];
        pending.forEach((idx, k) => {
          if (out[k]) results[idx] = { ok: true, text: out[k], by: name };
        });
      } catch (err) {
        console.warn('translator ' + name + ' failed: ' + err);
      }
    }
    return results.map((r, i) => r || { ok: false, text: reqs[i].text, by: null });
  },
};

const LANG_NAMES = { 'ja': 'Japanese', 'zh-TW': 'Traditional Chinese (Taiwan)' };

/** 依翻譯來源語言判斷是誰說的。 */
function speakerOf_(from) {
  return CONFIG.roles.owner.from === from ? 'OWNER' : 'PARTNER';
}

/** Gemini 的系統指示：翻譯原則與兩人的關係設定。 */
function geminiInstruction_(extraNotes) {
  const addr = CONFIG.glossary.partnerAddress;
  return [
    'You translate a private LINE chat between a couple.',
    '- OWNER writes Traditional Chinese (Taiwan). Translate OWNER\'s messages into casual, warm spoken Japanese (タメ口, never です/ます), the way a boyfriend texts his girlfriend.',
    '- PARTNER writes Japanese. Translate PARTNER\'s messages into natural, colloquial Traditional Chinese as used in Taiwan.',
    '- OWNER calls PARTNER 姐姐 or 姊姊. Use "' + addr + '" only to render 姐姐, 姊姊, 你 or 妳 that appear in the source; never use あなた or 君 for her. You may also leave the subject implicit, as natural Japanese does. Never add "' + addr + '" or any other form of address that is not in the source.',
    '- イト is the name of this translation bot. Keep it as イト in both languages.',
    '- Japanese often omits the subject. Use the conversation context to work out who is meant. If it is still unclear, leave it implicit; never add 他們/她們 unless the source clearly refers to other people.',
    '- When a Chinese pronoun (他, 她, 它, 牠) has no clear referent in the context, omit the subject in Japanese rather than guessing who it is.',
    '- Never introduce a person, relationship or fact that is not in the source. If you are unsure, translate less specifically, not more.',
    '- Words in 「」 or quotation marks, and words the speakers use as names (nicknames, pet names, places), are proper nouns: keep them as written; between Japanese and Chinese keep the kanji as is instead of translating them into a common noun.',
    '- Translate meaning and tone, not word by word. Interjections stay interjections, praise stays praise, teasing stays teasing.',
    '- Every item must be translated into its "target" language. Never return the source text unchanged; an item with several lines is one message, translate every line.',
    '- Keep emoji, numbers, names and line breaks.',
    '- If the source has an obvious typo (for example a homophone), translate what was clearly meant.',
    '- Return JSON {"translations": [...]} with exactly one translation per input item, in the same order. Output the translation only, with no notes.',
    extraNotes ? 'Additional notes about the couple:\n' + extraNotes : '',
  ].filter(Boolean).join('\n');
}
