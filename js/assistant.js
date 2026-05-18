// ============================================================
// 家庭記帳 PWA - 理財 AI 助理
// assistant.js v1.0
// 功能：浮動對話介面、記帳、查詢、分析、對話保存
// ============================================================

(function() {
'use strict';

// ── 角色資料（與 add.html 同步）────────────────────────────
const CHARACTERS = [
  { id:'koala',    emoji:'🐨', name:'無尾熊可可', style:'軟萌溫柔、正能量滿滿，像媽媽一樣鼓勵你，說話暖心，偶爾撒嬌' },
  { id:'oyster',   emoji:'🦪', name:'牡蠣寶寶',   style:'莫名其妙、語出驚人、邏輯跳躍，讓人哭笑不得但忍不住想看' },
  { id:'fox',      emoji:'🦊', name:'狐狸小智',   style:'數據導向、邏輯清晰、像專業財務顧問，給具體可執行的理財建議' },
  { id:'frog',     emoji:'🐸', name:'青蛙呱呱',   style:'嘴巴很壞但其實關心你，每句話都在吐槽，說完又補一句安慰' },
  { id:'otter',    emoji:'🦦', name:'水獺阿福',   style:'超放鬆、佛系、什麼都覺得沒關係，充滿治癒感，讓人壓力全消' },
  { id:'hamster',  emoji:'🐹', name:'倉鼠米米',   style:'超級節省觀念，對每筆花費都心痛，各種省錢妙招脫口而出' },
  { id:'panda',    emoji:'🐼', name:'熊貓胖胖',   style:'什麼都跟吃扯上關係，人生哲學全是食物，超有梗的美食觀點' },
  { id:'hedgehog', emoji:'🦔', name:'刺蝟蓬蓬',   style:'一本正經、像專業會計師、非常重視數字精確度，完全不開玩笑' },
  { id:'cat',      emoji:'🐱', name:'貓咪嗚嗚',   style:'傲嬌、不在乎你但其實很在乎，貓式關心，說話帶刺但有溫度' },
  { id:'dog',      emoji:'🐶', name:'狗狗旺財',   style:'每次都超開心超興奮，用力鼓勵，元氣滿滿，讓人被感染活力' },
  { id:'owl',      emoji:'🦉', name:'貓頭鷹歐比', style:'充滿哲理、說話像古代智者，每句話都有深意，有點裝但很有料' },
  { id:'octopus',  emoji:'🐙', name:'章魚奧托',   style:'腦洞超大、思路跳躍、說話充滿意外，根本猜不到下一句是什麼' },
];

function getChar() {
  const id = localStorage.getItem('mascot_char') || 'koala';
  return CHARACTERS.find(c => c.id === id) || CHARACTERS[0];
}

// ── 對話歷史（session 內保存）──────────────────────────────
let chatHistory   = [];    // Claude 的多輪對話歷史

// 對話持久化（切換頁面後保留）
const CHAT_PERSIST_KEY = 'assistant_chat_history';
const CHAT_DOM_KEY     = 'assistant_chat_dom';
const CHAT_MAX_PERSIST = 30;  // 最多保留 30 條訊息（避免 localStorage 爆量）

function saveChatToStorage() {
  try {
    // 保存 chatHistory（給 API 用）
    const trimmed = chatHistory.slice(-CHAT_MAX_PERSIST);
    localStorage.setItem(CHAT_PERSIST_KEY, JSON.stringify(trimmed));
    // 保存 DOM HTML（給畫面用）
    const msgs = document.getElementById('ast-msgs');
    if (msgs) localStorage.setItem(CHAT_DOM_KEY, msgs.innerHTML);
  } catch (e) { console.warn('[assistant] saveChat err:', e.message); }
}

function loadChatFromStorage() {
  try {
    const raw = localStorage.getItem(CHAT_PERSIST_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) chatHistory = arr;
    }
  } catch (e) { console.warn('[assistant] loadChat err:', e.message); }
}

function restoreChatDom() {
  try {
    const msgs = document.getElementById('ast-msgs');
    const html = localStorage.getItem(CHAT_DOM_KEY);
    if (msgs && html) {
      msgs.innerHTML = html;
      // 自動捲到最底
      requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
      return true;
    }
  } catch (e) { console.warn('[assistant] restoreChatDom err:', e.message); }
  return false;
}

// 啟動時先把 chatHistory 從 localStorage 讀回來
loadChatFromStorage();
let pendingTx     = null;  // 待確認的記帳資料
let isOpen        = false;
let isLoading     = false;
let voiceRec      = null;
let _dataSynced   = false; // 本頁本次是否已從 Firebase 同步過（避免重複拉）
let _syncPromise  = null;  // 進行中的同步 Promise，sendMsg 可 await 它避免太早查到空資料
let _lastCallMeta = null;  // 最後一次 callClaude() 的元資料：{ dataLevel, model, modeNote }，供 Discord 備份標註用

// 資料範圍模式：default=原本智慧判斷，L4=固定近90天，L5=固定近180天
const DATA_MODE_KEY = 'assistant_data_mode';

// Sonnet 手動鎖定模式：true=使用者主動切換為 Sonnet（深度分析、回應較慢）
// false=預設 Haiku（飛快、適合聊天和查詢）
// L1 記帳指令永遠用 Haiku，不受此 toggle 影響
const SONNET_MODE_KEY = 'assistant_sonnet_mode';

function getSonnetMode() {
  return localStorage.getItem(SONNET_MODE_KEY) === '1';
}

function setSonnetMode(on) {
  localStorage.setItem(SONNET_MODE_KEY, on ? '1' : '0');
}

function getDataMode() {
  const mode = localStorage.getItem(DATA_MODE_KEY) || 'default';
  return ['default', 'L4', 'L5'].includes(mode) ? mode : 'default';
}

function getForcedDataLevel() {
  const mode = getDataMode();
  return mode === 'default' ? null : mode;
}

function dataModeLabel(mode) {
  return mode === 'L4' ? '季（近90天）' : mode === 'L5' ? '半年（近180天）' : '預設';
}

function updateDataModeUI() {
  const mode = getDataMode();
  document.querySelectorAll('[data-ast-mode]').forEach(btn => {
    const on = btn.dataset.astMode === mode;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const label = document.getElementById('ast-mode-label');
  if (label) label.textContent = dataModeLabel(mode);

  // 同步 Sonnet toggle 按鈕的亮燈狀態
  const sonnetBtn = document.querySelector('[data-ast-sonnet]');
  if (sonnetBtn) {
    const on = getSonnetMode();
    sonnetBtn.classList.toggle('on', on);
    sonnetBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

// ── 工具函數 ─────────────────────────────────────────────────
function fmt(n) { return Number(n).toLocaleString('zh-TW'); }
function today() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function getKey() { return localStorage.getItem('claude_api_key') || ''; }

// ── 智慧分級：依問題決定撈多少天的資料來計算統計 ────────────
// L1: 記帳模式（不撈歷史）── 用戶要記帳 / 報金額
// L2: 今日昨日（7天）   ── 「今天花多少」「昨天吃啥」
// L3: 本月區間（35天）  ── 預設，涵蓋本月+少量上月尾巴
// L4: 跨月比較（90天）  ── 「上個月」「比較」
// L5: 長期分析（180天） ── 「半年」「年度報告」
// 註：一般分析維持採樣省 token；明細查詢會先用 JS 過濾完整資料再限量提供
const DETAIL_SAMPLE_LIMIT = 100;   // 一般查詢：均勻採樣 100 筆給 AI 看消費風格
const DETAIL_FULL_LIMIT   = 300;   // 偵測到明細查詢意圖時：擴大到 300 筆，AI 能回答具體單筆問題

// 偵測使用者是否想看「具體明細」（明細/逐筆/單筆/最大筆等）
function wantsDetailedView(msg) {
  if (!msg) return false;
  return /明細|逐筆|列出|清單|每一筆|單筆|最大|最貴|最高|最多金額|最便宜|最低|哪一筆|哪幾筆|刷卡紀錄|刷卡記錄/.test(msg);
}
const DATA_LEVELS = {
  L1: { days: 0   },
  L2: { days: 7   },
  L3: { days: 35  },
  L4: { days: 90  },
  L5: { days: 180 },
};

// ── 從問題解析明確日期區間 ──────────────────────────────────
// parseDateRange：解析各種日期表達，回傳 { from, to } YYYY-MM-DD 字串
// 與報表頁 txByRange(f, e) 完全一致
function parseDateRange(msg) {
  if (!msg) return null;
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
  const pad = n => String(n).padStart(2, '0');
  const toStr = (yr, m, dd) => `${yr}-${pad(m)}-${pad(dd)}`;
  // 當月最後一天
  const lastDay = (yr, m) => new Date(yr, m, 0).getDate();

  // ── 工具函數：算某週的週一與週日 ─────────────────────────
  const getWeekRange = (offsetWeeks) => {
    const dow = now.getDay(); // 0=週日
    const mondayOff = (dow === 0 ? -6 : 1 - dow) + offsetWeeks * 7;
    const mon = new Date(now); mon.setDate(d + mondayOff);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return {
      from: toStr(mon.getFullYear(), mon.getMonth()+1, mon.getDate()),
      to:   toStr(sun.getFullYear(), sun.getMonth()+1, sun.getDate())
    };
  };

  // ── 工具函數：算某個月的首尾日 ───────────────────────────
  const getMonthRange = (offsetMonths) => {
    const targetDate = new Date(y, mo + offsetMonths, 1);
    const ty = targetDate.getFullYear(), tm = targetDate.getMonth() + 1;
    return { from: toStr(ty, tm, 1), to: toStr(ty, tm, lastDay(ty, tm)) };
  };

  // ── 工具函數：算本季、上季的首尾日 ──────────────────────
  const getQuarterRange = (offsetQuarters) => {
    const currentQ = Math.floor(mo / 3); // 0-3
    const targetQ  = currentQ + offsetQuarters;
    const targetYear = y + Math.floor(targetQ / 4);
    const qInYear    = ((targetQ % 4) + 4) % 4;
    const qStartMo   = qInYear * 3 + 1; // 1,4,7,10
    const qEndMo     = qStartMo + 2;
    return {
      from: toStr(targetYear, qStartMo, 1),
      to:   toStr(targetYear, qEndMo, lastDay(targetYear, qEndMo))
    };
  };

  // ── 今天 / 昨天（高頻單日查詢，精準給單日 dateRange）─
  if (/今天|今日|今晚|今早|今午/.test(msg)) {
    const s = toStr(now.getFullYear(), now.getMonth()+1, now.getDate());
    return { from: s, to: s };
  }
  if (/昨天|昨日/.test(msg)) {
    const yest = new Date(now); yest.setDate(now.getDate()-1);
    const s = toStr(yest.getFullYear(), yest.getMonth()+1, yest.getDate());
    return { from: s, to: s };
  }

  // ── 比較型優先（本X vs 上X）── 要先比多詞組合再比單詞 ──
  // 本週 vs 上週 → from=上週一，to=本週日（14 天精準區間）
  if (/本週.*上週|上週.*本週|這週.*上週|上週.*這週|本周.*上周|週.*週比|week.*week/i.test(msg) ||
      /本週\s*[vV][sS]\s*上週|上週\s*[vV][sS]\s*本週/.test(msg)) {
    const thisWeek = getWeekRange(0);
    const lastWeek = getWeekRange(-1);
    return { from: lastWeek.from, to: thisWeek.to };
  }

  // 本月 vs 上月 → from=上月一號，to=本月底（完整兩個月）
  if (/本月.*上月|上月.*本月|這個月.*上個月|上個月.*這個月|月.*月比|月份.*比較/.test(msg) ||
      /本月\s*[vV][sS]\s*上月/.test(msg)) {
    const thisMonth = getMonthRange(0);
    const lastMonth = getMonthRange(-1);
    return { from: lastMonth.from, to: thisMonth.to };
  }

  // 本季 vs 上季 → from=上季初，to=本季末（完整兩季）
  if (/本季.*上季|上季.*本季|季.*季比|季度.*比較|這季.*上季|上季.*這季/.test(msg) ||
      /本季\s*[vV][sS]\s*上季/.test(msg)) {
    const thisQ = getQuarterRange(0);
    const lastQ = getQuarterRange(-1);
    return { from: lastQ.from, to: thisQ.to };
  }

  // 今年 vs 去年 → from=去年一月一號，to=今年底（若還沒到底就給今天）
  if (/今年.*去年|去年.*今年|年.*年比|今年跟去年/.test(msg)) {
    return { from: toStr(y-1, 1, 1), to: toStr(y, 12, 31) };
  }

  // ── 單一時段自然語言 ──────────────────────────────────────
  // 本週（週一～週日）
  if (/本週|這週|本周|這周/.test(msg)) return getWeekRange(0);
  // 上週
  if (/上週|上周|前一週|前一周/.test(msg)) return getWeekRange(-1);
  // 本月
  if (/本月|這個月|這月/.test(msg)) return getMonthRange(0);
  // 上個月
  if (/上個月|上月|前一個月/.test(msg)) return getMonthRange(-1);
  // 本季（當前季度）
  if (/本季|這季|這一季|本季度/.test(msg)) return getQuarterRange(0);
  // 上季
  if (/上季|上一季|前一季|上季度/.test(msg)) return getQuarterRange(-1);
  // 今年
  if (/今年/.test(msg)) return { from: toStr(y, 1, 1), to: toStr(y, 12, 31) };
  // 去年
  if (/去年/.test(msg)) return { from: toStr(y-1, 1, 1), to: toStr(y-1, 12, 31) };

  // X月份 或 X月（指定整月，不含後接「日」的單日格式）
  // (?!\d+日?) 確保「5月16日」這種不被當成「5月整月」
  const mMonth = msg.match(/([一二三四五六七八九十百]+|\d{1,2})月份?(?!\d)/);
  if (mMonth) {
    const chToNum = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12};
    const mNum = chToNum[mMonth[1]] || +mMonth[1];
    if (mNum >= 1 && mNum <= 12) {
      const mYear = mNum > mo + 1 ? y - 1 : y;
      return { from: toStr(mYear, mNum, 1), to: toStr(mYear, mNum, lastDay(mYear, mNum)) };
    }
  }

  // ── 明確日期區間格式 ────────────────────────────────────
  const patterns = [
    // 完整年月日區間：2026/5/1到2026/5/16 或 2026-05-01到2026-05-16
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*[到~～至\-]\s*(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
    // 月/日區間：5/1到5/16
    /(\d{1,2})\/(\d{1,2})\s*[到~～至\-]\s*(\d{1,2})\/(\d{1,2})/,
    // 漢字月日區間：5月1日到5月16日 / 5月1日至5月16日
    /(\d{1,2})月(\d{1,2})日?\s*[到~～至]\s*(\d{1,2})月(\d{1,2})日?/,
  ];

  let m2 = msg.match(patterns[0]);
  if (m2) return { from: toStr(+m2[1],+m2[2],+m2[3]), to: toStr(+m2[4],+m2[5],+m2[6]) };

  m2 = msg.match(patterns[1]);
  if (m2) return { from: toStr(y,+m2[1],+m2[2]), to: toStr(y,+m2[3],+m2[4]) };

  m2 = msg.match(patterns[2]);
  if (m2) return { from: toStr(y,+m2[1],+m2[2]), to: toStr(y,+m2[3],+m2[4]) };

  // 單日：月/日格式（5/16、05/16）— 必須在區間格式之後匹配，避免被搶先吃掉
  m2 = msg.match(/(?<![0-9])(\d{1,2})\/(\d{1,2})(?![0-9\/\-])/);
  if (m2 && +m2[1] >= 1 && +m2[1] <= 12 && +m2[2] >= 1 && +m2[2] <= 31) {
    const mNum = +m2[1], dNum = +m2[2];
    // 若指定月份已過 → 今年；否則今年（未來日期直接用今年）
    const s = toStr(y, mNum, dNum);
    return { from: s, to: s };
  }

  // 單日：漢字月日（5月16日）— 必須在區間格式之後匹配，區間已在上面處理完
  // 這裡加了 (?!.*[到至~～]) 確保不是區間格式的一部分
  m2 = msg.match(/(\d{1,2})月(\d{1,2})日?(?!.*[到至~～])/);
  if (m2 && +m2[1] >= 1 && +m2[1] <= 12 && +m2[2] >= 1 && +m2[2] <= 31) {
    const s = toStr(y, +m2[1], +m2[2]);
    return { from: s, to: s };
  }

  return null;
}

// 接受已解析好的 dateRange，避免重複呼叫 parseDateRange
function classifyDataLevel(msg, preParsedRange) {
  if (!msg) return 'L3';
  const m = msg.toLowerCase();

  // 若有明確日期區間（含自然語言解析後的結果），直接依範圍天數決定等級
  // 比較型問題（本週vs上週=14天、本月vs上月≈60天、本季vs上季≈180天）都會在
  // parseDateRange 產生精準 dateRange，classifyDataLevel 只負責決定 fallback 等級
  const dr = preParsedRange !== undefined ? preParsedRange : parseDateRange(msg);
  if (dr) {
    const days = Math.ceil((new Date(dr.to) - new Date(dr.from)) / 864e5);
    if (days <= 14)  return 'L2';
    if (days <= 35)  return 'L3';
    if (days <= 95)  return 'L4';
    return 'L5';
  }

  // L1：明確記帳意圖（有金額數字 或 記帳關鍵字）
  const hasAmount = /\d+\s*(元|塊|円|$|USD)?/.test(msg) &&
    !/分析|報告|趨勢|比較|比|建議|查詢|查一下|花了多少|多少錢|總額|筆數|明細|消費|紀錄|記錄|統計|查/.test(m);
  const recordKeywords = /^(幫我記|記帳|記一筆|剛剛|買了|吃了|花了\d|付了\d)/;
  if (recordKeywords.test(m) || (hasAmount && !/分析|比較|趨勢|建議|查/.test(m))) return 'L1';

  // L5：長期或完整分析（含年度比較）
  if (/半年|六個月|一年|年度|長期|今年|去年|信用卡.*規劃|規劃.*信用卡|完整報告|詳細報告|全部分析|財務報告|資產|所有.*記帳|所有.*記錄|全部.*記帳|全部.*記錄|完整.*分析|完整.*財務|所有資料|全部資料|預算上限|建議.*預算|幫我設定.*預算/.test(m)) return 'L5';

  // L4：跨月比較或季度分析
  if (/上個月|上月|前兩個月|兩個月|三個月|季度|季|比較|趨勢|變化|增加|減少|上升|下降/.test(m)) return 'L4';

  // L2：今日/昨日/本週/這週（短期查詢）
  if (/今天|今日|昨天|昨日|剛才|剛剛|今晚|今早|今午|最近一兩天|本週|這週|本周|這周|上週|上周/.test(m)) return 'L2';

  // 預設 L3（本月查詢）
  return 'L3';
}

// 將原始 tx 物件轉成 AI 助理用的格式
function _formatTx(t) {
  const d = new Date(t.at);
  const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  return {
    date:   dateStr,
    cat:    typeof catName === 'function' ? catName(t.cat) : t.cat,
    subCat: t.subCat || '',
    detail: t.detail || '',
    amount: t.amount,
    person: t.person || '',
    pay:    t.pay === 'cash' ? '現金' : t.pay === 'icard' ? '悠遊卡' : t.pay === 'acct' ? '帳戶' : '信用卡'
  };
}

// 用 localStorage 撈資料，支援明確日期區間 dateRange = { from, to }
// 直接使用 db.js 的 txByRange()，確保與報表頁資料來源完全一致
// 回傳 { txData: 截斷後明細陣列, fullStats: 完整統計 }
function getTxDataLocal(level, dateRange) {
  const lv = DATA_LEVELS[level || 'L3'];
  if (lv.days === 0) return { txData: [], fullStats: null };

  let txList;
  if (dateRange && dateRange.from && dateRange.to) {
    txList = typeof txByRange === 'function'
      ? txByRange(dateRange.from, dateRange.to)
      : (typeof getTx === 'function' ? getTx() : []);
  } else {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lv.days);
    const pad = n => String(n).padStart(2,'0');
    const toStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    txList = typeof txByRange === 'function'
      ? txByRange(toStr(cutoff), toStr(new Date()))
      : (typeof getTx === 'function' ? getTx() : []);
  }

  // ── 用完整 txList 算精準統計，數字 100% 與報表頁一致 ──
  const fullStats = _calcFullStats(txList);

  // 明細按日期新到舊排序，buildSystemPrompt 會再 slice 30 筆樣本給 AI
  const txData = txList
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .map(_formatTx);

  return { txData, fullStats };
}

// 智慧採樣：若資料多於 n 筆，做均勻間隔採樣（保留時段完整風貌）；少於 n 筆則全給
// 為何不用「最新 n 筆」：問「上月消費」時最新 30 筆會集中在月底，月初 AI 看不到
function _sampleTxs(txDataSorted, n) {
  if (!txDataSorted || txDataSorted.length === 0) return [];
  if (txDataSorted.length <= n) return txDataSorted;
  // 均勻採樣：每隔 step 筆抽一筆
  const step = txDataSorted.length / n;
  const sampled = [];
  for (let i = 0; i < n; i++) {
    sampled.push(txDataSorted[Math.floor(i * step)]);
  }
  return sampled;
}

// 完整統計計算（在 slice 截斷前呼叫，確保數字 100% 準確）
function _calcFullStats(txList) {
  if (!txList || txList.length === 0) return null;
  const total  = txList.reduce((s, t) => s + Number(t.amount || 0), 0);
  const byCash = txList.filter(t => t.pay === 'cash').reduce((s,t) => s+Number(t.amount||0), 0);
  const byCard = txList.filter(t => t.pay === 'card').reduce((s,t) => s+Number(t.amount||0), 0);
  const byIcard= txList.filter(t => t.pay === 'icard').reduce((s,t) => s+Number(t.amount||0), 0);
  const byAcct = txList.filter(t => t.pay === 'acct').reduce((s,t) => s+Number(t.amount||0), 0);
  const byCat = {}, byPerson = {};
  txList.forEach(t => {
    const catLabel = typeof catName === 'function' ? catName(t.cat) : t.cat;
    byCat[catLabel]     = (byCat[catLabel]     || 0) + Number(t.amount || 0);
    byPerson[t.person]  = (byPerson[t.person]  || 0) + Number(t.amount || 0);
  });
  return { total, count: txList.length, byCash, byCard, byIcard, byAcct, byCat, byPerson };
}

// 統一入口：全部用 localStorage（Firebase 同步後資料完整，且不受索引問題影響）
// 回傳 { txData: [...], fullStats: {...} }
async function getTxData(level, dateRange) {
  const lv = level || 'L3';
  if (lv === 'L1') return { txData: [], fullStats: null };
  return getTxDataLocal(lv, dateRange);
}

function getCatList() {
  return (typeof getCats === 'function' ? getCats() : [])
    .map(c => {
      const subs = (c.sub && c.sub.length) ? `[子分類:${c.sub.join('/')}]` : '[無子分類]';
      return `${c.id}(${c.name})${subs}`;
    }).join(', ');
}

function getCardList() {
  return (typeof getCards === 'function' ? getCards() : [])
    .map(c => `${c.id}:${c.name}(${c.last4})`).join(', ') || '無';
}

function getAcctList() {
  const personal = (typeof getAccts === 'function' ? getAccts(false) : [])
    .map(a => `${a.id}:${a.name}`);
  const shared = (typeof getAccts === 'function' ? getAccts(true) : [])
    .map(a => `shared_${a.id}:${a.name}`);
  return [...personal, ...shared].join(', ') || '無';
}

function getIcardList() {
  const personal = (typeof getIcards === 'function' ? getIcards() : [])
    .map(c => `${c.id}:${c.name}`);
  const shared = (typeof getSharedIcards === 'function' ? getSharedIcards() : [])
    .map(c => `${c.id}:${c.name}`);
  return [...personal, ...shared].join(', ') || '無';
}

// ── 建立系統 Prompt ──────────────────────────────────────────
async function buildSystemPrompt(level, dateRange, includeRecordRules = false, userMsg = '') {
  const char    = getChar();
  const lv      = level || 'L3';
  const result  = await getTxData(lv, dateRange);
  const fullStats = result.fullStats;     // 完整統計（在 slice 前計算，數字精準）
  // 動態樣本數：依「模型 + 資料範圍」決定，盡量讓 AI 看到完整明細
  // Haiku（預設）：100 筆 — 適合快速查詢和聊天
  // Sonnet 開啟時：依資料範圍擴大，盡可能涵蓋完整明細
  //   - 預設範圍（L2/L3） → 300 筆（多數情況已涵蓋完整）
  //   - 季 L4（90 天）   → 500 筆
  //   - 半年 L5（180 天） → 800 筆
  // 問明細時（最大筆、清單等）會再進一步擴大
  const wantDetail = wantsDetailedView(userMsg);
  let sampleSize;
  if (getSonnetMode() && lv !== 'L1') {
    // 使用者主動開啟 Sonnet → 給更多筆，盡量讓 AI 看到完整資料
    // Sonnet 模式下，採樣量本來就 ≥ 300，明細查詢自動涵蓋
    const forced = getDataMode();
    if (forced === 'L5')      sampleSize = 800;
    else if (forced === 'L4') sampleSize = 500;
    else                       sampleSize = 300;
  } else if (wantDetail) {
    // Haiku 模式但想看明細 → 擴大到 300 筆
    sampleSize = DETAIL_FULL_LIMIT;
  } else {
    sampleSize = DETAIL_SAMPLE_LIMIT; // Haiku 模式預設 100 筆，省 token 也夠用
  }
  const sourceTxs  = result.txData || [];
  const txData     = _sampleTxs(sourceTxs, sampleSize);
  const isNearComplete = sourceTxs.length <= sampleSize;   // 樣本已涵蓋全部
  const txJson  = txData.length > 0 ? JSON.stringify(txData) : '（本次查詢不需要歷史資料）';
  const now     = new Date();
  const nowStr  = now.toLocaleDateString('zh-TW', {
    year:'numeric', month:'2-digit', day:'2-digit', weekday:'long'
  });
  const todayISO = toLocalISO(now);
  const currentUser = localStorage.getItem('current_user') || '宏龍';
  const lvInfo = DATA_LEVELS[lv];
  const shouldShowRecordRules = lv === 'L1' || includeRecordRules;

  let dataDesc;
  if (lv === 'L1') {
    dataDesc = '（記帳模式，無需歷史資料）';
  } else if (dateRange && dateRange.from && dateRange.to) {
    const totalCount = fullStats ? fullStats.count : txData.length;
    dataDesc = `精準區間 ${dateRange.from} ～ ${dateRange.to}（共 ${totalCount} 筆）`;
  } else {
    const totalCount = fullStats ? fullStats.count : txData.length;
    dataDesc = `最近 ${lvInfo.days} 天（共 ${totalCount} 筆）`;
  }

  // ── 預算統計：直接用 fullStats（已在 slice 前計算完畢，數字絕對正確）──
  let preCalcStats = '';
  if (fullStats && fullStats.count > 0) {
    const catLines = Object.entries(fullStats.byCat)
      .sort((a,b) => b[1]-a[1])
      .map(([k,v]) => `  ${k}: $${Math.round(v)}`).join('\n');
    const personLines = Object.entries(fullStats.byPerson)
      .sort((a,b) => b[1]-a[1])
      .map(([k,v]) => `  ${k}: $${Math.round(v)}`).join('\n');
    preCalcStats = `
【統計數據（JS 精確計算，請直接引用，禁止自行重新加總）】
總金額：$${Math.round(fullStats.total)}
總筆數：${fullStats.count} 筆
付款方式：現金 $${Math.round(fullStats.byCash)} / 信用卡 $${Math.round(fullStats.byCard)} / 悠遊卡 $${Math.round(fullStats.byIcard)} / 帳戶 $${Math.round(fullStats.byAcct||0)}
分類明細：
${catLines}
記帳人明細：
${personLines}
`;
  }

  return `你是「${char.name}」，一個家庭理財 AI 助理。
個性：${char.style}
現在時間：${nowStr}，今天日期：${todayISO}
目前登入者：${currentUser}

你服務的是一對台灣夫妻：宏龍和盈慧。

你有三個能力：
1. 【記帳】幫用戶記錄消費
2. 【查詢】查詢消費記錄並統計
3. 【分析】分析消費習慣，給理財建議

可用分類：${getCatList()}
信用卡清單：${getCardList()}
悠遊卡清單：${getIcardList()}
帳戶清單：${getAcctList()}

${lv === 'L1' ? '' : `記帳資料範圍：${dataDesc}${preCalcStats}`}
${txJson !== '（本次查詢不需要歷史資料）' ? `
【${isNearComplete ? `${txData.length} 筆完整明細` : `${txData.length} 筆明細樣本（從共 ${sourceTxs.length} 筆均勻採樣）`}】
${txJson}

【明細使用規則】：
1. 總金額、總筆數、分類加總、付款方式加總 → **只能引用上方統計數據**，**絕對不可以**自己重新加總明細
2. 上方統計數據是 JS 精算的，跟報表頁 100% 一致
${isNearComplete
  ? '3. 上方明細已涵蓋此期間所有筆，可放心引用具體某一筆'
  : '3. 上方僅為樣本（非完整），若使用者問「最大筆/最貴/具體某天」這類需精確單筆的問題，要說明這是樣本、可能不是真正最大筆，建議縮小日期區間查更精準'}` : ''}
${shouldShowRecordRules ? `
━━━━━━━━━━━━━━━━━━━━━
【記帳規則：一步到位，不等用戶二次確認】
━━━━━━━━━━━━━━━━━━━━━

收到記帳訊息，立刻補全缺漏資訊，**同時輸出確認句和 [RECORD]**，一步完成：

預設值：日期=今天（${todayISO}）｜記帳人=${currentUser}（除非用戶訊息明確提到「盈慧」或「宏龍」，則用該人）｜付款=現金｜分類=自行推斷

【記帳人辨識規則】訊息中若出現「盈慧」二字，person 欄位必須填「盈慧」；若出現「宏龍」二字，person 欄位必須填「宏龍」；都沒提到才用預設值${currentUser}。

【必須同時輸出以下兩個部分，缺一不可】：

第一部分：用你的個性說一句確認話（不超過30字），格式：
「[日期] [分類]-[子分類]-[明細]，[記帳人]用[付款方式]消費 $[金額]，對嗎？」

第二部分：緊接著輸出 [RECORD]（不需等用戶回覆）：
[RECORD]{"amount":數字,"cat":"分類id","subCat":"子分類或空字串","newSubCat":true或false,"detail":"明細說明","date":"YYYY-MM-DD","person":"宏龍或盈慧","pay":"cash/card/icard/acct","cardId":"信用卡id或null","icardId":"悠遊卡id或null","acctId":"帳戶id或null"}[/RECORD]

【分類選擇邏輯（重要，務必遵守）】
A. 大分類（cat 欄位）：必須從上方「可用分類」清單中選一個 id。如果都不適合，一律歸類到「other」（其他），不要自己編造新的 cat id。
B. 子分類處理：
   - 步驟一：先嘗試從該分類的「已知子分類清單」中找最匹配的（包含同義詞）。例如「煤氣費」=「瓦斯」、「Uber」=「計程車」、「7-11買飲料」=「飲料」、「晚餐飯糰」=「晚餐」。寬鬆匹配，意思相近就用現有的，避免重複建立同一件事的不同名稱。這時 newSubCat = false。
   - 步驟二：如果完全找不到合適的現有子分類，建議新增一個簡短（2~6字）的子分類名稱，並把 newSubCat 設為 true。例如「換手錶電池」→ 新增子分類「手錶電池」歸到「其他」(other)。
   - 步驟三：如果輸入太籠統無法歸類（例如只說「花了500元」），subCat 留空字串，newSubCat 設為 false。
C. detail（明細）：從輸入文字提取具體消費內容，可以比 subCat 更詳細。例如「換手錶電池200元」→ subCat="手錶電池"、detail="換手錶電池"；「晚餐飯糰111」→ subCat="晚餐"、detail="晚餐飯糰"。

例子（用戶說「飲料135」）：
今天 餐飲-飲料-飲料，${currentUser}用現金消費 $135，對嗎？
[RECORD]{"amount":135,"cat":"food","subCat":"飲料","newSubCat":false,"detail":"飲料","date":"${todayISO}","person":"${currentUser}","pay":"cash","cardId":null,"icardId":null,"acctId":null}[/RECORD]

例子（用戶說「Uber 230刷卡」）：
今天 交通-計程車-Uber，${currentUser}用信用卡消費 $230，對嗎？
[RECORD]{"amount":230,"cat":"transport","subCat":"計程車","newSubCat":false,"detail":"Uber","date":"${todayISO}","person":"${currentUser}","pay":"card","cardId":null,"icardId":null,"acctId":null}[/RECORD]

【UI說明】：[RECORD] 輸出後，畫面會自動出現「✓確認」和「✏️修改」按鈕，用戶按確認才真正儲存，按修改可調整欄位。你不需要說「已記帳」，等用戶按按鈕。

【嚴格禁止】反問任何問題（不可問日期/記帳人/付款方式），資訊完整時絕不說「還需要知道」。
【嚴格禁止】只輸出確認句而不輸出 [RECORD]，兩者必須同時出現。` : ''}

回答語言：台灣繁體中文，嚴禁簡體字。查詢/分析用你的個性回答，可用 emoji 和換行讓格式好看。`;
}

// ── 呼叫 Claude API（帶自動重試，處理暫時性錯誤 529/500-503）─────
// Anthropic 在過載時會回 529，重試通常就能成功
async function fetchClaudeAPI(key, payload, maxRetries = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(payload)
      });

      // 成功或不需重試的錯誤（401/403）→ 直接回傳
      if (res.ok || res.status === 401 || res.status === 403 || res.status === 400) {
        return res;
      }

      // 429 / 500 / 502 / 503 / 529 → 重試（指數退避 1.5s / 4s）
      if ([429, 500, 502, 503, 529].includes(res.status) && attempt < maxRetries) {
        const waitMs = 1500 * Math.pow(2.5, attempt);
        console.warn(`[AI助理] HTTP ${res.status}，${waitMs/1000}s 後第 ${attempt+1} 次重試`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      return res;  // 已重試完仍失敗，回傳給上層處理
    } catch (e) {
      // 網路錯誤也重試
      lastErr = e;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1500 * Math.pow(2.5, attempt)));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr || new Error('Unexpected fetch failure');
}

async function callClaude(userMsg) {
  const key = getKey();
  if (!key) return '請先在設定頁填入 Claude API Key 才能使用我喔！';

  // 智慧分級：預設依問題決定資料範圍；若使用者切到「季/半年」模式，後續查詢固定抓 L4/L5
  const parsedRange = parseDateRange(userMsg);   // 嘗試解析明確日期區間
  const autoLevel   = classifyDataLevel(userMsg, parsedRange);  // 傳入避免重算
  const forcedLevel = getForcedDataLevel();
  const useForced   = !!forcedLevel;
  const dataLevel   = useForced ? forcedLevel : autoLevel;
  const dateRange   = useForced ? null : parsedRange;
  const levelDesc   = dateRange
    ? `精準區間（${dataLevel}）`
    : { L1:'記帳模式', L2:'近7天', L3:'近35天', L4:'近90天', L5:'近180天' }[dataLevel];
  const modeNote    = useForced ? ` 模式:${dataModeLabel(forcedLevel)}` : '';
  if (dateRange) {
    console.log(`[AI助理] 等級:${dataLevel} 區間:${dateRange.from}~${dateRange.to}${modeNote} 問:"${userMsg.slice(0,20)}"`);
  } else {
    console.log(`[AI助理] 等級:${dataLevel} (${levelDesc})${modeNote} 問:"${userMsg.slice(0,20)}"`);
  }

  // 修剪 chatHistory：只保留最近 6 輪（12 條訊息），避免 token 爆量、回應變慢
  if (chatHistory.length > 12) {
    chatHistory = chatHistory.slice(-12);
  }
  chatHistory.push({ role: 'user', content: userMsg });

  // ── 動態選模型 ──
  // L1 記帳指令 → 永遠用 Haiku（快、結構化萃取勝任）
  // 其他情境 → 看使用者有沒有手動開啟 Sonnet：開了用 Sonnet（深度但慢）、沒開用 Haiku（飛快）
  // 設計理念：盈慧愛聊天鬥嘴要快 → 預設 Haiku；宏龍要看深度分析 → 手動切 Sonnet
  let pickedModel;
  if (dataLevel === 'L1') {
    pickedModel = 'claude-haiku-4-5';
  } else {
    pickedModel = getSonnetMode() ? 'claude-sonnet-4-6' : 'claude-haiku-4-5';
  }
  console.log(`[AI助理] 模型:${pickedModel} (L1記帳=${dataLevel === 'L1'}, Sonnet開關=${getSonnetMode()})`);

  // 記錄這次呼叫的元資料，給 saveChatLog 在 Discord 備份訊息中標註用
  _lastCallMeta = {
    dataLevel,
    model: pickedModel,
    levelDesc,
    forced: useForced,
    sonnetManual: getSonnetMode() && dataLevel !== 'L1',  // 真的因為手動開關才用 Sonnet
    dateRange
  };

  try {
    const res = await fetchClaudeAPI(key, {
      model: pickedModel,
      max_tokens: 8192,
      system: await buildSystemPrompt(dataLevel, dateRange, dataLevel === 'L1', userMsg),
      messages: chatHistory
    });

    if (!res.ok) {
      if (res.status === 401) return 'API Key 有問題，請到設定頁重新填入 🔑';
      if (res.status === 403) return 'API Key 沒有權限，請確認你的 Anthropic 帳號狀態 🔑';
      if (res.status === 429) return '我太忙了 ⏳ 請稍等一下再問我（已重試過了）';
      if (res.status === 529 || res.status === 503) return 'Anthropic 伺服器目前過載 🛠️\n這是 Anthropic 那邊的問題，等個 1-2 分鐘再問我就好喔～';
      if (res.status >= 500) return 'Anthropic 伺服器暫時有狀況 🛠️ 請稍後再試';
      throw new Error(`HTTP ${res.status}`);
    }

    const data  = await res.json();
    let reply = (data.content?.[0]?.text || '').trim();

    // 若因 max_tokens 截斷，自動繼續請求（用同一個模型保持風格一致）
    if (data.stop_reason === 'max_tokens') {
      chatHistory.push({ role: 'assistant', content: reply });
      try {
        const res2 = await fetchClaudeAPI(key, {
          model: pickedModel,
          max_tokens: 4096,
          system: await buildSystemPrompt(dataLevel, dateRange, dataLevel === 'L1', userMsg),
          messages: [...chatHistory, { role: 'user', content: '請繼續未完成的回覆' }]
        });
        if (res2.ok) {
          const data2 = await res2.json();
          const cont = (data2.content?.[0]?.text || '').trim();
          if (cont) {
            reply = reply + '\n' + cont;
            chatHistory[chatHistory.length - 1].content = reply;
          }
        }
      } catch(e2) { console.warn('[AI助理] 續接失敗:', e2.message); }
    } else {
      chatHistory.push({ role: 'assistant', content: reply });
    }
    return reply;
  } catch(e) {
    chatHistory.pop(); // 移除失敗的 user message
    if (e.message.includes('fetch')) return '網路受限，請關閉 WiFi 改用行動網路 📶';
    return '發生錯誤：' + e.message;
  }
}

// ── 解析記帳意圖 ─────────────────────────────────────────────
function parseRecord(reply) {
  const match = reply.match(/\[RECORD\]([\s\S]*?)\[\/RECORD\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch(e) {
    return null;
  }
}

function getDisplayReply(reply) {
  return reply.replace(/\[RECORD\][\s\S]*?\[\/RECORD\]/g, '').trim();
}

// ── 確認記帳卡片（已移除，改用圓圈按鈕）──────────────────────
function buildConfirmCard(r) {
  return null; // 不顯示卡片，AI 說確認句即可，按鈕在輸入列
}

// ── 吉祥物泡泡（複用 add.html 機制）──────────────────────────
// 若頁面已定義同名函數（如 add.html），不覆蓋，沿用該頁面的版本
if (typeof window.showMascot !== 'function') {
  let _mascotTimer = null;
  window.closeMascot = function() {
    const wrap = document.getElementById('mascot-wrap');
    if (wrap) wrap.style.display = 'none';
  };
  window.showMascot = function(text) {
    const char = getChar();
    const wrap = document.getElementById('mascot-wrap');
    const icon = document.getElementById('mascot-icon');
    if (!wrap) return;
    if (icon) icon.textContent = char.emoji;
    document.getElementById('mascot-bubble').textContent = text;
    wrap.style.cssText += ';display:block;opacity:0;transform:translateY(12px);transition:opacity .3s,transform .3s';
    requestAnimationFrame(()=>{ wrap.style.opacity='1'; wrap.style.transform='translateY(0)'; });
    clearTimeout(_mascotTimer);
    _mascotTimer = setTimeout(window.closeMascot, 8000);
  };
}
// 本檔需要呼叫 showMascot 時用 window.showMascot
function showMascot(text) { return window.showMascot(text); }

// ── 確認記帳 ────────────────────────────────────────────────
window._assistantConfirm = function() {
  if (!pendingTx) return;

  // 若是新子分類，自動轉到 add.html 讓使用者透過既有「新增子分類」流程確認
  if (pendingTx.newSubCat === true && pendingTx.subCat) {
    if (typeof toast === 'function') {
      toast(`偵測到新子分類「${pendingTx.subCat}」，導向修改頁確認`, 'info');
    }
    setTimeout(() => window._assistantGoEdit(), 600);
    return;
  }

  const tx = pendingTx;
  pendingTx = null;

  // 解析日期
  const parts = tx.date.split('-').map(Number);
  const txObj = {
    amount:  tx.amount,
    cat:     tx.cat,
    subCat:  tx.subCat || '',
    detail:  tx.detail || '',
    pay:     tx.pay || 'cash',
    cardId:  tx.cardId || null,
    icardId: tx.icardId || null,
    acctId:  tx.acctId || null,
    person:  tx.person || localStorage.getItem('current_user') || '宏龍',
    at:      new Date(parts[0], parts[1]-1, parts[2], 12, 0, 0).toISOString()
  };

  if (typeof addTx === 'function')    addTx(txObj);
  if (typeof fbAddTx === 'function')  fbAddTx(txObj);

  // 產生 AI 評語後送 Discord（同 add.html 的 getFunnyComment 邏輯）
  (async () => {
    const key = localStorage.getItem('claude_api_key') || '';
    const char = getChar();
    let comment = char.name + ' 透過 AI 助理幫你記帳了 ✨';
    if (key) {
      try {
        const catLabel = typeof catName === 'function' ? catName(txObj.cat) : txObj.cat;
        const prompt = `你是「${char.name}」，一個記帳小夥伴。個性：${char.style}
這筆消費：${catLabel} ${txObj.detail?'「'+txObj.detail+'」':''} $${txObj.amount}
用你的個性說一句話（15~25字），加emoji，只回傳那句話。
【重要】必須使用台灣繁體中文，不可使用簡體中文字。`;
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 80, messages: [{ role: 'user', content: prompt }] })
        });
        if (res.ok) {
          const d = await res.json();
          const t = (d.content?.[0]?.text || '').trim();
          if (t) comment = t;
        }
      } catch(e) { console.warn('[assistant] 評語生成失敗:', e.message); }
    }
    // 用吉祥物泡泡顯示角色評語（完全複用 add.html 機制）
    showMascot(char.name + '：' + comment);
    if (typeof discordOnAddWithComment === 'function') {
      discordOnAddWithComment(txObj, comment, char.name);
    }
  })();

  // 移除確認卡片，加入成功訊息
  const confirmCard = document.querySelector('#ast-msgs .confirm-card');
  if (confirmCard) confirmCard.remove();

  const char = getChar();
  appendMsg('assistant', `已幫你記好了！$${fmt(tx.amount)} 已存入 ✅\n${char.name}覺得你很棒，有在好好記帳 💪`);
  saveChatToStorage();
  updateConfirmBar();

  // 存到 Firebase 對話記錄
  saveConversation('[已確認記帳] $' + tx.amount + ' ' + (tx.detail||''));
};

window._assistantCancel = function() {
  pendingTx = null;
  const confirmCard = document.querySelector('#ast-msgs .confirm-card');
  if (confirmCard) confirmCard.remove();
  appendMsg('assistant', '好的，取消記帳了。需要修改什麼再告訴我 😊');
  saveChatToStorage();
  updateConfirmBar();
};

// ── 確認/修改圓圈按鈕控制 ───────────────────────────────────
function updateConfirmBar() {
  const btnOK   = document.getElementById('ast-btn-confirm');
  const btnEdit = document.getElementById('ast-btn-edit');
  if (!btnOK || !btnEdit) return;
  const show = !!pendingTx;
  btnOK.style.display   = show ? 'flex' : 'none';
  btnEdit.style.display = show ? 'flex' : 'none';
}

// ✏️ 按鈕：把 pendingTx 寫入 sessionStorage，跳到 add.html 預填
window._assistantGoEdit = function() {
  if (!pendingTx) return;
  sessionStorage.setItem('ast_prefill', JSON.stringify(pendingTx));
  window.location.href = './add.html';
};

// ── 發送訊息 ─────────────────────────────────────────────────
async function sendMsg(text) {
  if (!text.trim() || isLoading) return;

  // ── 有待確認記帳時，攔截確認／取消詞，不送 API ──────────────
  if (pendingTx) {
    const t = text.trim().toLowerCase();
    const isConfirm = /^(是|對|好|yes|ok|沒錯|確認|記帳|對的|是的|沒問題|就這樣|save|yep|yup|👍)/.test(t);
    const isCancel  = /^(不|取消|cancel|算了|不要|不用|重來|錯了|改一下|修改|不對)/.test(t);
    if (isConfirm) {
      appendMsg('user', text);
      clearInput();
      window._assistantConfirm();
      return;
    }
    if (isCancel) {
      appendMsg('user', text);
      clearInput();
      window._assistantCancel();
      return;
    }
    // 其他文字（修改內容）→ 清掉 pendingTx，讓 AI 重新解析
    pendingTx = null;
    updateConfirmBar();
  }

  isLoading = true;

  appendMsg('user', text);
  clearInput();
  showTyping();

  // ── 同步保險：若 openAssistant 觸發的同步還沒回來，先等它（最多 5 秒）──
  // 避免使用者一打開就立刻問「今天花多少」、但 fbPullAll 還沒回來，
  // 結果 AI 抓到 0 筆資料反過來質疑使用者沒記帳的尷尬情況。
  if (_syncPromise) {
    try { await _syncPromise; } catch(e) {}
  }

  const reply = await callClaude(text);
  hideTyping();

  const record = parseRecord(reply);
  const displayReply = getDisplayReply(reply);

  if (record && record.amount > 0) {
    pendingTx = record;
    appendMsg('assistant', displayReply, buildConfirmCard(record));
    updateConfirmBar();
  } else {
    appendMsg('assistant', displayReply);
  }

  // 存到 Firebase + Discord
  saveChatLog(text, displayReply);

  // 對話存到 localStorage（跨頁面保留）
  saveChatToStorage();

  isLoading = false;
}

// AI 對話記錄專用 Discord 頻道（從 localStorage 讀取，避免 GitHub Pages public 時 webhook 外洩）
// 設定在 settings.html → AI 對話記錄頻道欄位
function getChatLogWebhook() {
  return localStorage.getItem('chat_log_webhook') || '';
}
async function saveChatLog(userMsg, assistantMsg) {
  try {
    // 取得這次對話的元資料（callClaude 寫入；若沒呼叫過 API 例如手動記帳完成，會是 null）
    const meta = _lastCallMeta;

    // Firebase
    if (typeof getDb === 'function') {
      const uid  = localStorage.getItem('current_uid') || 'unknown';
      const data = {
        uid,
        user:      userMsg,
        assistant: assistantMsg,
        char:      getChar().name,
        at:        new Date().toISOString()
      };
      // 附帶模型與等級資訊，方便日後 Firebase 端做使用統計
      if (meta) {
        data.dataLevel = meta.dataLevel;
        data.model     = meta.model;
      }
      await getDb().collection('chat_logs').add(data);
    }

    // Discord（專用 #ai對話記錄 頻道）
    const CHAT_LOG_WEBHOOK = getChatLogWebhook();
    if (!CHAT_LOG_WEBHOOK) return;

    const char    = getChar();
    const nowStr  = new Date().toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit' });
    const person  = localStorage.getItem('current_user') || '';

    // ── 模型 / 等級標籤（顯示在訊息最前面的 fields 區）──
    // 依模型決定 embed 顏色：Sonnet 紫（深度）、Haiku 青（快速）、無模型呼叫灰（純記帳確認）
    let embedColor = 0x6366F1; // 預設紫（原本顏色，保持向下相容）
    let metaFields = [];
    if (meta) {
      const isHaiku  = meta.model === 'claude-haiku-4-5';
      embedColor     = isHaiku ? 0x06B6D4 : 0x8B5CF6; // 青 / 紫
      // Sonnet 是「使用者主動開啟」還是「L1 以外自動走」── 現在邏輯下只會是前者
      const modelTag = isHaiku
        ? '⚡ Haiku 4.5'
        : `🧠 Sonnet 4.6${meta.sonnetManual ? '（手動）' : ''}`;
      const levelTag = `${meta.dataLevel}・${meta.levelDesc || ''}${meta.forced ? '（手動鎖定）' : ''}`;
      metaFields = [
        { name: '🤖 模型',  value: modelTag, inline: true },
        { name: '📊 等級',  value: levelTag, inline: true }
      ];
    }

    // Discord 2000 字元限制，超過自動分段
    const MAX = 3800; // Discord embed description 上限約 4096
    const sendChunk = async (text, title, includeMeta) => {
      const embed = {
        title,
        color: embedColor,
        description: text,
        footer: { text: '家庭記帳 PWA · AI 助理' }
      };
      // 只在第一段顯示 meta（續寫段不重複）
      if (includeMeta && metaFields.length > 0) {
        embed.fields = metaFields;
      }
      await fetch(CHAT_LOG_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] })
      });
    };

    // 第一則：用戶問題 + 助理回覆開頭
    const header = `👤 **${person}**\n${userMsg}\n\n${char.emoji} **${char.name}**\n`;
    const title  = `💬 AI 對話記錄　${today()} ${nowStr}`;

    if ((header + assistantMsg).length <= MAX) {
      await sendChunk(header + assistantMsg, title, true);
    } else {
      // 分段發送（meta 只放第一段）
      await sendChunk(header, title, true);
      let remaining = assistantMsg;
      let part = 1;
      while (remaining.length > 0) {
        const chunk = remaining.slice(0, MAX);
        remaining = remaining.slice(MAX);
        await sendChunk(chunk, remaining.length > 0 ? `${title}（續${part}）` : `${title}（完）`, false);
        part++;
        if (part > 15) break; // 最多15段保護
      }
    }
  } catch(e) {
    console.warn('[assistant] saveChatLog error:', e.message);
  }
}

function saveConversation(note) {
  saveChatLog(note, '✅ 記帳完成');
}


// ── Markdown 簡易渲染 ─────────────────────────────────────────
// HTML escape：避免 AI 回傳 HTML 標籤被直接渲染（safety: prevent XSS via prompt injection）
function _escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdown(text) {
  // 先 escape 整個輸入的 HTML 特殊字元，再用 markdown 規則加回安全的標籤
  // 這樣 AI 即使回傳 <img onerror=...>、<script> 也只會顯示為純文字
  text = _escHtml(text);
  const lines = text.split('\n');
  let html = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 表格處理（連續的 | 開頭行）
    if (/^\|/.test(line)) {
      const tableLines = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        // 跳過分隔行 |---|---|
        if (!/^\|[\s\-\|]+\|$/.test(lines[i])) {
          tableLines.push(lines[i]);
        }
        i++;
      }
      if (tableLines.length > 0) {
        html += '<div style="margin:6px 0">';
        tableLines.forEach((tl, idx) => {
          const cells = tl.split('|').filter((c, ci, arr) => ci > 0 && ci < arr.length - 1).map(c => c.trim());
          const isHeader = idx === 0;
          html += '<div style="display:flex;gap:4px;margin-bottom:3px">';
          cells.forEach(cell => {
            const cellContent = cell.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
            html += `<span style="flex:1;min-width:0;font-size:.78rem;padding:4px 6px;background:${isHeader ? 'var(--pdim)' : 'var(--card2)'};border-radius:5px;word-break:break-all;${isHeader ? 'color:var(--p);font-weight:700' : 'color:var(--t1)'}">${cellContent}</span>`;
          });
          html += '</div>';
        });
        html += '</div>';
      }
      continue;
    }

    // 標題
    if (/^### (.+)$/.test(line)) {
      const t = line.replace(/^### /, '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      html += `<div style="font-weight:900;font-size:.88rem;color:var(--p);margin:10px 0 4px">${t}</div>`;
    } else if (/^## (.+)$/.test(line)) {
      const t = line.replace(/^## /, '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      html += `<div style="font-weight:900;font-size:.92rem;color:var(--t1);margin:10px 0 4px">${t}</div>`;
    } else if (/^# (.+)$/.test(line)) {
      const t = line.replace(/^# /, '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      html += `<div style="font-weight:900;font-size:.96rem;color:var(--t1);margin:10px 0 4px">${t}</div>`;
    }
    // 分隔線
    else if (/^---+$/.test(line)) {
      html += '<hr style="border:none;border-top:1px solid var(--border);margin:8px 0">';
    }
    // 清單
    else if (/^- (.+)$/.test(line)) {
      const t = line.replace(/^- /, '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      html += `<div style="display:flex;gap:6px;margin:3px 0"><span style="color:var(--p);flex-shrink:0;margin-top:1px">•</span><span>${t}</span></div>`;
    }
    // 空行
    else if (line.trim() === '') {
      html += '<div style="height:6px"></div>';
    }
    // 一般文字
    else {
      const t = line
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.+?)\*/g, '<i>$1</i>');
      html += `<div style="margin:1px 0">${t}</div>`;
    }
    i++;
  }
  return html;
}

// ── UI 操作函數 ──────────────────────────────────────────────
function appendMsg(role, text, extraHtml) {
  const msgs    = document.getElementById('ast-msgs');
  if (!msgs) return;
  const char    = getChar();
  const isUser  = role === 'user';
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `display:flex;align-items:flex-end;gap:8px;margin-bottom:12px;${isUser?'flex-direction:row-reverse':''}`;

  // 頭像
  const avatar = document.createElement('div');
  avatar.style.cssText = `width:32px;height:32px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.1rem;${isUser?'background:var(--pdim)':'background:linear-gradient(135deg,var(--p),var(--p2))'}`;
  avatar.textContent = isUser ? '👤' : char.emoji;

  // 訊息氣泡
  const bubble = document.createElement('div');
  bubble.style.cssText = `max-width:78%;padding:10px 13px;border-radius:${isUser?'16px 4px 16px 16px':'4px 16px 16px 16px'};font-size:.85rem;line-height:1.65;white-space:pre-wrap;word-break:break-word;${isUser?'background:var(--pdim);color:var(--p);':'background:var(--card2);color:var(--t1);border:1px solid var(--border);'}`;

  // 名字標示（助理才顯示）
  if (!isUser) {
    const nameTag = document.createElement('div');
    nameTag.style.cssText = 'font-size:.65rem;color:var(--t3);margin-bottom:3px;font-weight:700';
    nameTag.textContent   = char.name;
    bubble.appendChild(nameTag);
  }

  const textNode = document.createElement('div');
  if (isUser) {
    textNode.textContent = text; // 使用者訊息不渲染 markdown
  } else {
    textNode.innerHTML = renderMarkdown(text); // 助理訊息渲染 markdown
  }
  bubble.appendChild(textNode);

  if (extraHtml) {
    const extra = document.createElement('div');
    extra.className = 'confirm-card';
    extra.innerHTML = extraHtml;
    bubble.appendChild(extra);
  }

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  msgs.appendChild(wrapper);

  // 使用者訊息：滾到最底（確認自己的問題可見）
  // 助理訊息：滾到該訊息頂部（長回答才能從頭看）
  if (isUser) {
    msgs.scrollTop = msgs.scrollHeight;
  } else {
    requestAnimationFrame(() => {
      wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

function showTyping() {
  const msgs = document.getElementById('ast-msgs');
  if (!msgs) return;
  const char  = getChar();
  const div   = document.createElement('div');
  div.id      = 'ast-typing';
  div.style.cssText = 'display:flex;align-items:flex-end;gap:8px;margin-bottom:12px';
  div.innerHTML = `
    <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--p2));display:flex;align-items:center;justify-content:center;font-size:1.1rem">${char.emoji}</div>
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:4px 16px 16px 16px;padding:12px 16px">
      <div style="display:flex;gap:5px;align-items:center">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--t3);animation:ast-bounce .9s infinite"></span>
        <span style="width:7px;height:7px;border-radius:50%;background:var(--t3);animation:ast-bounce .9s .2s infinite"></span>
        <span style="width:7px;height:7px;border-radius:50%;background:var(--t3);animation:ast-bounce .9s .4s infinite"></span>
      </div>
    </div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function hideTyping() {
  const el = document.getElementById('ast-typing');
  if (el) el.remove();
}

function clearInput() {
  const inp = document.getElementById('ast-input');
  if (inp) { inp.value = ''; inp.style.height = 'auto'; }
}

// ── 語音輸入 ─────────────────────────────────────────────────
function toggleVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('此裝置不支援語音輸入'); return; }

  if (voiceRec) {
    voiceRec.stop(); voiceRec = null; return;
  }

  const btn = document.getElementById('ast-voice');
  const rec = new SR();
  rec.lang = 'zh-TW'; rec.interimResults = false; rec.continuous = false;

  rec.onstart = () => {
    voiceRec = rec;
    if (btn) { btn.textContent = '🔴'; btn.style.color = '#f43f5e'; }
  };
  rec.onresult = (e) => {
    const text = e.results[0][0].transcript;
    const inp  = document.getElementById('ast-input');
    if (inp) inp.value = text;
    sendMsg(text);
  };
  rec.onerror = () => { voiceRec = null; if (btn) { btn.textContent = '🎤'; btn.style.color = ''; } };
  rec.onend   = () => { voiceRec = null; if (btn) { btn.textContent = '🎤'; btn.style.color = ''; } };
  rec.start();
}

// ── 開啟/關閉助理 ────────────────────────────────────────────
// ── 智慧資料同步 ─────────────────────────────────────
// 問題背景：assistant.js 純讀 localStorage，但只有 index.html 和 wallet.html
// 開啟時會呼叫 fbPullAll() 把 Firebase 資料拉到 localStorage。
// 若使用者從 add/settings/report/shopping 等頁面直接打開 AI 助理，
// localStorage 可能是空的（尤其首次登入、清過快取、或換裝置），
// 結果就是 AI 一直回「0 筆記錄」，反而質疑使用者沒記帳。
//
// 解法：openAssistant() 時先檢查資料量，看起來不齊全才主動同步。
// 用 _syncPromise 暴露進行中的同步動作，sendMsg 在發送前可 await 它，
// 避免使用者打開後立刻問問題、但同步還沒回來，又抓到空資料的情況。
// 加 5 秒 timeout，網路不好也不會卡死。
function _ensureDataReady() {
  // 已同步完成 → 直接 resolve
  if (_dataSynced) return Promise.resolve({ ok: true, synced: false });

  // 已有進行中的同步 → 回傳同一個 Promise（避免重複拉）
  if (_syncPromise) return _syncPromise;

  // fbPullAll 不存在（理論上不會發生，所有 AI 助理出現的頁面都引了 firebase.js）
  if (typeof fbPullAll !== 'function') {
    _dataSynced = true;
    return Promise.resolve({ ok: true, synced: false });
  }

  // 沒登入就不拉
  const uid = localStorage.getItem('current_uid');
  if (!uid) {
    _dataSynced = true;
    return Promise.resolve({ ok: true, synced: false });
  }

  // 檢查目前 localStorage 資料量。極少筆數（< 3）視為「可能還沒同步」
  // 用低門檻是因為：盈慧長期使用後 localStorage 一定有大量資料，
  // 出現 < 3 筆基本上就是換裝置/清快取/從非首頁直接進來這幾種情況。
  let currentCount = 0;
  try {
    currentCount = (typeof getTx === 'function') ? (getTx() || []).length : 0;
  } catch(e) { currentCount = 0; }

  if (currentCount >= 3) {
    _dataSynced = true; // 本頁已有資料，不需要再同步
    return Promise.resolve({ ok: true, synced: false });
  }

  // 進入實際同步流程，存到 _syncPromise 讓 sendMsg 可共享
  _syncPromise = (async () => {
    try {
      const pullPromise = fbPullAll();
      const timeoutPromise = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), 5000)
      );
      await Promise.race([pullPromise, timeoutPromise]);
      _dataSynced = true;
      const afterCount = (typeof getTx === 'function') ? (getTx() || []).length : 0;
      return { ok: true, synced: true, before: currentCount, after: afterCount };
    } catch(e) {
      console.warn('[Assistant] 資料同步失敗:', e.message);
      // 失敗也標記為「已嘗試過」，避免每次問問題都重試卡 5 秒
      _dataSynced = true;
      return { ok: false, synced: false, error: e.message };
    } finally {
      _syncPromise = null;
    }
  })();

  return _syncPromise;
}

function openAssistant() {
  isOpen = true;
  document.getElementById('ast-panel').style.display  = 'flex';
  document.getElementById('ast-fab').style.display    = 'none';
  document.getElementById('ast-overlay').style.display= 'block';

  // 還原之前的對話內容（如果有的話）
  const restored = restoreChatDom();

  // 沒有歷史對話時才送開場白
  if (!restored && chatHistory.length === 0) {
    _sendCharGreeting();
  }

  // focus 輸入框
  setTimeout(() => {
    const inp = document.getElementById('ast-input');
    if (inp) inp.focus();
  }, 300);

  // 背景檢查資料同步狀態（不擋使用者操作）
  // 若資料看起來不齊全，會在背景拉 Firebase，避免出現「0 筆記錄」誤判
  _ensureDataReady().then(result => {
    if (result.synced && result.after > result.before) {
      // 同步成功且確實補了資料，悄悄通知使用者一下
      const msgs = document.getElementById('ast-msgs');
      if (msgs) {
        appendMsg('assistant',
          `📡 已從雲端同步 ${result.after} 筆記帳資料，現在可以開始查詢囉～`
        );
      }
    } else if (!result.ok) {
      // 同步失敗，提醒使用者目前可能查不到完整資料
      appendMsg('assistant',
        '⚠️ 目前網路連線不穩，無法從雲端拉取最新資料。\n如果查詢結果顯示 0 筆，請稍後再試或先回首頁等待同步完成。'
      );
    }
  });
}

// 發送目前角色的開場白
function _sendCharGreeting() {
  const char = getChar();
  const greetings = {
      koala: [
        '嗨嗨～我是無尾熊可可 🐨 你的暖心理財小夥伴！\n可以問我「今天花多少」、「幫我記帳」或「分析消費習慣」，我會溫柔地幫你整理 🌿',
        '可可在這裡陪你 🐨 不管花多還是花少，記帳就是最棒的理財第一步！\n想查帳、記帳、或聊聊財務規劃，都可以跟我說喔 💚',
        '歡迎回來～可可想你了 🐨🌿\n今天有什麼消費要記錄嗎？或是想查查最近花了多少？'
      ],
      oyster: [
        '呱嗒！牡蠣寶寶報到 🦪 我也不知道為什麼我在這裡，但我可以幫你查帳、記帳、分析花費～\n反正海浪會帶走煩惱，但帳單不會 😂',
        '🦪 牡蠣寶寶今天心情像退潮一樣平靜～\n有帳要記嗎？有錢要查嗎？說吧，我聽著（雖然我沒有耳朵）',
        '貝殼打開，智慧流出 🦪✨ 不知道這句話什麼意思但感覺很厲害！\n反正我能幫你記帳查帳分析消費，快說！'
      ],
      fox: [
        '您好，我是狐狸小智 🦊 專業理財顧問模式啟動。\n可為您提供：消費查詢、支出分析、預算建議、對話記帳。請問今日有何財務需求？',
        '🦊 狐狸小智已就位，今日財務報告準備完畢。\n請告知查詢區間或記帳需求，將為您精確分析。',
        '建議您養成每日記帳習慣 🦊📊\n我可以協助查詢任何時段的消費明細，或幫您即時記帳。請說明需求。'
      ],
      frog: [
        '哎唷，又來問錢的事啊 🐸 行啦，我青蛙呱呱雖然嘴巴壞，但還是會幫你查帳啦！\n說吧，要查哪天？要記帳？還是要我吐槽你花太多？',
        '呱～你又來了 🐸 每次來都是花了什麼亂七八糟的錢要查吧！\n好啦好啦，說吧，我幫你查，順便幫你罵自己一下。',
        '🐸 呱呱！別以為我不知道你最近花很多！\n快說要記帳還是要查帳，查完我保證要吐槽你三句話。'
      ],
      otter: [
        '嗨～水獺阿福在這裡 🦦 不管花多少都沒關係啦，人生就是要快樂嘛～\n不過如果想知道花去哪了，我可以幫你查查，超級輕鬆的！',
        '🦦 阿福剛剛在河裡漂完回來，感覺好舒服～\n有什麼要記帳或查帳的嗎？慢慢說不急，人生不用急。',
        '水獺哲學：錢花了就花了，記錄下來最重要 🦦✨\n要記帳嗎？要查帳嗎？我幫你，很輕鬆的那種。'
      ],
      hamster: [
        '天啊你終於來了！倉鼠米米等好久 🐹 快來跟我說你花了多少錢，我幫你省！\n記帳、查帳、分析，通通都會，省錢是我的使命！',
        '🐹 米米今天又發現三個省錢方法！要聽嗎？\n不過先說說你最近花了什麼，讓我幫你分析哪裡可以省！',
        '省錢省錢省錢！！🐹💰 米米的口號！\n快告訴我你花了多少，我來幫你找出可以少花的地方！'
      ],
      panda: [
        '熊貓胖胖來了 🐼 話說你今天吃了什麼？\n不管啦，有記帳就是好事！要查花費、記帳、還是分析都可以，反正都跟吃有關係 🍜',
        '🐼 胖胖剛吃完竹子，現在可以幫你查帳了！\n你今天吃了什麼？花了多少？都跟我說，我來記！',
        '人生在吃，錢花在食物上是值得的 🐼🍱\n不過其他的花費就要好好記錄了！要幫你查帳嗎？'
      ],
      hedgehog: [
        '您好。我是刺蝟蓬蓬 🦔 功能說明如下：\n1.記帳 2.消費查詢 3.支出分析 4.預算建議。請明確說明需求，我將精確處理。謝謝。',
        '🦔 蓬蓬已準備就緒。請說明：需要記帳、查詢、還是分析？\n請提供具體日期或金額，以利精確作業。',
        '效率第一。請直接說明需求 🦔\n可處理事項：A.記帳 B.查詢特定日期 C.分析消費 D.比較週期。'
      ],
      cat: [
        '...你來了啊 🐱 本貓懶得多說，但可以幫你查帳、記帳、分析消費。\n快說要幹嘛，不然本貓要去睡覺了。',
        '🐱 喵。有事說事。\n記帳還是查帳？本貓雖懶，但還是會幫你的。（勉強）',
        '本貓今天心情還可以，可以多回答你兩個問題 🐱\n說吧，要查帳還是記帳？別讓本貓等太久。'
      ],
      dog: [
        '哇哇哇你來了！！狗狗旺財超開心！！🐶 汪汪！\n可以問我今天花多少！或幫你記帳！或分析消費習慣！什麼都可以！我超會的！加油加油！',
        '🐶 汪！！主人來了！！旺財好開心好開心！！\n要記帳嗎！！要查帳嗎！！旺財都會！！說說說！！',
        '旺財今天精神超好！！！🐶💪\n有什麼財務問題都可以問我！記帳查帳分析！通通沒問題！衝！'
      ],
      owl: [
        '吾乃貓頭鷹歐比 🦉 金錢如流水，記錄即智慧。\n可為汝查詢消費、記錄支出、分析財務規律。凡事皆有因果，理財亦然。請道來。',
        '🦉 夜深人靜，正是理財之時。\n吾可助汝記帳、查帳、分析消費趨勢。智者理財，愚者消費。汝屬何者？',
        '歐比在此靜候 🦉 財務之道，在乎平衡。\n請告知所需，查帳記帳分析，皆在吾之能力範圍。'
      ],
      octopus: [
        '八隻手臂齊歡迎你！章魚奧托在此 🐙\n我可以幫你記帳！查帳！分析！還有想到一半忘掉的功能！對了你知道章魚也會理財嗎？不知道？那就問我吧～',
        '🐙 奧托今天突然想到，錢跟墨水一樣，噴出去就回不來了！\n所以要好好記帳！我幫你！要查什麼說！',
        '八隻手臂，八種服務！🐙 記帳、查帳、分析、建議...\n剩下四種我忘了但應該也很厲害！快問我！'
      ]
    };
  // 每天輪換（用日期決定顯示哪一句）
  const dayIndex = new Date().getDate() % 3;
  const charGreetings = greetings[char.id] || greetings.koala;
  const greeting = charGreetings[dayIndex];
  appendMsg('assistant', greeting);
  chatHistory.push({ role: 'assistant', content: greeting });
  saveChatToStorage();
}

function closeAssistant() {
  isOpen = false;
  document.getElementById('ast-panel').style.display   = 'none';
  document.getElementById('ast-fab').style.display     = 'flex';
  document.getElementById('ast-overlay').style.display = 'none';
}

// ── 建立 UI ──────────────────────────────────────────────────
function buildUI() {
  const char = getChar();

  // 動畫 CSS
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ast-bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }
    @keyframes ast-fadeup { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
    #ast-fab { animation: ast-fadeup .4s ease; }
    #ast-panel { animation: ast-fadeup .3s ease; }
    #ast-input:focus { outline: none; border-color: var(--p); }
    #ast-msgs::-webkit-scrollbar { width: 4px; }
    #ast-msgs::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
    .ast-quick, .ast-mode { background:var(--card2); border:1px solid var(--border); color:var(--t2); border-radius:20px; padding:5px 12px; font-size:.72rem; cursor:pointer; font-family:inherit; white-space:nowrap; transition:all .15s; }
    .ast-quick:active, .ast-mode:active { background:var(--pdim); border-color:var(--p); color:var(--p); }
    .ast-mode.on { background:var(--pdim); border-color:var(--p); color:var(--p); font-weight:800; }
  `;
  document.head.appendChild(style);

  // 遮罩
  const overlay = document.createElement('div');
  overlay.id    = 'ast-overlay';
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:299';
  overlay.onclick = closeAssistant;
  document.body.appendChild(overlay);

  // 浮動按鈕
  const fab = document.createElement('div');
  fab.id    = 'ast-fab';
  fab.style.cssText = `position:fixed;bottom:calc(68px + env(safe-area-inset-bottom,0px) + 16px);right:16px;z-index:300;width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--p2));display:flex;align-items:center;justify-content:center;font-size:1.5rem;cursor:pointer;box-shadow:0 4px 20px rgba(0,229,180,.45);transition:transform .2s`;
  fab.textContent = char.emoji;
  fab.onclick     = openAssistant;
  fab.onmouseenter = () => fab.style.transform = 'scale(1.1)';
  fab.onmouseleave = () => fab.style.transform = 'scale(1)';
  document.body.appendChild(fab);

  // 對話面板
  const panel = document.createElement('div');
  panel.id    = 'ast-panel';
  panel.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;z-index:300;max-width:480px;margin:0 auto;flex-direction:column;background:var(--bg);border-radius:20px 20px 0 0;box-shadow:0 -4px 32px rgba(0,0,0,.3);max-height:82vh';

  panel.innerHTML = `
    <!-- 標題列 -->
    <div style="display:flex;align-items:center;gap:10px;padding:14px 16px 10px;border-bottom:1px solid var(--border);flex-shrink:0">
      <div id="ast-hdr-icon" style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--p2));display:flex;align-items:center;justify-content:center;font-size:1.2rem">${char.emoji}</div>
      <div style="flex:1">
        <div id="ast-hdr-name" style="font-weight:800;font-size:.92rem">${char.name}</div>
        <div style="font-size:.68rem;color:var(--t3)">理財 AI 助理 · 隨時問我</div>
      </div>
      <button onclick="clearChat()" style="padding:5px 10px;background:var(--card2);border:1px solid var(--border);color:var(--t3);border-radius:8px;font-size:.68rem;cursor:pointer;font-family:inherit">清空</button>
      <button onclick="closeAssistant()" style="width:30px;height:30px;background:var(--card2);border:1px solid var(--border);color:var(--t2);border-radius:50%;font-size:1rem;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center">✕</button>
    </div>

    <!-- 資料範圍模式 + Sonnet 切換 -->
    <div style="display:flex;align-items:center;gap:6px;padding:8px 12px 0;overflow-x:auto;flex-shrink:0;scrollbar-width:none">
      <span style="font-size:.68rem;color:var(--t3);white-space:nowrap">資料範圍：<b id="ast-mode-label">預設</b></span>
      <button class="ast-mode" data-ast-mode="default" onclick="setAssistantDataMode('default')" aria-pressed="true">預設</button>
      <button class="ast-mode" data-ast-mode="L4" onclick="setAssistantDataMode('L4')" aria-pressed="false">季</button>
      <button class="ast-mode" data-ast-mode="L5" onclick="setAssistantDataMode('L5')" aria-pressed="false">半年</button>
      <!-- Sonnet toggle：亮起 = 啟用深度分析模型；預設 Haiku 較快 -->
      <button class="ast-mode" data-ast-sonnet="1" onclick="toggleSonnetMode()" aria-pressed="false"
        title="深度分析模式：開啟使用 Sonnet 4.6，回應較慢但更精準；關閉用 Haiku 4.5 飛快回答">🧠 Sonnet</button>
    </div>

    <!-- 快捷問題 -->
    <div style="display:flex;gap:6px;padding:8px 12px;overflow-x:auto;flex-shrink:0;scrollbar-width:none">
      <button class="ast-quick" onclick="quickAsk('今天花了多少？')">今天花多少</button>
      <button class="ast-quick" onclick="quickAsk('本週跟上週消費比較')">本週vs上週</button>
      <button class="ast-quick" onclick="quickAsk('這個月哪個分類花最多？')">最多分類</button>
      <button class="ast-quick" onclick="quickAsk('幫我分析消費習慣')">消費分析</button>
      <button class="ast-quick" onclick="quickAsk('照現在速度這個月會超支嗎？')">超支預測</button>
    </div>

    <!-- 訊息區 -->
    <div id="ast-msgs" style="flex:1;overflow-y:auto;padding:8px 12px 4px"></div>

    <!-- 輸入區 -->
    <div style="padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--border);flex-shrink:0">
      <div style="display:flex;gap:8px;align-items:flex-end">
        <textarea id="ast-input" rows="1"
          placeholder="問我任何財務問題，或說「幫我記帳...」"
          style="flex:1;background:var(--card2);border:1.5px solid var(--border);border-radius:12px;padding:10px 12px;font-size:.85rem;color:var(--t1);font-family:inherit;resize:none;line-height:1.5;max-height:100px;overflow-y:auto"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendAssistantMsg()}"
          oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px'"></textarea>
        <!-- 確認/修改圓圈（有 pendingTx 才顯示） -->
        <button id="ast-btn-confirm" onclick="window._assistantConfirm()" title="確認記帳"
          style="display:none;width:38px;height:38px;border-radius:50%;background:#16a34a;border:none;color:#fff;font-size:1.2rem;font-weight:900;cursor:pointer;flex-shrink:0;align-items:center;justify-content:center">✓</button>
        <button id="ast-btn-edit" onclick="window._assistantGoEdit()" title="修改後記帳"
          style="display:none;width:38px;height:38px;border-radius:50%;background:var(--card2);border:1.5px solid var(--border);color:var(--t1);font-size:1rem;cursor:pointer;flex-shrink:0;align-items:center;justify-content:center">✏️</button>
        <button id="ast-voice" onclick="toggleVoice()"
          style="width:38px;height:38px;border-radius:50%;background:var(--card2);border:1.5px solid var(--border);font-size:1.1rem;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">🎤</button>
        <button onclick="sendAssistantMsg()"
          style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--p2));border:none;color:#000;font-size:1.1rem;font-weight:900;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">➤</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  updateDataModeUI();
}

// ── 對外函數 ─────────────────────────────────────────────────
window.sendAssistantMsg = function() {
  const inp = document.getElementById('ast-input');
  if (inp && inp.value.trim()) sendMsg(inp.value.trim());
};

window.setAssistantDataMode = function(mode) {
  const next = ['default', 'L4', 'L5'].includes(mode) ? mode : 'default';
  localStorage.setItem(DATA_MODE_KEY, next);
  updateDataModeUI();
  const label = dataModeLabel(next);
  appendMsg('assistant', next === 'default'
    ? '已切回預設模式，接下來會依問題自動判斷資料範圍。'
    : `已切換到${label}模式，接下來的查詢會固定抓${DATA_LEVELS[next].days}天資料。`);
};

// Sonnet 模式切換：開 → 深度分析（Sonnet 4.6，慢但完整）；關 → 飛快聊天（Haiku 4.5）
// L1 記帳指令永遠用 Haiku，不受此開關影響
window.toggleSonnetMode = function() {
  const next = !getSonnetMode();
  setSonnetMode(next);
  updateDataModeUI();
  const dm = getDataMode();
  let sampleHint;
  if (next) {
    if (dm === 'L5')      sampleHint = '半年範圍會給 800 筆明細';
    else if (dm === 'L4') sampleHint = '季範圍會給 500 筆明細';
    else                  sampleHint = '一般查詢會給 300 筆明細';
  }
  appendMsg('assistant', next
    ? `🧠 已開啟 Sonnet 4.6 深度分析模式。\n回應會稍慢（2-3 秒），但分析更精準完整。\n${sampleHint}，多數情境能涵蓋全部資料。\n（記帳指令仍用 Haiku 飛快處理）`
    : '⚡ 已切回 Haiku 4.5 飛快模式，適合聊天和快速查詢。'
  );
};

window.quickAsk = function(text) {
  sendMsg(text);
};

window.clearChat = function() {
  chatHistory = [];
  pendingTx   = null;
  const msgs  = document.getElementById('ast-msgs');
  if (msgs) msgs.innerHTML = '';
  updateConfirmBar();
  // 同步清除 localStorage（避免下次又跑出舊對話）
  try {
    localStorage.removeItem(CHAT_PERSIST_KEY);
    localStorage.removeItem(CHAT_DOM_KEY);
  } catch (e) {}
};

window.toggleVoice = toggleVoice;
window.closeAssistant = closeAssistant;

// 換角色時：清空對話、更新 UI、若助理開啟則重新送開場白
function handleCharChange() {
  const char = getChar();
  // 更新顯示
  const fab  = document.getElementById('ast-fab');
  const icon = document.getElementById('ast-hdr-icon');
  const name = document.getElementById('ast-hdr-name');
  if (fab)  fab.textContent   = char.emoji;
  if (icon) icon.textContent  = char.emoji;
  if (name) name.textContent  = char.name;

  // 清空對話與持久化記錄（新角色用新身份開場）
  chatHistory = [];
  pendingTx   = null;
  const msgs  = document.getElementById('ast-msgs');
  if (msgs) msgs.innerHTML = '';
  updateConfirmBar();
  try {
    localStorage.removeItem(CHAT_PERSIST_KEY);
    localStorage.removeItem(CHAT_DOM_KEY);
  } catch (e) {}

  // 重置 Sonnet toggle（新角色從 Haiku 預設開始，避免盈慧誤以為切角色後重置了但其實還在 Sonnet 模式）
  setSonnetMode(false);
  updateDataModeUI();

  // 若此時助理 panel 是開著的，立刻送新角色開場白
  if (isOpen) {
    _sendCharGreeting();
  }
}

// 跨頁面切換角色（其他分頁/設定頁修改）→ storage 事件
window.addEventListener('storage', (e) => {
  if (e.key !== 'mascot_char') return;
  handleCharChange();
});

// 同頁面切換角色：polling 偵測（storage 事件不會在同頁觸發）
let _lastCharId = (function(){ try { return localStorage.getItem('mascot_char') || 'koala'; } catch(e){ return 'koala'; } })();
setInterval(() => {
  try {
    const cur = localStorage.getItem('mascot_char') || 'koala';
    if (cur !== _lastCharId) {
      _lastCharId = cur;
      handleCharChange();
    }
  } catch(e){}
}, 1500);

// ── 初始化 ───────────────────────────────────────────────────
function init() {
  buildUI();
  console.log('[Assistant] 理財 AI 助理已載入');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
