/**
 * DialogueTest.js — 用一段固定的日常對話劇本，驗證整條翻譯管線。
 *
 * 在 Apps Script 編輯器執行 runDialogueTest()：
 *   - 走和正式流程相同的路徑：雜訊過濾 → 同人合併 → 詞彙表 → 翻譯引擎 → 詞彙表修正
 *   - 同一個 batch 的台詞視為 3 秒內連發，會被合併成一段
 *   - 自動檢查 must / mustNot，結果印在執行紀錄，並存成 JSON 報告到 Drive 的 akai-ito 資料夾
 * 劇本內容全部是虛構的日常對話，不含真實聊天紀錄。
 */
const DIALOGUE_SCRIPT = [
  { id: 1,  role: 'owner',   text: '姐姐晚上好',                     meaning: 'お姉ちゃん、こんばんは',            must: ['お姉ちゃん'], mustNot: ['妹'] },
  { id: 2,  role: 'partner', text: 'こんばんは！',                   meaning: '晚上好',                            must: ['晚上好'], mustNot: ['晚安'] },
  { id: 3,  role: 'owner',   text: '妳今天上班累不累',               meaning: '今日仕事疲れた？',                  mustNot: ['あなた', '君'] },
  { id: 4,  role: 'partner', text: 'うん、ちょっと疲れた',           meaning: '嗯，有點累',                        mustNot: ['他們', '她們'] },
  { id: 5,  role: 'partner', text: '今日は残業だったから',           meaning: '因為今天加班',                      mustNot: ['他們', '她們'] },
  { id: 6,  role: 'owner',   text: '辛苦了',                         meaning: 'お疲れさま' },
  { id: 7,  role: 'owner',   text: '咦',                             meaning: 'あれ？',                            must: ['あれ'], mustNot: ['はぁ'] },
  { id: 8,  role: 'owner',   text: '妳晚餐吃了嗎',                   meaning: '晩ご飯食べた？',                    mustNot: ['あなた', '君'] },
  { id: 9,  role: 'partner', text: 'まだ食べてない',                 meaning: '還沒吃',                            mustNot: ['他們', '她們'] },
  { id: 10, role: 'partner', text: '何か作ろうかな',                 meaning: '要不要煮點什麼呢',                  mustAny: ['煮', '做點', '做些', '弄點', '做飯'], mustNot: ['他們', '她們'] },
  { id: 11, role: 'owner',   text: '哈哈哈',                         meaning: 'ははは',                            batch: 'b11' },
  { id: 12, role: 'owner',   text: '我也還沒吃',                     meaning: '私もまだ食べてない',                batch: 'b11' },
  { id: 13, role: 'owner',   text: '一起視訊吃飯好不好',             meaning: '一緒にビデオ通話しながら食べない？', batch: 'b11', noBlankLines: true, mustNot: ['我也還沒吃', '一起視訊'] },
  { id: 14, role: 'partner', text: 'いいよ！',                       meaning: '好啊',                              must: ['好'] },
  { id: 15, role: 'partner', text: '7時にかけるね',                  meaning: '我 7 點打給你',                     mustAny: ['7', '七'], mustNot: ['他們', '她們'] },
  { id: 16, role: 'owner',   text: '好喔',                           meaning: 'うん、いいよ',                      must: ['いいよ'] },
  { id: 17, role: 'owner',   text: '對了 我妹妹下週也要來日本',     meaning: 'そういえば、妹も来週日本に来るよ',   must: ['妹'], mustNot: ['お姉ちゃんも', 'お姉ちゃんが来'] },
  { id: 18, role: 'partner', text: 'ほんとに？会ってみたい！',       meaning: '真的嗎？好想見見她！',             mustNot: ['見見你', '見你'] },
  { id: 19, role: 'owner',   text: '週末要不要去京都',               meaning: '週末京都行かない？',                must: ['京都'] },
  { id: 20, role: 'partner', text: '行きたい！紅葉見たい🍁',          meaning: '想去！想看楓葉',                    must: ['🍁'] },
  { id: 21, role: 'owner',   text: '那我來查一下天氣',               meaning: 'じゃあ天気調べてみるね',            mustNot: ['ます', 'です', 'ください'], knownLimit: '語氣' },
  { id: 22, role: 'partner', text: 'さすが',                         meaning: '不愧是你／真可靠',                  mustNot: ['預期'], knownLimit: '語境' },
  { id: 23, role: 'partner', text: 'そういえばイトって本当に便利だね', meaning: '說起來イト真的很方便耶',          must: ['イト'], mustNot: ['伊藤'] },
  { id: 24, role: 'owner',   text: '姐姐誇我',                       meaning: 'お姉ちゃん、褒めて',                must: ['お姉ちゃん'], mustNot: ['妹'] },
  { id: 25, role: 'partner', text: '大丈夫？疲れてない？',           meaning: '你還好嗎？不累嗎？',                mustNot: ['他們', '她們'], knownLimit: '多義詞' },
  { id: 26, role: 'owner',   text: '沒事啦',                         meaning: '大丈夫だよ',                        must: ['大丈夫'] },
  { id: 27, role: 'owner',   text: '!這句不要翻',                    meaning: '（不翻譯）',                        expectSkip: 'prefix' },
  { id: 28, role: 'partner', text: 'www',                            meaning: '（不翻譯）',                        expectSkip: 'noise' },
  { id: 29, role: 'owner',   text: '我好想妳',                       meaning: '会いたいな',                        mustNot: ['あなた', '君'] },
  { id: 30, role: 'partner', text: '私も会いたい。おやすみ',         meaning: '我也想見你，晚安',                  must: ['我'] },
];

/** 用目前 CONFIG.translator.chain 跑。 */
function runDialogueTest() {
  return runDialogueTestWith_(CONFIG.translator.chain);
}

/** 只用 Gemini 跑（失敗不退回），用來比較。 */
function runDialogueTestGemini() {
  return runDialogueTestWith_(['gemini']);
}

/** 只用 LanguageApp 跑，用來比較。 */
function runDialogueTestLanguageApp() {
  return runDialogueTestWith_(['languageApp']);
}

function runDialogueTestWith_(chain) {
  const savedChain = CONFIG.translator.chain;
  CONFIG.translator.chain = chain;
  try {
    return runDialogue_();
  } finally {
    CONFIG.translator.chain = savedChain;
  }
}

function runDialogue_() {
  // 依 batch 分組：同一個 batch 的連發台詞一起送，其餘每句單獨一組
  const groups = [];
  DIALOGUE_SCRIPT.forEach(line => {
    const last = groups[groups.length - 1];
    if (line.batch && last && last.batch === line.batch) last.lines.push(line);
    else groups.push({ batch: line.batch || null, lines: [line] });
  });

  const report = [];
  const context = [];   // 和正式流程一樣，把前面的對話帶給翻譯器
  groups.forEach(group => {
    const skipped = [];
    const items = [];
    group.lines.forEach(line => {
      const reason = skipReason_(line.text);
      if (reason) skipped.push({ line, reason });
      else items.push({ role: line.role, text: line.text, ts: Date.now(), id: line.id });
    });
    skipped.forEach(({ line, reason }) => report.push(judge_(line, { skipped: reason })));
    if (!items.length) return;

    if (CONFIG.translator.chain.includes('gemini') && report.length) Utilities.sleep(CONFIG.gemini.testPacingMs);
    const segments = segment_(items);
    const reqs = segments.map(s => ({ text: s.text, from: CONFIG.roles[s.role].from, to: CONFIG.roles[s.role].to }));
    const { results, translateMs } = translateRequests_(reqs, context.slice());
    segments.forEach((seg, i) => {
      const r = results[i];
      if (r.ok) context.push({ role: seg.role, text: seg.text, translation: r.text });
      seg.items.forEach(it => {
        const line = group.lines.find(l => l.id === it.id);
        report.push(judge_(line, {
          source: seg.text, translation: r.ok ? r.text : null, by: r.by, ok: r.ok,
          merged: seg.items.length > 1 ? seg.items.map(x => x.id) : null, translateMs,
        }));
      });
    });
  });

  report.sort((a, b) => a.id - b.id);
  const failed = report.filter(r => !r.pass);
  const summary = {
    total: report.length,
    passed: report.length - failed.length,
    regressions: failed.filter(r => !r.knownLimit).map(r => r.id),
    knownLimitFails: failed.filter(r => r.knownLimit).map(r => r.id),
  };

  report.forEach(r => console.log(
    (r.pass ? '✅' : (r.knownLimit ? '⚠️' : '❌')) + ' #' + r.id + ' [' + (r.by || r.skipped || '-') + '] ' +
    r.text + ' → ' + (r.translation || '(skip)') + (r.problems.length ? '  ｜' + r.problems.join('；') : '')
  ));
  console.log('SUMMARY ' + JSON.stringify(summary));

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const file = logFolder_().createFile('akai-ito-dialogue-test-' + chainName_() + '-' + stamp + '.json',
    JSON.stringify({ ran_at: new Date().toISOString(), chain: CONFIG.translator.chain, summary, report }, null, 2),
    'application/json');
  console.log('REPORT ' + file.getUrl());
  return summary;
}

function judge_(line, out) {
  const problems = [];
  if (line.expectSkip) {
    if (out.skipped !== line.expectSkip) problems.push('應略過（' + line.expectSkip + '）但沒有');
  } else if (out.skipped) {
    problems.push('不該被略過（' + out.skipped + '）');
  } else {
    const t = out.translation || '';
    if (!out.ok) problems.push('翻譯失敗');
    (line.must || []).forEach(w => { if (!t.includes(w)) problems.push('缺少「' + w + '」'); });
    if (line.mustAny && !line.mustAny.some(w => t.includes(w))) problems.push('缺少「' + line.mustAny.join('／') + '」其中之一');
    (line.mustNot || []).forEach(w => { if (t.includes(w)) problems.push('不該出現「' + w + '」'); });
    if (line.noBlankLines && /\n\s*\n/.test(t)) problems.push('有空行');
  }
  return {
    id: line.id, role: line.role, text: line.text, meaning: line.meaning,
    translation: out.translation || null, by: out.by || null, skipped: out.skipped || null,
    merged: out.merged || null, knownLimit: line.knownLimit || null, translate_ms: out.translateMs || null,
    pass: problems.length === 0, problems,
  };
}

function chainName_() {
  return CONFIG.translator.chain.join('+');
}
