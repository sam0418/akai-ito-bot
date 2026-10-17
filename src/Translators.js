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
