'use strict';
// ═══════════════════════════════════════
//  db.js — 本地資料層（localStorage）
// ═══════════════════════════════════════
const DB = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  del(k) { localStorage.removeItem(k); },
};

const DEF_CATS = [
  { id:'food',      name:'🍜 餐飲',  color:'#10b981', sub:['早餐','午餐','晚餐','飲料','零食','聚餐'] },
  { id:'transport', name:'🚌 交通',  color:'#3b82f6', sub:['加油','捷運/公車','停車費','計程車'] },
  { id:'shopping',  name:'🛍️ 購物', color:'#f59e0b', sub:['服飾','3C','日用品','網購'] },
  { id:'home',      name:'🏠 居家',  color:'#ec4899', sub:['房租','水費','電費','瓦斯','網路'] },
  { id:'medical',   name:'💊 醫療',  color:'#8b5cf6', sub:['掛號','藥費','健檢','牙科'] },
  { id:'entertain', name:'🎬 娛樂',  color:'#06b6d4', sub:['電影','遊戲','訂閱','旅遊'] },
  { id:'education', name:'📚 教育',  color:'#84cc16', sub:['學費','補習','課程'] },
  { id:'child',     name:'👶 育兒',  color:'#f97316', sub:['奶粉','玩具','衣物','托育'] },
  { id:'other',     name:'📦 其他',  color:'#94a3b8', sub:['禮金','捐款','雜費'] },
];
const DEF_CARDS = [
  { id:'c1', name:'國泰世華', last4:'1234', color:'#1d4ed8' },
  { id:'c2', name:'台新玫瑰', last4:'5678', color:'#be185d' },
  { id:'c3', name:'中信鈦金', last4:'9012', color:'#374151' },
];

function initDB() {
  // 遷移舊版 key
  const mg = (o, n) => {
    const v = localStorage.getItem(o);
    if (v && !DB.get(n)) { try { DB.set(n, JSON.parse(v)); } catch {} }
    localStorage.removeItem(o);
  };
  mg('fb_transactions', 'tx'); mg('fb_wallet', 'wal');
  mg('fb_categories', 'cats'); mg('fb_cards', 'cards');
  mg('fb_budgets', 'bud');     mg('fb_tx', 'tx');
  // 預設值
  if (!DB.get('cats'))  DB.set('cats',  DEF_CATS);
  if (!DB.get('cards')) DB.set('cards', DEF_CARDS);
  if (!DB.get('wal'))   DB.set('wal',   { balance: 0, history: [] });
  if (!DB.get('bud'))   DB.set('bud',   {});
  if (!DB.get('tx'))    DB.set('tx',    []);
}

// 交易
function getTx()      { return DB.get('tx') || []; }
function addTx(tx) {
  const list = getTx();
  tx.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  tx.at  = tx.at || new Date().toISOString();
  list.unshift(tx); DB.set('tx', list);
  if (tx.pay === 'cash') walOut(tx.amount, tx.detail || catName(tx.cat));
  return tx;
}
function delTx(id) {
  const list = getTx(), tx = list.find(t => t.id === id);
  DB.set('tx', list.filter(t => t.id !== id));
  if (tx && tx.pay === 'cash') walIn(tx.amount, '刪除還原');
}
function txByMonth(y, m) {
  return getTx().filter(t => { const d = new Date(t.at); return d.getFullYear() === y && d.getMonth() + 1 === m; });
}
function txByRange(f, e) {
  const s = new Date(f), en = new Date(e); en.setHours(23, 59, 59);
  return getTx().filter(t => { const d = new Date(t.at); return d >= s && d <= en; });
}

// 錢包
function getWal()        { return DB.get('wal') || { balance: 0, history: [] }; }
function walIn(n, note)  { const w = getWal(); w.balance += n; w.history.unshift({ type:'in',  amount: n, note, time: new Date().toISOString() }); DB.set('wal', w); }
function walOut(n, note) { const w = getWal(); w.balance = Math.max(0, w.balance - n); w.history.unshift({ type:'out', amount: n, note, time: new Date().toISOString() }); DB.set('wal', w); }

// 分類
function getCats()     { return DB.get('cats')  || DEF_CATS; }
function catFind(id)   { return getCats().find(c => c.id === id) || { name: id, color: '#94a3b8', sub: [] }; }
function catName(id)   { return catFind(id).name; }
function addCat(c)     { const l = getCats(); c.id = 'cat_' + Date.now().toString(36); l.push(c); DB.set('cats', l); }

// 信用卡
function getCards()    { return DB.get('cards') || DEF_CARDS; }
function cardFind(id)  { return getCards().find(c => c.id === id) || null; }
function addCard(c)    { const l = getCards(); c.id = 'cc_' + Date.now().toString(36); l.push(c); DB.set('cards', l); }
function delCard(id)   { DB.set('cards', getCards().filter(c => c.id !== id)); }

// 預算
function getBud()       { return DB.get('bud') || {}; }
function getBudget(id)  { return getBud()[id] || 0; }
function setBudget(id, n) { const b = getBud(); b[id] = n; DB.set('bud', b); }

// 統計
function calcStats(list) {
  const total = list.reduce((s, x) => s + x.amount, 0);
  const cash  = list.filter(x => x.pay === 'cash').reduce((s, x) => s + x.amount, 0);
  const card  = list.filter(x => x.pay === 'card').reduce((s, x) => s + x.amount, 0);
  const byCat = {}, byCard = {}, byPerson = {};
  list.forEach(x => {
    byCat[x.cat]       = (byCat[x.cat]       || 0) + x.amount;
    byPerson[x.person] = (byPerson[x.person]  || 0) + x.amount;
    if (x.pay === 'card' && x.cardId) byCard[x.cardId] = (byCard[x.cardId] || 0) + x.amount;
  });
  return { total, cash, card, byCat, byCard, byPerson };
}

// 格式化
function fmt(n)  { return Number(n).toLocaleString('zh-TW'); }
function fmtT(s) { const d = new Date(s); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
function fmtD(s) { const d = new Date(s); return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`; }
function groupDay(list) {
  const g = {};
  [...list].sort((a, b) => new Date(b.at) - new Date(a.at))
    .forEach(t => { const k = fmtD(t.at); if (!g[k]) g[k] = []; g[k].push(t); });
  return g;
}

// 清除所有資料（本地 + 雲端）
function clearAll() {
  ['tx','wal','cats','cards','bud',
   'fb_tx','fb_wallet','fb_cats','fb_cards','fb_budgets',
   'fb_transactions','fb_categories'
  ].forEach(k => localStorage.removeItem(k));
  Object.keys(localStorage).filter(k => k.startsWith('fb_')).forEach(k => localStorage.removeItem(k));
}

initDB();
