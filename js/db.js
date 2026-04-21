'use strict';
// ═══════════════════════════════════════════════════
//  db.js v7 — 完整個人財務資料層
//  支援：個人帳戶、共用帳戶、錢包、悠遊卡、信用卡帳單
//  資料依登入者隔離，共用記帳與家用帳戶除外
// ═══════════════════════════════════════════════════

const DB = {
  get(k)    { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  del(k)    { localStorage.removeItem(k); },
};

// 取得目前登入者 uid
// 統一用 email 前綴，確保手機/電腦/不同裝置都一致
function uid() {
  const e = localStorage.getItem('current_email') || '';
  if (e) return e.split('@')[0].replace(/[^a-z0-9]/gi,'_');
  // 最後 fallback
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

  // 個人資料（依登入者隔離）
  if (!DB.get(pKey('wal')))    DB.set(pKey('wal'),    {balance:0, history:[], updatedAt:0});
  if (!DB.get(pKey('cards')))  DB.set(pKey('cards'),  []);
  if (!DB.get(pKey('icards'))) DB.set(pKey('icards'), []);
  if (!DB.get(pKey('accts')))  DB.set(pKey('accts'),  []); // 銀行帳戶
  if (!DB.get(pKey('bills')))  DB.set(pKey('bills'),  []); // 信用卡帳單

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
  list.unshift(tx); DB.set('tx', list);
  // 自動扣款
  if (tx.pay === 'cash')  walOut(tx.amount, tx.detail || catName(tx.cat));
  if (tx.pay === 'icard' && tx.icardId) icardOut(tx.icardId, tx.amount, tx.detail || catName(tx.cat));
  if (tx.pay === 'card'  && tx.cardId)  cardAddBill(tx.cardId, tx.amount, tx.detail || catName(tx.cat), tx.at);
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
  }
}
function txByMonth(y, m) {
  return getTx().filter(t => { const d=new Date(t.at); return d.getFullYear()===y && d.getMonth()+1===m; });
}
function txByRange(f, e) {
  const s=new Date(f), en=new Date(e); en.setHours(23,59,59);
  return getTx().filter(t => { const d=new Date(t.at); return d>=s && d<=en; });
}
function txByPeriod() {
  const {start,end} = getBudgetPeriod();
  return getTx().filter(t => { const d=new Date(t.at); return d>=start && d<=end; });
}

// ── 個人錢包 ─────────────────────────────────────────
// 用時間戳記防止 Firebase 舊資料覆蓋新資料
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
// 從帳戶提領到錢包
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
function cardFind(id) { return getCards().find(c=>c.id===id) || null; }
function addCard(c)   { const l=getCards(); c.id='cc_'+Date.now().toString(36); l.push(c); DB.set(pKey('cards'),l); }
function delCard(id)  { DB.set(pKey('cards'), getCards().filter(c=>c.id!==id)); }

// 信用卡帳單邏輯
function getCardBills() { return DB.get(pKey('bills')) || []; }
function cardAddBill(cardId, amount, note, at) {
  const bills = getCardBills();
  const card  = cardFind(cardId); if (!card) return;
  // 找本期帳單（依信用卡結帳日分期）
  const cutDay = card.cutDay || 25; // 預設每月25日結帳
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
function icardFind(id) { return getIcards().find(c=>c.id===id) || null; }
function addIcard(c)   { const l=getIcards(); c.id='ic_'+Date.now().toString(36); c.balance=c.balance||0; c.history=[]; l.push(c); DB.set(pKey('icards'),l); return c; }
function delIcard(id)  { DB.set(pKey('icards'), getIcards().filter(c=>c.id!==id)); }
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
  DB.set(pKey('icards'),list);
}
function icardIn(id,amount,note){
  const list=getIcards(),idx=list.findIndex(c=>c.id===id);if(idx<0)return;
  list[idx].balance=(list[idx].balance||0)+amount;
  list[idx].history=list[idx].history||[];
  list[idx].history.unshift({type:'in',amount,note,time:new Date().toISOString()});
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

// ── Discord 設定 ─────────────────────────────────────
function getDiscord() {
  return DB.get('discord') || {webhook:'',onAdd:true,onDaily:true,dailyHour:21,onBudget:true,budgetPct:80,onWeekly:false};
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
  const cash=list.filter(x=>x.pay==='cash').reduce((s,x)=>s+x.amount,0);
  const card=list.filter(x=>x.pay==='card').reduce((s,x)=>s+x.amount,0);
  const icard=list.filter(x=>x.pay==='icard').reduce((s,x)=>s+x.amount,0);
  const byCat={},byCard={},byIcard={},byPerson={};
  list.forEach(x=>{
    byCat[x.cat]=(byCat[x.cat]||0)+x.amount;
    byPerson[x.person]=(byPerson[x.person]||0)+x.amount;
    if(x.pay==='card'&&x.cardId)  byCard[x.cardId] =(byCard[x.cardId]||0)+x.amount;
    if(x.pay==='icard'&&x.icardId)byIcard[x.icardId]=(byIcard[x.icardId]||0)+x.amount;
  });
  return {total,cash,card,icard,byCat,byCard,byIcard,byPerson};
}

// ── 資產總覽 ─────────────────────────────────────────
function calcNetWorth() {
  const wal = getWal().balance;
  const icTotal = getIcards().reduce((s,c)=>s+c.balance,0);
  const acTotal = getAccts(false).reduce((s,a)=>s+a.balance,0);
  const shTotal = getAccts(true).reduce((s,a)=>s+a.balance,0);
  const pendingBills = getPendingBills().reduce((s,b)=>s+b.total,0);
  return { wal, icTotal, acTotal, shTotal, pendingBills,
    total: wal + icTotal + acTotal + shTotal - pendingBills };
}

// ── 格式化 ────────────────────────────────────────────
function fmt(n)  { return Number(n||0).toLocaleString('zh-TW'); }
function fmtT(s) { const d=new Date(s); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function fmtD(s) { const d=new Date(s); return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`; }
function groupDay(list) {
  const g={};
  [...list].sort((a,b)=>new Date(b.at)-new Date(a.at)).forEach(t=>{
    const k=fmtD(t.at); if(!g[k])g[k]=[]; g[k].push(t);
  });
  return g;
}

// ── 清除 ─────────────────────────────────────────────
function clearAll() {
  const keys = Object.keys(localStorage).filter(k =>
    k.startsWith(uid()+'_') || ['tx','cats','budgets','hints','discord','prefs','shared_accts'].includes(k)
  );
  keys.forEach(k => localStorage.removeItem(k));
}

// ── 主題系統 ─────────────────────────────────────────
const ACCENTS={
  teal:{p:'#00e5b4',p2:'#00b48e',pdim:'rgba(0,229,180,.13)'},
  blue:{p:'#4f8ef7',p2:'#2563eb',pdim:'rgba(79,142,247,.13)'},
  pink:{p:'#f472b6',p2:'#db2777',pdim:'rgba(244,114,182,.13)'},
  purple:{p:'#a78bfa',p2:'#7c3aed',pdim:'rgba(167,139,250,.13)'},
  yellow:{p:'#fbbf24',p2:'#d97706',pdim:'rgba(251,191,36,.13)'},
  green:{p:'#4ade80',p2:'#16a34a',pdim:'rgba(74,222,128,.13)'},
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
