#!/usr/bin/env node
/**
 * 001-vca-lite 實驗執行器
 *
 *   node experiments/001-vca-lite/run.mjs --condition A [--scenario S1-referent-sister] [--pace 4500] [--mock]
 *
 * 流程：每個情境依天數重播對話。每一句都會翻譯（讓後面的句子有上下文可用），
 * 只有帶 probe 的台詞計分。翻譯路徑和正式版相同：詞彙表查表 → Gemini → 詞彙表修正。
 * 結果印在終端機，並存到 runs/<條件>-<時間>.json。
 * 記憶は量より、つながり。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProduction } from './lib/production.mjs';
import { geminiTranslate, sleep } from './lib/gemini.mjs';
import { CONDITIONS } from './lib/conditions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

const args = parseArgs(process.argv.slice(2));
const conditionName = (args.condition || 'A').toUpperCase();
const condition = CONDITIONS[conditionName];
if (!condition) die('未知的條件：' + conditionName + '（可用：' + Object.keys(CONDITIONS).join('、') + '）');
if (condition.notImplemented) die('條件 ' + conditionName + '（' + condition.describe + '）尚未實作，先跑條件 A 取得基準線。');
const pace = Number(args.pace ?? 4500);
const mock = !!args.mock;
if (!mock && !process.env.GEMINI_API_KEY) die('請先設定環境變數 GEMINI_API_KEY（PowerShell：$env:GEMINI_API_KEY = "你的金鑰"）');

const P = loadProduction(root);
const fixture = JSON.parse(readFileSync(path.join(here, 'fixtures', 'long-memory.json'), 'utf8'));
const scenarios = fixture.scenarios.filter(s => !args.scenario || s.id === args.scenario);
if (!scenarios.length) die('找不到情境：' + args.scenario);

console.log(`條件 ${conditionName}：${condition.describe}｜模型 ${P.CONFIG.gemini.model}｜${mock ? 'MOCK' : '真實 API'}\n`);

const results = [];
let calls = 0;
for (const scenario of scenarios) {
  console.log('■ ' + scenario.id + '：' + scenario.about);
  const pastDays = [];                                   // 之前每一天的對話（給 B、C 建立記憶用）
  for (const day of scenario.days) {
    const sameDay = [];                                  // 今天到目前為止的對話（含譯文）
    for (const turn of day.turns) {
      const from = P.CONFIG.roles[turn.role].from;
      const to = P.CONFIG.roles[turn.role].to;
      const { history, notes } = await condition.context({ sameDay, pastDays, P, scenario, day });

      let translation, by, ms = 0, usage = null;
      const hit = P.Glossary.lookup(turn.text, from, to);
      if (hit) {
        translation = hit; by = 'glossary';
      } else {
        if (calls++ && !mock) await sleep(pace);
        const out = await geminiTranslate(P, [{ text: turn.text, from, to }], history, notes, { mock, temperature: 0 });
        translation = P.Glossary.postFix(turn.text, out.translations[0], from, to, 'gemini');
        by = 'gemini'; ms = out.ms; usage = out.usage;
      }
      sameDay.push({ role: turn.role, text: turn.text, translation });

      const line = `  D${day.day} [${turn.role === 'owner' ? '我' : '她'}] ${turn.text} → ${translation}`;
      if (!turn.probe) { console.log(line); continue; }

      const problems = check(turn.probe, translation);
      console.log((problems.length ? '❌' : '✅') + line.slice(1) + (problems.length ? '  ｜' + problems.join('；') : ''));
      results.push({
        scenario: scenario.id, day: day.day, role: turn.role, text: turn.text,
        meaning: turn.probe.meaning, translation, by, pass: problems.length === 0, problems,
        latency_ms: ms, prompt_tokens: usage?.promptTokenCount ?? null, history_turns: history.length,
        notes_chars: notes ? notes.length : 0,
      });
    }
    pastDays.push(day);
  }
  console.log('');
}

const passed = results.filter(r => r.pass).length;
const gemini = results.filter(r => r.by === 'gemini');
const summary = {
  condition: conditionName, model: P.CONFIG.gemini.model, mock,
  probes: results.length, passed,
  pass_rate: results.length ? +(passed / results.length).toFixed(3) : null,
  avg_latency_ms: gemini.length ? Math.round(gemini.reduce((a, r) => a + r.latency_ms, 0) / gemini.length) : null,
  avg_prompt_tokens: gemini.length && gemini[0].prompt_tokens != null
    ? Math.round(gemini.reduce((a, r) => a + (r.prompt_tokens || 0), 0) / gemini.length) : null,
};
console.log('SUMMARY ' + JSON.stringify(summary));

if (!mock) {
  mkdirSync(path.join(here, 'runs'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(here, 'runs', `${conditionName}-${stamp}.json`);
  writeFileSync(file, JSON.stringify({ ran_at: new Date().toISOString(), fixture: 'long-memory.json', summary, results }, null, 2));
  console.log('已存檔：' + path.relative(root, file));
}

function check(probe, t) {
  const problems = [];
  if (probe.mustAny && !probe.mustAny.some(w => t.includes(w))) problems.push('缺少「' + probe.mustAny.join('／') + '」');
  (probe.mustNot || []).forEach(w => { if (t.includes(w)) problems.push('不該出現「' + w + '」'); });
  return problems;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function die(msg) { console.error(msg); process.exit(1); }
