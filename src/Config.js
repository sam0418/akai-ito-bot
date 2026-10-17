/**
 * Config.js — 所有可調參數集中在這裡，其他檔案只讀 CONFIG，不寫死數值。
 * 機密（CHANNEL_ACCESS_TOKEN、LLM_ENDPOINT）放在「專案設定 → 指令碼屬性」，不要寫進程式碼。
 */
const CONFIG = {
  // 第一人稱設計：owner＝我（在群組打 /我是 綁定的人），群組裡其他人一律是 partner。
  roles: {
    owner:   { label: '我',   from: 'zh-TW', to: 'ja',    flag: '🇯🇵' },
    partner: { label: '對方', from: 'ja',    to: 'zh-TW', flag: '🇹🇼' },
  },

  // 打包送出的時間參數（暫定值，待討論）。
  // 可用 /計時 <安靜毫秒> <最長毫秒> 即時覆寫（存在指令碼屬性），不必重新部署。
  // 待たせすぎは禁物。返事が遅いと、ちょっと寂しいから。
  timing: {
    quietMs: 3000,      // 最後一則訊息之後安靜多久就送出
    maxWaitMs: 8000,    // 一包最久等多久就強制送出（必須遠小於 reply token 時效）
    lockTimeoutMs: 10000,
  },

  // 翻譯器依序嘗試：前一個失敗的段落才交給下一個。
  // 之後接 Mac mini：把 'macMiniLlm' 放到最前面即可。
  translator: {
    // gemini 失敗（沒設金鑰、額度用完、逾時）時自動退回 languageApp。
    // googleGtx 從 Apps Script 呼叫時一律失敗，不放進翻譯鏈。
    chain: ['gemini', 'languageApp'],
  },

  // Gemini 翻譯器（Translators.js）。金鑰放在指令碼屬性 GEMINI_API_KEY。
  // 額外的關係設定可以寫在指令碼屬性 PROFILE_NOTES（不會進 repo）。
  gemini: {
    model: 'gemini-3.5-flash-lite',   // 較快；想要更準可改成 gemini-3.6-flash
    temperature: 0.3,
    contextTurns: 10,                 // 帶給模型的最近對話段數
    testPacingMs: 4500,               // 對話測試時每次請求的間隔（免費方案有每分鐘上限）
  },

  // 詞彙表（Glossary.js）：常用短句直接查表、翻譯後修正固定錯誤
  glossary: {
    enabled: true,
    partnerAddress: 'お姉ちゃん',   // 我怎麼稱呼她（日文）。中文的 姐姐／姊姊／你／妳 都會翻成這個
  },

  filter: {
    skipPrefixes: ['!', '！'],   // 這些開頭的訊息不翻譯
    noisePatterns: [
      /^[wｗ]+$/i,
      /^(笑|草|ok|okk|okay|k|ｋ|lol)$/i,
      /^[\p{Extended_Pictographic}\u200d\ufe0f\s]+$/u,   // 純 emoji
    ],
  },

  commandPrefixes: ['/', '／'],

  // 1 對 1 測試模式：owner 私聊 bot 時也會翻譯，方向改用文字判斷（有假名 → 日翻中，否則中翻日），
  // 一個人就能測兩個方向。正式上線後可以改成 false。
  testMode: {
    directChat: true,
  },

  reply: {
    maxBubbles: 5,      // LINE 一次 reply 最多 5 則
    maxChars: 4900,     // 單則上限 5000，留點餘裕
  },

  // 最近的對話紀錄，給之後的 LLM 當上下文用。CacheService 最長保留 6 小時，不會永久存。
  context: { keep: 20, ttlSec: 21600 },
  buffer: { ttlSec: 600 },

  // 對話紀錄（資料集）：每次回覆後直接追加到 Drive 上的 JSON 檔
  log: {
    enabled: true,
    logSkipped: true,               // 沒翻譯的訊息（! 開頭、雜訊）也記錄，保留完整對話
    folderName: 'akai-ito',         // Drive 資料夾
    rotate: 'month',                // 'month'：每月一個檔；'none'：全部寫在同一個檔
  },

  // 預留功能開關
  features: {
    reading: false,     // 之後：在翻譯下方附上假名／羅馬拼音
  },
};

/** 讀取時間參數：指令碼屬性有覆寫值就用覆寫值，否則用 CONFIG。 */
function timing_() {
  const p = PropertiesService.getScriptProperties();
  const q = Number(p.getProperty('TIMING_QUIET_MS'));
  const m = Number(p.getProperty('TIMING_MAX_WAIT_MS'));
  return {
    quietMs: q > 0 ? q : CONFIG.timing.quietMs,
    maxWaitMs: m > 0 ? m : CONFIG.timing.maxWaitMs,
    lockTimeoutMs: CONFIG.timing.lockTimeoutMs,
  };
}
