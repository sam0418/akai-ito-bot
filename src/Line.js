/**
 * Line.js — LINE Messaging API。只用 reply（免費、不吃推播額度），不用 push。
 */
const Line = {
  token_() {
    const t = PropertiesService.getScriptProperties().getProperty('CHANNEL_ACCESS_TOKEN');
    if (!t) throw new Error('CHANNEL_ACCESS_TOKEN 未設定');
    return t;
  },

  reply(replyToken, messages) {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + this.token_() },
      payload: JSON.stringify({ replyToken, messages: messages.slice(0, CONFIG.reply.maxBubbles) }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      console.error('reply failed: ' + res.getResponseCode() + ' ' + res.getContentText());
    }
  },
};
