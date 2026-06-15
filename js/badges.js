/* ══════════════════════════════════════════════════════
 * 🏅 徽章成就系統 badges.js
 * ──────────────────────────────────────────────────────
 * 設計原則（參考市面 Beyond Budget / Fortune City / Monobank）：
 *  - 慶祝「有意義的成就」，不獎勵瑣碎動作
 *  - 5 級稀有度：common < rare < epic < legend < mythic
 *  - 全部對接真實數據庫（streak / tx / budget / goals / trades）
 *  - 解鎖記錄存 localStorage 'badges_unlocked' + Firebase 同步
 * ══════════════════════════════════════════════════════ */

const BADGE_RARITY = {
  common: { name:'銅',   color:'#b08d57', glow:'rgba(176,141,87,.4)' },
  rare:   { name:'銀',   color:'#9ca3af', glow:'rgba(156,163,175,.5)' },
  epic:   { name:'金',   color:'#fbbf24', glow:'rgba(251,191,36,.5)' },
  legend: { name:'鑽石', color:'#22d3ee', glow:'rgba(34,211,238,.6)' },
  mythic: { name:'傳奇', color:'#a78bfa', glow:'rgba(167,139,250,.7)' },
};

// 徽章定義。check(ctx) 回傳 true 表示已達成。
// ctx 由 _buildBadgeContext() 預先算好所有數據，避免每個 check 重複計算
const BADGES = [
  // ── 連續打卡類 🔥 ──
  { id:'streak_3',   icon:'🌱', name:'記帳新芽',   rarity:'common', scope:'personal', cat:'streak', desc:'連續記帳 3 天',   check:c=>c.streakLongest>=3 },
  { id:'streak_7',   icon:'🔥', name:'一週戰士',   rarity:'common', scope:'personal', cat:'streak', desc:'連續記帳 7 天',   check:c=>c.streakLongest>=7 },
  { id:'streak_30',  icon:'💎', name:'堅持達人',   rarity:'rare',   scope:'personal', cat:'streak', desc:'連續記帳 30 天',  check:c=>c.streakLongest>=30 },
  { id:'streak_100', icon:'👑', name:'記帳之王',   rarity:'epic',   scope:'personal', cat:'streak', desc:'連續記帳 100 天', check:c=>c.streakLongest>=100 },
  { id:'streak_365', icon:'🏆', name:'年度傳說',   rarity:'mythic', scope:'personal', cat:'streak', desc:'連續記帳 365 天', check:c=>c.streakLongest>=365 },

  // ── 記帳量類 📝 ──
  { id:'tx_first',  icon:'✏️', name:'第一筆',     rarity:'common', scope:'shared', cat:'log', desc:'記下第一筆帳',     check:c=>c.txTotal>=1 },
  { id:'tx_100',    icon:'📒', name:'百筆達成',   rarity:'common', scope:'shared', cat:'log', desc:'累積記帳 100 筆',  check:c=>c.txTotal>=100 },
  { id:'tx_500',    icon:'📚', name:'記帳老手',   rarity:'rare',   scope:'shared', cat:'log', desc:'累積記帳 500 筆',  check:c=>c.txTotal>=500 },
  { id:'tx_1000',   icon:'🗄️', name:'記帳大師',   rarity:'epic',   scope:'shared', cat:'log', desc:'累積記帳 1000 筆', check:c=>c.txTotal>=1000 },
  { id:'early_bird',icon:'🌅', name:'早鳥記帳',   rarity:'rare',   scope:'personal', cat:'log', desc:'早上 8 點前記帳 10 次', check:c=>c.earlyCount>=10 },
  { id:'night_owl', icon:'🦉', name:'夜貓記帳',   rarity:'common', scope:'personal', cat:'log', desc:'凌晨記帳（手癢消費也誠實記）', check:c=>c.lateCount>=5 },

  // ── 預算紀律類 🎯 ──
  { id:'budget_first', icon:'🎯', name:'預算守門員', rarity:'rare',   scope:'shared', cat:'budget', desc:'單月所有分類都沒超支', check:c=>c.budgetCleanMonths>=1 },
  { id:'budget_3',     icon:'🛡️', name:'紀律銅牆',   rarity:'epic',   scope:'shared', cat:'budget', desc:'連續 3 個週期不超支',  check:c=>c.budgetCleanStreak>=3 },
  { id:'week_win_4',   icon:'🥇', name:'週週達標',   rarity:'rare',   scope:'shared', cat:'budget', desc:'週預算連勝 4 週',     check:c=>c.weekWinStreak>=4 },

  // ── 儲蓄理財類 💰 ──
  { id:'save_goal_1',  icon:'🎁', name:'儲蓄先鋒',   rarity:'rare',   scope:'shared', cat:'save', desc:'達成第一個儲蓄目標',  check:c=>c.goalsCompleted>=1 },
  { id:'save_goal_3',  icon:'🏦', name:'目標收藏家', rarity:'epic',   scope:'shared', cat:'save', desc:'達成 3 個儲蓄目標',   check:c=>c.goalsCompleted>=3 },
  { id:'save_rate_20', icon:'📈', name:'存錢有道',   rarity:'rare',   scope:'shared', cat:'save', desc:'單月儲蓄率達 20%',    check:c=>c.bestSavingsRate>=20 },
  { id:'save_rate_50', icon:'💸', name:'極簡省王',   rarity:'legend', scope:'shared', cat:'save', desc:'單月儲蓄率達 50%',    check:c=>c.bestSavingsRate>=50 },

  // ── 消費覺察類 🧠（鼓勵自我覺察，非鼓勵消費）──
  { id:'cooldown_win', icon:'🧘', name:'冷靜致勝',   rarity:'rare',   scope:'shared', cat:'aware', desc:'想買清單冷靜後放棄一次衝動', check:c=>c.cooldownGiveUp>=1 },
  { id:'tag_master',   icon:'🏷️', name:'標籤達人',   rarity:'common', scope:'shared', cat:'aware', desc:'用消費標籤標記 30 筆', check:c=>c.taggedCount>=30 },
  { id:'need_focus',   icon:'✅', name:'理性消費',   rarity:'epic',   scope:'shared', cat:'aware', desc:'單月「需要」比「想要」多', check:c=>c.needOverWant>=1 },

  // ── 投資交易類 📊（紀律導向，非鼓勵賭博）──
  { id:'trade_journal', icon:'📓', name:'交易記錄者', rarity:'common', scope:'personal', cat:'trade', desc:'記錄第一筆交易',       check:c=>c.tradeTotal>=1 },
  { id:'paper_grad',    icon:'🎓', name:'模擬畢業',   rarity:'epic',   scope:'personal', cat:'trade', desc:'模擬交易達 A 級評等',   check:c=>c.paperGradeA },
  { id:'discipline',    icon:'🧊', name:'鐵的紀律',   rarity:'legend', scope:'personal', cat:'trade', desc:'連續 20 筆交易零違紀', check:c=>c.disciplineStreak>=20 },
  { id:'stop_loss',     icon:'🛑', name:'停損勇者',   rarity:'rare',   scope:'personal', cat:'trade', desc:'確實執行停損 10 次',   check:c=>c.stopLossCount>=10 },
];

// 解鎖記錄分兩份：
//   個人徽章（scope:personal）→ localStorage 'badges_personal' + users/{uid}/badges
//   共用徽章（scope:shared）  → localStorage 'badges_shared'   + shared/badges
// 對外仍提供合併視圖 getUnlockedBadges()（給 UI 用）
function _getPersonalBadges() {
  try { return JSON.parse(localStorage.getItem('badges_personal') || '{}'); } catch(e) { return {}; }
}
function _getSharedBadges() {
  try { return JSON.parse(localStorage.getItem('badges_shared') || '{}'); } catch(e) { return {}; }
}
// 合併兩份給 UI 顯示（個人 + 共用）
function getUnlockedBadges() {
  // 相容舊資料：若有舊的 badges_unlocked 但兩份新 key 都空，沿用舊的當共用
  const personal = _getPersonalBadges();
  const shared = _getSharedBadges();
  if (!Object.keys(personal).length && !Object.keys(shared).length) {
    try {
      const old = JSON.parse(localStorage.getItem('badges_unlocked') || '{}');
      if (Object.keys(old).length) return old;
    } catch(e) {}
  }
  return { ...shared, ...personal };
}
// 某 badgeId 的 scope（查定義，預設 personal）
function _badgeScope(id) {
  const b = BADGES.find(x => x.id === id);
  return (b && b.scope === 'shared') ? 'shared' : 'personal';
}

// 建立判定用的數據快照（一次算好，給所有 check 用）
function _buildBadgeContext() {
  const c = {};
  // streak
  const sk = (typeof getStreak === 'function') ? getStreak() : {current:0,longest:0};
  c.streakLongest = sk.longest || 0;

  // 記帳量、時段、標籤
  const tx = (typeof getTx === 'function') ? getTx() : [];
  c.txTotal = tx.length;
  let early=0, late=0, tagged=0;
  tx.forEach(t => {
    const h = new Date(t.at).getHours();
    if (h >= 5 && h < 8) early++;   // 清晨 5~8 點為早鳥
    if (h >= 0 && h < 5) late++;    // 凌晨 0~5 點為夜貓
    if (t.tags && t.tags.length) tagged++;
  });
  c.earlyCount = early; c.lateCount = late; c.taggedCount = tagged;

  // 儲蓄目標完成數
  const goals = (typeof getGoals === 'function') ? getGoals() : [];
  c.goalsCompleted = goals.filter(g => (g.current||0) >= (g.target||Infinity) && g.target>0).length;

  // 最佳儲蓄率（用 db.js 既有月結資料，盡量不重算）
  c.bestSavingsRate = (typeof getBestSavingsRate === 'function') ? getBestSavingsRate() : 0;

  // 預算乾淨月數 / 連勝（用既有函數，沒有就 0，避免重算出錯）
  c.budgetCleanMonths  = (typeof getBudgetCleanMonths === 'function') ? getBudgetCleanMonths() : 0;
  c.budgetCleanStreak  = (typeof getBudgetCleanStreak === 'function') ? getBudgetCleanStreak() : 0;
  c.weekWinStreak      = (typeof getWeekWinStreak === 'function') ? getWeekWinStreak() : 0;
  c.cooldownGiveUp     = (typeof getCooldownGiveUpCount === 'function') ? getCooldownGiveUpCount() : 0;
  c.needOverWant       = (typeof getNeedOverWantMonths === 'function') ? getNeedOverWantMonths() : 0;

  // 交易類
  const trades = (typeof getRealTrades === 'function') ? getRealTrades() : [];
  c.tradeTotal = trades.length;
  // 模擬 A 級
  let gradeA = false;
  if (typeof evalPaperGraduation === 'function') {
    try { gradeA = evalPaperGraduation().grade === 'A'; } catch(e) {}
  }
  c.paperGradeA = gradeA;
  // 連續零違紀（從最近往前數）
  let dStreak = 0;
  const closedTrades = trades.filter(t => t.status === 'closed');
  for (const t of closedTrades) { if (!t.disciplineViolation) dStreak++; else break; }
  c.disciplineStreak = dStreak;
  // 停損執行次數：有設停損 + 虧損出場 = 確實執行了停損紀律（沒凹單）
  c.stopLossCount = closedTrades.filter(t => {
    if (!t.stop || !t.exitPrice) return false;
    try { return calcTradeCost(t).netPnl < 0; } catch(e) { return false; }
  }).length;

  return c;
}

// 檢查並解鎖新徽章；回傳「這次新解鎖的徽章陣列」
function checkBadges() {
  const ctx = _buildBadgeContext();
  const unlocked = getUnlockedBadges();   // 合併視圖（判斷是否已解鎖）
  const personal = _getPersonalBadges();
  const shared = _getSharedBadges();
  const newly = [];
  const today = (typeof toLocalISO === 'function') ? toLocalISO() : new Date().toISOString().slice(0,10);
  let pChanged = false, sChanged = false;
  BADGES.forEach(b => {
    if (!unlocked[b.id]) {
      let ok = false;
      try { ok = b.check(ctx); } catch(e) {}
      if (ok) {
        if (_badgeScope(b.id) === 'shared') { shared[b.id] = today; sChanged = true; }
        else { personal[b.id] = today; pChanged = true; }
        newly.push(b);
      }
    }
  });
  // 分別寫入兩份儲存與雲端
  if (pChanged) {
    localStorage.setItem('badges_personal', JSON.stringify(personal));
    if (typeof fbSyncBadgesPersonal === 'function') fbSyncBadgesPersonal(personal);
  }
  if (sChanged) {
    localStorage.setItem('badges_shared', JSON.stringify(shared));
    if (typeof fbSyncBadgesShared === 'function') fbSyncBadgesShared(shared);
  }
  return newly;
}

// 取得徽章牆資料（含已解鎖狀態與進度），給 UI 渲染
function getBadgeWall() {
  const unlocked = getUnlockedBadges();
  const badges = BADGES.map(b => ({
    ...b,
    unlocked: !!unlocked[b.id],
    date: unlocked[b.id] || null,
    rarityInfo: BADGE_RARITY[b.rarity],
    scopeLabel: (b.scope === 'shared') ? '🤝 家庭共享' : '👤 個人',
  }));
  return {
    total: BADGES.length,
    earned: badges.filter(b => b.unlocked).length,   // 只計實際存在的徽章
    badges,
  };
}
