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

// 資料範圍模式：default=原本智慧判斷，L4=固定近90天，L5=固定近180天
const DATA_MODE_KEY = 'assistant_data_mode';

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

  // ── 自然語言相對日期（優先比對）──────────────────────────
  // 本週（週一～週日）
  if (/本週|這週|本周|這周/.test(msg)) {
    const dow = now.getDay(); // 0=日
    const mondayOff = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(now); mon.setDate(d + mondayOff);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: toStr(mon.getFullYear(),mon.getMonth()+1,mon.getDate()),
             to:   toStr(sun.getFullYear(),sun.getMonth()+1,sun.getDate()) };
  }
  // 上週
  if (/上週|上周|前一週/.test(msg)) {
    const dow = now.getDay();
    const mondayOff = (dow === 0 ? -6 : 1 - dow) - 7;
    const mon = new Date(now); mon.setDate(d + mondayOff);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: toStr(mon.getFullYear(),mon.getMonth()+1,mon.getDate()),
             to:   toStr(sun.getFullYear(),sun.getMonth()+1,sun.getDate()) };
  }
  // 本月
  if (/本月|這個月|這月/.test(msg)) {
    return { from: toStr(y, mo+1, 1), to: toStr(y, mo+1, lastDay(y, mo+1)) };
  }
  // 上個月
  if (/上個月|上月|前一個月/.test(msg)) {
    const pm = mo === 0 ? 12 : mo;
    const py = mo === 0 ? y-1 : y;
    return { from: toStr(py, pm, 1), to: toStr(py, pm, lastDay(py, pm)) };
  }
  // 今年
  if (/今年/.test(msg)) {
    return { from: toStr(y, 1, 1), to: toStr(y, 12, 31) };
  }
  // X月份 或 X月（指定月份，今年）
  const mMonth = msg.match(/([一二三四五六七八九十百]+|\d{1,2})月份?/);
  if (mMonth) {
    const chToNum = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12};
    const mNum = chToNum[mMonth[1]] || +mMonth[1];
    if (mNum >= 1 && mNum <= 12) {
      const mYear = mNum > mo + 1 ? y - 1 : y; // 超過當月則為去年同月
      return { from: toStr(mYear, mNum, 1), to: toStr(mYear, mNum, lastDay(mYear, mNum)) };
    }
  }

  // ── 明確日期區間格式 ────────────────────────────────────
  const patterns = [
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*[到~～至\-]\s*(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
    /(\d{1,2})\/(\d{1,2})\s*[到~～至\-]\s*(\d{1,2})\/(\d{1,2})/,
    /(\d{1,2})月(\d{1,2})日?\s*[到~～至]\s*(\d{1,2})月(\d{1,2})日?/,
  ];

  let m2 = msg.match(patterns[0]);
  if (m2) return { from: toStr(+m2[1],+m2[2],+m2[3]), to: toStr(+m2[4],+m2[5],+m2[6]) };

  m2 = msg.match(patterns[1]);
  if (m2) return { from: toStr(y,+m2[1],+m2[2]), to: toStr(y,+m2[3],+m2[4]) };

  m2 = msg.match(patterns[2]);
  if (m2) return { from: toStr(y,+m2[1],+m2[2]), to: toStr(y,+m2[3],+m2[4]) };

  return null;
}

// 接受已解析好的 dateRange，避免重複呼叫 parseDateRange
function classifyDataLevel(msg, preParsedRange) {
  if (!msg) return 'L3';
  const m = msg.toLowerCase();

  // 若有明確日期區間，直接依範圍天數決定等級（優先判斷，避免被 L1 誤吃）
  const dr = preParsedRange !== undefined ? preParsedRange : parseDateRange(msg);
  if (dr) {
    const days = Math.ceil((new Date(dr.to) - new Date(dr.from)) / 864e5);
    if (days <= 7)   return 'L2';
    if (days <= 35)  return 'L3';
    if (days <= 90)  return 'L4';
    return 'L5';
  }

  // L1：明確記帳意圖（有金額數字 或 記帳關鍵字）
  const hasAmount = /\d+\s*(元|塊|円|$|USD)?/.test(msg) &&
    !/分析|報告|趨勢|比較|比|建議|查詢|查一下|花了多少|多少錢|總額|筆數|明細|消費|紀錄|記錄|統計|查/.test(m);
  const recordKeywords = /^(幫我記|記帳|記一筆|剛剛|買了|吃了|花了\d|付了\d)/;
  if (recordKeywords.test(m) || (hasAmount && !/分析|比較|趨勢|建議|查/.test(m))) return 'L1';

  // L5：長期或完整分析關鍵字
  if (/半年|六個月|一年|年度|長期|信用卡.*規劃|規劃.*信用卡|完整報告|詳細報告|全部分析|財務報告|資產|所有.*記帳|所有.*記錄|全部.*記帳|全部.*記錄|完整.*分析|完整.*財務|所有資料|全部資料|預算上限|建議.*預算|幫我設定.*預算/.test(m)) return 'L5';

  // L4：跨月比較
  if (/上個月|上月|前兩個月|兩個月|三個月|季度|季|比較|趨勢|變化|增加|減少|上升|下降/.test(m)) return 'L4';

  // L2：今日/昨日
  if (/今天|今日|昨天|昨日|剛才|剛剛|今晚|今早|今午|最近一兩天/.test(m)) return 'L2';

  // 預設 L3（本週/本月查詢）
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

// L3/L4/L5：從 Firebase 拉取（資料更完整，換手機也有）
async function getTxDataFirebase(level) {
  const lv = DATA_LEVELS[level || 'L3'];
  try {
    const db = (typeof getDb === 'function') ? getDb() : null;
    if (!db) return getTxDataLocal(level);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lv.days);
    const cutoffISO = cutoff.toISOString();
    // 正確做法：先用 where 過濾日期範圍，再 orderBy，最後才 limit
    // 這樣 limit 才是在日期範圍內的筆數限制，不會遺漏資料
    const snap = await db.collection('transactions')
      .where('at', '>=', cutoffISO)
      .orderBy('at', 'desc')
      .limit(1000)
      .get();
    const result = [];
    snap.forEach(doc => {
      const t = doc.data();
      if (t.private) return;
      result.push(_formatTx(t));
    });
    console.log(`[AI助理] Firebase 查詢 ${lv.days}天 → ${result.length} 筆`);
    return result;
  } catch (e) {
    console.warn('[AI助理] Firebase 查詢失敗，改用 localStorage:', e.message);
    return getTxDataLocal(level);
  }
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
    .map(c => `${c.id}(${c.name})`).join(', ');
}

function getCardList() {
  return (typeof getCards === 'function' ? getCards() : [])
    .map(c => `${c.id}:${c.name}(${c.last4})`).join(', ') || '無';
}

// ── 建立系統 Prompt ──────────────────────────────────────────
async function buildSystemPrompt(level, dateRange, includeRecordRules = false, userMsg = '') {
  const char    = getChar();
  const lv      = level || 'L3';
  const result  = await getTxData(lv, dateRange);
  const fullStats = result.fullStats;     // 完整統計（在 slice 前計算，數字精準）
  // 動態樣本數：問明細時給更多筆，一般查詢給 100 筆
  const wantDetail = wantsDetailedView(userMsg);
  const sampleSize = wantDetail ? DETAIL_FULL_LIMIT : DETAIL_SAMPLE_LIMIT;
  const sourceTxs  = result.txData || [];
  const txData     = _sampleTxs(sourceTxs, sampleSize);
  const isNearComplete = sourceTxs.length <= sampleSize;   // 樣本已涵蓋全部
  const txJson  = txData.length > 0 ? JSON.stringify(txData) : '（本次查詢不需要歷史資料）';
  const now     = new Date();
  const nowStr  = now.toLocaleDateString('zh-TW', {
    year:'numeric', month:'2-digit', day:'2-digit', weekday:'long'
  });
  const todayISO = now.toISOString().slice(0,10);
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
付款方式：現金 $${Math.round(fullStats.byCash)} / 信用卡 $${Math.round(fullStats.byCard)} / 悠遊卡 $${Math.round(fullStats.byIcard)}
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
【記帳規則：大膽假設、一次確認、絕不反問】
━━━━━━━━━━━━━━━━━━━━━

收到記帳訊息，立刻補全缺漏資訊，直接出示確認句，不得反問：

預設值：日期=今天（${todayISO}）｜記帳人=${currentUser}｜付款=現金｜分類=自行推斷

確認句格式：「[日期] [分類]-[子分類]-[明細]，[記帳人]用[付款方式]消費 $[金額]，對嗎？」

例子：
- 「飲料135」→「今天 餐飲-飲料-飲料，${currentUser}用現金消費 $135，對嗎？」
- 「晚餐地瓜60現金盈慧」→「今天 餐飲-晚餐-烤地瓜，盈慧用現金消費 $60，對嗎？」
- 「Uber 230刷卡」→「今天 交通-計程車-Uber，${currentUser}用信用卡消費 $230，對嗎？」

用戶確認（對/是/沒錯/ok）→ 立刻輸出 [RECORD] 格式：
[RECORD]{"amount":數字,"cat":"分類id","subCat":"子分類","detail":"說明","date":"YYYY-MM-DD","pay":"cash/card/icard","cardId":"信用卡id或null"}[/RECORD]
後面用你的個性說一句不超過20字的話。

【嚴格禁止】反問任何問題（不可問日期/記帳人/付款方式），資訊完整時絕不說「還需要知道」。` : ''}

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

  try {
    const res = await fetchClaudeAPI(key, {
      model: 'claude-haiku-4-5',
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

    // 若因 max_tokens 截斷，自動繼續請求
    if (data.stop_reason === 'max_tokens') {
      chatHistory.push({ role: 'assistant', content: reply });
      try {
        const res2 = await fetchClaudeAPI(key, {
          model: 'claude-haiku-4-5',
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

// ── 確認記帳卡片 ─────────────────────────────────────────────
function buildConfirmCard(r) {
  const catLabel  = typeof catName === 'function' ? catName(r.cat) : r.cat;
  const subLabel  = r.subCat ? ` › ${r.subCat}` : '';
  const payLabel  = r.pay === 'cash' ? '💵 現金' : r.pay === 'icard' ? '🎫 悠遊卡' : '💳 信用卡';
  const cardLabel = r.cardId && typeof cardFind === 'function'
    ? `（${cardFind(r.cardId)?.name || r.cardId}）` : '';
  const person    = r.person || localStorage.getItem('current_user') || '';

  return `<div style="background:var(--pdim);border:1.5px solid var(--p);border-radius:12px;padding:12px 14px;margin:8px 0;font-size:.85rem">
    <div style="font-weight:700;color:var(--p);margin-bottom:8px">📋 確認記帳</div>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;line-height:1.9;color:var(--t1)">
      <span style="color:var(--t3);font-size:.78rem">日期</span><span>${r.date}</span>
      <span style="color:var(--t3);font-size:.78rem">分類</span><span>${catLabel}${subLabel}</span>
      <span style="color:var(--t3);font-size:.78rem">明細</span><span>${r.detail || '（未填）'}</span>
      <span style="color:var(--t3);font-size:.78rem">金額</span><span style="font-weight:900;color:var(--p)">$${fmt(r.amount)}</span>
      <span style="color:var(--t3);font-size:.78rem">付款</span><span>${payLabel}${cardLabel}</span>
      <span style="color:var(--t3);font-size:.78rem">記帳人</span><span>${person}</span>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button onclick="window._assistantConfirm()" style="flex:1;padding:10px;background:linear-gradient(135deg,var(--p),var(--p2));color:#000;border:none;border-radius:8px;font-weight:900;cursor:pointer;font-family:inherit;font-size:.88rem">✅ 確認</button>
      <button onclick="window._assistantCancel()" style="flex:1;padding:10px;background:var(--card2);border:1px solid var(--border);color:var(--t2);border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;font-size:.88rem">✏️ 修改</button>
    </div>
  </div>`;
}

// ── 確認記帳 ────────────────────────────────────────────────
window._assistantConfirm = function() {
  if (!pendingTx) return;
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
    person:  tx.person || localStorage.getItem('current_user') || '宏龍',
    at:      new Date(parts[0], parts[1]-1, parts[2], 12, 0, 0).toISOString()
  };

  if (typeof addTx === 'function')    addTx(txObj);
  if (typeof fbAddTx === 'function')  fbAddTx(txObj);
  if (typeof discordOnAddWithComment === 'function') {
    const char = getChar();
    discordOnAddWithComment(txObj, char.name + ' 透過 AI 助理幫你記帳了 ✨');
  }

  // 移除確認卡片，加入成功訊息
  const confirmCard = document.querySelector('#ast-msgs .confirm-card');
  if (confirmCard) confirmCard.remove();

  const char = getChar();
  appendMsg('assistant', `已幫你記好了！$${fmt(tx.amount)} 已存入 ✅\n${char.name}覺得你很棒，有在好好記帳 💪`);
  saveChatToStorage();

  // 存到 Firebase 對話記錄
  saveConversation('[已確認記帳] $' + tx.amount + ' ' + (tx.detail||''));
};

window._assistantCancel = function() {
  pendingTx = null;
  const confirmCard = document.querySelector('#ast-msgs .confirm-card');
  if (confirmCard) confirmCard.remove();
  appendMsg('assistant', '好的，取消記帳了。需要修改什麼再告訴我 😊');
  saveChatToStorage();
};

// ── 發送訊息 ─────────────────────────────────────────────────
async function sendMsg(text) {
  if (!text.trim() || isLoading) return;
  isLoading = true;

  appendMsg('user', text);
  clearInput();
  showTyping();

  const reply = await callClaude(text);
  hideTyping();

  const record = parseRecord(reply);
  const displayReply = getDisplayReply(reply);

  if (record && record.amount > 0) {
    pendingTx = record;
    appendMsg('assistant', displayReply, buildConfirmCard(record));
  } else {
    appendMsg('assistant', displayReply);
  }

  // 存到 Firebase + Discord
  saveChatLog(text, displayReply);

  // 對話存到 localStorage（跨頁面保留）
  saveChatToStorage();

  isLoading = false;
}

// AI 對話記錄專用 Discord 頻道
const CHAT_LOG_WEBHOOK = 'https://discord.com/api/webhooks/1497601562782990407/agylbOyLjHrIGFu46LljF02wCGK4lZNdoqVHw_wOTSNIGxVuBnfBxm_Ozea8t3eZ0WIT';
async function saveChatLog(userMsg, assistantMsg) {
  try {
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
      await getDb().collection('chat_logs').add(data);
    }

    // Discord（專用 #ai對話記錄 頻道）
    if (!CHAT_LOG_WEBHOOK) return;

    const char    = getChar();
    const nowStr  = new Date().toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit' });
    const person  = localStorage.getItem('current_user') || '';

    // Discord 2000 字元限制，超過自動分段
    const MAX = 3800; // Discord embed description 上限約 4096
    const sendChunk = async (text, title) => {
      await fetch(CHAT_LOG_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title,
            color: 0x6366F1,
            description: text,
            footer: { text: '家庭記帳 PWA · AI 助理' }
          }]
        })
      });
    };

    // 第一則：用戶問題 + 助理回覆開頭
    const header = `👤 **${person}**\n${userMsg}\n\n${char.emoji} **${char.name}**\n`;
    const title  = `💬 AI 對話記錄　${today()} ${nowStr}`;

    if ((header + assistantMsg).length <= MAX) {
      await sendChunk(header + assistantMsg, title);
    } else {
      // 分段發送
      await sendChunk(header, title);
      let remaining = assistantMsg;
      let part = 1;
      while (remaining.length > 0) {
        const chunk = remaining.slice(0, MAX);
        remaining = remaining.slice(MAX);
        await sendChunk(chunk, remaining.length > 0 ? `${title}（續${part}）` : `${title}（完）`);
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
function renderMarkdown(text) {
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
  msgs.scrollTop = msgs.scrollHeight;
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

    <!-- 資料範圍模式 -->
    <div style="display:flex;align-items:center;gap:6px;padding:8px 12px 0;overflow-x:auto;flex-shrink:0;scrollbar-width:none">
      <span style="font-size:.68rem;color:var(--t3);white-space:nowrap">資料範圍：<b id="ast-mode-label">預設</b></span>
      <button class="ast-mode" data-ast-mode="default" onclick="setAssistantDataMode('default')" aria-pressed="true">預設</button>
      <button class="ast-mode" data-ast-mode="L4" onclick="setAssistantDataMode('L4')" aria-pressed="false">季</button>
      <button class="ast-mode" data-ast-mode="L5" onclick="setAssistantDataMode('L5')" aria-pressed="false">半年</button>
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

window.quickAsk = function(text) {
  sendMsg(text);
};

window.clearChat = function() {
  chatHistory = [];
  pendingTx   = null;
  const msgs  = document.getElementById('ast-msgs');
  if (msgs) msgs.innerHTML = '';
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
  try {
    localStorage.removeItem(CHAT_PERSIST_KEY);
    localStorage.removeItem(CHAT_DOM_KEY);
  } catch (e) {}

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
