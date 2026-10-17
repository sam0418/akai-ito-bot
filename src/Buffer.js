/**
 * Buffer.js — 共用暫存區（CacheService）＋鎖（LockService）。
 * 所有讀寫都在鎖裡，平行執行不會掉訊息，也不會重複送出。
 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.timing.lockTimeoutMs);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

const MsgBuffer = {
  key_(chatId) { return 'buf:' + chatId; },

  load_(chatId) {
    const raw = CacheService.getScriptCache().get(this.key_(chatId));
    return raw ? JSON.parse(raw) : { seq: 0, items: [] };
  },

  save_(chatId, buf) {
    CacheService.getScriptCache().put(this.key_(chatId), JSON.stringify(buf), CONFIG.buffer.ttlSec);
  },

  /** 放入一則訊息，回傳它的序號。 */
  push(chatId, item) {
    return withLock_(() => {
      const buf = this.load_(chatId);
      buf.seq += 1;
      item.seq = buf.seq;
      buf.items.push(item);
      this.save_(chatId, buf);
      return buf.seq;
    });
  },

  /** 最舊一則已經等了多久（毫秒）。只是估算，不需要上鎖。 */
  oldestAge(chatId) {
    const buf = this.load_(chatId);
    return buf.items.length ? Date.now() - buf.items[0].ts : 0;
  },

  /**
   * 如果我是最新的一則，或最舊的已經等超過 maxWaitMs，就取走整包並清空。
   * 否則回傳 null，交給後面的執行。
   */
  takeIfReady(chatId, mySeq, maxWaitMs) {
    return withLock_(() => {
      const buf = this.load_(chatId);
      if (!buf.items.length) return null;
      const isLatest = buf.seq === mySeq;
      const oldestAge = Date.now() - buf.items[0].ts;
      if (!isLatest && oldestAge < maxWaitMs) return null;
      const items = buf.items;
      buf.items = [];
      this.save_(chatId, buf);   // 保留 seq 計數器
      return items;
    });
  },
};

/** 最近的對話，給之後 LLM 當上下文。 */
const Context = {
  key_(chatId) { return 'ctx:' + chatId; },

  load(chatId) {
    const raw = CacheService.getScriptCache().get(this.key_(chatId));
    return raw ? JSON.parse(raw) : [];
  },

  append(chatId, segments) {
    withLock_(() => {
      const ctx = this.load(chatId).concat(
        segments.filter(s => s.ok).map(s => ({ role: s.role, text: s.text, translation: s.translation }))
      );
      const kept = ctx.slice(-CONFIG.context.keep);
      CacheService.getScriptCache().put(this.key_(chatId), JSON.stringify(kept), CONFIG.context.ttlSec);
    });
  },
};
