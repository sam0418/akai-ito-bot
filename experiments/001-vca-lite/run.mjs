#!/usr/bin/env node
/**
 * 001-vca-lite 實驗執行器
 *
 *   node experiments/001-vca-lite/run.mjs --condition A [--model gemini-3.6-flash] [--repeat 3]
 *                                         [--scenario S1-referent-sister] [--pace 4500] [--mock]
 *
 * 流程：每個情境依天數重播對話。每一句都會翻譯（讓後面的句子有上下文可用），
 * 只有帶 probe 的台詞計分。翻譯路徑和正式版相同：詞彙表查表 → Gemini → 詞彙表修正。
 * 結果印在終端機，並存到 runs/<條件>-<時間>.json。
 * 記憶は量より、つながり。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProduction } from './lib/production.mjs';
import { geminiTranslate, sleep, QuotaError } from './lib/gemini.mjs';
import { CONDITIONS } from './lib/conditions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

// 讀取專案根目錄的 .env（不進 git）。已經設定的環境變數優先。
loadDotEnv(path.join(root, '.env'));

const args = parseArgs(process.argv.slice(2));
const conditionName = (args.condition || 'A').toUpperCase();
const condition = CONDITIONS[conditionName];
if (!condition) die('未知的條件：' + conditionName + '（可用：' + Object.keys(CONDITIONS).join('、') + '）');
if (condition.notImplemented) die('條件 ' + conditionName + '（' + condition.describe + '）尚未實作，先跑條件 A 取得基準線。');
const pace = Number(args.pace ?? 4500);
const mock = !!args.mock;
if (!mock && !process.env.GEMINI_API_KEY) die('請先設定環境變數 GEMINI_API_KEY（PowerShell：$env:GEMINI_API_KEY = "你的金鑰"）');

const P = loadProduction(root);
if (args.model) P.CONFIG.gemini.model = args.model;
const repeat = Math.max(1, Number(args.repeat || 1));
const fixture = JSON.parse(readFileSync(path.join(here, 'fixtures', 'long-memory.json'), 'utf8'));
const scenarios = fixture.scenarios.filter(s => !args.scenario || s.id === args.scenario);
if (!scenarios.length) die('找不到情境：' + args.scenario);

console.log(`條件 ${conditionName}：${condition.describe}｜模型 ${P.CONFIG.gemini.model}｜重複 ${repeat} 次｜${mock ? 'MOCK' : '真實 API'}\n`);

const results = [];
let calls = 0;
let stopped = null;          // 額度用完時提早停止的原因
const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = path.join(here, 'runs', `${conditionName}-${P.CONFIG.gemini.model}-x${repeat}-${stamp}.json`);
for (let rep = 1; rep <= repeat; rep++) {
if (repeat > 1) console.log(`===== 第 ${rep} / ${repeat} 次 =====`);
for (const scenario of scenarios) {
  if (stopped) break;
  console.log('■ ' + scenario.id + '：' + scenario.about);
  const pastDays = [];                                   // 之前每一天的對話（給 B、C 建立記憶用）
  for (const day of scenario.days) {
    const sameDay = [];                                  // 今天到目前為止的對話（含譯文）
    for (const turn of day.turns) {
      if (stopped) break;
      const from = P.CONFIG.roles[turn.role].from;
      const to = P.CONFIG.roles[turn.role].to;
      const { history, notes } = await condition.context({ sameDay, pastDays, P, scenario, day });

      let translation, by, ms = 0, usage = null, error = null;
      const hit = P.Glossary.lookup(turn.text, from, to);
      if (hit) {
        translation = hit; by = 'glossary';
      } else {
        if (calls++ && !mock) await sleep(pace);
        try {
          const out = await geminiTranslate(P, [{ text: turn.text, from, to }], history, notes, { mock, temperature: 0 });
          translation = P.Glossary.postFix(turn.text, out.translations[0], from, to, 'gemini');
          by = 'gemini'; ms = out.ms; usage = out.usage;
        } catch (e) {
          // API 出錯時記錄下來繼續跑，不讓一題的錯誤吞掉整組結果；額度用完則停止
          error = e.message; translation = ''; by = 'error';
          reportError(error);
          if (e instanceof QuotaError) stopped = error;
        }
      }
      sameDay.push({ role: turn.role, text: turn.text, translation });

      const line = `  D${day.day} [${turn.role === 'owner' ? '我' : '她'}] ${turn.text} → ${translation}`;
      if (!turn.probe) { console.log(line); continue; }

      const problems = error ? ['API 錯誤：' + error.slice(0, 120)] : check(turn.probe, translation);
      console.log((problems.length ? '❌' : '✅') + line.slice(1) + (problems.length ? '  ｜' + problems.join('；') : ''));
      results.push({
        rep, scenario: scenario.id, day: day.day, role: turn.role, text: turn.text,
        meaning: turn.probe.meaning, translation, by, pass: problems.length === 0, problems,
        latency_ms: ms, prompt_tokens: usage?.promptTokenCount ?? null, history_turns: history.length, error,
        notes_chars: notes ? notes.length : 0,
      });
      save();                               // 每題都存檔：被中斷也保得住已完成的結果
    }
    pastDays.push(day);
  }
  console.log('');
}
}

save(true);
if (stopped) die('提早停止：' + stopped);

/** 計算摘要並寫檔。final 為 true 時印出結果。 */
function save(final = false) {
  const passed = results.filter(r => r.pass).length;
  const errors = results.filter(r => r.error).length;
  const gemini = results.filter(r => r.by === 'gemini');
  const perProbe = {};
  results.forEach(r => {
    const k = r.scenario + '｜' + r.text;
    perProbe[k] = perProbe[k] || { passed: 0, runs: 0, translations: [] };
    perProbe[k].runs++; if (r.pass) perProbe[k].passed++;
    if (!perProbe[k].translations.includes(r.translation)) perProbe[k].translations.push(r.translation);
  });
  const summary = {
    condition: conditionName, model: P.CONFIG.gemini.model, repeat, mock,
    probes: results.length, passed, errors,
    pass_rate: results.length ? +(passed / results.length).toFixed(3) : null,
    avg_latency_ms: gemini.length ? Math.round(gemini.reduce((a, r) => a + r.latency_ms, 0) / gemini.length) : null,
    avg_prompt_tokens: gemini.length && gemini[0].prompt_tokens != null
      ? Math.round(gemini.reduce((a, r) => a + (r.prompt_tokens || 0), 0) / gemini.length) : null,
    complete: final && !stopped, stopped,
  };
  if (final) {
    if (repeat > 1) {
      console.log('各題穩定度（通過次數／重複次數，不同譯文數）：');
      Object.entries(perProbe).forEach(([k, v]) => console.log(`  ${v.passed}/${v.runs}  ${v.translations.length} 種  ${k}`));
    }
    console.log('SUMMARY ' + JSON.stringify(summary));
  }
  if (mock) return;
  mkdirSync(path.join(here, 'runs'), { recursive: true });
  writeFileSync(outFile, JSON.stringify({ ran_at: startedAt.toISOString(), fixture: 'long-memory.json', summary, per_probe: perProbe, results }, null, 2));
  if (final) console.log('已存檔：' + path.relative(root, outFile));
}

function check(probe, t) {
  const problems = [];
  if (probe.mustAny && !probe.mustAny.some(w => t.includes(w))) problems.push('缺少「' + probe.mustAny.join('／') + '」');
  (probe.mustAll || []).forEach(w => { if (!t.includes(w)) problems.push('缺少「' + w + '」'); });
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

function die(msg) {
  console.error(msg);
  if (process.env.GITHUB_ACTIONS) console.log('::error title=Experiment::' + String(msg).replace(/\s+/g, ' ').slice(0, 300));
  process.exit(1);
}

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

// 在 GitHub Actions 上輸出成 annotation（可以透過 API 讀到），同樣的訊息只報一次
function reportError(msg) {
  const reportedErrors = (globalThis.__reportedErrors ??= new Set());
  const short = msg.replace(/\s+/g, ' ').slice(0, 300);
  console.error('API 錯誤：' + short);
  if (process.env.GITHUB_ACTIONS && !reportedErrors.has(short)) {
    reportedErrors.add(short);
    console.log('::warning title=Gemini API::' + short);
  }
}
