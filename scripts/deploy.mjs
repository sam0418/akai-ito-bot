#!/usr/bin/env node
/**
 * npm run deploy [-- "說明"]
 *
 * 1. clasp push -f：把 src/ 推到 Apps Script
 * 2. clasp update-deployment：把新版本發布到既有的部署，webhook 網址不變
 *
 * 部署 ID 從 .deploy.json 讀取（不進 git），或用環境變數 AKAI_DEPLOYMENT_ID。
 * 一回で届く、が理想。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

function deploymentId() {
  if (process.env.AKAI_DEPLOYMENT_ID) return process.env.AKAI_DEPLOYMENT_ID;
  if (existsSync('.deploy.json')) {
    const { deploymentId } = JSON.parse(readFileSync('.deploy.json', 'utf8'));
    if (deploymentId) return deploymentId;
  }
  console.error('找不到部署 ID：請把 .deploy.json.example 複製成 .deploy.json 並填入 deploymentId，或設定 AKAI_DEPLOYMENT_ID。');
  console.error('部署 ID 可以用 npm run deployments 查詢。');
  process.exit(1);
}

function run(args) {
  console.log('\n> clasp ' + args.join(' '));
  const r = spawnSync('clasp', args, { stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const id = deploymentId();
const description = process.argv.slice(2).join(' ') || 'deploy ' + new Date().toISOString().slice(0, 16).replace('T', ' ');

run(['push', '-f']);
run(['update-deployment', id, '-d', JSON.stringify(description)]);
console.log('\n✅ 已發布新版本，webhook 網址不變。');
