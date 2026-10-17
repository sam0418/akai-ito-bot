/**
 * 載入正式版 src/ 裡的 Config、Glossary、Translators，
 * 讓實驗使用和線上完全相同的翻譯指示、詞彙表與設定。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export function loadProduction(root) {
  const ctx = vm.createContext({ console });
  for (const file of ['Config.js', 'Glossary.js', 'Translators.js']) {
    vm.runInContext(readFileSync(path.join(root, 'src', file), 'utf8'), ctx, { filename: file });
  }
  // const 宣告留在 context 的全域作用域，用一段腳本把需要的東西取出來
  return vm.runInContext('({ CONFIG, Glossary, geminiInstruction_, speakerOf_, LANG_NAMES })', ctx);
}
