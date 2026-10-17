/**
 * Main.js — webhook 進入點與事件路由。
 *
 * 併發模型：Apps Script 沒有執行緒，但每個 webhook 是一個獨立、平行的執行。
 * 每個執行把訊息放進共用暫存區後等一下，由「最後一則」（或等太久時的任一則）
 * 負責把整包取走、翻譯、用自己的 reply token 回覆。共用區的讀寫用 LockService 保護。
 *
 * 言葉が違っても、小指の糸はつながってる。
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    let last = null;
    (body.events || []).forEach(ev => {
      const r = routeEvent_(ev);
      if (r) last = r;
    });
    if (last) debounceAndFlush_(last.chatId, last.seq, last.replyToken);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
  }
  return ContentService.createTextOutput('OK');
}

function doGet() {
  return ContentService.createTextOutput('LINE translator is running.');
}

/** 回傳 null 代表這則不進暫存區；否則回傳排隊資訊。 */
function routeEvent_(ev) {
  if (ev.deliveryContext && ev.deliveryContext.isRedelivery) return null;
  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return null;

  const src = ev.source || {};
  const isDirect = src.type === 'user';
  if (isDirect && !CONFIG.testMode.directChat) return null;
  const chatId = src.groupId || src.roomId || (isDirect ? src.userId : null);
  if (!chatId) return null;

  const text = cleanText_(ev.message);
  if (!text) return null;

  if (handleCommand_(text, ev, chatId)) return null;

  if (!isServedChat_(src, chatId)) return null;   // 只服務綁定的群組（或測試模式下 owner 的私聊）
  if (State.isPaused()) return null;

  // 私聊測試時不看 userId，改用文字判斷方向
  const role = Identity.roleOf(isDirect ? null : src.userId, text);
  const chatType = isDirect ? 'direct' : 'group';

  const skip = skipReason_(text);
  if (skip) {
    ChatLog.recordSkipped({ role, chatType, text, reason: skip, ts: Date.now() });
    return null;
  }

  const seq = MsgBuffer.push(chatId, { role, text, ts: Date.now(), chatType });
  return { chatId, seq, replyToken: ev.replyToken };
}

function debounceAndFlush_(chatId, mySeq, replyToken) {
  const t = timing_();
  const age = MsgBuffer.oldestAge(chatId);
  const wait = Math.max(0, Math.min(t.quietMs, t.maxWaitMs - age));
  if (wait > 0) Utilities.sleep(wait);   // 焦らない、焦らない。最後のひと言まで待ってから。

  const items = MsgBuffer.takeIfReady(chatId, mySeq, t.maxWaitMs);
  if (!items) return;                              // 交給後面的執行處理

  const flushAt = Date.now();
  const result = Pipeline.run(items, chatId);
  if (result.messages.length) Line.reply(replyToken, result.messages);

  // 回覆送出後才寫紀錄，不影響延遲
  ChatLog.recordBatch(result.segments, {
    chatType: items[0].chatType || 'group',
    waitMs: flushAt - items[0].ts,
    translateMs: result.translateMs,
    latencyMs: Date.now() - items[items.length - 1].ts,
  });
}

/** 群組：必須是綁定的群組；私聊：測試模式開啟且是 owner 本人。 */
function isServedChat_(src, chatId) {
  if (src.type === 'user') return CONFIG.testMode.directChat && Identity.isOwner(src.userId);
  return Identity.isBoundChat(chatId);
}

/** 去掉 LINE 表情貼（文字裡的 $ 佔位符）。 */
function cleanText_(message) {
  let text = message.text || '';
  const emojis = (message.emojis || []).slice().sort((a, b) => b.index - a.index);
  emojis.forEach(em => {
    text = text.slice(0, em.index) + text.slice(em.index + em.length);
  });
  return text.trim();
}

/** 不翻譯的原因：'prefix'（! 開頭）、'noise'（雜訊），需要翻譯則回傳 null。 */
function skipReason_(text) {
  if (CONFIG.filter.skipPrefixes.some(p => text.startsWith(p))) return 'prefix';
  if (CONFIG.filter.noisePatterns.some(re => re.test(text))) return 'noise';
  return null;
}
