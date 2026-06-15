/* ══════════════════════════════════════════════════════
 * 🌱 個人盆栽養成系統 garden.js（系統二）
 * ──────────────────────────────────────────────────────
 * 核心：植物成長 = 個人記帳行為。鼓勵兩人「各自都要記帳」。
 *  - 澆水 = 當天有自己(person===currentUser)的記帳
 *  - 成長 = 個人連續記帳天數 + 累積筆數
 *  - 枯萎但不死：長期沒記會蔫，一記帳就復活
 * 資料：localStorage 'garden_data' + Firebase users/{uid}/garden
 * ══════════════════════════════════════════════════════ */

// 植物品種定義
const PLANT_TYPES = {
  cactus:    { name:'仙人掌', emoji:'🌵', difficulty:'簡單', droughtDays:5, desc:'耐旱，偶爾忘記也不易枯，新手友善', cost:0 },
  sunflower: { name:'向日葵', emoji:'🌻', difficulty:'普通', droughtDays:2, desc:'成長快、開花亮眼，需穩定澆水', cost:50 },
  bamboo:    { name:'幸運竹', emoji:'🎋', difficulty:'普通', droughtDays:3, desc:'節節高升，象徵財富成長', cost:80 },
  rose:      { name:'玫瑰',   emoji:'🌹', difficulty:'較難', droughtDays:1, desc:'漂亮但嬌貴，斷簽容易蔫', cost:120 },
  money:     { name:'搖錢樹', emoji:'🌳', difficulty:'進階', droughtDays:3, desc:'養大會結錢幣彩蛋', cost:200 },
  sakura:    { name:'櫻花',   emoji:'🌸', difficulty:'進階', droughtDays:2, desc:'滿開時整片粉色', cost:200 },
};

// 成長階段（growth 0~100）
const PLANT_STAGES = [
  { key:'seed',    name:'種子', emoji:'🌰', min:0 },
  { key:'sprout',  name:'發芽', emoji:'🌱', min:15 },
  { key:'seedling',name:'幼苗', emoji:'🌿', min:40 },
  { key:'mature',  name:'成株', emoji:'🪴', min:70 },
  { key:'bloom',   name:'開花', emoji:'🌼', min:100 },
];

function getGarden() {
  try {
    const g = JSON.parse(localStorage.getItem('garden_data') || 'null');
    if (g && Array.isArray(g.plants)) return g;
  } catch(e) {}
  // 預設：送一株仙人掌
  return {
    plants: [{ id:'p_'+Date.now(), type:'cactus', growth:0, plantedAt: _gToday(), lastWater:'', bloomed:false }],
    activePlantId: null,
    seeds: [],
    coins: 0,
    collected: [],
  };
}
function saveGarden(g) {
  localStorage.setItem('garden_data', JSON.stringify(g));
  if (typeof fbSyncGarden === 'function') fbSyncGarden(g);
}

function _gToday() { return (typeof toLocalISO === 'function') ? toLocalISO() : new Date().toISOString().slice(0,10); }

// 取得植物當前階段
function getPlantStage(growth) {
  let stage = PLANT_STAGES[0];
  for (const s of PLANT_STAGES) { if (growth >= s.min) stage = s; }
  return stage;
}

// 今天我有沒有記帳（個人）
function _waterToday() {
  if (typeof getTx !== 'function' || typeof currentUser !== 'function') return false;
  const me = currentUser();
  const today = _gToday();
  return getTx().some(t => {
    const d = (typeof toLocalISO === 'function') ? toLocalISO(new Date(t.at)) : new Date(t.at).toISOString().slice(0,10);
    return d === today && t.person === me;
  });
}

// 結算植物狀態（每次開 App / 記帳後呼叫）
// 回傳 { watered, grew, plant, stageChanged }
function tickGarden() {
  const g = getGarden();
  if (!g.activePlantId && g.plants.length) g.activePlantId = g.plants[0].id;
  const plant = g.plants.find(p => p.id === g.activePlantId) || g.plants[0];
  if (!plant) return { watered:false, grew:false, plant:null };

  const today = _gToday();
  const watered = _waterToday();
  let grew = false, stageChanged = false;
  const beforeStage = getPlantStage(plant.growth).key;

  if (watered && plant.lastWater !== today) {
    // 今天首次澆水：依個人連續天數加成成長
    const sk = (typeof getStreak === 'function') ? getStreak() : { current:1 };
    const bonus = Math.min(5, Math.floor((sk.current || 1) / 7));  // 連續越久長越快（上限+5）
    const growthGain = 5 + bonus;
    plant.growth = Math.min(100, (plant.growth || 0) + growthGain);
    plant.lastWater = today;
    if (plant.growth >= 100 && !plant.bloomed) { plant.bloomed = true; }
    grew = true;
  }

  const afterStage = getPlantStage(plant.growth).key;
  if (beforeStage !== afterStage) stageChanged = true;

  saveGarden(g);
  return { watered, grew, plant, stageChanged, stageName: getPlantStage(plant.growth).name };
}

// 植物是否枯萎（缺水超過耐旱天數）— 不影響 growth，只影響外觀
function isPlantWilted(plant) {
  if (!plant || !plant.lastWater) return false;
  const info = PLANT_TYPES[plant.type] || { droughtDays:3 };
  const last = new Date(plant.lastWater + 'T00:00:00');
  const now = new Date(_gToday() + 'T00:00:00');
  const days = Math.floor((now - last) / 86400000);
  return days > info.droughtDays;
}

// 種新植物（需有種子或足夠金幣）
function plantNew(type) {
  const g = getGarden();
  const info = PLANT_TYPES[type];
  if (!info) return { ok:false, msg:'未知品種' };
  // 種子優先，否則扣金幣
  const seedIdx = g.seeds.indexOf(type);
  if (seedIdx >= 0) {
    g.seeds.splice(seedIdx, 1);
  } else if (info.cost > 0) {
    if ((g.coins || 0) < info.cost) return { ok:false, msg:`金幣不足（需 ${info.cost}）` };
    g.coins -= info.cost;
    g.coinsSpent = (g.coinsSpent || 0) + info.cost;
  }
  const np = { id:'p_'+Date.now(), type, growth:0, plantedAt:_gToday(), lastWater:'', bloomed:false };
  g.plants.push(np);
  g.activePlantId = np.id;
  saveGarden(g);
  return { ok:true, plant:np };
}

// 收成已開花植物 → 加入圖鑑 + 給種子獎勵
function harvestPlant(plantId) {
  const g = getGarden();
  const idx = g.plants.findIndex(p => p.id === plantId);
  if (idx < 0) return { ok:false };
  const p = g.plants[idx];
  if (!p.bloomed) return { ok:false, msg:'還沒開花，不能收成' };
  if (!g.collected.includes(p.type)) g.collected.push(p.type);
  g.coins = (g.coins || 0) + 30;          // 收成獎勵金幣
  g.coinsEarned = (g.coinsEarned || 0) + 30;  // 同步記入 earned，避免被 sync 重設
  g.seeds.push(p.type);                   // 回收一顆同款種子
  g.plants.splice(idx, 1);
  if (g.activePlantId === plantId) g.activePlantId = g.plants[0]?.id || null;
  saveGarden(g);
  return { ok:true, coins:30 };
}

// 設定當前主要照顧的植物
function setActivePlant(plantId) {
  const g = getGarden();
  if (g.plants.some(p => p.id === plantId)) { g.activePlantId = plantId; saveGarden(g); }
}

// 用個人儲蓄率更新金幣（earned 依儲蓄率只增，coins = earned - spent）
function syncGardenCoins() {
  const g = getGarden();
  const rate = (typeof getBestSavingsRate === 'function') ? getBestSavingsRate() : 0;
  const earned = Math.max(0, Math.floor(rate * 5));   // 50% 儲蓄率 → 賺得 250
  if ((g.coinsEarned || 0) < earned) {
    g.coinsEarned = earned;
    g.coins = Math.max(0, (g.coinsEarned || 0) - (g.coinsSpent || 0));
    saveGarden(g);
  }
  return g.coins || 0;
}
