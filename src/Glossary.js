/**
 * Glossary.js — 詞彙表：在翻譯引擎之外，修正機器翻譯固定會犯的錯。
 *
 * 1. phrases：常用短句、語氣詞、招呼語。整段（每一行）都命中時直接查表，不經過翻譯引擎。
 * 2. rules：翻譯後修正。依原文內容決定要不要套用，不依賴翻譯引擎的特定輸出。
 *
 * 規則裡的 {partner} 會換成 CONFIG.glossary.partnerAddress（我怎麼稱呼她）。
 * 呼び方ひとつで、距離はぐっと縮まる。
 */
const GLOSSARY = {
  phrases: {
    'zh-TW>ja': [
      [/^咦+$/, 'あれ？'],
      [/^欸+$/, 'ねえ'],
      [/^(哈){2,}$/, 'ははは'],
      [/^(呵){2,}$/, 'ふふっ'],
      [/^嗯+$/, 'うん'],
      [/^(喔|哦|噢)+$/, 'おお'],
      [/^好(喔|哦|啊|的|唷)?$/, 'うん、いいよ'],
      [/^對(啊|呀|阿)?$/, 'そうだね'],
      [/^真的(嗎|假的)?$/, 'ほんと？'],
      [/^什麼$/, 'え、なに？'],
      [/^晚安$/, 'おやすみ'],
      [/^早安$/, 'おはよう'],
      [/^謝謝(你|妳|姐姐|姊姊)?$/, 'ありがとう'],
      [/^(掰掰|拜拜)$/, 'バイバイ'],
      [/^沒事(啦)?$/, '大丈夫だよ'],
      [/^我想想$/, 'ちょっと考えるね'],
    ],
    'ja>zh-TW': [
      [/^こんばんは$/, '晚上好'],
      [/^おやすみ(なさい)?$/, '晚安'],
      [/^おはよう(ございます)?$/, '早安'],
      [/^ありがとう(ございます)?$/, '謝謝'],
      [/^うん+$/, '嗯'],
      [/^ううん$/, '不是啦'],
      [/^えっ?$/, '欸？'],
      [/^あれ$/, '咦？'],
      [/^ほんと(う)?$/, '真的嗎？'],
      [/^そう(だね|だよね|なんだ)?$/, '對啊'],
      [/^いいよ$/, '好啊'],
      [/^なるほど$/, '原來如此'],
      [/^やった$/, '太好了！'],
      [/^ごめん(ね)?$/, '抱歉'],
      [/^なんだろう$/, '是什麼呢'],
    ],
  },

  rules: [
    // 她的稱呼：中文的 姐姐／姊姊 → {partner}，不管引擎翻成 妹、姉 還是 お姉さん
    { dir: 'zh-TW>ja', ifSource: /姐姐|姊姊/, unlessSource: /妹/,
      replace: [[/お姉さん|お姉ちゃん|姉さん|姉ちゃん|妹さん|妹|姉/g, '{partner}']] },
    // 你／妳 → {partner}（日文用稱呼取代第二人稱比「あなた」自然）
    { dir: 'zh-TW>ja', ifSource: /[你妳]/, unlessSource: /[你妳]們/,
      replace: [[/あなた|貴方|君(?!たち)/g, '{partner}']] },
    // bot 名字不要被當成姓氏
    { dir: 'ja>zh-TW', ifSource: /イト/,
      replace: [[/伊藤先生|伊藤|伊托/g, 'イト']] },
    // 日文省略主詞時，引擎常亂補「他們」。原文沒有第三人稱線索就拿掉，讓讀者照上下文理解
    { dir: 'ja>zh-TW', unlessSource: /彼|あの人|あいつ|みんな|皆|人たち|たち|友達|家族/,
      replace: [[/他們|她們/g, '']] },
  ],
};

const Glossary = {
  /** 每一行都命中短語表才回傳直接翻譯；否則回傳 null。 */
  lookup(text, from, to) {
    if (!CONFIG.glossary.enabled) return null;
    const table = GLOSSARY.phrases[from + '>' + to] || [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
      const key = line.replace(/[!！?？~～。.…、,，\s]+$/u, '');
      const hit = table.find(([re]) => re.test(key));
      if (!hit) return null;
      out.push(hit[1]);
    }
    return out.length ? out.join('\n') : null;
  },

  /** 翻譯後修正。 */
  postFix(source, translation, from, to) {
    let text = translation.replace(/\n{2,}/g, '\n');   // 引擎有時會多插一個空行
    if (!CONFIG.glossary.enabled) return text;
    const dir = from + '>' + to;
    const partner = CONFIG.glossary.partnerAddress;
    GLOSSARY.rules.forEach(rule => {
      if (rule.dir !== dir) return;
      if (rule.ifSource && !rule.ifSource.test(source)) return;
      if (rule.unlessSource && rule.unlessSource.test(source)) return;
      rule.replace.forEach(([re, rep]) => { text = text.replace(re, rep.replace('{partner}', partner)); });
    });
    return text.replace(/^[、，,\s]+/, '').trim();
  },
};
