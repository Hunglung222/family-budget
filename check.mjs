#!/usr/bin/env node
// 家庭記帳 — 最小健康檢查（不需安裝任何套件）
// 用法：node check.mjs
//   1) check:js    — 所有 js 檔 + HTML 內嵌 script 的語法
//   2) check:sw    — sw.js 快取清單 A[] 裡每個檔案都存在
//   3) check:links — 每個 HTML 引用的本機 js/css/圖片都存在
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';

const ROOT = dirname(new URL(import.meta.url).pathname);
let errors = 0, warns = 0, checks = 0;
const fail = (m) => { errors++; console.log('  ❌ ' + m); };
const warn = (m) => { warns++; console.log('  ⚠️  ' + m); };
const ok   = (m) => { checks++; console.log('  ✓ ' + m); };

// 列出所有 HTML 檔
const htmls = readdirSync(ROOT).filter(f => f.endsWith('.html'));
// 列出所有 js 檔
function walkJs(dir) {
  let out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'node_modules' && !f.startsWith('.')) out = out.concat(walkJs(p)); }
    else if (f.endsWith('.js') || f.endsWith('.mjs')) out.push(p);
  }
  return out;
}

// ---------- 1) check:js ----------
console.log('\n[1] check:js — JavaScript 語法');
for (const jf of walkJs(ROOT)) {
  if (jf.endsWith('check.mjs')) continue;
  try { execSync(`node --check "${jf}"`, { stdio: 'pipe' }); }
  catch (e) { fail(`語法錯誤：${jf.replace(ROOT, '.')}\n     ${String(e.stderr || e).split('\n').slice(0,3).join('\n     ')}`); }
}
// HTML 內嵌 script
for (const h of htmls) {
  const html = readFileSync(join(ROOT, h), 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!blocks.length) continue;
  const tmp = join(ROOT, `.__chk_${h}.js`);
  try {
    writeFileSync(tmp, blocks.join('\n;\n'));
    execSync(`node --check "${tmp}"`, { stdio: 'pipe' });
  } catch (e) {
    fail(`${h} 內嵌 script 語法錯誤：\n     ${String(e.stderr || e).split('\n').slice(0,3).join('\n     ')}`);
  } finally { try { rmSync(tmp); } catch {} }
}
if (errors === 0) ok('所有 JS 與內嵌 script 語法通過');

// ---------- 2) check:sw ----------
console.log('\n[2] check:sw — sw.js 快取清單檔案存在');
try {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const m = sw.match(/const\s+A\s*=\s*\[([\s\S]*?)\];/);
  if (!m) warn('找不到 sw.js 的快取陣列 A[]');
  else {
    const files = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
    let miss = 0;
    for (const f of files) {
      const rel = f.replace(/^\.\//, '');
      if (!existsSync(join(ROOT, rel))) { fail(`快取清單檔案不存在：${f}`); miss++; }
    }
    if (miss === 0) ok(`快取清單 ${files.length} 個檔案全部存在`);
  }
} catch (e) { warn('無法讀取 sw.js：' + e.message); }

// ---------- 3) check:links ----------
console.log('\n[3] check:links — HTML 引用的本機檔案存在');
let linkMiss = 0;
for (const h of htmls) {
  const html = readFileSync(join(ROOT, h), 'utf8');
  const refs = [
    ...[...html.matchAll(/<script[^>]*\bsrc=['"]([^'"]+)['"]/g)].map(x => x[1]),
    ...[...html.matchAll(/<link[^>]*\bhref=['"]([^'"]+)['"]/g)].map(x => x[1]),
    ...[...html.matchAll(/<img[^>]*\bsrc=['"]([^'"]+)['"]/g)].map(x => x[1]),
  ];
  for (const r of refs) {
    if (/^https?:|^data:|^\/\//.test(r)) continue; // 外部資源略過
    const rel = r.replace(/^\.\//, '').split('?')[0].split('#')[0];
    if (rel && !existsSync(join(ROOT, rel))) { fail(`${h} 引用不存在的檔案：${r}`); linkMiss++; }
  }
}
if (linkMiss === 0) ok('所有 HTML 本機引用都存在');

// ---------- 4) check:dynamic ----------
// 掃描 HTML 內嵌 script 裡以字串形式出現的 ./js/*.js 路徑（動態 createElement('script') 載入，
// 例如 add.html 的 loadDeferredModules），確認檔案存在。第 3 項只查 <script src> 標籤，抓不到這種。
console.log('\n[4] check:dynamic — 內嵌 script 動態載入的 js 路徑存在');
let dynMiss = 0, dynCount = 0;
for (const h of htmls) {
  const html = readFileSync(join(ROOT, h), 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  for (const m of blocks.matchAll(/['"](\.\/js\/[\w.-]+\.js)['"]/g)) {
    dynCount++;
    const rel = m[1].replace(/^\.\//, '');
    if (!existsSync(join(ROOT, rel))) { fail(`${h} 動態載入不存在的檔案：${m[1]}`); dynMiss++; }
  }
}
if (dynMiss === 0) ok(dynCount ? `動態載入路徑 ${dynCount} 個全部存在` : '無動態載入路徑（略過）');

// ---------- 總結 ----------
console.log(`\n${'─'.repeat(40)}`);
console.log(`通過 ${checks} 項，警告 ${warns} 項，錯誤 ${errors} 項`);
if (errors > 0) { console.log('❌ 檢查未通過，請修正上述錯誤再交付。'); process.exit(1); }
else { console.log('✅ 全部通過。'); process.exit(0); }
