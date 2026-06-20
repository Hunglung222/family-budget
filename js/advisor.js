/* ══════════════════════════════════════════════════════
 * 💰 阿錢 — 家庭專屬財務顧問 × 知心好友 × 全系統總管
 * ──────────────────────────────────────────────────────
 * 定位：Hub 角色。一個統一窗口，貫穿整套家庭記帳系統。
 *   - 看得到記帳夥伴、家庭寵物、個人盆栽
 *   - 認識投資顧問老余、交易紀律教練鐵衛，需要時轉介
 *   - 有記憶、每日主動建議、隨時深聊/談心，跨時間陪伴
 *
 * 三層記憶（存 localStorage 快取 + Firebase shared/advisor/*，兩人共用）：
 *   1. profile    長期事實：是誰、財務目標、重大約定（幾乎不變）
 *   2. milestones 里程碑：跨越財務階段的時間點與情境（成長軌跡）
 *   3. recent     近期情境：最近對話摘要、情緒、煩惱（滾動更新，壓縮不無限長）
 *
 * 設計原則：
 *   - 全域變數一律加前綴（ADVISOR_ / _adv）避免與其他已載入 js/inline 撞名
 *   - 日期一律用 toLocalISO()，禁用 .toISOString().slice(0,10)
 *   - 財務快照重用 db.js 全域函數（getIncomes/getTx/...），與老余看同一份真相
 *   - fbSync 函數在 firebase.js，所以 firebase.js 必須先載入
 * ══════════════════════════════════════════════════════ */

// ── 阿錢人設（固定，不像 12 記帳夥伴可切換）──────────────
const ADVISOR_PROFILE = {
  id:    'achian',
  name:  '阿錢',
  emoji: '💰',
  role:  '家庭專屬財務顧問 × 知心好友',
  catchphrase: '錢的事，慢慢來，但要一直走。',
  // 人格主軸：雙模式由情境（prompt）驅動，不靠切換角色
  persona: [
    '你是「阿錢」，一位約 40 歲、溫暖沉穩的台灣家庭財務顧問，是宏龍和盈慧的專屬顧問，也是陪他們很久的知心好友。',
    '你是「人類」，不是動物吉祥物——在一群可愛的記帳小動物之中，你是那個最真實、最值得信任、認真陪他們過日子的人。',
    '你的口頭禪：「錢的事，慢慢來，但要一直走。」偶爾講一兩句溫暖的台語。',
    '',
    '【你的雙模式，看情境自動切換，不需要使用者指定】',
    '・顧問模式（談數字、做分析、給建議時）：像有 20 年經驗的私人財務顧問。冷靜、精準、給「具體可執行」的步驟與數字，不講空泛大道理，所有建議都有數據依據。',
    '・知心模式（對方累了、焦慮、想放棄、心情低落時）：先接住情緒，像老朋友坐下來陪他喘口氣。不說教、不硬塞理財知識、不報喜不報憂、不用罐頭安慰。等情緒穩了，再溫柔地一起想辦法。',
    '',
    '【你的核心信念】「錢的問題，從來不只是錢的問題。我陪你們看數字，也陪你們過日子。」',
    '你陪他們的目標是長期的：從負債、月光，一步一步走到收支平衡、開始儲蓄、緊急備用金、投資，甚至財務自由。你會記得他們走過的路，在他們進步時讓他們看見自己的成長。',
    '',
    '【你和其他角色的關係——你是統一窗口，認識他們但不取代他們】',
    '・12 隻記帳小夥伴（可可、寶寶、小智、歐比…）：每次記帳時陪伴用戶的可愛角色。你看得到他們今天選了誰，可以自然提起。',
    '・家庭寵物（狐狸/狗狗等，兩人共養）+ 個人盆栽：是「財務健康」的視覺化進度，由你來旁白。寵物不會自己說話。',
    '・老余（🦁 投資顧問）：投資配置、ETF、定期定額的專家，個性務實穩重、重長期複利。你「看得到」他們的投資持有明細（在財務快照的「投資.持有明細」），所以談投資時可以講出具體的標的、損益、佔比，給一個高層次的整體觀察（例如部位是否過度集中、緊急備用金沒滿就別急著加碼）。但「要買什麼、怎麼配、進出場時機」這種細節，請引導他們去投資頁找老余，不要自己給明確的買賣指令。',
    '・鐵衛（🤖 台股交易紀律教練）：負責短線交易的紀律與覆盤。遇到交易紀律問題，提醒去找鐵衛。',
    '你管的是「整個家的財務全局」（收支、負債、儲蓄、情緒、目標、陪伴），這是你和老余最大的不同——老余只管投資那一塊。',
    '',
    '【回答規則】',
    '・必須使用台灣繁體中文，不用簡體字。',
    '・回答簡潔，適合手機閱讀，一般不超過 250 字（深聊或對方需要時可以長一點）。',
    '・引用財務數字時，只引用下方「財務快照」與「統計數據」提供的數字，不要自己重算或編造。',
    '・若某項數據為 0 或空，可能是還沒記錄，溫和引導去記，不要假設。',
    '・你不是正式持牌的財務顧問或投資顧問，重大決定提醒對方自行判斷。',
  ].join('\n'),
};

function getAdvisor() { return ADVISOR_PROFILE; }

// ── 記憶層 ───────────────────────────────────────────────
// 預設骨架
function _advDefaultMemory() {
  return {
    profile: {
      members: ['宏龍', '盈慧'],
      stage: '',          // 目前財務階段（見 ADVISOR_STAGES）
      goals: [],          // [{title, note}] 重要財務目標（還卡債、緊急備用金…）
      facts: [],          // 長期事實/重大約定（手動或 AI 提煉）
      updatedAt: '',
    },
    milestones: [],       // [{date, stage, title, context}] 成長軌跡
    recent: {
      summary: '',        // 最近對話的滾動摘要（壓縮）
      mood: '',           // 最近情緒狀態（如「焦慮」「平穩」「有動力」）
      concerns: [],       // 最近提過的煩惱（最多保留數則）
      lastTalkedAt: '',   // 最後一次深聊日期
    },
  };
}

function getAdvisorMemory() {
  try {
    const m = JSON.parse(localStorage.getItem('advisor_memory') || 'null');
    if (m && m.profile) {
      // 與預設骨架合併，補齊可能缺的欄位（向後相容）
      const d = _advDefaultMemory();
      return {
        profile:    { ...d.profile,    ...(m.profile    || {}) },
        milestones: Array.isArray(m.milestones) ? m.milestones : d.milestones,
        recent:     { ...d.recent,     ...(m.recent     || {}) },
      };
    }
  } catch (e) {}
  return _advDefaultMemory();
}

function saveAdvisorMemory(mem) {
  try { localStorage.setItem('advisor_memory', JSON.stringify(mem)); } catch (e) {}
  if (typeof fbSyncAdvisorMemory === 'function') fbSyncAdvisorMemory(mem);
  return mem;
}

function _advToday() {
  return (typeof toLocalISO === 'function') ? toLocalISO() : new Date().toISOString().slice(0, 10);
}

// 更新近期記憶（一次深聊結束後呼叫）
//   patch = { summary?, mood?, addConcern?, turns? }
function updateAdvisorRecent(patch = {}) {
  const mem = getAdvisorMemory();
  const r = mem.recent;
  if (typeof patch.summary === 'string') r.summary = patch.summary.slice(0, 1200); // 摘要壓縮上限
  if (typeof patch.mood === 'string' && patch.mood) r.mood = patch.mood;
  if (patch.addConcern) {
    r.concerns = (r.concerns || []);
    r.concerns.push({ date: _advToday(), text: String(patch.addConcern).slice(0, 200) });
    r.concerns = r.concerns.slice(-5); // 最多保留最近 5 則煩惱
  }
  // 隱私：原始逐字對話只留本機（advisor_chat_session），不寫進共用記憶。
  // 共用記憶只保留「濃縮後的理解」（摘要/情緒/在意的事）。清除任何 legacy turns。
  if (r.turns) delete r.turns;
  r.lastTalkedAt = _advToday();
  return saveAdvisorMemory(mem);
}

// 設定/更新長期目標
function setAdvisorGoals(goals) {
  const mem = getAdvisorMemory();
  mem.profile.goals = (goals || []).slice(0, 10);
  mem.profile.updatedAt = _advToday();
  return saveAdvisorMemory(mem);
}

// 新增一則長期事實/約定
function addAdvisorFact(text) {
  const mem = getAdvisorMemory();
  mem.profile.facts = (mem.profile.facts || []);
  mem.profile.facts.push(String(text).slice(0, 200));
  mem.profile.facts = mem.profile.facts.slice(-20);
  mem.profile.updatedAt = _advToday();
  return saveAdvisorMemory(mem);
}

// 新增單一目標（記憶面板用）
function addAdvisorGoal(title, note) {
  const mem = getAdvisorMemory();
  mem.profile.goals = (mem.profile.goals || []);
  if (title && String(title).trim()) {
    mem.profile.goals.push({ title: String(title).trim().slice(0, 60), note: (note || '').slice(0, 100) });
    mem.profile.goals = mem.profile.goals.slice(0, 10);
    mem.profile.updatedAt = _advToday();
    saveAdvisorMemory(mem);
  }
  return mem;
}
// 刪除第 i 個目標
function removeAdvisorGoal(i) {
  const mem = getAdvisorMemory();
  if (Array.isArray(mem.profile.goals) && i >= 0 && i < mem.profile.goals.length) {
    mem.profile.goals.splice(i, 1);
    mem.profile.updatedAt = _advToday();
    saveAdvisorMemory(mem);
  }
  return mem;
}
// 刪除第 i 個事實
function removeAdvisorFact(i) {
  const mem = getAdvisorMemory();
  if (Array.isArray(mem.profile.facts) && i >= 0 && i < mem.profile.facts.length) {
    mem.profile.facts.splice(i, 1);
    mem.profile.updatedAt = _advToday();
    saveAdvisorMemory(mem);
  }
  return mem;
}

// 新增一個里程碑（成長見證，階段三會自動偵測呼叫）
function addAdvisorMilestone(stage, title, context) {
  const mem = getAdvisorMemory();
  mem.milestones = (mem.milestones || []);
  // 同階段已記錄過就不重複
  if (mem.milestones.some(m => m.stage === stage)) return mem;
  mem.milestones.push({
    date: _advToday(),
    stage: stage || '',
    title: title || '',
    context: (context || '').slice(0, 300),
  });
  mem.milestones = mem.milestones.slice(-30);
  if (mem.profile) mem.profile.stage = stage || mem.profile.stage;
  return saveAdvisorMemory(mem);
}

// 依 key 取得階段物件
function getStageByKey(key) {
  return ADVISOR_STAGES.find(s => s.key === key) || null;
}

// 目前已達到的最高階段 order（從里程碑歷史推算）
function _advHighestReachedOrder(mem) {
  let hi = 0;
  (mem.milestones || []).forEach(m => {
    const s = getStageByKey(m.stage);
    if (s && s.order > hi) hi = s.order;
  });
  return hi;
}

/* 偵測財務階段是否「向前跨越」到新高度（成長見證核心）
 * 回傳：
 *   { baseline:true, stage }                  第一次建立基準點（不慶祝，靜默記錄）
 *   { crossed:true, stage, prevStage }        跨越到新階段（要慶祝）
 *   { crossed:false, stage }                  沒有前進（同階段或回落，不慶祝）
 * 只往前慶祝、只記錄一次，回落不記錄（回落的低潮由 recent 記憶承接）
 */
function checkAdvisorMilestone() {
  const snap = buildAdvisorSnapshot();
  const stage = getAdvisorStage(snap);
  const mem = getAdvisorMemory();
  const recorded = mem.milestones || [];

  // 第一次：沒有任何里程碑 → 靜默記錄起點，不慶祝（避免老用戶一開啟就跳假里程碑）
  if (recorded.length === 0) {
    addAdvisorMilestone(stage.key, '開始記帳的起點 · ' + stage.name, '阿錢開始陪伴你們的地方');
    return { baseline: true, stage };
  }

  const highestOrder = _advHighestReachedOrder(mem);
  const prevStage = ADVISOR_STAGES.find(s => s.order === highestOrder) || null;

  // 向前跨越到比過去最高更高的階段 → 慶祝 + 記錄
  if (stage.order > highestOrder) {
    addAdvisorMilestone(stage.key, '邁入 ' + stage.name, `從「${prevStage ? prevStage.name : '起點'}」前進到「${stage.name}」`);
    return { crossed: true, stage, prevStage };
  }

  return { crossed: false, stage };
}

// 跨階段時的靜態祝賀（沒有 API key 也能有溫度，不留空白）
function _advStaticMilestoneMsg(stage, prevStage) {
  const from = prevStage ? prevStage.name : '起點';
  const map = {
    paycheck:  `你們從背債的壓力裡走出來了，這一步很不容易。接下來我們一起想辦法，讓每個月開始留得住一點錢。`,
    balance:   `收支平衡了！從「${from}」走到這裡，代表你們真的把錢看住了。這是所有改變的起點，我為你們高興。`,
    saving:    `開始存得下錢了 🌱 還記得從前月底總是空空的嗎？現在你們有了結餘，第一桶金正在長出來。`,
    emergency: `緊急備用金達標了！這代表就算遇到意外，你們的生活也不會被打亂——財務有了韌性，這是很大的安全感。`,
    investing: `行有餘力，開始讓錢替你們工作了。投資的路上記得找老余聊聊配置，我幫你們看好整體節奏。`,
    freedom:   `你們正走在邁向財務自由的路上。從一開始到現在，這一路的努力我都看在眼裡，真的很了不起。`,
  };
  return map[stage.key] || `你們又往前跨了一步，從「${from}」邁入「${stage.name}」。我一直都在，陪你們繼續走。`;
}

// 跨階段時請阿錢生成「回顧式」祝賀（還記得…嗎），有 API key 才呼叫
async function generateMilestoneMessage(stage, prevStage) {
  const mem = getAdvisorMemory();
  const journey = (mem.milestones || []).map(m => `${m.date} ${m.title}`).join('；');
  const sys = buildAdvisorSystemPrompt({ daily: false });
  const ask = `【特殊時刻】使用者的家庭財務剛剛從「${prevStage ? prevStage.name : '起點'}」向前跨越到「${stage.name}」，這是值得紀念的里程碑。
他們走過的路：${journey || '（剛開始）'}
請你以阿錢的身份，說一段溫暖、真誠的祝賀。回顧他們的成長（可以用「還記得…嗎」這樣的句子），具體連結他們走過的階段，讓他們感受到「有一個記得他們過去的人，正在見證他們的改變」。不要浮誇、不要說教，120～180 字。`;
  const r = await _advCallClaude(sys, [{ role: 'user', content: ask }], 500);
  return r;
}
// 由收支/儲蓄/負債/備用金推斷目前處於哪個階段
const ADVISOR_STAGES = [
  { key:'debt',     name:'背債期',     order:1, desc:'有未清負債，先止血、規劃還款' },
  { key:'paycheck', name:'月光期',     order:2, desc:'收支大致打平但存不下來' },
  { key:'balance',  name:'收支平衡',   order:3, desc:'開始有結餘，建立記帳習慣' },
  { key:'saving',   name:'開始儲蓄',   order:4, desc:'穩定有儲蓄率，累積第一桶金' },
  { key:'emergency',name:'備用金達標', order:5, desc:'緊急備用金足夠，財務有韌性' },
  { key:'investing',name:'開始投資',   order:6, desc:'行有餘力，讓錢替你工作' },
  { key:'freedom',  name:'邁向自由',   order:7, desc:'被動收入累積，朝財務自由前進' },
];

function getAdvisorStage(snap) {
  try {
    const s = snap || buildAdvisorSnapshot();
    const inc = s._raw.avgInc, exp = s._raw.avgExp;
    const debt = s._raw.pendingBills + s._raw.instRem;
    const efMonths = s._raw.efMonths;
    const hasInv = (s._raw.invCur || 0) > 0;
    const rate = inc > 0 ? (inc - exp) / inc : 0;

    if (inc <= 0) return ADVISOR_STAGES[1]; // 沒收入資料，當月光期處理（保守）
    if (debt > inc * 1.5) return ADVISOR_STAGES[0];               // 背債期
    if (rate <= 0.02) return ADVISOR_STAGES[1];                   // 月光期
    if (hasInv && efMonths >= 6) {
      return rate >= 0.3 ? ADVISOR_STAGES[6] : ADVISOR_STAGES[5]; // 投資/邁向自由
    }
    if (efMonths >= 6) return ADVISOR_STAGES[4];                  // 備用金達標
    if (rate >= 0.1) return ADVISOR_STAGES[3];                    // 開始儲蓄
    return ADVISOR_STAGES[2];                                     // 收支平衡
  } catch (e) {
    return ADVISOR_STAGES[2];
  }
}

// ── 財務快照（重用 db.js 全域函數，與老余同一份真相）─────────
function _advCalcAvgIncome(now) {
  if (typeof getIncomes !== 'function') return 0;
  const incomes = getIncomes();
  if (!incomes.length) return 0;
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const recent = incomes.filter(i => new Date(i.at) >= threeMonthsAgo);
  if (!recent.length) return incomes.reduce((s, i) => s + (i.amount || 0), 0) / Math.max(1, incomes.length);
  const months = Math.max(1, Math.min(3, (() => {
    const dates = recent.map(i => new Date(i.at));
    const minD = new Date(Math.min(...dates));
    return Math.ceil((now - minD) / (1000 * 60 * 60 * 24 * 30));
  })()));
  return recent.reduce((s, i) => s + (i.amount || 0), 0) / months;
}

function _advCalcAvgExpense(now) {
  if (typeof getTx !== 'function') return 0;
  const txs = getTx();
  if (!txs.length) return 0;
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const recent = txs.filter(t => new Date(t.at) >= threeMonthsAgo && (t.amount || 0) > 0);
  if (!recent.length) return 0;
  return recent.reduce((s, t) => s + (t.amount || 0), 0) / 3;
}

function buildAdvisorSnapshot() {
  const now = new Date();
  const avgInc = _advCalcAvgIncome(now);
  const avgExp = _advCalcAvgExpense(now);

  const instActive = (typeof getInstallments === 'function')
    ? getInstallments().filter(i => i.status === 'active') : [];
  const instAmt = instActive.reduce((s, i) => s + (i.monthlyAmt || Math.floor((i.totalAmt || 0) / (i.months || 1))), 0);
  const instRem = instActive.reduce((s, i) => {
    const left = (i.months || 0) - (i.paidCount || 0);
    return s + left * (i.monthlyAmt || Math.floor((i.totalAmt || 0) / (i.months || 1)));
  }, 0);
  const investable = Math.max(0, avgInc - avgExp - instAmt);

  const walBal = (typeof getWal === 'function' ? (getWal().balance || 0) : 0);
  const acctBal = (typeof getAccts === 'function') ? getAccts(false).reduce((s, a) => s + (a.balance || 0), 0) : 0;
  const shBal = (typeof getAccts === 'function') ? getAccts(true).reduce((s, a) => s + (a.balance || 0), 0) : 0;
  const totalCash = walBal + acctBal + shBal;
  const efGoal = avgExp * 6;
  const efMonths = avgExp > 0 ? totalCash / avgExp : 0;

  const pendingBills = (typeof getPendingBills === 'function')
    ? getPendingBills().reduce((s, b) => s + (b.total || 0), 0) : 0;

  const invList = (typeof getInvestments === 'function') ? getInvestments() : [];
  const invCost = invList.reduce((s, i) => s + (i.costAmt || 0), 0);
  const invCur = invList.reduce((s, i) => s + (i.currentAmt ?? i.costAmt ?? 0), 0);
  // 逐檔明細（讓阿錢談投資時講得出具體標的，再轉介老余處理配置）
  const invHoldings = invList.slice(0, 12).map(i => {
    const cost = i.costAmt || 0;
    const cur = (i.currentAmt ?? i.costAmt ?? 0);
    return {
      標的: i.name || i.fullName || '未命名',
      成本: Math.round(cost),
      現值: Math.round(cur),
      損益: Math.round(cur - cost),
      報酬率: cost > 0 ? (((cur - cost) / cost) * 100).toFixed(1) + '%' : '—',
      佔比: invCur > 0 ? Math.round(cur / invCur * 100) + '%' : '—',
    };
  });

  const streak = (typeof getStreak === 'function') ? getStreak() : { current: 0, longest: 0 };
  const goals = (typeof getGoals === 'function') ? getGoals() : [];

  const rate = avgInc > 0 ? (investable / avgInc * 100) : 0;

  return {
    user: (typeof currentUser === 'function') ? currentUser() : '用戶',
    today: _advToday(),
    月均收入: Math.round(avgInc),
    月均支出: Math.round(avgExp),
    分期月付: Math.round(instAmt),
    每月可結餘: Math.round(investable),
    儲蓄率: avgInc > 0 ? rate.toFixed(1) + '%' : '無收入資料',
    緊急備用金: {
      現有: Math.round(totalCash),
      目標: Math.round(efGoal),
      可維持月數: efMonths.toFixed(1) + ' 個月',
      狀態: efMonths >= 6 ? '充足' : efMonths >= 3 ? '尚可' : '不足',
    },
    負債: {
      信用卡未繳: Math.round(pendingBills),
      分期剩餘: Math.round(instRem),
      負債收入比: avgInc > 0 ? ((pendingBills + instRem) / avgInc * 100).toFixed(1) + '%' : '無資料',
    },
    投資: { 總成本: Math.round(invCost), 現值: Math.round(invCur), 損益: Math.round(invCur - invCost), 持有明細: invHoldings },
    記帳習慣: { 連續打卡天數: streak.current || 0, 最長連續: streak.longest || 0 },
    儲蓄目標: goals.map(g => ({
      目標: g.title || g.name || '',
      進度: (g.target > 0) ? Math.min(100, Math.round((g.current || 0) / g.target * 100)) + '%' : '未設目標',
    })),
    // 內部用（判定階段，不丟給 AI 看，避免它重算）
    _raw: { avgInc, avgExp, pendingBills, instRem, efMonths, invCur },
  };
}

// ── 組合 system prompt（人設 + 記憶 + 快照）────────────────
function buildAdvisorSystemPrompt(opts = {}) {
  const adv = ADVISOR_PROFILE;
  const mem = getAdvisorMemory();
  const snap = buildAdvisorSnapshot();
  const stage = getAdvisorStage(snap);
  const me = snap.user;

  // 快照丟給 AI 前移除內部欄位
  const snapForAI = { ...snap };
  delete snapForAI._raw;

  const now = new Date();
  const nowStr = now.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' });

  // 記憶摘要區塊
  const memLines = [];
  memLines.push('【你對這個家庭的記憶】');
  if (mem.profile.members && mem.profile.members.length) memLines.push(`成員：${mem.profile.members.join('、')}`);
  memLines.push(`目前財務階段：${stage.name}（${stage.desc}）`);
  if (mem.profile.goals && mem.profile.goals.length) {
    memLines.push('他們的財務目標：');
    mem.profile.goals.forEach(g => memLines.push(`  ・${g.title}${g.note ? '（' + g.note + '）' : ''}`));
  }
  if (mem.profile.facts && mem.profile.facts.length) {
    memLines.push('你記得的重要事情：');
    mem.profile.facts.slice(-8).forEach(f => memLines.push(`  ・${f}`));
  }
  if (mem.milestones && mem.milestones.length) {
    memLines.push('他們走過的路（里程碑）：');
    mem.milestones.slice(-6).forEach(ms => memLines.push(`  ・${ms.date} ${ms.title || ms.stage}`));
  }
  if (mem.recent.summary) memLines.push(`最近聊過：${mem.recent.summary}`);
  if (mem.recent.mood) memLines.push(`最近的情緒狀態：${mem.recent.mood}`);
  if (mem.recent.concerns && mem.recent.concerns.length) {
    memLines.push('最近在意的事：');
    mem.recent.concerns.slice(-3).forEach(c => memLines.push(`  ・${c.text}`));
  }
  if (mem.recent.lastTalkedAt) memLines.push(`上次深聊：${mem.recent.lastTalkedAt}`);

  // 記帳夥伴（阿錢看得到今天陪伴用戶的是誰）
  let companionLine = '';
  try {
    if (typeof getChar === 'function') {
      const c = getChar();
      if (c && c.name) companionLine = `（目前使用者選的記帳小夥伴是「${c.name}」${c.emoji || ''}，你可以自然提起牠。）`;
    }
  } catch (e) {}

  // 家庭寵物狀態（阿錢來旁白）
  let petLine = '';
  try {
    if (typeof getPet === 'function') {
      const p = getPet();
      if (p && p.type && typeof PET_TYPES !== 'undefined' && PET_TYPES[p.type]) {
        const info = PET_TYPES[p.type];
        const st = (typeof getPetStage === 'function') ? getPetStage(p).name : '';
        petLine = `（家庭共養的寵物是${info.name}${info.emoji}・${st}，連續被餵養 ${p.feedStreak || 0} 天、健康 ${p.health}。狀態好就肯定他們有持續記帳，狀態差就溫柔提醒。寵物不會自己說話，由你旁白。）`;
      }
    }
  } catch (e) {}

  const modeHint = opts.daily
    ? '\n【本次任務】這是「每日主動關心」，會「同時」顯示給宏龍和盈慧兩個人看（共用同一則）。根據昨天到今天的真實記帳與財務快照，主動說一段有溫度又具體的話：先「看見」他們做對的事或值得在意的變化，再給一個小小的、今天就能做的建議。\n【稱呼規則｜很重要】這則訊息是給「兩個人」的，所以一律用「你們」稱呼，或同時提到兩人（例如「宏龍、盈慧早安」）。絕對不要只對其中一個人說話、不要用單一姓名當開頭問候（例如不要「嗨，宏龍」這種）。像一個記得這個家、每天惦記他們兩人的朋友，不是冷冰冰的報表。控制在 80～150 字。'
    : '';

  // 每日訊息是兩人共看的，不綁定單一登入者；對話模式才標明目前是誰在跟阿錢說話
  const whoLine = opts.daily
    ? '這則每日訊息同時給宏龍和盈慧兩人共看'
    : `目前登入者：${me}`;

  return `${adv.persona}

現在時間：${nowStr}
${whoLine}
${companionLine}
${petLine}

${memLines.join('\n')}

【財務快照（從記帳 App 即時擷取，數字精確，請直接引用、勿重算）】
${JSON.stringify(snapForAI, null, 2)}
${modeHint}`;
}

// ── 呼叫 Claude（沿用 assistant.js 的瀏覽器直連方式）────────
async function _advCallClaude(systemPrompt, messages, maxTokens, forceSonnet) {
  const key = (typeof getKey === 'function') ? getKey() : (localStorage.getItem('claude_api_key') || '');
  if (!key) return { ok: false, error: 'NO_KEY', text: '還沒設定 Claude API Key，請到「設定 → API 設定」填入，阿錢才能開口說話。' };

  // 深聊用 Sonnet（若使用者開啟），每日建議用 Haiku 省 token；
  // 有附件（圖片/PDF）時強制用 Sonnet，文件理解較佳
  const useSonnet = forceSonnet || (typeof getSonnetMode === 'function' && getSonnetMode());
  const model = useSonnet ? 'claude-sonnet-4-6' : 'claude-haiku-4-5';
  // 防禦性清洗：送給 API 的每則訊息只能有 {role, content}，
  // 任何多餘欄位（如對話歷史的 ts）都會讓 API 報 "Extra inputs are not permitted"
  const cleanMessages = (Array.isArray(messages) ? messages : []).map(m => ({ role: m.role, content: m.content }));
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens || 1024,
        system: systemPrompt,
        messages: cleanMessages,
      }),
    });
    const data = await res.json();
    if (data.error) return { ok: false, error: data.error.type || 'API_ERROR', text: '阿錢暫時無法回應：' + (data.error.message || '') };
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    return { ok: true, text, model };
  } catch (e) {
    return { ok: false, error: 'NETWORK', text: '連線出了點問題，等一下再試試。' };
  }
}

// 深聊：history 為 [{role, content}]；attachments 為 [{kind,name,mediaType,data|text}]
// 回傳 { ok, text }。content 可為字串或多模態 blocks 陣列（Anthropic API 皆支援）
async function askAdvisor(userText, history, attachments) {
  // 重要：送給 API 的每則訊息只能有 {role, content}，歷史裡的 ts 等欄位必須濾掉，
  // 否則 API 會回 "messages.N.ts: Extra inputs are not permitted"
  const hist = (Array.isArray(history) ? history.slice(-10) : [])
    .map(m => ({ role: m.role, content: m.content }));
  let content;
  const atts = Array.isArray(attachments) ? attachments : [];
  if (atts.length) {
    // 多模態：文字 + 各附件
    content = [];
    const textParts = [userText || ''];
    atts.forEach(a => {
      if (a.kind === 'image' && a.data) {
        content.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType || 'image/jpeg', data: a.data } });
      } else if (a.kind === 'pdf' && a.data) {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } });
      } else if (a.kind === 'text' && typeof a.text === 'string') {
        // 文字檔（md/txt/csv/json）直接內嵌成文字，省 token 又精準
        textParts.push(`\n\n【附件：${a.name || '檔案'}】\n${a.text}`);
      }
    });
    content.unshift({ type: 'text', text: textParts.join('') });
  } else {
    content = userText;
  }
  const messages = [...hist, { role: 'user', content }];
  const sys = buildAdvisorSystemPrompt({ daily: false });
  // 有圖片/PDF 附件時用 Sonnet（文件理解佳）
  const hasBinary = atts.some(a => a.kind === 'image' || a.kind === 'pdf');
  return _advCallClaude(sys, messages, 1500, hasBinary);
}

// 每日主動建議：產生一句「懂你們」的話（GAS 端也可呼叫同套 prompt 邏輯）
async function generateDailyAdvice() {
  // 順便把正確快照寫到共用 doc，讓 GAS 端讀同一份（GAS 看不到個人錢包/帳單/目標）
  try { if (typeof fbSaveAdvisorSnapshot === 'function') fbSaveAdvisorSnapshot(); } catch (e) {}
  const sys = buildAdvisorSystemPrompt({ daily: true });
  const messages = [{ role: 'user', content: '（系統觸發每日關心，請主動對他們說今天的話）' }];
  const r = await _advCallClaude(sys, messages, 400);
  return r;
}

// 把一段對話請 AI 自己壓縮成記憶摘要，寫回 recent（深聊結束時呼叫）
async function summarizeAndRemember(history) {
  const hist = Array.isArray(history) ? history : [];
  if (hist.length < 2) return { ok: false };
  const convo = hist.map(m => `${m.role === 'user' ? '對方' : '阿錢'}：${typeof m.content === 'string' ? m.content : ''}`).join('\n');
  const sys = '你是一個記憶整理助手。請把以下「家庭財務顧問與用戶」的對話，濃縮成繁體中文的記憶筆記，只輸出 JSON（不要任何多餘文字、不要 markdown）：{"summary":"這次聊了什麼、做了什麼決定，2~3 句","mood":"用戶當下的情緒，2~6 字","concern":"用戶這次提到最在意的一件事，沒有就空字串"}';
  const r = await _advCallClaude(sys, [{ role: 'user', content: convo }], 400);
  if (!r.ok) return r;
  try {
    const clean = r.text.replace(/```json|```/g, '').trim();
    const j = JSON.parse(clean);
    updateAdvisorRecent({
      summary: j.summary || '',
      mood: j.mood || '',
      addConcern: j.concern || '',
    });
    return { ok: true, memory: j };
  } catch (e) {
    return { ok: false, error: 'PARSE' };
  }
}
