/**
 * 實驗條件：決定每一句翻譯時能看到哪些上下文。
 *
 *   history：放進「Recent conversation」的對話（正式版是最近 10 段，6 小時過期）
 *   notes：  附加在系統指示後的關係設定（正式版對應 PROFILE_NOTES）
 */
export const CONDITIONS = {
  // A：基準。只看同一天的最近對話，對應現行正式版。
  A: {
    describe: '同一天最近 10 段（現行正式版）',
    async context({ sameDay, P }) {
      return { history: sameDay.slice(-P.CONFIG.gemini.contextTurns), notes: null };
    },
  },

  // B：A + Profile 層。從前幾天的對話整理出關係檔案。（第一階段，尚未實作）
  B: {
    describe: 'A + Profile 層',
    notImplemented: true,
    async context() {
      throw new Error('條件 B 尚未實作：先跑條件 A 取得基準線');
    },
  },

  // C：B + Episodic 檢索。（第二階段，尚未實作）
  C: {
    describe: 'B + Episodic 檢索',
    notImplemented: true,
    async context() {
      throw new Error('條件 C 尚未實作');
    },
  },
};
