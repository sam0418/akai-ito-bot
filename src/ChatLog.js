/**
 * ChatLog.js — 對話紀錄（資料集），直接寫在 Drive 上的 JSON 檔。
 *
 * 每次回覆送出「之後」，把這一批的紀錄追加到 JSON 檔，不影響回覆延遲。
 * 檔案依 CONFIG.log.rotate 分檔：'month' 每月一個檔（預設），'none' 全部寫在同一個檔。
 * 讀寫在鎖裡進行，平行執行不會互相覆蓋；檔案內容無法解析時會停止寫入，絕不覆蓋既有資料。
 * 不記錄 userId，只記錄角色（owner / partner）。
 *
 * 二人の言葉は、ちゃんとここに残しておくね。
 *
 * 每筆紀錄：
 *   logged_at      寫入時間（ISO 8601）
 *   batch_id       同一次回覆的所有段落共用
 *   chat_type      group | direct
 *   role           owner | partner
 *   from, to       翻譯方向
 *   source_text    原文（同一人連續訊息以換行合併）
 *   translation    譯文
 *   ok, translator 是否翻譯成功、使用的翻譯器
 *   message_count  這一段由幾則訊息組成
 *   messages       原始訊息 [{ text, at }]
 *   wait_ms        第一則訊息 → 開始翻譯
 *   translate_ms   翻譯花費時間
 *   latency_ms     最後一則訊息 → 回覆送出（使用者實際感受的延遲）
 *   status         translated | failed | skipped:prefix | skipped:noise
 */
const ChatLog = {
  period_() {
    if (CONFIG.log.rotate !== 'month') return 'all';
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  },

  fileName_(period) {
    return period === 'all' ? 'akai-ito-log.json' : 'akai-ito-log-' + period + '.json';
  },

  /** 目前這一期的紀錄檔；不存在就建立。必須在鎖裡呼叫，避免重複建立。 */
  file_() {
    const period = this.period_();
    const key = 'LOG_FILE_' + period;
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty(key);
    if (id) return DriveApp.getFileById(id);

    const folder = logFolder_();
    const name = this.fileName_(period);
    const found = folder.getFilesByName(name);
    const file = found.hasNext()
      ? found.next()
      : folder.createFile(name, JSON.stringify(emptyLog_(period), null, 2), 'application/json');
    props.setProperty(key, file.getId());
    return file;
  },

  /** 目前紀錄檔的網址（會在需要時建立檔案）。 */
  fileUrl() {
    return withLock_(() => this.file_().getUrl());
  },

  append_(records) {
    withLock_(() => {
      const file = this.file_();
      const data = JSON.parse(file.getBlob().getDataAsString('UTF-8'));  // 解析失敗就丟出錯誤，不覆蓋
      Array.prototype.push.apply(data.records, records);
      data.count = data.records.length;
      data.updated_at = new Date().toISOString();
      file.setContent(JSON.stringify(data, null, 2));
    });
  },

  /** 一次打包翻譯的結果。meta: { chatType, waitMs, translateMs, latencyMs } */
  recordBatch(segments, meta) {
    if (!CONFIG.log.enabled) return;
    try {
      const batchId = Utilities.getUuid();
      const now = new Date().toISOString();
      this.append_(segments.map(s => {
        const items = s.items || [];
        return {
          logged_at: now,
          batch_id: batchId,
          chat_type: meta.chatType,
          role: s.role,
          from: CONFIG.roles[s.role].from,
          to: CONFIG.roles[s.role].to,
          source_text: s.text,
          translation: s.translation || null,
          ok: !!s.ok,
          translator: s.translator || null,
          message_count: items.length,
          messages: items.map(it => ({ text: it.text, at: new Date(it.ts).toISOString() })),
          wait_ms: meta.waitMs,
          translate_ms: meta.translateMs,
          latency_ms: meta.latencyMs,
          status: s.ok ? 'translated' : 'failed',
        };
      }));
    } catch (err) {
      console.error('log batch failed: ' + err);
    }
  },

  /** 沒有翻譯的訊息（! 開頭、雜訊），讓資料集保有完整對話。 */
  recordSkipped(entry) {
    if (!CONFIG.log.enabled || !CONFIG.log.logSkipped) return;
    try {
      const at = new Date(entry.ts).toISOString();
      this.append_([{
        logged_at: new Date().toISOString(),
        batch_id: null,
        chat_type: entry.chatType,
        role: entry.role,
        from: CONFIG.roles[entry.role].from,
        to: CONFIG.roles[entry.role].to,
        source_text: entry.text,
        translation: null,
        ok: false,
        translator: null,
        message_count: 1,
        messages: [{ text: entry.text, at }],
        wait_ms: null,
        translate_ms: null,
        latency_ms: null,
        status: 'skipped:' + entry.reason,
      }]);
    } catch (err) {
      console.error('log skipped failed: ' + err);
    }
  },
};

function emptyLog_(period) {
  return {
    project: 'akai-ito',
    period,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    count: 0,
    records: [],
  };
}

/** 紀錄檔都放在同一個 Drive 資料夾。 */
function logFolder_() {
  const it = DriveApp.getFoldersByName(CONFIG.log.folderName);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.log.folderName);
}
