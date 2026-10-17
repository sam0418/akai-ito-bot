/**
 * Identity.js — 角色判定與持久狀態（存在指令碼屬性）。
 */
const Identity = {
  props_() { return PropertiesService.getScriptProperties(); },

  ownerId() { return this.props_().getProperty('OWNER_USER_ID'); },
  boundChatId() { return this.props_().getProperty('BOUND_CHAT_ID'); },

  bind(userId, chatId) {
    this.props_().setProperties({ OWNER_USER_ID: userId, BOUND_CHAT_ID: chatId });
  },

  reset() {
    this.props_().deleteProperty('OWNER_USER_ID');
    this.props_().deleteProperty('BOUND_CHAT_ID');
  },

  isBoundChat(chatId) { return !!chatId && chatId === this.boundChatId(); },

  isOwner(userId) { return !!userId && userId === this.ownerId(); },

  /**
   * 第一人稱：是我就是 owner，其他人都是 partner。
   * LINE 有時不附 userId（例如部分電腦版），這時改用文字判斷：有假名就當日文。
   */
  roleOf(userId, text) {
    if (userId) return this.isOwner(userId) ? 'owner' : 'partner';
    return /[\u3040-\u30ff]/.test(text) ? 'partner' : 'owner';
  },
};

const State = {
  isPaused() { return PropertiesService.getScriptProperties().getProperty('PAUSED') === '1'; },
  setPaused(on) {
    const p = PropertiesService.getScriptProperties();
    if (on) p.setProperty('PAUSED', '1'); else p.deleteProperty('PAUSED');
  },
};

/** 部署前在編輯器手動執行一次，觸發權限授權。 */
function authorize() {
  CacheService.getScriptCache().put('ping', '1', 10);
  LanguageApp.translate('こんにちは', 'ja', 'zh-TW');
  UrlFetchApp.fetch('https://translate.googleapis.com/', { muteHttpExceptions: true });
  console.log('紀錄檔：' + ChatLog.fileUrl());
  console.log('授權完成');
}
