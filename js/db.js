'use strict';
// ═══════════════════════════════════════════════════
//  db.js v8 — 完整個人財務資料層
//  支援：個人帳戶、共用帳戶、錢包、悠遊卡、信用卡帳單
//  v8 新增：消費標籤(tags)、快捷範本(shortcuts)
//  資料依登入者隔離，共用記帳與家用帳戶除外
// ═══════════════════════════════════════════════════

const DB = {
  get(k)    { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  del(k)    { localStorage.removeItem(k); },
};

// 取得目前登入者 uid
function uid() {
  const e = localStorage.getItem('current_email') || '';
  if (e) return e.split('@')[0].replace(/[^a-z0-9]/gi,'_');
  return localStorage.getItem('current_uid') || 'user';
}

// 個人 key（加上 uid 前綴）
function pKey(k) { return `${uid()}_${k}`; }

const DEF_CATS = [
  {id:'food',      name:'🍜 餐飲',  color:'#10b981', sub:['早餐','午餐','晚餐','飲料','零食','聚餐']},
  {id:'transport', name:'🚌 交通',  color:'#3b82f6', sub:['加油','捷運/公車','停車費','計程車','高鐵']},
  {id:'shopping',  name:'🛍️ 購物', color:'#f59e0b', sub:['服飾','3C','日用品','網購']},
  {id:'home',      name:'🏠 居家',  color:'#ec4899', sub:['房租','水費','電費','瓦斯','網路']},
  {id:'medical',   name:'💊 醫療',  color:'#8b5cf6', sub:['掛號','藥費','健檢','牙科']},
  {id:'entertain', name:'🎬 娛樂',  color:'#06b6d4', sub:['電影','遊戲','訂閱','旅遊']},
  {id:'education', name:'📚 教育',  color:'#84cc16', sub:['學費','補習','課程']},
  {id:'child',     name:'👶 育兒',  color:'#f97316', sub:['奶粉','玩具','衣物','托育']},
  {id:'other',     name:'📦 其他',  color:'#94a3b8', sub:['禮金','捐款','雜費']},
];

// ── 預設消費標籤 ───────────────────────────────────
const DEF_TX_TAGS = [
  {id:'need',     label:'🧠 需要',    color:'#10b981'},
  {id:'want',     label:'💝 想要',    color:'#4f8ef7'},
  {id:'impulse',  label:'⚡ 衝動消費', color:'#f59e0b'},
  {id:'planned',  label:'📋 計畫中',  color:'#8b5cf6'},
  {id:'routine',  label:'🔄 例行支出', color:'#06b6d4'},
  {id:'reward',   label:'🎁 犒賞自己', color:'#ec4899'},
  {id:'social',   label:'👥 社交壓力', color:'#84cc16'},
  {id:'emotion',  label:'😔 情緒消費', color:'#f97316'},
];

function initDB() {
  // 共用資料
  if (!DB.get('cats'))    DB.set('cats',    DEF_CATS);
  if (!DB.get('tx'))      DB.set('tx',      []);
  if (!DB.get('budgets')) DB.set('budgets', {startDay:1, items:{}});
  if (!DB.get('hints'))   DB.set('hints',   {});
  if (!DB.get('discord')) DB.set('discord', {
    webhook:'', onAdd:true, onDaily:true, dailyHour:21,
    onBudget:true, budgetPct:80, onWeekly:false,
  });
  if (!DB.get('prefs'))   DB.set('prefs',   {theme:'dark', accent:'teal', lastCat:'', lastPay:'cash'});
  if (!DB.get('tx_tags')) DB.set('tx_tags', DEF_TX_TAGS);

  // 個人資料（依登入者隔離）
  if (!DB.get(pKey('wal')))       DB.set(pKey('wal'),       {balance:0, history:[], updatedAt:0});
  if (!DB.get(pKey('cards')))     DB.set(pKey('cards'),     []);
  if (!DB.get(pKey('icards')))    DB.set(pKey('icards'),    []);
  if (!DB.get(pKey('accts')))     DB.set(pKey('accts'),     []);
  if (!DB.get(pKey('bills')))     DB.set(pKey('bills'),     []);
  if (!DB.get(pKey('shortcuts'))) DB.set(pKey('shortcuts'), []); // 快捷範本（個人）

  // 共用帳戶（家用）
  if (!DB.get('shared_accts')) DB.set('shared_accts', []);
}

// ── 交易（共用） ──────────────────────────────────────
function getTx()      { return DB.get('tx') || []; }
function addTx(tx) {
  const list = getTx();
  tx.id  = Date.now().toString(36) + Math.random().toString(36).slice(2,5);
  tx.at  = tx.at || new Date().toISOString();
  tx.uid = uid();
  if (!tx.tags) tx.tags = [];
  list.unshift(tx); DB.set('tx', list);
  // 自動扣款
  if (tx.pay === 'cash')  walOut(tx.amount, tx.detail || catName(tx.cat));
  if (tx.pay === 'icard' && tx.icardId) icardOut(tx.icardId, tx.amount, tx.detail || catName(tx.cat));
  if (tx.pay === 'card'  && tx.cardId)  cardAddBill(tx.cardId, tx.amount, tx.detail || catName(tx.cat), tx.at);
  if (tx.pay === 'acct'  && tx.acctId) {
    const isShared = tx.acctId.startsWith('shared_');
    acctOut(isShared ? tx.acctId.replace('shared_','') : tx.acctId, tx.amount, tx.detail || catName(tx.cat), isShared);
  }
  rememberHint(tx.cat, tx.subCat, tx.detail);
  const p = getPrefs(); p.lastCat = tx.cat; p.lastPay = tx.pay; DB.set('prefs', p);
  return tx;
}
function delTx(id) {
  const list = getTx(), tx = list.find(t => t.id === id);
  DB.set('tx', list.filter(t => t.id !== id));
  if (tx) {
    if (tx.pay === 'cash')  walIn(tx.amount, '刪除還原');
    if (tx.pay === 'icard' && tx.icardId) icardIn(tx.icardId, tx.amount, '刪除還原');
    if (tx.pay === 'card'  && tx.cardId)  cardVoidBill(tx.cardId, tx.amount, tx.id);
    if (tx.pay === 'acct'  && tx.acctId) {
      const isShared = tx.acctId.startsWith('shared_');
      acctIn(isShared ? tx.acctId.replace('shared_','') : tx.acctId, tx.amount, '刪除還原', isShared);
    }
  }
}
function txByMonth(y, m) {
  return getTx().filter(t => { const d=new Date(t.at); return d.getFullYear()===y && d.getMonth()+1===m; });
}
function txByRange(f, e) {
  // YYYY-MM-DD 字串直接用 new Date() 會解析成 UTC 午夜（台灣早 8 點）
  // 改成本地時間解析：取年月日手動建 Date，確保是本地凌晨 0:00
  const parseLocal = (s) => {
    const [y,m,d] = s.split('-').map(Number);
    return new Date(y, m-1, d, 0, 0, 0, 0);
  };
  const start = parseLocal(f);
  const end   = parseLocal(e);
  end.setHours(23, 59, 59, 999);
  return getTx().filter(t => { const d=new Date(t.at); return d>=start && d<=end; });
}
function txByPeriod() {
  const {start,end} = getBudgetPeriod();
  return getTx().filter(t => { const d=new Date(t.at); return d>=start && d<=end; });
}

// ── 消費標籤 CRUD ─────────────────────────────────────
function getTxTags() { return DB.get('tx_tags') || DEF_TX_TAGS; }
function saveTxTags(tags) { DB.set('tx_tags', tags); }
function addTxTag(label, color) {
  const tags = getTxTags();
  const id = 'tag_' + Date.now().toString(36);
  tags.push({id, label, color: color || '#94a3b8'});
  saveTxTags(tags); return id;
}
function delTxTag(id) {
  saveTxTags(getTxTags().filter(t => t.id !== id));
}
function getTxTagById(id) {
  return getTxTags().find(t => t.id === id) || null;
}

// ── 快捷範本 CRUD（個人） ─────────────────────────────
function getShortcuts()   { return DB.get(pKey('shortcuts')) || []; }
function saveShortcuts(s) { DB.set(pKey('shortcuts'), s); }
function addShortcut(sc) {
  const list = getShortcuts();
  if (list.length >= 5) { return false; } // 最多 5 組
  sc.id = 'sc_' + Date.now().toString(36);
  list.push(sc);
  saveShortcuts(list); return sc.id;
}
function delShortcut(id) { saveShortcuts(getShortcuts().filter(s => s.id !== id)); }
function editShortcut(id, updates) {
  saveShortcuts(getShortcuts().map(s => s.id === id ? {...s, ...updates} : s));
}

// ── 個人錢包 ─────────────────────────────────────────
function getWal() {
  return DB.get(pKey('wal')) || {balance:0, history:[], updatedAt:0};
}
function _saveWal(w) {
  w.updatedAt = Date.now();
  DB.set(pKey('wal'), w);
}
function walIn(n, note) {
  const w = getWal();
  w.balance += n;
  w.history.unshift({type:'in', amount:n, note, time:new Date().toISOString()});
  _saveWal(w);
}
function walOut(n, note) {
  const w = getWal();
  w.balance = Math.max(0, w.balance - n);
  w.history.unshift({type:'out', amount:n, note, time:new Date().toISOString()});
  _saveWal(w);
}
function walWithdraw(acctId, amount, note) {
  const isShared = acctId.startsWith('shared_');
  if (isShared) {
    acctOut(acctId.replace('shared_',''), amount, note||'提領至錢包', true);
  } else {
    acctOut(acctId, amount, note||'提領至錢包', false);
  }
  walIn(amount, note||'提領現金');
}

// ── 信用卡（個人） ────────────────────────────────────
function getCards()   { return DB.get(pKey('cards')) || []; }
function cardFind(id) {
  const mine = getCards().find(c=>c.id===id);
  if (mine) return mine;
  const shared = getSharedCards();
  return shared.find(c=>c.id===id) || null;
}
function addCard(c)   { const l=getCards(); c.id='cc_'+Date.now().toString(36); c.owner=uid(); l.push(c); DB.set(pKey('cards'),l); }
function editCard(id, updates) {
  const l = getCards().map(c => c.id===id ? {...c, ...updates} : c);
  DB.set(pKey('cards'), l);
}
function delCard(id)  { DB.set(pKey('cards'), getCards().filter(c=>c.id!==id)); }

function getSharedCards()    { return DB.get('shared_cards') || []; }
function getMySharedCards()  { return getCards().filter(c => c.shared === true); }
function getAllAvailableCards() {
  const mine   = getCards().map(c => ({...c, _owner: '我的'}));
  const shared = getSharedCards().map(c => ({...c, _owner: c.ownerName || '對方'}));
  return [...mine, ...shared];
}

function getCardBills() { return DB.get(pKey('bills')) || []; }
function cardAddBill(cardId, amount, note, at) {
  const bills = getCardBills();
  const card  = cardFind(cardId); if (!card) return;
  const cutDay = card.cutDay || 25;
  const now    = new Date(at || new Date());
  let billMonth = now.getMonth()+1, billYear = now.getFullYear();
  if (now.getDate() > cutDay) { billMonth++; if (billMonth>12){billMonth=1;billYear++;} }
  const billKey = `${cardId}_${billYear}_${billMonth}`;
  let bill = bills.find(b => b.id === billKey);
  if (!bill) {
    bill = {
      id: billKey, cardId, year: billYear, month: billMonth,
      cutDay, dueDay: card.dueDay || 15,
      total: 0, items: [], paid: false, paidAt: null,
    };
    bills.unshift(bill);
  }
  bill.total += amount;
  bill.items.unshift({txId: Date.now().toString(36), amount, note, at: now.toISOString()});
  DB.set(pKey('bills'), bills);
}
function cardVoidBill(cardId, amount, txId) {
  const bills = getCardBills();
  bills.forEach(b => {
    if (b.cardId !== cardId) return;
    b.items = b.items.filter(i => i.txId !== txId);
    b.total = b.items.reduce((s,i)=>s+i.amount, 0);
  });
  DB.set(pKey('bills'), bills.filter(b=>b.items.length>0||b.paid));
}
function cardPayBill(billId, fromType, fromId) {
  const bills = getCardBills();
  const bill  = bills.find(b => b.id === billId); if (!bill) return;
  if (fromType === 'wallet') walOut(bill.total, `信用卡繳費 ${bill.month}月帳單`);
  if (fromType === 'acct')   acctOut(fromId, bill.total, `信用卡繳費 ${bill.month}月帳單`, false);
  bill.paid = true; bill.paidAt = new Date().toISOString();
  DB.set(pKey('bills'), bills);
}
function getCardBill(cardId, year, month) {
  return getCardBills().find(b => b.cardId===cardId && b.year===year && b.month===month) || null;
}
function getPendingBills() {
  return getCardBills().filter(b => !b.paid);
}

// ── 悠遊卡（個人） ────────────────────────────────────
function getIcards()   { return DB.get(pKey('icards')) || []; }
function icardFind(id) {
  const mine = getIcards().find(c=>c.id===id);
  if (mine) return mine;
  const shared = getSharedIcards();
  return shared.find(c=>c.id===id) || null;
}
function addIcard(c)   { const l=getIcards(); c.id='ic_'+Date.now().toString(36); c.balance=c.balance||0; c.history=[]; c.owner=uid(); l.push(c); DB.set(pKey('icards'),l); return c; }
function editIcard(id, updates) {
  const l = getIcards().map(c => c.id===id ? {...c, ...updates} : c);
  DB.set(pKey('icards'), l);
}
function delIcard(id)  { DB.set(pKey('icards'), getIcards().filter(c=>c.id!==id)); }

function getSharedIcards()   { return DB.get('shared_icards') || []; }
function getMySharedIcards() { return getIcards().filter(c => c.shared === true); }
function getAllAvailableIcards() {
  const mine   = getIcards().map(c => ({...c, _owner: '我的'}));
  const shared = getSharedIcards().map(c => ({...c, _owner: c.ownerName || '對方'}));
  return [...mine, ...shared];
}
function icardTopup(id, amount, payMethod, payId, note) {
  const list=getIcards(), idx=list.findIndex(c=>c.id===id); if(idx<0)return;
  list[idx].balance=(list[idx].balance||0)+amount;
  list[idx].history=list[idx].history||[];
  list[idx].history.unshift({type:'topup',amount,payMethod,payId,note,time:new Date().toISOString()});
  DB.set(pKey('icards'),list);
  if(payMethod==='cash') walOut(amount, list[idx].name+' 加值');
  if(payMethod==='card' && payId) cardAddBill(payId, amount, list[idx].name+' 加值');
  return list[idx];
}
function icardOut(id,amount,note){
  const list=getIcards(),idx=list.findIndex(c=>c.id===id);if(idx<0)return;
  list[idx].balance=Math.max(0,(list[idx].balance||0)-amount);
  list[idx].history=list[idx].history||[];
  list[idx].history.unshift({type:'out',amount,note,time:new Date().toISOString()});
  list[idx]._localTs=Date.now();
  DB.set(pKey('icards'),list);
}
function icardIn(id,amount,note){
  const list=getIcards(),idx=list.findIndex(c=>c.id===id);if(idx<0)return;
  list[idx].balance=(list[idx].balance||0)+amount;
  list[idx].history=list[idx].history||[];
  list[idx].history.unshift({type:'in',amount,note,time:new Date().toISOString()});
  list[idx]._localTs=Date.now();
  DB.set(pKey('icards'),list);
}

// ── 銀行帳戶（個人+共用） ────────────────────────────
function getAccts(shared=false) {
  return DB.get(shared ? 'shared_accts' : pKey('accts')) || [];
}
function acctFind(id, shared=false) { return getAccts(shared).find(a=>a.id===id)||null; }
function addAcct(a, shared=false) {
  const l=getAccts(shared);
  a.id=(shared?'shared_':'acct_')+Date.now().toString(36);
  a.balance=a.balance||0; a.history=[]; a.updatedAt=Date.now();
  l.push(a); DB.set(shared?'shared_accts':pKey('accts'), l);
  return a;
}
function delAcct(id, shared=false) {
  const key = shared?'shared_accts':pKey('accts');
  DB.set(key, getAccts(shared).filter(a=>a.id!==id));
}
function acctIn(id, amount, note, shared=false) {
  const list=getAccts(shared), idx=list.findIndex(a=>a.id===id); if(idx<0)return;
  list[idx].balance=(list[idx].balance||0)+amount;
  list[idx].history=list[idx].history||[];
  list[idx].history.unshift({type:'in',amount,note,time:new Date().toISOString()});
  list[idx].updatedAt=Date.now();
  DB.set(shared?'shared_accts':pKey('accts'), list);
}
function acctOut(id, amount, note, shared=false) {
  const list=getAccts(shared), idx=list.findIndex(a=>a.id===id); if(idx<0)return;
  list[idx].balance=Math.max(0,(list[idx].balance||0)-amount);
  list[idx].history=list[idx].history||[];
  list[idx].history.unshift({type:'out',amount,note,time:new Date().toISOString()});
  list[idx].updatedAt=Date.now();
  DB.set(shared?'shared_accts':pKey('accts'), list);
}

// ── 分類（共用） ─────────────────────────────────────
function getCats()   { return DB.get('cats') || DEF_CATS; }
function catFind(id) { return getCats().find(c=>c.id===id) || {name:id,color:'#94a3b8',sub:[]}; }

function getSubCats(catId) { return catFind(catId).sub || []; }
function addSubCat(catId, subName) {
  const cats = getCats();
  const cat = cats.find(c=>c.id===catId);
  if (!cat) return;
  if (!cat.sub) cat.sub = [];
  if (!cat.sub.includes(subName)) { cat.sub.push(subName); DB.set('cats', cats); }
}
function renameSubCat(catId, oldName, newName) {
  const cats = getCats();
  const cat = cats.find(c=>c.id===catId);
  if (!cat||!cat.sub) return;
  const idx = cat.sub.indexOf(oldName);
  if (idx>=0) { cat.sub[idx]=newName; DB.set('cats', cats); }
}
function delSubCat(catId, subName) {
  const cats = getCats();
  const cat = cats.find(c=>c.id===catId);
  if (!cat||!cat.sub) return;
  cat.sub = cat.sub.filter(s=>s!==subName);
  DB.set('cats', cats);
}

// ── 私密記帳（只有 kevin 看得到）────────────────────
const KEVIN_EMAIL = 'kevin67222@gmail.com';
function isKevin() { return (localStorage.getItem('current_email')||'')===KEVIN_EMAIL; }
function pPrivKey(k) { return 'priv_'+uid()+'_'+k; }

function getPrivTx() {
  // 一次性遷移：舊版 fbPullPrivTx 因 const DB 不掛 window 走 fallback，把資料寫到
  // db_priv_{uid}_tx；新版寫到 priv_{uid}_tx。這裡偵測舊 key 有資料就遷移過來。
  try {
    const wrongKey = 'db_priv_' + uid() + '_tx';
    const wrongRaw = localStorage.getItem(wrongKey);
    if (wrongRaw) {
      const wrongList = JSON.parse(wrongRaw);
      const currentList = DB.get(pPrivKey('tx')) || [];
      const merged = new Map();
      [...currentList, ...wrongList].forEach(t => { if (!merged.has(t.id)) merged.set(t.id, t); });
      DB.set(pPrivKey('tx'), [...merged.values()]);
      localStorage.removeItem(wrongKey);
      console.log('[Migration] 已遷移私密記帳資料到正確 key（共', merged.size, '筆）');
    }
  } catch(e) { console.warn('[Migration] privTx 遷移失敗:', e); }

  const raw = DB.get(pPrivKey('tx')) || [];
  const map = new Map(); raw.forEach(t=>{ if(!map.has(t.id)) map.set(t.id,t); });
  return [...map.values()];
}
function addPrivTx(tx) {
  const list = getPrivTx();
  tx.id = 'priv_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6);
  tx.private = true;
  if (list.find(t=>t.id===tx.id)) return tx;
  list.unshift(tx);
  DB.set(pPrivKey('tx'), list);
  return tx;
}
function delPrivTx(id) { DB.set(pPrivKey('tx'), getPrivTx().filter(t=>t.id!==id)); }
function editPrivTx(id, updates) {
  const list = getPrivTx().map(t=>t.id===id?{...t,...updates}:t);
  DB.set(pPrivKey('tx'), list);
}

function fixDuplicates() {
  const txRaw = DB.get(pPrivKey('tx')) || [];
  const txMap = new Map(); txRaw.forEach(t=>{ if(!txMap.has(t.id)) txMap.set(t.id,t); });
  DB.set(pPrivKey('tx'), [...txMap.values()]);

  const memoRaw = DB.get(pPrivKey('memos')) || [];
  const memoMap = new Map(); memoRaw.forEach(m=>{ if(!memoMap.has(m.id)) memoMap.set(m.id,m); });
  DB.set(pPrivKey('memos'), [...memoMap.values()]);

  console.log(`[fixDuplicates] 私密記帳: ${txRaw.length}→${txMap.size}, 備忘錄: ${memoRaw.length}→${memoMap.size}`);
  return { txBefore: txRaw.length, txAfter: txMap.size, memoBefore: memoRaw.length, memoAfter: memoMap.size };
}

function getMemos() {
  // 一次性遷移：同 getPrivTx
  try {
    const wrongKey = 'db_priv_' + uid() + '_memos';
    const wrongRaw = localStorage.getItem(wrongKey);
    if (wrongRaw) {
      const wrongList = JSON.parse(wrongRaw);
      const currentList = DB.get(pPrivKey('memos')) || [];
      const merged = new Map();
      [...currentList, ...wrongList].forEach(m => { if (!merged.has(m.id)) merged.set(m.id, m); });
      DB.set(pPrivKey('memos'), [...merged.values()]);
      localStorage.removeItem(wrongKey);
      console.log('[Migration] 已遷移備忘錄資料到正確 key（共', merged.size, '筆）');
    }
  } catch(e) { console.warn('[Migration] memos 遷移失敗:', e); }

  const raw = DB.get(pPrivKey('memos')) || [];
  const map = new Map(); raw.forEach(m=>{ if(!map.has(m.id)) map.set(m.id,m); });
  return [...map.values()];
}
function addMemo(m) {
  const list = getMemos();
  m.id  = 'memo_'+Date.now().toString(36);
  m.at  = new Date().toISOString();
  if (list.find(x=>x.id===m.id)) return m;
  list.unshift(m);
  DB.set(pPrivKey('memos'), list);
  return m;
}
function editMemo(id, updates) {
  DB.set(pPrivKey('memos'), getMemos().map(m=>m.id===id?{...m,...updates,updatedAt:new Date().toISOString()}:m));
}
function delMemo(id)  { DB.set(pPrivKey('memos'), getMemos().filter(m=>m.id!==id)); }
function catName(id) { return catFind(id).name; }
function addCat(c)   { const l=getCats(); c.id='cat_'+Date.now().toString(36); l.push(c); DB.set('cats',l); }
function delCat(id)  { DB.set('cats', getCats().filter(c=>c.id!==id)); }

// ── 預算（共用） ─────────────────────────────────────
function getBudgetConfig()     { return DB.get('budgets') || {startDay:1, items:{}}; }
function saveBudgetConfig(cfg) { DB.set('budgets', cfg); }
function getBudgetPeriod(now) {
  now = now || new Date();
  const cfg = getBudgetConfig(), sd = cfg.startDay||1;
  const y=now.getFullYear(), m=now.getMonth()+1, d=now.getDate();
  let s, e;
  if (d >= sd) { s=new Date(y,m-1,sd); e=new Date(y,m,sd-1); }
  else         { s=new Date(y,m-2,sd); e=new Date(y,m-1,sd-1); }
  e.setHours(23,59,59,999);
  return {start:s, end:e};
}
function getBudget(id)    { return (getBudgetConfig().items||{})[id]?.limit || 0; }
function setBudget(id, n) { const cfg=getBudgetConfig(); if(!cfg.items)cfg.items={}; cfg.items[id]={limit:n}; saveBudgetConfig(cfg); }
function getBudgetStartDay()    { return getBudgetConfig().startDay||1; }
function setBudgetStartDay(day) { const cfg=getBudgetConfig(); cfg.startDay=day; saveBudgetConfig(cfg); }
function fmtPeriod() {
  const {start:s, end:e} = getBudgetPeriod();
  return `${s.getMonth()+1}/${s.getDate()} ～ ${e.getMonth()+1}/${e.getDate()}`;
}


// ── 收入管理 ─────────────────────────────────────────
const DEF_INCOME_SOURCES = ['薪資','獎金','投資','其他'];
function getIncomeSources() { return DB.get('income_sources') || DEF_INCOME_SOURCES.slice(); }
function saveIncomeSources(list) { DB.set('income_sources', list); }
function addIncomeSource(name) {
  const list = getIncomeSources();
  if (!list.includes(name)) { list.push(name); saveIncomeSources(list); }
  return list;
}
function delIncomeSource(name) {
  saveIncomeSources(getIncomeSources().filter(s => s !== name));
}

function getIncomes() { return DB.get('incomes') || []; }
function saveIncomes(list) { DB.set('incomes', list); }
function addIncome(inc) {
  const list = getIncomes();
  inc.id = inc.id || ('inc_' + Date.now() + '_' + Math.random().toString(36).slice(2,6));
  inc.at = inc.at || new Date().toISOString();
  list.unshift(inc);
  saveIncomes(list);
  return inc;
}
function updateIncome(id, patch) {
  const list = getIncomes();
  const item = list.find(i => i.id === id);
  if (item) { Object.assign(item, patch); saveIncomes(list); }
}
function delIncome(id) {
  saveIncomes(getIncomes().filter(i => i.id !== id));
}
// 依週期月取收入
function incomesByPeriod(now) {
  const {start, end} = getBudgetPeriod(now);
  return getIncomes().filter(i => { const d = new Date(i.at); return d >= start && d <= end; });
}

// ── Discord 設定 ─────────────────────────────────────
function getDiscord() {
  return DB.get('discord') || {webhook:'',onAdd:true,onDaily:true,dailyHour:21,onBudget:true,budgetPct:80,onWeekly:false,onMonthly:false,monthlyDay:11};
}
function saveDiscord(cfg) { DB.set('discord', {...getDiscord(),...cfg}); }

// ── 偏好設定 ─────────────────────────────────────────
function getPrefs()  { return DB.get('prefs') || {theme:'dark',accent:'teal',lastCat:'',lastPay:'cash',fontSize:1}; }
function setPrefs(p) { DB.set('prefs', {...getPrefs(),...p}); applyTheme(); }

// ── 智慧輸入記憶 ─────────────────────────────────────
function getHints() { return DB.get('hints') || {}; }
function rememberHint(cat, subCat, detail) {
  if (!cat||!detail) return;
  const h=getHints(); if(!h[cat])h[cat]={};
  const key=subCat||'_'; if(!h[cat][key])h[cat][key]=[];
  h[cat][key]=[detail,...h[cat][key].filter(d=>d!==detail)].slice(0,10);
  DB.set('hints',h);
}
function getAllDetailHints(cat) {
  const h=getHints(); if(!h[cat])return[];
  return Object.values(h[cat]).flat().filter((v,i,a)=>a.indexOf(v)===i).slice(0,20);
}

// ── 統計 ─────────────────────────────────────────────
function calcStats(list) {
  const total=list.reduce((s,x)=>s+x.amount,0);
  const cash =list.filter(x=>x.pay==='cash' ).reduce((s,x)=>s+x.amount,0);
  const card =list.filter(x=>x.pay==='card' ).reduce((s,x)=>s+x.amount,0);
  const icard=list.filter(x=>x.pay==='icard').reduce((s,x)=>s+x.amount,0);
  const acct =list.filter(x=>x.pay==='acct' ).reduce((s,x)=>s+x.amount,0);
  const byCat={},byCard={},byIcard={},byAcct={},byPerson={};
  // 孤兒記錄統計：pay=card/icard/acct 但對應 id 為空，或 id 存在但卡片已被刪除
  let orphanCard=0, orphanIcard=0, orphanAcct=0;
  list.forEach(x=>{
    byCat[x.cat]=(byCat[x.cat]||0)+x.amount;
    byPerson[x.person]=(byPerson[x.person]||0)+x.amount;
    if(x.pay==='card'){
      // 孤兒條件：沒有 cardId，或有 cardId 但找不到對應卡片（已刪除）
      if(x.cardId && (typeof cardFind==='function') && cardFind(x.cardId))
        byCard[x.cardId]=(byCard[x.cardId]||0)+x.amount;
      else
        orphanCard += x.amount;
    }
    if(x.pay==='icard'){
      if(x.icardId && (typeof icardFind==='function') && icardFind(x.icardId))
        byIcard[x.icardId]=(byIcard[x.icardId]||0)+x.amount;
      else
        orphanIcard += x.amount;
    }
    if(x.pay==='acct'){
      const aid = x.acctId;
      const found = aid && (typeof getAccts==='function') && (
        getAccts(false).find(a=>a.id===aid) || getAccts(true).find(a=>a.id===aid.replace('shared_',''))
      );
      if(found) byAcct[aid]=(byAcct[aid]||0)+x.amount;
      else      orphanAcct += x.amount;
    }
  });
  // 若有孤兒記錄，加到 byCard 的特殊 key '_orphan' 顯示
  if (orphanCard > 0)  byCard['_orphan']  = orphanCard;
  if (orphanIcard > 0) byIcard['_orphan'] = orphanIcard;
  if (orphanAcct > 0)  byAcct['_orphan']  = orphanAcct;
  return {total,cash,card,icard,acct,byCat,byCard,byIcard,byAcct,byPerson,
          orphanCard,orphanIcard,orphanAcct};
}

// ── 標籤統計 ─────────────────────────────────────────
function calcTagStats(list) {
  const byTag = {};
  list.forEach(tx => {
    (tx.tags||[]).forEach(tagId => {
      if (!byTag[tagId]) byTag[tagId] = {total:0, count:0, list:[]};
      byTag[tagId].total += tx.amount;
      byTag[tagId].count++;
      byTag[tagId].list.push(tx);
    });
  });
  return byTag;
}

// ── 本週支出預測（週一～週日）────────────────────────
function getWeekPrediction() {
  const now = new Date();
  // 本週起始（週一）
  const dow = now.getDay(); // 0=日,1=週一...
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + mondayOffset);
  weekStart.setHours(0,0,0,0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23,59,59,999);

  // 本週已花費（依分類）
  const allTx = getTx();
  const thisWeekTx = allTx.filter(t => {
    const d = new Date(t.at);
    return d >= weekStart && d <= weekEnd;
  });

  // 今天是週幾（週一=1, 週日=7）
  const todayDow = dow === 0 ? 7 : dow;
  const daysElapsed = todayDow; // 已過天數（含今天）
  const daysLeft = 7 - daysElapsed; // 剩餘天數

  // 歷史日均（取過去所有 tx，計算日均支出）
  // 只取今天以前的完整日期（排除今天避免偏差）
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
  const histTx = allTx.filter(t => new Date(t.at) < todayStart);

  // 找最早一筆記帳日期
  let histDays = 0;
  if (histTx.length > 0) {
    const oldest = new Date(Math.min(...histTx.map(t => new Date(t.at))));
    const diffMs = todayStart - oldest;
    histDays = Math.max(1, Math.ceil(diffMs / 86400000));
  }

  // 依分類計算
  const cats = getCats();
  const catResults = cats.map(cat => {
    const spentThisWeek = thisWeekTx.filter(t=>t.cat===cat.id).reduce((s,t)=>s+t.amount,0);
    let predicted = 0;
    if (histTx.length > 0 && histDays > 0) {
      const histTotal = histTx.filter(t=>t.cat===cat.id).reduce((s,t)=>s+t.amount,0);
      const dailyAvg = histTotal / histDays;
      predicted = Math.round(dailyAvg * daysLeft);
    }
    return {cat, spentThisWeek, predicted, total: spentThisWeek + predicted};
  }).filter(r => r.spentThisWeek > 0 || r.predicted > 0);

  const totalSpent = thisWeekTx.reduce((s,t)=>s+t.amount,0);
  const totalPredicted = catResults.reduce((s,r)=>s+r.predicted,0);

  return {
    weekStart, weekEnd, daysElapsed, daysLeft,
    totalSpent, totalPredicted,
    catResults,
    thisWeekTx,
  };
}

// ── 資產總覽 ─────────────────────────────────────────
function calcNetWorth() {
  const wal         = getWal().balance;
  const icTotal     = getIcards().reduce((s,c) => s + (c.balance||0), 0);
  const acTotal     = getAccts(false).reduce((s,a) => s + (a.balance||0), 0);
  const shTotal     = getAccts(true).reduce((s,a) => s + (a.balance||0), 0);
  const pendingBills= getPendingBills().reduce((s,b) => s + (b.total||0), 0);
  // 投資市值（currentAmt 由用戶手動更新）
  const investTotal = getInvestments().reduce((s,i) => s + (i.currentAmt || i.costAmt || 0), 0);
  // 分期未繳餘額
  const instDebt    = getInstallments().filter(i => i.status !== 'completed').reduce((inst, i) => {
    const paid = (i.paidMonths || []).length;
    const months = i.months || i.totalMonths || 0;
    return inst + Math.max(0, months - paid) * (i.monthlyAmt || 0);
  }, 0);
  const total = wal + icTotal + acTotal + shTotal + investTotal - pendingBills - instDebt;
  return { wal, icTotal, acTotal, shTotal, pendingBills, investTotal, instDebt, total };
}

// ── 格式化 ────────────────────────────────────────────
// 本地日期字串（YYYY-MM-DD），避免 toISOString() 用 UTC 在台灣凌晨掉到前一天
function toLocalISO(d) {
  if (!d) d = new Date();
  if (typeof d === 'string') d = new Date(d);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function fmt(n)  { return Number(n||0).toLocaleString('zh-TW'); }
function fmtT(s) { const d=new Date(s); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function fmtD(s) {
  try {
    const d = new Date(s);
    // 用本地時間取年月日，避免 UTC 在台灣時區造成跨日偏移（凌晨 0~8 點）
    return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
  } catch(e) { return s; }
}
function groupDay(list) {
  const g={};
  [...list].sort((a,b)=>new Date(b.at)-new Date(a.at)).forEach(t=>{
    // 用本地時間取日期（避免 UTC+8 環境下 00:00~07:59 被歸到前一天）
    const d = new Date(t.at);
    const k = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
    if(!g[k])g[k]=[];
    g[k].push(t);
  });
  return g;
}


// ── 分期付款 ──────────────────────────────────────────
function getInstallments()      { return DB.get('installments') || []; }
function saveInstallments(list) { DB.set('installments', list); }

function addInstallment(data) {
  const list = getInstallments();
  list.unshift(data);
  saveInstallments(list);
  return data;
}

function updateInstallment(id, patch) {
  const list = getInstallments();
  const idx  = list.findIndex(i => i.id === id);
  if (idx < 0) return;
  Object.assign(list[idx], patch);
  saveInstallments(list);
}

function delInstallment(id) {
  saveInstallments(getInstallments().filter(i => i.id !== id));
}

// 計算某分期某期次的金額
function installmentPeriodAmt(inst, periodIdx) {
  const base = Math.floor(inst.totalAmt / inst.months);
  const rem  = inst.totalAmt - base * inst.months;
  if (rem === 0) return base;
  if (inst.remainderOn === 'first' && periodIdx === 0)              return base + rem;
  if (inst.remainderOn === 'last'  && periodIdx === inst.months - 1) return base + rem;
  return base;
}

// 取得「當月 + 過去未記帳」的提醒清單
function getPendingInstallments() {
  const now = new Date();
  const currentYM = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  const pending = [];

  getInstallments().filter(i => i.status === 'active').forEach(inst => {
    const [sy, sm] = inst.startYM.split('-').map(Number);
    const paidSet  = new Set(inst.paidMonths || []);

    for (let m = 0; m < inst.months; m++) {
      let y = sy, mo = sm + m - 1;
      y += Math.floor(mo / 12);
      mo = mo % 12 + 1;
      const ym = y + '-' + String(mo).padStart(2,'0');
      if (ym <= currentYM && !paidSet.has(ym)) {
        pending.push({
          inst,
          periodYM:  ym,
          periodNo:  m + 1,
          periodAmt: installmentPeriodAmt(inst, m),
        });
      }
    }
  });

  return pending;
}


// ── 投資記錄 ──────────────────────────────────────────
function getInvestments()      { return DB.get('investments') || []; }
function saveInvestments(list) { DB.set('investments', list); }

function addInvestment(data) {
  const list = getInvestments();
  list.unshift(data);
  saveInvestments(list);
  return data;
}

function updateInvestment(id, patch) {
  const list = getInvestments();
  const idx  = list.findIndex(i => i.id === id);
  if (idx < 0) return;
  Object.assign(list[idx], patch);
  saveInvestments(list);
}

function delInvestment(id) {
  saveInvestments(getInvestments().filter(i => i.id !== id));
}


// ── 台股交易日誌（宏龍私密）──────────────────────────
function getTrades()      { return DB.get('trades') || []; }
function saveTrades(list) { DB.set('trades', list); }

function addTrade(data) {
  const list = getTrades();
  list.unshift(data);
  saveTrades(list);
  return data;
}
function updateTrade(id, patch) {
  const list = getTrades();
  const idx  = list.findIndex(t => t.id === id);
  if (idx < 0) return;
  Object.assign(list[idx], patch);
  saveTrades(list);
}
function delTrade(id) {
  saveTrades(getTrades().filter(t => t.id !== id));
}

// 紀律規則設定
function getTradeRules() {
  return DB.get('trade_rules') || {
    maxDailyLoss:       5000,    // 單日最大虧損（達到提醒停手）
    maxPositionSize:    100000,  // 單筆最大部位金額
    maxConsecutiveLoss: 3,       // 連虧幾次停手
    maxTradesPerDay:    10,      // 單日最大交易次數
    feeRate:            0.1425,  // 手續費率 %
    feeDiscount:        0.28,    // 折扣（如 2.8折=0.28；無折扣填1）
    minFee:             20,      // 最低手續費
    enabled:            true,
  };
}
function saveTradeRules(r) { DB.set('trade_rules', {...getTradeRules(), ...r}); }

// 台股交易成本計算（傳入交易物件，回傳含損益的明細）
function calcTradeCost(t) {
  const rules    = getTradeRules();
  const feeRate  = (rules.feeRate / 100) * (rules.feeDiscount || 1);
  const minFee   = rules.minFee || 20;
  const entry    = t.entryPrice || 0;
  const exit     = t.exitPrice || 0;
  const shares   = t.shares || 0;
  const isDay    = t.type === 'intraday';          // 當沖證交稅減半
  const taxRate  = isDay ? 0.0015 : 0.003;

  const buyAmt   = entry * shares;
  const sellAmt  = exit  * shares;

  // 手續費：買賣各一次，取 max(金額×費率, 最低費)
  const buyFee   = entry && shares ? Math.max(Math.round(buyAmt * feeRate), minFee) : 0;
  const sellFee  = exit  && shares ? Math.max(Math.round(sellAmt * feeRate), minFee) : 0;
  // 證交稅：賣出時課（放空為買回時，金額用成交額計，這裡以 sellAmt 計）
  const tax      = exit && shares ? Math.round(sellAmt * taxRate) : 0;

  const fees     = buyFee + sellFee;
  // 損益方向：做多 = (賣-買)；做空 = (買-賣)
  const grossPnl = t.direction === 'short'
    ? (entry - exit) * shares
    : (exit - entry) * shares;
  const netPnl   = grossPnl - fees - tax;

  return { buyFee, sellFee, fees, tax, grossPnl, netPnl, totalCost: fees + tax };
}

// 今日交易統計（給紀律守門員用）
function getTodayTradeStats() {
  const today = toLocalISO();
  const todayTrades = getTrades().filter(t => t.date === today && t.status === 'closed');
  let netSum = 0, count = todayTrades.length, consecutiveLoss = 0, maxConsec = 0;
  // 依時間排序算連虧
  const sorted = [...todayTrades].sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  sorted.forEach(t => {
    const { netPnl } = calcTradeCost(t);
    netSum += netPnl;
    if (netPnl < 0) { consecutiveLoss++; maxConsec = Math.max(maxConsec, consecutiveLoss); }
    else consecutiveLoss = 0;
  });
  return { netSum, count, currentConsecutiveLoss: consecutiveLoss, maxConsecutiveLoss: maxConsec };
}


// ── 關注清單（給交易 GAS 盤後抓資料用）────────────────
function getWatchlist()      { return DB.get('trade_watchlist') || []; }
function saveWatchlist(list) { DB.set('trade_watchlist', list); }

function addWatchItem(item) {
  const list = getWatchlist();
  if (list.some(w => w.ticker === item.ticker)) return false;  // 已存在
  list.push(item);
  saveWatchlist(list);
  return true;
}
function delWatchItem(ticker) {
  saveWatchlist(getWatchlist().filter(w => w.ticker !== ticker));
}

// ── 清除 ─────────────────────────────────────────────
function clearAll() {
  const keys = Object.keys(localStorage).filter(k =>
    k.startsWith(uid()+'_') || ['tx','cats','budgets','hints','discord','prefs','shared_accts','tx_tags'].includes(k)
  );
  keys.forEach(k => localStorage.removeItem(k));
}

// ── 主題系統 ─────────────────────────────────────────
const ACCENTS={
  // ── 原有 6 色 ──
  teal:  {p:'#00e5b4',p2:'#00b48e',pdim:'rgba(0,229,180,.13)'},
  blue:  {p:'#4f8ef7',p2:'#2563eb',pdim:'rgba(79,142,247,.13)'},
  pink:  {p:'#f472b6',p2:'#db2777',pdim:'rgba(244,114,182,.13)'},
  purple:{p:'#a78bfa',p2:'#7c3aed',pdim:'rgba(167,139,250,.13)'},
  yellow:{p:'#fbbf24',p2:'#d97706',pdim:'rgba(251,191,36,.13)'},
  green: {p:'#4ade80',p2:'#16a34a',pdim:'rgba(74,222,128,.13)'},
  // ── 新增 6 色 ──
  orange:{p:'#fb923c',p2:'#ea580c',pdim:'rgba(251,146,60,.13)'},
  red:   {p:'#f87171',p2:'#dc2626',pdim:'rgba(248,113,113,.13)'},
  rose:  {p:'#fb7185',p2:'#e11d48',pdim:'rgba(251,113,133,.13)'},
  cyan:  {p:'#22d3ee',p2:'#0891b2',pdim:'rgba(34,211,238,.13)'},
  indigo:{p:'#818cf8',p2:'#4338ca',pdim:'rgba(129,140,248,.13)'},
  lime:  {p:'#a3e635',p2:'#65a30d',pdim:'rgba(163,230,53,.13)'},
};
const THEMES={
  dark:{bg:'#0a0f1e',bg2:'#111827',card:'#1a2235',card2:'#202d42',border:'#2a3550',t:'#e8edf8',t2:'#8896b3',t3:'#4a5670'},
  light:{bg:'#f0f4f8',bg2:'#ffffff',card:'#ffffff',card2:'#f8fafc',border:'#e2e8f0',t:'#1a202c',t2:'#64748b',t3:'#94a3b8'},
};
function applyTheme() {
  const p=getPrefs(),th=THEMES[p.theme]||THEMES.dark,ac=ACCENTS[p.accent]||ACCENTS.teal,r=document.documentElement;
  Object.entries(th).forEach(([k,v])=>r.style.setProperty('--'+k,v));
  r.style.setProperty('--p',ac.p); r.style.setProperty('--p2',ac.p2); r.style.setProperty('--pdim',ac.pdim);
  r.style.setProperty('--fs', p.fontSize||1);
}
function currentUser() { return localStorage.getItem('current_user')||'宏龍'; }

initDB();

// ── Discord AI 問答記錄（宏龍專屬）──────────────────────────
async function discordAiLog(source, question, answer) {
  if (!isKevin()) return;
  const webhook = localStorage.getItem('chat_log_webhook');
  if (!webhook) return;
  const now = new Date().toLocaleString('zh-TW', { timeZone:'Asia/Taipei', hour12:false });
  const truncQ = (question || '').slice(0, 200);
  const truncA = (answer   || '').length > 800 ? answer.slice(0, 800) + '…（略）' : (answer || '');
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [{ title: '🤖 AI 問答記錄', color: 0x8b5cf6, fields: [
        { name: '📍 來源', value: source, inline: true },
        { name: '⏰ 時間', value: now, inline: true },
        { name: '❓ 問',   value: truncQ || '（快速提問）', inline: false },
        { name: '💬 答',   value: truncA, inline: false },
      ]}] }),
    });
  } catch(e) { console.warn('[AI Log]', e); }
}

// ── 知識庫自訂卡片 ──────────────────────────────────────────
function getCustomKbCards() { return DB.get('kb_custom') || []; }
function saveCustomKbCards(cards) { DB.set('kb_custom', cards); }

function addCustomKbCard(card) {
  const cards = getCustomKbCards();
  card.id      = 'custom_' + Date.now();
  card.isCustom = true;
  card.createdAt = Date.now();
  card.updatedAt = Date.now();
  cards.push(card);
  saveCustomKbCards(cards);
  return card;
}

function updateCustomKbCard(id, updates) {
  const cards = getCustomKbCards();
  const idx = cards.findIndex(c => c.id === id);
  if (idx < 0) return null;
  cards[idx] = { ...cards[idx], ...updates, updatedAt: Date.now() };
  saveCustomKbCards(cards);
  return cards[idx];
}

function deleteCustomKbCard(id) {
  saveCustomKbCards(getCustomKbCards().filter(c => c.id !== id));
}

// ── 記帳待確認請求 ─────────────────────────────────────
function getPendingRequests() { return DB.get('pending_requests') || []; }
function savePendingRequests(list) { DB.set('pending_requests', list); }

function addPendingRequest(req) {
  const list = getPendingRequests();
  req.id        = 'preq_' + Date.now();
  req.status    = 'pending';
  req.createdAt = Date.now();
  list.unshift(req);
  savePendingRequests(list);
  return req;
}

function removePendingRequest(id) {
  savePendingRequests(getPendingRequests().filter(r => r.id !== id));
}

function getMyPendingRequests() {
  // 找指定給目前使用者的待確認請求（用 current_user 識別，與 currentUser() 一致）
  const me = currentUser();
  return getPendingRequests().filter(r => r.assignedTo === me && r.status === 'pending');
}

function currentPersonLabel() {
  return currentUser();
}

// ── 通用 Modal 開關（所有頁面共用）─────────────────────
function showModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('show');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}

// ── 固定繳費讀取（供 index.html 收件夾使用）─────────────
function getRecurring() {
  try { return JSON.parse(localStorage.getItem('recurring_items') || '[]'); } catch { return []; }
}

// ════════════════════════════════════════════════════
// 通知收件夾 — aggregator
// ════════════════════════════════════════════════════

/** 已略過的通知 ID（每月自動清除） */
function _dismissedInboxKey() {
  const d = new Date();
  return `inbox_dismissed_${d.getFullYear()}_${d.getMonth()+1}`;
}
function getDismissedInbox() {
  try { return JSON.parse(localStorage.getItem(_dismissedInboxKey()) || '[]'); } catch { return []; }
}
function dismissInboxItem(id) {
  const list = getDismissedInbox();
  if (!list.includes(id)) { list.push(id); localStorage.setItem(_dismissedInboxKey(), JSON.stringify(list)); }
}
function isInboxItemDismissed(id) { return getDismissedInbox().includes(id); }

/** 彙整所有通知項目 */
function getInboxItems() {
  const items = [];
  const today = new Date();
  const todayDay   = today.getDate();
  const todayMonth = today.getMonth() + 1;
  const todayYear  = today.getFullYear();
  const todayStr   = toLocalISO(today).slice(0,10);

  // ── 1. 待確認記帳請求 ──────────────────────────────
  getMyPendingRequests().forEach(req => {
    items.push({
      id: req.id,
      type: 'pending_confirm',
      icon: '⏳',
      title: `${req.requestedBy} 的記帳確認`,
      subtitle: (catName(req.cat) || req.cat) + (req.detail ? ' · ' + req.detail : ''),
      note: req.note || '',
      date: req.date || todayStr,
      isNew: true,
      actionLabel: '確認金額',
      raw: req,
    });
  });

  // ── 2. 固定繳費到期提醒（今日起 3 天內到期）─────────
  getRecurring().forEach(rec => {
    // 檢查是否本月應提醒（按 interval 週期）
    const startM  = rec.startMonth || 1;
    const monthsFromStart = (todayYear - 2024) * 12 + todayMonth - startM;
    const interval = rec.interval || 1;
    if (monthsFromStart < 0 || monthsFromStart % interval !== 0) return;
    // 到期日在今日起 3 天內（-1 ~ +3）
    const diff = rec.day - todayDay;
    if (diff < -1 || diff > 3) return;
    const notifId = `rec_${rec.name}_${todayYear}_${todayMonth}`;
    if (isInboxItemDismissed(notifId)) return;
    const dueLabel = diff === 0 ? '今天到期' : diff < 0 ? `已過期 ${Math.abs(diff)} 天` : `${diff} 天後到期`;
    items.push({
      id: notifId,
      type: 'recurring',
      icon: '🔄',
      title: rec.name,
      subtitle: `$${fmt(rec.amt || 0)} · ${dueLabel}`,
      note: '',
      date: `${todayYear}/${String(todayMonth).padStart(2,'0')}/${String(rec.day).padStart(2,'0')}`,
      isNew: true,
      actionLabel: '立即記帳',
      raw: rec,
    });
  });

  // ── 3. 分期月繳提醒 ─────────────────────────────────
  getInstallments().forEach(inst => {
    if (!inst.active && inst.active !== undefined) return;
    const startDate = new Date(inst.startDate || inst.createdAt);
    const mDiff = (todayYear - startDate.getFullYear()) * 12 + todayMonth - (startDate.getMonth()+1);
    if (mDiff < 0 || mDiff >= (inst.months || inst.totalMonths || 0)) return;
    const period = mDiff + 1;
    const notifId = `inst_${inst.id}_${todayYear}_${todayMonth}`;
    if (isInboxItemDismissed(notifId)) return;
    // 提醒日：每月 1 日起（或分期開始日當天）
    const remindDay = startDate.getDate();
    const diff2 = remindDay - todayDay;
    if (diff2 < -1 || diff2 > 3) return;
    items.push({
      id: notifId,
      type: 'installment',
      icon: '📦',
      title: inst.name,
      subtitle: `第 ${period}/${inst.months || inst.totalMonths} 期 · $${fmt(inst.monthlyAmt || inst.amount || 0)}`,
      note: '',
      date: todayStr,
      isNew: true,
      actionLabel: '立即記帳',
      raw: { ...inst, currentPeriod: period },
    });
  });

  // ── 4. 信用卡帳單到期（5 天內）─────────────────────
  getPendingBills().forEach(bill => {
    const due  = new Date(bill.year, bill.month - 1, bill.dueDay || 15);
    const diff = Math.ceil((due - today) / 864e5);
    if (diff > 5 || diff < -1) return;
    const notifId = `bill_${bill.id}`;
    if (isInboxItemDismissed(notifId)) return;
    const urgLabel = diff <= 0 ? '🔴 已逾期' : diff <= 2 ? '🟠 緊急' : '🟡 即將到期';
    const card = typeof cardFind === 'function' ? cardFind(bill.cardId) : null;
    items.push({
      id: notifId,
      type: 'bill_due',
      icon: '💳',
      title: `${card?.name || '信用卡'} ${bill.month}月帳單`,
      subtitle: `$${fmt(bill.total)} · ${urgLabel}（${bill.year}/${bill.month}/${bill.dueDay || 15}）`,
      note: '',
      date: `${bill.year}/${String(bill.month).padStart(2,'0')}/${String(bill.dueDay||15).padStart(2,'0')}`,
      isNew: true,
      actionLabel: '立即繳費',
      raw: bill,
    });
  });

  // ── 5. 月度預算超支警示（目前週期月超過 budgetPct%）─
  const { start: pStart, end: pEnd } = getBudgetPeriod();
  const periodTx = getTx().filter(tx => {
    const d = new Date(tx.at);
    return d >= pStart && d <= pEnd;
  });
  const catSpend = {};
  periodTx.forEach(tx => { catSpend[tx.cat] = (catSpend[tx.cat] || 0) + (tx.amount || 0); });
  const warningPct = getDiscord().budgetPct || 80;
  Object.keys(catSpend).forEach(catId => {
    const limit = getBudget(catId);
    if (!limit) return;
    const spent = catSpend[catId];
    const pct   = Math.round(spent / limit * 100);
    if (pct < warningPct) return;
    const notifId = `budget_${catId}_${todayYear}_${todayMonth}`;
    if (isInboxItemDismissed(notifId)) return;
    const icon = pct >= 100 ? '🚨' : '⚠️';
    items.push({
      id: notifId,
      type: 'budget_alert',
      icon,
      title: `${catName(catId) || catId} 預算${pct >= 100 ? '超支' : '快到了'}`,
      subtitle: `已用 $${fmt(spent)} / 預算 $${fmt(limit)}（${pct}%）`,
      note: '',
      date: todayStr,
      isNew: true,
      actionLabel: '查看報表',
      raw: { catId, spent, limit, pct },
    });
  });

  // ── 6. 儲蓄目標進度提醒（每月提醒未達成的目標）────────
  getGoals().forEach(goal => {
    const pct = goal.target ? Math.round((goal.current || 0) / goal.target * 100) : 0;
    if (pct >= 100) return;
    const notifId = `goal_${goal.id}_${todayYear}_${todayMonth}`;
    if (isInboxItemDismissed(notifId)) return;
    // 只在每月 1 日提醒（或第一次看到時）
    if (todayDay !== 1 && !getDismissedInbox().includes(notifId) && todayDay > 3) return;
    items.push({
      id: notifId,
      type: 'goal_reminder',
      icon: goal.icon || '🎯',
      title: `儲蓄目標：${goal.name}`,
      subtitle: `已存 $${fmt(goal.current || 0)} / 目標 $${fmt(goal.target)}（${pct}%）`,
      note: '',
      date: todayStr,
      isNew: true,
      actionLabel: '更新進度',
      raw: goal,
    });
  });

  // ── 7. 待確認請求回執（對方已確認你的請求）─────────────
  getMyInboxReceipts().forEach(rcpt => {
    items.push({
      id: rcpt.id,
      type: 'receipt',
      icon: '✅',
      title: `${rcpt.confirmedBy} 已確認記帳`,
      subtitle: `${catName(rcpt.cat) || rcpt.cat}${rcpt.detail ? ' · ' + rcpt.detail : ''} $${fmt(rcpt.amount)}`,
      note: '',
      date: rcpt.date || todayStr,
      isNew: true,
      actionLabel: '知道了',
      raw: rcpt,
    });
  });

  // 依建立時間排序（新 → 舊）
  items.sort((a,b) => {
    const ta = a.raw?.createdAt || 0;
    const tb = b.raw?.createdAt || 0;
    return tb - ta;
  });
  return items;
}

function getUnreadInboxCount() {
  return getInboxItems().length;
}

// ── 儲蓄目標追蹤 ─────────────────────────────────────
function getGoals()        { return DB.get('savings_goals') || []; }
function saveGoals(list)   { DB.set('savings_goals', list); }

function addGoal(goal) {
  const list = getGoals();
  goal.id        = 'goal_' + Date.now();
  goal.createdAt = Date.now();
  list.push(goal);
  saveGoals(list);
  return goal;
}
function updateGoal(id, patch) {
  const list = getGoals();
  const i = list.findIndex(g => g.id === id);
  if (i >= 0) { list[i] = { ...list[i], ...patch }; saveGoals(list); }
}
function deleteGoal(id) { saveGoals(getGoals().filter(g => g.id !== id)); }

// ── 待確認回執（對方完成後通知你）──────────────────────
function getInboxReceipts() {
  try { return JSON.parse(localStorage.getItem('inbox_receipts') || '[]'); } catch { return []; }
}
function saveInboxReceipts(list) { localStorage.setItem('inbox_receipts', JSON.stringify(list)); }

function addInboxReceipt(receipt) {
  const list = getInboxReceipts();
  receipt.id = 'rcpt_' + Date.now();
  receipt.createdAt = Date.now();
  receipt.isRead = false;
  list.unshift(receipt);
  saveInboxReceipts(list);
}

function getMyInboxReceipts() {
  const me = currentUser();
  return getInboxReceipts().filter(r => r.assignedTo === me && !r.isRead);
}

function clearInboxReceipt(id) {
  saveInboxReceipts(getInboxReceipts().map(r => r.id === id ? {...r, isRead: true} : r));
}

// ════════════════════════════════════════════════════
// 💬 家庭簡訊 (Chat Messages)
// Firestore path: shared/chat_messages → { list: [...] }
// localStorage key: chat_messages（全域共用，不加 uid prefix）
// 同步模型：Firestore server 為單一真相來源（single source of truth）
// ════════════════════════════════════════════════════

const CHAT_MAX_LEN = 500;  // 單則訊息字數上限

/** 統一的身份判斷：優先用 current_email，避免 auth 時序問題 */
function chatMe() {
  const email = localStorage.getItem('current_email') || '';
  if (email === 'kevin67222@gmail.com')      return '宏龍';
  if (email === 'gogosuperbird@gmail.com')   return '盈慧';
  return localStorage.getItem('current_user') || '';
}

function getChatMessages() {
  try {
    const list = JSON.parse(localStorage.getItem('chat_messages') || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function saveChatMessages(list) {
  localStorage.setItem('chat_messages', JSON.stringify(Array.isArray(list) ? list : []));
}

/** 新增一則訊息，回傳完整訊息物件（失敗回 null） */
function addChatMessage(text) {
  const me = chatMe();
  if (!me) return null;  // 身份未就緒，不寫入
  const clean = String(text || '').trim().slice(0, CHAT_MAX_LEN);
  if (!clean) return null;
  const list = getChatMessages();
  const msg = {
    id:        'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    from:      me,
    text:      clean,
    createdAt: Date.now(),
    readBy:    [me],  // 自己寄出就算自己已讀
  };
  list.push(msg);
  saveChatMessages(list);
  return msg;
}

/** 標記某則訊息為已讀（自己） */
function markChatMessageRead(msgId) {
  const me   = chatMe();
  if (!me) return false;
  const list = getChatMessages();
  const msg  = list.find(m => m.id === msgId);
  if (msg && !msg.readBy.includes(me)) {
    msg.readBy.push(me);
    saveChatMessages(list);
    return true;
  }
  return false;
}

/** 把所有「對方寄來、我還沒讀」的訊息標記為已讀，回傳是否有變動 */
function markAllChatMessagesRead() {
  const me = chatMe();
  if (!me) return false;
  const list = getChatMessages();
  let changed = false;
  list.forEach(m => {
    if (m.from !== me && !m.readBy.includes(me)) {
      m.readBy.push(me);
      changed = true;
    }
  });
  if (changed) saveChatMessages(list);
  return changed;
}

/** 刪除單則訊息（by id） */
function deleteChatMessage(msgId) {
  saveChatMessages(getChatMessages().filter(m => m.id !== msgId));
}

/** 清除全部訊息 */
function clearAllChatMessages() {
  saveChatMessages([]);
}

/** 取得「對我未讀」的訊息（別人寄的、我還沒讀的） */
function getUnreadChatMessages() {
  const me = chatMe();
  if (!me) return [];
  return getChatMessages().filter(m => m.from !== me && !m.readBy.includes(me));
}
