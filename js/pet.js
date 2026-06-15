/* ══════════════════════════════════════════════════════
 * 🐾 家庭共養寵物系統 pet.js（系統一）
 * ──────────────────────────────────────────────────────
 * 核心：宏龍 + 盈慧共養一隻。寵物狀態由「家庭合併數據」驅動。
 *  - 餵食：任一人當天記帳 = 餵一餐
 *  - 健康：家庭當期預算守住 = 健康；超支 = 生病
 *  - 心情：餵食連續天數 + 衝動消費標籤
 *  - 永不死亡：只會虛弱/生病，記帳即恢復
 * 資料：localStorage 'pet_data'（快取）+ Firebase shared/pet（兩人共用真相）
 * ══════════════════════════════════════════════════════ */

// 可選寵物種類（不限狐狸！盈慧喜歡狗狗）
const PET_TYPES = {
  fox:     { name:'狐狸', emoji:'🦊', personality:'機靈精打細算', voice:'理性吐槽' },
  dog:     { name:'狗狗', emoji:'🐶', personality:'忠誠熱情',     voice:'元氣鼓勵、黏人' },
  cat:     { name:'貓咪', emoji:'🐱', personality:'高冷傲嬌',     voice:'毒舌但偷偷關心' },
  rabbit:  { name:'兔子', emoji:'🐰', personality:'溫柔膽小',     voice:'軟萌、擔心型' },
  hamster: { name:'倉鼠', emoji:'🐹', personality:'愛囤積',       voice:'碎念存錢' },
};

// 成長階段（綁定餵食連續天數 或 總餵食次數）
const PET_STAGES = [
  { key:'egg',    name:'蛋',     emoji:'🥚', minStreak:0,   minFeed:0 },
  { key:'baby',   name:'幼體',   emoji:'🐣', minStreak:7,   minFeed:30 },
  { key:'teen',   name:'成長期', emoji:'🐾', minStreak:30,  minFeed:150 },
  { key:'adult',  name:'成熟體', emoji:'⭐', minStreak:100, minFeed:500 },
  { key:'legend', name:'傳說體', emoji:'👑', minStreak:365, minFeed:1000 },
];

function getPet() {
  try {
    const p = JSON.parse(localStorage.getItem('pet_data') || 'null');
    if (p && p.type) return p;
  } catch(e) {}
  return {
    type: 'fox',            // 預設狐狸，可在寵物頁更換
    hunger: 2,              // 0~3 飽食度
    health: 100,            // 0~100
    mood: 'normal',         // happy / normal / sad / worried / sick
    feedStreak: 0,          // 餵食連續天數（任一人餵就續）
    feedTotal: 0,           // 總餵食次數
    coins: 0,
    house: 'tent',          // tent / cabin / house / castle
    equipped: [],
    owned: [],
    lastFedDate: '',        // 最後餵食日 YYYY-MM-DD
    lastFedBy: '',          // 最後是誰餵的
    feedLog: [],            // 最近餵食記錄 [{date, by}]
    hatchedAt: '',
    born: _pToday(),
  };
}
function savePet(p) {
  localStorage.setItem('pet_data', JSON.stringify(p));
  if (typeof fbSyncPet === 'function') fbSyncPet(p);
}

function _pToday() { return (typeof toLocalISO === 'function') ? toLocalISO() : new Date().toISOString().slice(0,10); }
function _pYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return (typeof toLocalISO === 'function') ? toLocalISO(d) : d.toISOString().slice(0,10);
}

// 取得寵物當前階段（雙條件取「較高者」，用「或」邏輯：任一達標即晉級）
function getPetStage(pet) {
  let stage = PET_STAGES[0];
  for (const s of PET_STAGES) {
    if (pet.feedStreak >= s.minStreak || pet.feedTotal >= s.minFeed) stage = s;
  }
  return stage;
}

// 家庭今天有沒有人記帳（不分 person）
function _familyFedToday() {
  if (typeof getTx !== 'function') return false;
  const today = _pToday();
  return getTx().some(t => {
    const d = (typeof toLocalISO === 'function') ? toLocalISO(new Date(t.at)) : new Date(t.at).toISOString().slice(0,10);
    return d === today;
  });
}

// 家庭當期是否預算超支（用既有 getBudgetPeriod + 預算設定）
function _familyBudgetOver() {
  if (typeof getBudgetPeriod !== 'function' || typeof getTx !== 'function') return false;
  try {
    const p = getBudgetPeriod(new Date());
    const spent = getTx()
      .filter(t => { const d = new Date(t.at); return d >= p.start && d <= p.end; })
      .reduce((s,t) => s + t.amount, 0);
    // 總預算 = 各分類預算加總（若有設定）
    const cfg = (typeof getBudgetConfig === 'function') ? getBudgetConfig() : null;
    if (!cfg || !cfg.items) return false;
    const totalBudget = Object.values(cfg.items).reduce((s,v) => s + (v.limit || 0), 0);
    if (totalBudget <= 0) return false;
    return spent > totalBudget;
  } catch(e) { return false; }
}

// 當期衝動消費是否過多（家庭合併）
function _familyImpulseHigh() {
  if (typeof getBudgetPeriod !== 'function' || typeof getTx !== 'function') return false;
  try {
    const p = getBudgetPeriod(new Date());
    const ptx = getTx().filter(t => { const d = new Date(t.at); return d >= p.start && d <= p.end; });
    if (ptx.length < 3) return false;
    const impulse = ptx.filter(t => (t.tags||[]).includes('impulse')).length;
    return impulse >= 3;   // 當期 3 筆以上衝動消費
  } catch(e) { return false; }
}

// 結算寵物狀態（每次開 App / 記帳後呼叫）
// 回傳 { fed, justFed, pet, stageChanged, leveledUp }
function tickPet() {
  const pet = getPet();
  const today = _pToday();
  const fedToday = _familyFedToday();
  const beforeStage = getPetStage(pet).key;
  let justFed = false;

  // ── 餵食結算 ──
  if (fedToday && pet.lastFedDate !== today) {
    // 今天首次被餵：更新連續天數
    if (pet.lastFedDate === _pYesterday()) {
      pet.feedStreak = (pet.feedStreak || 0) + 1;
    } else if (pet.lastFedDate && pet.lastFedDate < _pYesterday()) {
      pet.feedStreak = 1;   // 中斷過，重新開始
    } else if (!pet.lastFedDate) {
      pet.feedStreak = 1;   // 第一次餵
    }
    pet.feedTotal = (pet.feedTotal || 0) + 1;
    pet.hunger = Math.min(3, (pet.hunger || 0) + 1);
    pet.lastFedDate = today;
    pet.lastFedBy = (typeof currentUser === 'function') ? currentUser() : '';
    pet.feedLog = (pet.feedLog || []).slice(-13);
    pet.feedLog.push({ date: today, by: pet.lastFedBy });
    if (!pet.hatchedAt && pet.feedStreak >= 7) pet.hatchedAt = today;  // 破殼
    justFed = true;
  } else if (!fedToday && pet.lastFedDate) {
    // 沒餵：依距上次餵食天數降飽食度
    const last = new Date((pet.lastFedDate || today) + 'T00:00:00');
    const now = new Date(today + 'T00:00:00');
    const gap = Math.floor((now - last) / 86400000);
    if (gap >= 1) pet.hunger = Math.max(0, 2 - gap);   // 隔1天剩1、隔2天剩0
    // 連續中斷
    if (gap >= 2) pet.feedStreak = 0;
  }

  // ── 健康結算（預算）──
  if (_familyBudgetOver()) {
    pet.health = Math.max(20, (pet.health || 100) - 5);
  } else {
    pet.health = Math.min(100, (pet.health || 100) + 3);   // 守住預算逐步康復
  }

  // ── 心情結算 ──
  if (pet.hunger <= 0) pet.mood = 'sad';
  else if (pet.health < 50) pet.mood = 'sick';
  else if (_familyImpulseHigh()) pet.mood = 'worried';
  else if (pet.feedStreak >= 7) pet.mood = 'happy';
  else pet.mood = 'normal';

  savePet(pet);
  const afterStage = getPetStage(pet).key;
  return {
    fed: fedToday,
    justFed,
    pet,
    stageChanged: beforeStage !== afterStage,
    stageName: getPetStage(pet).name,
  };
}

// 更換寵物種類（保留所有進度，只換外觀與個性）
function changePetType(type) {
  if (!PET_TYPES[type]) return false;
  const pet = getPet();
  pet.type = type;
  savePet(pet);
  return true;
}

// 寵物的家（依家庭儲蓄目標達成數）
function getPetHouse() {
  const goals = (typeof getGoals === 'function') ? getGoals() : [];
  const done = goals.filter(g => (g.current||0) >= (g.target||Infinity) && g.target > 0).length;
  if (done >= 5) return { key:'castle', name:'城堡', emoji:'🏰' };
  if (done >= 3) return { key:'house',  name:'磚房', emoji:'🏠' };
  if (done >= 1) return { key:'cabin',  name:'小木屋', emoji:'🏚️' };
  return { key:'tent', name:'帳篷', emoji:'⛺' };
}

// 同步金幣（家庭儲蓄率，earned 只增，coins = earned - spent）
function syncPetCoins() {
  const pet = getPet();
  const rate = (typeof getBestSavingsRate === 'function') ? getBestSavingsRate() : 0;
  const earned = Math.max(0, Math.floor(rate * 5));
  if ((pet.coinsEarned || 0) < earned) {
    pet.coinsEarned = earned;
    pet.coins = Math.max(0, (pet.coinsEarned || 0) - (pet.coinsSpent || 0));
    savePet(pet);
  }
  return pet.coins || 0;
}

// 寵物心情對應的表情符號修飾
function getPetMoodFace(mood) {
  return { happy:'😊', normal:'🙂', sad:'😢', worried:'😟', sick:'🤒' }[mood] || '🙂';
}
