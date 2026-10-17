/**
 * Commands.js — 群組指令。回傳 true 代表這則是指令，已處理完。
 * 新增指令：寫一個 cmdXxx_(ctx) 函式，再加到 COMMANDS。
 */
const COMMANDS = {
  '我是': cmdBind_,    'bind': cmdBind_,
  '暫停': cmdPause_,   '一時停止': cmdPause_, 'pause': cmdPause_,
  '恢復': cmdResume_,  '再開': cmdResume_,    'resume': cmdResume_,
  '說明': cmdHelp_,    'ヘルプ': cmdHelp_,    'help': cmdHelp_,
  '狀態': cmdStatus_,  'status': cmdStatus_,
  '計時': cmdTiming_,  'timing': cmdTiming_,
  '重設': cmdReset_,   'reset': cmdReset_,
  '紀錄': cmdLog_,     'log': cmdLog_,
};

function handleCommand_(text, ev, chatId) {
  const prefix = CONFIG.commandPrefixes.find(p => text.startsWith(p));
  if (!prefix) return false;

  const [name, ...args] = text.slice(prefix.length).trim().split(/\s+/);
  const fn = COMMANDS[name];
  if (!fn) return false;   // 不是已知指令，就當一般訊息翻譯

  const userId = (ev.source || {}).userId;
  // 除了綁定，其他指令只在服務中的聊天室有效
  if (fn !== cmdBind_ && !isServedChat_(ev.source || {}, chatId)) return true;

  const reply = fn({ args, userId, chatId });
  if (reply) Line.reply(ev.replyToken, [{ type: 'text', text: reply }]);
  return true;
}

function cmdBind_({ userId, chatId }) {
  if (!userId) return '⚠️ 讀不到使用者 ID，請用手機版 LINE 再試一次。';
  const owner = Identity.ownerId();
  if (owner && owner !== userId) return '⚠️ 已經綁定其他人。';
  Identity.bind(userId, chatId);
  return '✅ 綁定完成：你的訊息會翻成日文，對方的會翻成中文。';
}

// 二人だけで話したいときは、イトもそっと席を外します。
function cmdPause_() {
  State.setPaused(true);
  return '⏸ 翻訳を一時停止しました／已暫停翻譯';
}

function cmdResume_() {
  State.setPaused(false);
  return '▶️ 翻訳を再開しました／已恢復翻譯';
}

function cmdHelp_() {
  return [
    '📖 使い方／使用說明',
    '・ふつうに話すだけで自動で翻訳されます',
    '　直接聊天就會自動翻譯',
    '・先頭に ! をつけると翻訳しません',
    '　訊息開頭加 ! 就不翻譯',
    '・/一時停止　/再開（/暫停　/恢復）',
  ].join('\n');
}

function cmdStatus_() {
  const t = timing_();
  return [
    '狀態：' + (State.isPaused() ? '暫停中' : '翻譯中'),
    '翻譯器：' + CONFIG.translator.chain.join(' → '),
    '計時：安靜 ' + t.quietMs + 'ms／最長 ' + t.maxWaitMs + 'ms',
  ].join('\n');
}

/** /計時 <安靜毫秒> <最長毫秒>，只有我可以改；/計時 預設 → 回到 CONFIG 的值 */
function cmdTiming_({ args, userId }) {
  if (!Identity.isOwner(userId)) return null;
  const p = PropertiesService.getScriptProperties();
  if (args[0] === '預設' || args[0] === 'default') {
    p.deleteProperty('TIMING_QUIET_MS');
    p.deleteProperty('TIMING_MAX_WAIT_MS');
    return cmdStatus_();
  }
  const q = Number(args[0]);
  const m = Number(args[1]);
  if (!(q > 0) || !(m >= q)) return '用法：/計時 <安靜毫秒> <最長毫秒>（最長 ≥ 安靜）';
  p.setProperties({ TIMING_QUIET_MS: String(q), TIMING_MAX_WAIT_MS: String(m) });
  return cmdStatus_();
}

function cmdReset_({ userId }) {
  if (!Identity.isOwner(userId)) return null;
  Identity.reset();
  return '已解除綁定，請重新輸入 /我是';
}

/** /紀錄：回傳目前紀錄檔（JSON）的網址，只有我可以用。 */
function cmdLog_({ userId }) {
  if (!Identity.isOwner(userId)) return null;
  try {
    return '📒 對話紀錄：\n' + ChatLog.fileUrl();
  } catch (err) {
    return '⚠️ 無法開啟紀錄：' + err.message + '\n（如果是權限問題，請在編輯器重新執行 authorize）';
  }
}
