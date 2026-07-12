'use strict';
// ═══════════════════════════════════════════════════
//  db.js v8 — 完整個人財務資料層
//  支援：個人帳戶、共用帳戶、錢包、悠遊卡、信用卡帳單
//  v8 新增：消費標籤(tags)、快捷範本(shortcuts)
//  資料依登入者隔離，共用記帳與家用帳戶除外
// ═══════════════════════════════════════════════════

// 共用 XSS 跳脫工具：把使用者輸入的文字安全地放進 innerHTML
// 用法：`<div>${escapeHTML(userText)}</div>`
function escapeHTML(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// 放進 onclick='fn("...")' 這種字串參數時的跳脫（避免引號截斷與注入）
function escapeAttr(s) {
  if (s == null) return '';
  return escapeHTML(s).replace(/`/g, '&#96;');
}

// v14.1（#10）：DB 層對 'tx' 做針對性記憶體快取。
// 背景：getTx() 全案數十處呼叫，每次 DB.get 都 JSON.parse 整包交易，資料量大時每次 render 都重複解析、成本線性上升。
// 只快取 tx（不快取其他 key）——因為已確認所有 tx 寫入都走 DB.set('tx',...)，快取能保證一致；
// 其他 key 有不少地方直接 localStorage.setItem 繞過 DB，若一律快取反而會讀到過期資料。
let _txCache = { raw: null, parsed: null };
const DB = {
  get(k)    {
    if (k === 'tx') {
      const raw = localStorage.getItem('tx');
      if (raw === _txCache.raw && _txCache.parsed !== null) return _txCache.parsed; // 命中快取
      try { _txCache = { raw, parsed: JSON.parse(raw) }; return _txCache.parsed; }
      catch { _txCache = { raw: null, parsed: null }; return null; }
    }
    try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
  },
  set(k, v) {
    const str = JSON.stringify(v);
    localStorage.setItem(k, str);
    if (k === 'tx') _txCache = { raw: str, parsed: v }; // 寫入同步更新快取
  },
  del(k)    { localStorage.removeItem(k); if (k === 'tx') _txCache = { raw: null, parsed: null }; },
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
  // v14.1：寫入時間戳（與 at 消費時間分開，因為 at 可能被填成過去日期，不能拿來判斷「是不是新寫入」）。
  //   createdAt：建立時間，供 Firestore 增量查詢抓「新增」。
  //   updatedAt：每次寫入/編輯都更新，供偵測「編輯」（見 touchTx）。
  tx.createdAt = Date.now();
  tx.updatedAt = Date.now();
  if (!tx.tags) tx.tags = [];
  list.unshift(tx); DB.set('tx', list);
  // 自動扣款
  if (tx.pay === 'cash')  walOut(tx.amount, tx.detail || catName(tx.cat));
  if (tx.pay === 'icard' && tx.icardId) icardOut(tx.icardId, tx.amount, tx.detail || catName(tx.cat));
  if (tx.pay === 'card'  && tx.cardId)  cardAddBill(tx.cardId, tx.amount, tx.detail || catName(tx.cat), tx.at, tx.id);
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
// v14.1：編輯交易後呼叫，更新 updatedAt，讓其他裝置的增量同步（where updatedAt > lastPull）能抓到這筆編輯。
// 回傳更新後的 tx 物件，方便呼叫端拿去 fbAddTx 同步。
function touchTx(id) {
  const list = getTx();
  const idx = list.findIndex(t => t.id === id);
  if (idx < 0) return null;
  list[idx].updatedAt = Date.now();
  DB.set('tx', list);
  return list[idx];
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

// 把一筆 tx 的 tags(id陣列) 轉成中文標籤字串，例如「衝動消費、情緒消費、想要」
// 去掉 label 前面的 emoji，只留文字，給 AI prompt 用（emoji 對語意理解無益且占 token）
function tagLabels(tx) {
  const ids = (tx && tx.tags) || [];
  if (!ids.length) return '';
  const tags = getTxTags();
  return ids
    .map(id => {
      const t = tags.find(x => x.id === id);
      if (!t) return '';
      // 移除開頭 emoji 與空白，只保留中文
      return t.label.replace(/^[^\u4e00-\u9fff]+/, '').trim();
    })
    .filter(Boolean)
    .join('、');
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
const WAL_HISTORY_LIMIT = 300;
// v14.1（#10）：錢包 history 原本無上限，每筆現金收支都 unshift 永久累積，長期會膨脹拖慢解析。
// 在統一寫入點 _saveWal 加 trim：保留最近紀錄，把更舊的折疊成一筆檢查點（記錄折疊當下的累計餘額變化）。
// 錢包 history 只有 in/out 兩型，折疊後補一筆 note 標記，不影響 balance（balance 另存於 w.balance）。
function _trimWalHistory(w) {
  if (!w || !Array.isArray(w.history) || w.history.length <= WAL_HISTORY_LIMIT) return;
  const keepRecent = w.history.slice(0, WAL_HISTORY_LIMIT - 1);
  const older = w.history.slice(WAL_HISTORY_LIMIT - 1);
  let net = 0;
  older.forEach(e => {
    const amt = Number(e.amount) || 0;
    if (e.type === 'in') net += amt;
    else if (e.type === 'out') net -= amt;
  });
  const oldestTime = older.length ? older[older.length - 1].time : new Date().toISOString();
  keepRecent.push({
    type: net >= 0 ? 'in' : 'out',
    amount: Math.abs(net),
    note: `歷史彙整（${older.length} 筆）`,
    time: oldestTime,
    _archived: true,
  });
  w.history = keepRecent;
}
function _saveWal(w) {
  w.updatedAt = Date.now();
  _trimWalHistory(w);
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
function addCard(c)   { const l=getCards(); c.id='cc_'+Date.now().toString(36); c.owner=uid(); c._localTs=Date.now(); l.push(c); DB.set(pKey('cards'),l); }
function editCard(id, updates) {
  const now = Date.now();
  const l = getCards().map(c => c.id===id ? {...c, ...updates, _localTs: now} : c);
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
function cardAddBill(cardId, amount, note, at, txId) {
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
  // 用交易的 tx.id 當帳單明細的 txId，刪除交易時才對得回來（沒傳則給 auto_ 前綴）
  // 同時記錄這張卡的實際持有者 owner（共用卡可追溯帳單真正歸屬，報表可區分消費者 vs 卡主）
  bill.items.unshift({
    txId: txId || ('auto_'+Date.now().toString(36)),
    amount, note, at: now.toISOString(),
    cardOwner: card.owner || uid(),
    spentBy: uid(),
  });
  DB.set(pKey('bills'), bills);
}
function cardVoidBill(cardId, amount, txId) {
  const bills = getCardBills();
  let removed = false;
  // 第一輪：用 txId 精準刪除
  for (const b of bills) {
    if (b.cardId !== cardId) continue;
    const before = b.items.length;
    b.items = b.items.filter(i => i.txId !== txId);
    if (b.items.length < before) { b.total = b.items.reduce((s,i)=>s+i.amount, 0); removed = true; break; }
  }
  // 第二輪 fallback：舊帳單的 txId 是亂數對不上 → 用「金額」弱匹配刪「一筆」
  // （優先未繳帳單，且只刪一筆，避免誤刪多筆相同金額）
  if (!removed) {
    for (const b of bills) {
      if (b.cardId !== cardId || b.paid) continue;
      const idx = b.items.findIndex(i => i.amount === amount);
      if (idx >= 0) { b.items.splice(idx, 1); b.total = b.items.reduce((s,i)=>s+i.amount, 0); removed = true; break; }
    }
  }
  DB.set(pKey('bills'), bills.filter(b=>b.items.length>0||b.paid));
}
function cardPayBill(billId, fromType, fromId) {
  const bills = getCardBills();
  const bill  = bills.find(b => b.id === billId); if (!bill) return;
  if (fromType === 'wallet') walOut(bill.total, `信用卡繳費 ${bill.month}月帳單`);
  if (fromType === 'acct') {
    const isShared = fromId.startsWith('shared_');
    acctOut(isShared ? fromId.replace('shared_','') : fromId,
            bill.total, `信用卡繳費 ${bill.month}月帳單`, isShared);
  }
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
const ICARD_HISTORY_LIMIT = 200;
function _trimIcardHistory(card) {
  if (!card || !Array.isArray(card.history) || card.history.length <= ICARD_HISTORY_LIMIT) return;
  // history 是新到舊；保留最近紀錄，並在尾端放一筆舊資料彙整後的 set 檢查點，
  // 讓回復餘額仍可從檢查點往後完整重建。
  const keepRecent = card.history.slice(0, ICARD_HISTORY_LIMIT - 1);
  const older = card.history.slice(ICARD_HISTORY_LIMIT - 1).reverse();
  let bal = 0;
  older.forEach(e => {
    const amt = Number(e.amount) || 0;
    if (e.type === 'set') bal = amt;
    else if (e.type === 'topup' || e.type === 'in') bal += amt;
    else if (e.type === 'out') bal = Math.max(0, bal - amt);
  });
  keepRecent.push({type:'set', amount:bal, note:'歷史彙整', time:new Date().toISOString()});
  card.history = keepRecent;
}
function addIcard(c)   {
  const l=getIcards();
  c.id='ic_'+Date.now().toString(36);
  c.balance=Number(c.balance)||0;
  c.history=[];
  if(c.balance>0) c.history.unshift({type:'set', amount:c.balance, note:'初始餘額', time:new Date().toISOString()});
  c.owner=uid(); c._localTs=Date.now();
  l.push(c); DB.set(pKey('icards'),l); return c;
}
function editIcard(id, updates) {
  const now = Date.now();
  const l = getIcards().map(c => c.id===id ? {...c, ...updates, _localTs: now} : c);
  DB.set(pKey('icards'), l);
}
function icardSetBalance(id, amount, note) {
  const list=getIcards(), idx=list.findIndex(c=>c.id===id); if(idx<0)return null;
  const n = Math.max(0, Number(amount)||0);
  list[idx].balance=n;
  list[idx].history=list[idx].history||[];
  list[idx].history.unshift({type:'set',amount:n,note:note||'手動校正',time:new Date().toISOString()});
  list[idx]._localTs=Date.now();
  _trimIcardHistory(list[idx]);
  DB.set(pKey('icards'),list);
  return list[idx];
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
  list[idx]._localTs=Date.now();
  _trimIcardHistory(list[idx]);
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
  _trimIcardHistory(list[idx]);
  DB.set(pKey('icards'),list);
}
function icardIn(id,amount,note){
  const list=getIcards(),idx=list.findIndex(c=>c.id===id);if(idx<0)return;
  list[idx].balance=(list[idx].balance||0)+amount;
  list[idx].history=list[idx].history||[];
  list[idx].history.unshift({type:'in',amount,note,time:new Date().toISOString()});
  list[idx]._localTs=Date.now();
  _trimIcardHistory(list[idx]);
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

  const memoRaw = DB.get('shared_memos') || [];
  const memoMap = new Map(); memoRaw.forEach(m=>{ if(!memoMap.has(m.id)) memoMap.set(m.id,m); });
  DB.set('shared_memos', [...memoMap.values()]);

  console.log(`[fixDuplicates] 私密記帳: ${txRaw.length}→${txMap.size}, 備忘錄: ${memoRaw.length}→${memoMap.size}`);
  return { txBefore: txRaw.length, txAfter: txMap.size, memoBefore: memoRaw.length, memoAfter: memoMap.size };
}

function getMemos() {
  const SHARED_KEY = 'shared_memos';
  // 一次性遷移：舊 pPrivKey('memos') → shared_memos（讓盈慧也能看到 Kevin 原有的備忘錄）
  try {
    const oldKey = pPrivKey('memos');
    const oldRaw = DB.get(oldKey) || [];
    const wrongKey = 'db_priv_' + uid() + '_memos';
    const wrongRaw = localStorage.getItem(wrongKey);
    const wrongList = wrongRaw ? (JSON.parse(wrongRaw)||[]) : [];
    const sharedCur = DB.get(SHARED_KEY) || [];
    const allSrc = [...sharedCur, ...oldRaw, ...wrongList];
    if (oldRaw.length || wrongList.length) {
      const map = new Map();
      allSrc.forEach(m=>{ if(!map.has(m.id)) map.set(m.id,m); });
      DB.set(SHARED_KEY, [...map.values()]);
      DB.set(oldKey, []);                         // 清舊私有 key
      if (wrongRaw) localStorage.removeItem(wrongKey);
      console.log('[Migration] 備忘錄已遷移至共用存儲 shared_memos');
    }
  } catch(e) { console.warn('[Migration] memos 遷移失敗:', e); }

  const raw = DB.get('shared_memos') || [];
  const map = new Map(); raw.forEach(m=>{ if(!map.has(m.id)) map.set(m.id,m); });
  return [...map.values()];
}
function addMemo(m) {
  const list = getMemos();
  m.id     = 'memo_'+Date.now().toString(36);
  m.at     = new Date().toISOString();
  m.author = m.author || (typeof currentUser==='function' ? currentUser() : '');
  if (list.find(x=>x.id===m.id)) return m;
  list.unshift(m);
  DB.set('shared_memos', list);
  return m;
}
function editMemo(id, updates) {
  const editedBy = typeof currentUser==='function' ? currentUser() : '';
  DB.set('shared_memos', getMemos().map(m=>m.id===id?{...m,...updates,updatedAt:new Date().toISOString(),editedBy}:m));
}
function delMemo(id)  { DB.set('shared_memos', getMemos().filter(m=>m.id!==id)); }
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

// ── 每週預算把關 ──────────────────────────────────────
// 將「週期月」的分類月預算，依「本週落在週期月內的實際天數比例」拆成週預算
// 例：週期月 6/10~7/9（30天），本週一 6/8 ~ 週日 6/14，交集為 6/10~6/14 共 5 天
//     飲食月預算 12000 → 本週預算 = 12000 × (5/30) = 2000
function getWeekBudget(now) {
  now = now || new Date();
  // 1) 本週範圍（週一 ~ 週日）
  const dow = now.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const weekStart = new Date(now); weekStart.setDate(now.getDate()+mondayOffset); weekStart.setHours(0,0,0,0);
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate()+6); weekEnd.setHours(23,59,59,999);

  // 2) 週期月範圍與總天數（日期歸零計算，避免 end 的 23:59:59 進位多一天）
  const { start: pStart, end: pEnd } = getBudgetPeriod(now);
  const _d0 = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const periodDays = Math.round((_d0(pEnd) - _d0(pStart)) / 86400000) + 1;

  // 3) 本週 ∩ 週期月 的交集天數（避免跨期時把上/下期天數也算進來）
  const segStart = weekStart > pStart ? weekStart : pStart;
  const segEnd   = weekEnd   < pEnd   ? weekEnd   : pEnd;
  let overlapDays = 0;
  if (segEnd >= segStart) {
    const a = new Date(segStart); a.setHours(0,0,0,0);
    const b = new Date(segEnd);   b.setHours(0,0,0,0);
    overlapDays = Math.round((b - a) / 86400000) + 1;
  }
  const ratio = periodDays > 0 ? (overlapDays / periodDays) : 0;

  // 4) 本週實際花費（依分類，只計落在交集區間的交易）
  const allTx = getTx();
  const weekTx = allTx.filter(t => { const d = new Date(t.at); return d >= weekStart && d <= weekEnd; });

  // 5) 每個「有設定預算」的分類，計算週預算與已花
  const cfg = getBudgetConfig();
  const items = cfg.items || {};
  const results = [];
  getCats().forEach(cat => {
    const monthLimit = items[cat.id]?.limit || 0;
    if (!monthLimit) return; // 只顯示有設定預算的分類
    const weekLimit = Math.round(monthLimit * ratio);
    const spent = weekTx.filter(t => t.cat === cat.id).reduce((s,t)=>s+t.amount, 0);
    const remaining = weekLimit - spent;
    const pct = weekLimit > 0 ? Math.round(spent / weekLimit * 100) : 0;
    // 號誌：<70% 綠、70~99% 黃、>=100% 紅
    const light = pct >= 100 ? 'red' : pct >= 70 ? 'yellow' : 'green';
    results.push({ cat, monthLimit, weekLimit, spent, remaining, pct, light });
  });
  results.sort((a,b) => b.pct - a.pct);

  // 6) 累積結餘（預算結轉核心）：從週期月起始到「今天」，應花 vs 實花
  //    應花預算 = 月預算 × (已過天數 / 週期月總天數)
  //    讓使用者看清整個月到目前為止是超前還是落後，不只看單週
  const todayEnd = new Date(now); todayEnd.setHours(23,59,59,999);
  const elapsedStart = _d0(pStart);
  const elapsedToday = _d0(now);
  const daysElapsedInPeriod = Math.min(
    periodDays,
    Math.max(1, Math.round((elapsedToday - elapsedStart) / 86400000) + 1)
  );
  const periodTx = allTx.filter(t => { const d = new Date(t.at); return d >= pStart && d <= todayEnd; });
  const cumResults = results.map(r => {
    const shouldSpend = Math.round(r.monthLimit * (daysElapsedInPeriod / periodDays));
    const actualSpent = periodTx.filter(t => t.cat === r.cat.id).reduce((s,t)=>s+t.amount, 0);
    const balance = shouldSpend - actualSpent; // 正=超前(省)，負=落後(超支)
    return { cat: r.cat, monthLimit: r.monthLimit, shouldSpend, actualSpent, balance };
  });
  const cumTotalShould = cumResults.reduce((s,r)=>s+r.shouldSpend, 0);
  const cumTotalActual = cumResults.reduce((s,r)=>s+r.actualSpent, 0);
  const cumTotalBalance = cumTotalShould - cumTotalActual;

  return {
    weekStart, weekEnd, periodStart: pStart, periodEnd: pEnd,
    periodDays, overlapDays, ratio, daysElapsedInPeriod,
    results,
    totalWeekLimit: results.reduce((s,r)=>s+r.weekLimit, 0),
    totalSpent:     results.reduce((s,r)=>s+r.spent, 0),
    // 累積結餘（結轉）
    cumResults, cumTotalShould, cumTotalActual, cumTotalBalance,
  };
}

// ── 預算超支歷史（回溯過去 N 個週期月的達成率）──────────
function getBudgetHistory(monthsBack=6) {
  const items = getBudgetConfig().items || {};
  const budgetedCats = Object.keys(items).filter(id => (items[id]?.limit||0) > 0);
  if (!budgetedCats.length) return { periods: [], cats: [] };

  const allTx = getTx();
  const periods = [];
  // 從本週期月往前回溯
  let ref = new Date();
  for (let i = 0; i < monthsBack; i++) {
    const { start, end } = getBudgetPeriod(ref);
    const periodTx = allTx.filter(t => { const d = new Date(t.at); return d >= start && d <= end; });
    const catData = {};
    budgetedCats.forEach(cid => {
      const limit = items[cid].limit;
      const spent = periodTx.filter(t => t.cat === cid).reduce((s,t)=>s+t.amount, 0);
      catData[cid] = { limit, spent, pct: limit > 0 ? Math.round(spent/limit*100) : 0, over: spent > limit };
    });
    periods.unshift({
      label: `${start.getMonth()+1}/${start.getDate()}`,
      startISO: toLocalISO(start),
      catData,
      totalLimit: budgetedCats.reduce((s,c)=>s+items[c].limit, 0),
      totalSpent: budgetedCats.reduce((s,c)=>s+(catData[c].spent), 0),
    });
    // 往前一個週期月
    ref = new Date(start.getTime() - 86400000);
  }

  // 每個分類的超支次數統計
  const cats = budgetedCats.map(cid => ({
    id: cid,
    name: catName(cid) || cid,
    limit: items[cid].limit,
    overCount: periods.filter(p => p.catData[cid]?.over).length,
    avgPct: Math.round(periods.reduce((s,p)=>s+(p.catData[cid]?.pct||0), 0) / periods.length),
  }));

  return { periods, cats };
}

// ── 訂閱服務偵測 ──────────────────────────────────────────
// 偵測「每月固定金額的重複支出」（非固定支出設定）
// 條件：同 detail、相似金額（±5%）、間隔 25~35 天，出現 ≥ 2 次
function detectSubscriptions() {
  const allTx = getTx().slice().sort((a, b) => new Date(a.at) - new Date(b.at));
  const groups = {};
  allTx.forEach(t => {
    const key = (t.detail || '').trim().toLowerCase();
    if (!key || key.length < 2) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ at: new Date(t.at), amount: t.amount, detail: t.detail });
  });

  const subs = [];
  for (const [key, txs] of Object.entries(groups)) {
    if (txs.length < 2) continue;
    // 找相鄰筆中間隔 25~35 天且金額 ±10% 的對
    let matchPairs = 0;
    for (let i = 1; i < txs.length; i++) {
      const dayGap = (txs[i].at - txs[i-1].at) / 86400000;
      const amtRatio = txs[i].amount / txs[i-1].amount;
      if (dayGap >= 25 && dayGap <= 40 && amtRatio >= 0.9 && amtRatio <= 1.1) matchPairs++;
    }
    if (matchPairs < 1) continue;
    const avgAmt = Math.round(txs.reduce((s, t) => s + t.amount, 0) / txs.length);
    const lastAt = txs[txs.length - 1].at;
    subs.push({
      name:      txs[0].detail,
      avgAmt,
      count:     txs.length,
      yearCost:  avgAmt * 12,
      lastAt:    toLocalISO(lastAt),
      matchPairs,
    });
  }
  return subs.sort((a, b) => b.yearCost - a.yearCost).slice(0, 10);
}

// ── 月度財務體檢 ──────────────────────────────────────────
// 產生上一個完整週期月的綜合健康度分數（0~100）與評語
function getMonthlyHealthReport() {
  const now   = new Date();
  const curP  = getBudgetPeriod(now);
  const lastP = getBudgetPeriod(new Date(curP.start.getTime() - 86400000));

  const allTx = getTx();
  const ptx   = allTx.filter(t => { const d=new Date(t.at); return d>=lastP.start && d<=lastP.end; });
  const incomes = getIncomes().filter(i => { const d=new Date(i.at||''); return d>=lastP.start && d<=lastP.end; });

  const totalSpent  = ptx.reduce((s,t)=>s+t.amount, 0);
  const totalIncome = incomes.reduce((s,i)=>s+(i.amount||0), 0);
  const savingsRate = totalIncome > 0 ? Math.round((totalIncome - totalSpent) / totalIncome * 100) : null;

  // 淨資產計算
  const nw = typeof calcNetWorth === 'function' ? calcNetWorth() : null;

  // 預算達成率
  const budItems = getBudgetConfig().items || {};
  const cats = Object.keys(budItems).filter(id => (budItems[id]?.limit||0) > 0);
  let budScore = 100;
  if (cats.length) {
    const overCount = cats.filter(cid => {
      const spent = ptx.filter(t=>t.cat===cid).reduce((s,t)=>s+t.amount,0);
      return spent > budItems[cid].limit;
    }).length;
    budScore = Math.round((cats.length - overCount) / cats.length * 100);
  }

  // 衝動消費比例
  const IMPULSE = new Set(['impulse','emotion','social']);
  const impulseAmt = ptx.filter(t=>(t.tags||[]).some(id=>IMPULSE.has(id))).reduce((s,t)=>s+t.amount,0);
  const impulseRate = totalSpent > 0 ? Math.round(impulseAmt / totalSpent * 100) : 0;

  // 綜合分數（加權）
  const savScore    = savingsRate !== null ? Math.min(Math.max(savingsRate, 0), 40) : 20; // 儲蓄率 40%
  const budScoreW   = budScore * 0.35;   // 預算紀律 35%
  const impulseW    = Math.max(0, 25 - impulseRate); // 衝動消費 25%
  const totalScore  = Math.round(savScore + budScoreW + impulseW);

  const label =
    totalScore >= 85 ? { grade:'A', emoji:'🌟', msg:'財務狀況非常健康，繼續保持！' }
  : totalScore >= 70 ? { grade:'B', emoji:'👍', msg:'整體良好，個別分類有改善空間。' }
  : totalScore >= 55 ? { grade:'C', emoji:'⚠️', msg:'部分指標偏弱，建議重點改善預算控管。' }
  :                    { grade:'D', emoji:'🔴', msg:'財務壓力較大，建議仔細檢視支出結構。' };

  return {
    period: `${lastP.start.getMonth()+1}/${lastP.start.getDate()} ～ ${lastP.end.getMonth()+1}/${lastP.end.getDate()}`,
    totalSpent, totalIncome, savingsRate,
    budScore, impulseRate,
    totalScore, label,
    netWorth: nw?.total || null,
    txCount: ptx.length,
  };
}

// ── 週目標挑戰（連續達標紀錄）────────────────────────────
// 每週預算把關達標（總花費 < 本週預算額度）= +1 streak
// 資料存 localStorage 'week_challenge'，格式 [{weekKey, reached, pct}]
function getWeekChallenge() {
  try { return JSON.parse(localStorage.getItem('week_challenge') || '[]'); } catch { return []; }
}
function saveWeekChallenge(list) { localStorage.setItem('week_challenge', JSON.stringify(list)); }
// 計算連續達標週數
function getWeekStreak() {
  const list = getWeekChallenge().slice().reverse(); // 最新在前
  let streak = 0;
  for (const w of list) {
    if (w.reached) streak++;
    else break;
  }
  return streak;
}
// 每次進報表頁時呼叫，更新本週達標狀態
function updateWeekChallengeStatus() {
  const wb = typeof getWeekBudget === 'function' ? getWeekBudget() : null;
  if (!wb || !wb.results.length) return;
  // weekKey = YYYY-Www（ISO週號）
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  const weekKey = `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  const pct = wb.totalWeekLimit > 0 ? Math.round(wb.totalSpent / wb.totalWeekLimit * 100) : 0;
  const reached = pct <= 100 && wb.daysElapsedInPeriod > 0;
  // 僅在週末（週日or週六）才記錄，避免週中重複計算
  // 改為：只在 daysLeft === 0 或 daysLeft === 1 時更新（本週最後2天）
  const list = getWeekChallenge();
  const existing = list.findIndex(w => w.weekKey === weekKey);
  const entry = { weekKey, reached, pct, updatedAt: now.toISOString() };
  if (existing >= 0) list[existing] = entry;
  else list.push(entry);
  // 只保留最近 12 週
  saveWeekChallenge(list.slice(-12));
}

// ── 消費日型態分析 ────────────────────────────────────────
// 統計週一到週日的平均支出，找出爆量日
function getDayPatternStats(txList) {
  const DOW = ['週日','週一','週二','週三','週四','週五','週六'];
  const buckets = Array.from({length:7}, () => ({ total:0, count:0, weeks:new Set() }));
  (txList||getTx()).forEach(t => {
    const d = new Date(t.at);
    const dow = d.getDay();
    const weekKey = `${d.getFullYear()}_${Math.floor((d.getDate()-1)/7)}_${d.getMonth()}`;
    buckets[dow].total += t.amount;
    buckets[dow].count++;
    buckets[dow].weeks.add(weekKey);
  });
  const results = buckets.map((b, i) => ({
    day:     DOW[i],
    dowIdx:  i,
    total:   b.total,
    count:   b.count,
    weekCnt: b.weeks.size,
    avg:     b.weeks.size > 0 ? Math.round(b.total / b.weeks.size) : 0,
  }));
  // 找爆量日：均值超過整體均值 1.5 倍
  const overallAvg = results.reduce((s,r)=>s+r.avg,0) / 7;
  results.forEach(r => { r.isHot = overallAvg > 0 && r.avg > overallAvg * 1.5; });
  return results;
}

// ── 商家價格追蹤 ──────────────────────────────────────────
// 回傳指定商家（detail 模糊匹配）的歷次消費記錄，可用於折線圖
function getMerchantPriceHistory(merchantName, maxRecords = 30) {
  if (!merchantName) return [];
  const q = merchantName.toLowerCase().trim();
  return getTx()
    .filter(t => t.detail && t.detail.toLowerCase().includes(q))
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .slice(-maxRecords)
    .map(t => ({
      date:   (t.at || '').slice(0, 10),
      amount: t.amount,
      detail: t.detail,
      cat:    t.cat,
    }));
}

// 回傳前 N 大商家，各含最近 price history（供報表頁商家排行點開後顯示）
function getTopMerchantsWithTrend(txList, topN = 10) {
  const groups = {};
  for (const tx of txList) {
    const d = (tx.detail || '').trim();
    if (!d || d.length < 2) continue;
    if (!groups[d]) groups[d] = { name: d, total: 0, count: 0, txList: [] };
    groups[d].total  += tx.amount;
    groups[d].count  += 1;
    groups[d].txList.push(tx);
  }
  return Object.values(groups)
    .sort((a, b) => b.total - a.total)
    .slice(0, topN)
    .map(g => {
      const sorted = g.txList.sort((a, b) => new Date(a.at) - new Date(b.at));
      const amounts = sorted.map(t => t.amount);
      // 偵測漲價：最近3次均值 vs 更早均值
      let trend = 'stable';
      if (amounts.length >= 4) {
        const recent = amounts.slice(-3).reduce((s, a) => s + a, 0) / 3;
        const older  = amounts.slice(0, -3).reduce((s, a) => s + a, 0) / (amounts.length - 3);
        if (recent > older * 1.15) trend = 'up';
        else if (recent < older * 0.85) trend = 'down';
      }
      return { name: g.name, total: g.total, count: g.count, avg: Math.round(g.total / g.count), trend, history: sorted.map(t => ({ date: (t.at||'').slice(0,10), amount: t.amount })) };
    });
}

// ── 資料健康檢查 ──────────────────────────────────────────
// 偵測常見資料異常，回傳 { issues: [...], summary }，不自動修改任何資料
function runHealthCheck() {
  const issues = [];
  const add = (level, title, detail, fixable=false, fixKey=null) =>
    issues.push({ level, title, detail, fixable, fixKey });

  // 1) 交易 id 重複
  try {
    const tx = getTx();
    const seen = new Set(), dup = new Set();
    tx.forEach(t => { if (seen.has(t.id)) dup.add(t.id); else seen.add(t.id); });
    if (dup.size) add('warn', '交易記錄有重複 ID', `共 ${dup.size} 個重複 ID（可能因多次匯入造成）`, true, 'dedupeTx');
  } catch(e) {}

  // 2) 交易缺少必要欄位
  try {
    const bad = getTx().filter(t => !t.at || typeof t.amount !== 'number' || !t.pay);
    if (bad.length) add('warn', '交易缺少必要欄位', `${bad.length} 筆交易缺少日期/金額/付款方式`, false);
  } catch(e) {}

  // 3) 分期 paidMonths 與 paidCount 不一致
  try {
    const insts = getInstallments();
    const mismatch = insts.filter(i => (i.paidMonths||[]).length !== (i.paidCount||0));
    if (mismatch.length) add('warn', '分期已繳期數不一致', `${mismatch.length} 筆分期的 paidMonths 與 paidCount 對不上`, true, 'fixInstPaidCount');
  } catch(e) {}

  // 4) 分期已全繳但仍標記 active
  try {
    const stuck = getInstallments().filter(i =>
      i.status === 'active' && (i.paidMonths||[]).length >= (i.months||i.totalMonths||0) && (i.months||i.totalMonths||0) > 0);
    if (stuck.length) add('warn', '分期已繳完未結案', `${stuck.length} 筆分期已全部繳清但仍為進行中`, true, 'closeFinishedInst');
  } catch(e) {}

  // 5) 帳戶餘額 vs 歷史加總（僅提示，不自動改）
  try {
    [...getAccts(false), ...getAccts(true)].forEach(a => {
      if (!Array.isArray(a.history)) return;
      const net = a.history.reduce((s,h) => s + (h.type==='in' ? h.amount : -h.amount), 0);
      // 帳戶可能有初始餘額，故只在差距極大時提示
      if (Math.abs((a.balance||0) - net) > 0 && a.history.length > 0) {
        // 不一定是錯（有初始餘額），列為 info
        // 略過：太容易誤報，改不列入
      }
    });
  } catch(e) {}

  // 6) 信用卡帳單 total 為負或 NaN
  try {
    const badBills = getCardBills().filter(b => typeof b.total !== 'number' || b.total < 0 || isNaN(b.total));
    if (badBills.length) add('warn', '信用卡帳單金額異常', `${badBills.length} 筆帳單金額為負或非數字`, false);
  } catch(e) {}

  // 7) 預算設定指向不存在的分類
  try {
    const catIds = new Set(getCats().map(c => c.id));
    const cfg = getBudgetConfig().items || {};
    const orphan = Object.keys(cfg).filter(id => !catIds.has(id));
    if (orphan.length) add('info', '預算指向已刪除分類', `${orphan.length} 個預算設定對應的分類已不存在`, true, 'cleanOrphanBudget');
  } catch(e) {}

  // 8) 固定支出/收入指向不存在分類
  try {
    const catIds = new Set(getCats().map(c => c.id));
    const badRec = getRecurring().filter(r => r.type !== 'income' && r.cat && !catIds.has(r.cat));
    if (badRec.length) add('info', '固定支出分類失效', `${badRec.length} 筆固定支出對應的分類已不存在`, false);
  } catch(e) {}

  // 9) 收入記錄重複偵測（同一天、同來源、同金額出現 2 次以上）
  try {
    const incList = getIncomes();
    const incKey  = i => `${(i.at||'').slice(0,10)}_${i.source||''}_${i.amount||0}`;
    const incSeen = new Map();
    incList.forEach(i => { const k=incKey(i); incSeen.set(k,(incSeen.get(k)||0)+1); });
    const dupInc = [...incSeen.entries()].filter(([,c])=>c>1);
    if (dupInc.length) add('warn','收入記錄可能重複',
      `有 ${dupInc.length} 組相同（日期+來源+金額）的收入記錄，可能是固定收入被確認了兩次`,
      false);
  } catch(e) {}

  // 10) 本機 vs Firebase 交易筆數落差（比較 localStorage 與最後同步筆數）
  try {
    const localCount  = getTx().length;
    const lastSyncKey = 'fb_last_tx_count';
    const lastSync    = parseInt(localStorage.getItem(lastSyncKey) || '0');
    if (lastSync > 0 && Math.abs(localCount - lastSync) > 5) {
      add('info', '本機與 Firebase 筆數落差',
        `本機 ${localCount} 筆，上次同步記錄 ${lastSync} 筆，差距 ${Math.abs(localCount-lastSync)} 筆。`
        + '可到「設定→資料→健康檢查」下方點「強制同步」確認。', false);
    }
  } catch(e) {}

  const errCount  = issues.filter(i => i.level==='error').length;
  const warnCount = issues.filter(i => i.level==='warn').length;
  const infoCount = issues.filter(i => i.level==='info').length;
  return {
    issues,
    summary: { total: issues.length, error: errCount, warn: warnCount, info: infoCount },
    healthy: issues.length === 0,
  };
}

// 修復動作（依 fixKey 執行，回傳修復筆數）
function runHealthFix(fixKey) {
  if (fixKey === 'dedupeTx') {
    const tx = getTx(), seen = new Set(), out = [];
    tx.forEach(t => { if (!seen.has(t.id)) { seen.add(t.id); out.push(t); } });
    const removed = tx.length - out.length;
    DB.set('tx', out);
    return removed;
  }
  if (fixKey === 'fixInstPaidCount') {
    const list = getInstallments(); let n = 0;
    list.forEach(i => { const c=(i.paidMonths||[]).length; if(i.paidCount!==c){i.paidCount=c;n++;} });
    saveInstallments(list);
    return n;
  }
  if (fixKey === 'closeFinishedInst') {
    const list = getInstallments(); let n = 0;
    list.forEach(i => {
      const m=(i.months||i.totalMonths||0);
      if (i.status==='active' && m>0 && (i.paidMonths||[]).length>=m) { i.status='completed'; n++; }
    });
    saveInstallments(list);
    return n;
  }
  if (fixKey === 'cleanOrphanBudget') {
    const catIds = new Set(getCats().map(c => c.id));
    const cfg = getBudgetConfig(); const items = cfg.items||{}; let n=0;
    Object.keys(items).forEach(id => { if(!catIds.has(id)){ delete items[id]; n++; } });
    cfg.items = items; saveBudgetConfig(cfg);
    return n;
  }
  return 0;
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
  const instDebt    = getInstallments().filter(i => i.status !== 'completed' && i.status !== 'cancelled').reduce((inst, i) => {
    const paid = (i.paidMonths || []).length;
    const months = i.months || i.totalMonths || 0;
    return inst + Math.max(0, months - paid) * (i.monthlyAmt || 0);
  }, 0);
  const total = wal + icTotal + acTotal + shTotal + investTotal - pendingBills - instDebt;
  return { wal, icTotal, acTotal, shTotal, pendingBills, investTotal, instDebt, total };
}

// ── 淨值歷史追蹤（v14.0 新增）──────────────────────────
// 個人快照：pKey('networth_history')，本地陣列，新到舊；每個週期月最多存一筆（發薪日當天），
// 也允許手動補拍（會覆蓋當期已有的那筆，避免同一期重複堆疊）。
// 家庭合併淨值＝兩人快照相加，由 firebase.js 的 fbSyncNetWorthSnapshot/fbPullNetWorthHistory 負責跨裝置同步。
const NETWORTH_HISTORY_LIMIT = 104; // 約 4 年份（每週期月一筆）
function getNetWorthHistory() {
  return DB.get(pKey('networth_history')) || [];
}
// periodKey：用週期起始日字串（YYYY-MM-DD）當作該期的唯一鍵，同一期重覆拍照會取代舊的那筆
function _networthPeriodKey(now) {
  const { start } = getBudgetPeriod(now || new Date());
  return toLocalISO(start);
}
function saveNetWorthSnapshot(manual) {
  const nw = calcNetWorth();
  const now = new Date();
  const periodKey = _networthPeriodKey(now);
  const list = getNetWorthHistory();
  const entry = {
    periodKey,
    date: toLocalISO(now),
    total: nw.total,
    wal: nw.wal, icTotal: nw.icTotal, acTotal: nw.acTotal, shTotal: nw.shTotal,
    investTotal: nw.investTotal, pendingBills: nw.pendingBills, instDebt: nw.instDebt,
    manual: !!manual,
  };
  const idx = list.findIndex(e => e.periodKey === periodKey);
  if (idx >= 0) list[idx] = entry; else list.unshift(entry);
  list.sort((a,b) => b.periodKey.localeCompare(a.periodKey));
  if (list.length > NETWORTH_HISTORY_LIMIT) list.length = NETWORTH_HISTORY_LIMIT;
  DB.set(pKey('networth_history'), list);
  if (typeof fbSyncNetWorthSnapshot === 'function') fbSyncNetWorthSnapshot(entry);
  return entry;
}
// 本期是否已經拍過照（用於 index.html 開啟時判斷要不要自動拍）
function hasNetWorthSnapshotThisPeriod() {
  const periodKey = _networthPeriodKey(new Date());
  return getNetWorthHistory().some(e => e.periodKey === periodKey);
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

// ── 每日打卡 / 連續天數 🔥 ────────────────────────────
// 連續定義：只要打開 App 就算（重在養成每天關心財務的習慣）
// 資料存 localStorage 'streak_data'，並由 firebase.js 同步到 users/{uid}/streak
function getStreak() {
  try {
    const s = JSON.parse(localStorage.getItem('streak_data') || 'null');
    if (s && typeof s.current === 'number') return s;
  } catch (e) {}
  return { current: 0, longest: 0, lastCheckIn: '' };
}

function setStreak(s) {
  localStorage.setItem('streak_data', JSON.stringify(s));
}

// 每天首次開 App 呼叫；回傳更新後的 streak 物件
// 回傳物件多帶 _changed（今天是否為新簽到）與 _broken（是否曾中斷重新開始）
function checkInToday() {
  const today = toLocalISO();              // YYYY-MM-DD（台灣本地）
  const s = getStreak();
  if (s.lastCheckIn === today) {
    return { ...s, _changed: false, _broken: false };  // 今天已簽過
  }
  // 計算昨天日期字串
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = toLocalISO(y);
  let broken = false;
  if (s.lastCheckIn === yesterday) {
    s.current = (s.current || 0) + 1;       // 昨天有簽 → 連續+1
  } else {
    if (s.current > 1) broken = true;       // 中斷過
    s.current = 1;                          // 重新開始
  }
  s.lastCheckIn = today;
  if (s.current > (s.longest || 0)) s.longest = s.current;
  setStreak(s);
  // 同步到 Firebase（若函數存在）
  if (typeof fbSyncStreak === 'function') fbSyncStreak(s);
  return { ...s, _changed: true, _broken: broken };
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

// 標記某分期的某月份已記帳（寫入 paidMonths，避免 inbox 重複提醒）
function markInstallmentPaid(instId, periodYM) {
  const list = getInstallments();
  const idx  = list.findIndex(i => i.id === instId);
  if (idx < 0) return;
  const inst = list[idx];
  inst.paidMonths = inst.paidMonths || [];
  if (!inst.paidMonths.includes(periodYM)) inst.paidMonths.push(periodYM);
  inst.paidCount = inst.paidMonths.length;
  // 全部期數繳完 → 標記 completed
  if (inst.paidCount >= (inst.months || inst.totalMonths || 0)) inst.status = 'completed';
  saveInstallments(list);
  return inst;
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
// ── 交易模式：'real'(真實) / 'paper'(模擬沙盒) ─────────
// 模式分流讓 getTrades/saveTrades 自動讀寫不同 key，
// 現有的 renderReview/calcTradeCost/renderJournal 等全部無需修改即可支援模擬交易
let _tradeMode = (typeof localStorage !== 'undefined' && localStorage.getItem('trade_mode') === 'paper') ? 'paper' : 'real';
function getTradeViewMode() { return _tradeMode; }
function setTradeViewMode(m) {
  _tradeMode = (m === 'paper') ? 'paper' : 'real';
  try { localStorage.setItem('trade_mode', _tradeMode); } catch(e) {}
}
function _tradeKey() { return _tradeMode === 'paper' ? 'paper_trades' : 'trades'; }

function getTrades()      { return DB.get(_tradeKey()) || []; }
function saveTrades(list) { DB.set(_tradeKey(), list); }

// 真實交易專用讀取（守門員、淨資產等永遠看真錢，不受模擬模式影響）
function getRealTrades()  { return DB.get('trades') || []; }
function getPaperTrades() { return DB.get('paper_trades') || []; }

// 模擬交易畢業評估：判斷模擬績效是否夠格上實盤
// 回傳 {count, winRate, profitFactor, expectancy, verdict, grade, advice}
function evalPaperGraduation() {
  const closed = getPaperTrades().filter(t => t.status === 'closed');
  const n = closed.length;
  let net = 0, wins = 0, losses = 0, winSum = 0, lossSum = 0, violations = 0;
  closed.forEach(t => {
    const { netPnl } = calcTradeCost(t);
    net += netPnl;
    if (netPnl > 0) { wins++; winSum += netPnl; }
    else if (netPnl < 0) { losses++; lossSum += Math.abs(netPnl); }
    if (t.disciplineViolation) violations++;
  });
  const winRate = n ? wins / n * 100 : 0;
  const profitFactor = lossSum ? winSum / lossSum : (winSum > 0 ? 99 : 0);
  const expectancy = n ? net / n : 0;
  const vioRate = n ? violations / n * 100 : 0;

  // 評級邏輯：要同時看勝率、盈虧比、期望值、紀律
  let grade = 'D', verdict = '樣本不足', advice = '';
  if (n < 30) {
    grade = '—'; verdict = `還需累積（${n}/30 筆）`;
    advice = `先在沙盒練到至少 30 筆才有統計意義，目前還剩 ${Math.max(0, 30 - n)} 筆。`;
  } else {
    // 期望值為正是上實盤的最低門檻
    const posExp = expectancy > 0;
    const goodPF = profitFactor >= 1.5;
    const okPF   = profitFactor >= 1.2;
    const goodWR = winRate >= 45;
    const lowVio = vioRate <= 15;
    if (posExp && goodPF && goodWR && lowVio) {
      grade = 'A'; verdict = '✅ 夠格上實盤';
      advice = '期望值為正、盈虧比與紀律都健康。建議先用「最小部位」上實盤，因為真錢的心理壓力和模擬完全不同，要重新驗證心態。';
    } else if (posExp && okPF) {
      grade = 'B'; verdict = '⚠️ 接近但還不穩';
      advice = (vioRate > 15 ? `違紀率偏高（${vioRate.toFixed(0)}%），先把紀律練穩。` : '') +
               '期望值為正但盈虧比不夠扎實，建議再練 30 筆觀察一致性，別急著上實盤。';
    } else if (!posExp) {
      grade = 'D'; verdict = '🔴 還不能上實盤';
      advice = `期望值為負（每筆平均 ${expectancy>=0?'+':''}$${Math.round(expectancy)}），代表這套策略長期會賠錢。先檢討為什麼賠：是停損太慢、還是進場點不對？`;
    } else {
      grade = 'C'; verdict = '⚠️ 需要調整';
      advice = '勝率或盈虧比偏低。回顧覆盤頁的型態/情緒勝率，砍掉勝率最低的那種打法。';
    }
  }
  return { count: n, winRate, profitFactor, expectancy, vioRate, net, grade, verdict, advice };
}

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
  // 證交稅：只課賣出端（做多賣在 exit，做空賣在 entry）；未平倉(exit=0)不課
  const taxBase  = (t.direction === 'short' ? entry : exit) * shares;
  const tax      = exit && entry && shares ? Math.round(taxBase * taxRate) : 0;

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
  // 守門員永遠看真實交易（模擬交易不該觸發真錢虧損上限）
  const todayTrades = getRealTrades().filter(t => t.date === today && t.status === 'closed');
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
// 所有模組會用到的 localStorage key 總清單（集中管理，新增功能時請更新這裡）
// 分成「全域共用 key」與「會加 uid 前綴的個人 key」；另有少數前綴式 key 用 pattern 清。
const ALL_GLOBAL_KEYS = [
  // 記帳/分類/預算
  'tx','cats','budgets','card_budgets','hints','prefs','tx_tags','list_filter_date','shortcuts',
  // 收入/分期/儲蓄目標
  'incomes','income_sources','installments','savings_goals','recurring_items',
  // 共用帳戶/卡片
  'shared_accts','shared_cards','shared_icards','shared_card_names',
  // 通知/webhook/金鑰
  'discord','discord_webhook','report_webhook','chat_log_webhook','trade_webhook',
  'claude_api_key','gemini_api_key','app_config_updated',
  // 阿錢
  'advisor_memory','advisor_daily','advisor_chat_session','advisor_chat_log','advisor_acked_badges','advisor_settings_snapshot','advisor_start_date',
  // 家庭簡訊/備忘/購物
  'chat_messages','shared_memos','orders','orders_migrated','platforms','sellers','wish_list',
  // 徽章/花園寵物/存錢遊戲
  'badges_unlocked','badges_personal','badges_shared','garden_data','pet_data',
  'deposit_cups','streak_data','week_challenge',
  // 投資/交易紀律
  'investments','trades','paper_trades','trade_mode','trade_rules','trade_watchlist',
  // 收件匣/請求/雜項
  'inbox_receipts','pending_requests','kb_custom','mascot_char','card_cache_reset',
  'fb_last_tx_count','migrate_dismissed','fb_last_pull_at','fb_last_full_pull_at',
];
// 前綴式 key（每月/每項一筆，用 startsWith 清）；'user_' 是 uid() 無 email 時的退回前綴
const ALL_PREFIX_KEYS = ['recurring_done_', 'user_'];

function clearAll() {
  const u = (typeof uid === 'function') ? uid() : '';
  Object.keys(localStorage).forEach(k => {
    const isMine     = u && k.startsWith(u + '_');               // 個人 uid 前綴 key
    const isGlobal   = ALL_GLOBAL_KEYS.includes(k);              // 已知全域 key
    const isPrefixed = ALL_PREFIX_KEYS.some(p => k.startsWith(p)); // 前綴式 key
    if (isMine || isGlobal || isPrefixed) localStorage.removeItem(k);
  });
  // v14.1：clearAll 用 removeItem 直接刪、繞過 DB.del，需手動讓 tx 記憶體快取失效
  _txCache = { raw: null, parsed: null };
  // current_email / current_uid / current_user 保留，登出流程另外處理
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
// ── 固定支出本月已記帳標記（跨裝置防重複）──────────────
function _recurringDoneKey() {
  const d = new Date();
  return 'recurring_done_' + d.getFullYear() + '_' + (d.getMonth()+1);
}
function getRecurringDoneList() {
  try { return JSON.parse(localStorage.getItem(_recurringDoneKey()) || '[]'); } catch { return []; }
}
function markRecurringDone(notifId) {
  const list = getRecurringDoneList();
  if (!list.includes(notifId)) {
    list.push(notifId);
    localStorage.setItem(_recurringDoneKey(), JSON.stringify(list));
  }
}
function isRecurringDone(notifId) {
  return getRecurringDoneList().includes(notifId);
}
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
    if (isInboxItemDismissed(notifId) || isRecurringDone(notifId)) return;
    const dueLabel = diff === 0 ? '今天到期' : diff < 0 ? `已過期 ${Math.abs(diff)} 天` : `${diff} 天後到期`;
    const isIncome = rec.type === 'income';
    items.push({
      id: notifId,
      type: 'recurring',
      icon: isIncome ? '💰' : '🔄',
      title: rec.name,
      subtitle: `${isIncome?'收入 ':''}$${fmt(rec.amt || 0)} · ${dueLabel}`,
      note: '',
      date: `${todayYear}/${String(todayMonth).padStart(2,'0')}/${String(rec.day).padStart(2,'0')}`,
      isNew: true,
      actionLabel: isIncome ? '立即入帳' : '立即記帳',
      raw: rec,
    });
  });

  // ── 3. 分期月繳提醒（統一用 startYM 計算，與 getPendingInstallments 一致）──
  const _curYM = todayYear + '-' + String(todayMonth).padStart(2,'0');
  getInstallments().forEach(inst => {
    if (inst.status && inst.status !== 'active') return; // 只處理 active 狀態
    if (!inst.startYM) return;                            // 無起始月則略過
    const [sy, sm] = inst.startYM.split('-').map(Number);
    const months   = inst.months || inst.totalMonths || 0;
    const paidSet  = new Set(inst.paidMonths || []);
    // 本月（或之前未記）的期次才提醒
    const mDiff = (todayYear - sy) * 12 + (todayMonth - sm);
    if (mDiff < 0 || mDiff >= months) return;
    if (paidSet.has(_curYM)) return;                      // 本月已記過，不再提醒
    const period   = mDiff + 1;
    const periodAmt = typeof installmentPeriodAmt === 'function'
      ? installmentPeriodAmt(inst, mDiff)
      : (inst.monthlyAmt || 0);
    const notifId = `inst_${inst.id}_${todayYear}_${todayMonth}`;
    if (isInboxItemDismissed(notifId)) return;
    items.push({
      id: notifId,
      type: 'installment',
      icon: '📦',
      title: inst.name,
      subtitle: `第 ${period}/${months} 期 · $${fmt(periodAmt)}`,
      note: '',
      date: todayStr,
      isNew: true,
      actionLabel: '立即記帳',
      raw: { ...inst, currentPeriod: period, periodYM: _curYM },
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

  // ── 8. AI 主動洞察 ───────────────────────────────────
  try {
    getInsightItems().forEach(it => items.push(it));
  } catch(e) { console.warn('[insight]', e); }

  // ── 9. 現金流警示（未來 14 天到期金額 > 可用資產 80%）─
  try {
    const cf = getCashFlowForecast(14);
    if (cf.isAlert) {
      const cfId = `cashflow_alert_${todayYear}_${todayMonth}`;
      if (!isInboxItemDismissed(cfId)) {
        items.push({
          id: cfId, type: 'cashflow_alert', icon: '💸',
          title: '近期大額支出預警',
          subtitle: `未來 14 天需繳 $${fmt(Math.round(cf.totalDue))}，目前可用資產 $${fmt(Math.round(cf.totalBalance))}`,
          note: '',
          date: todayStr, isNew: true, actionLabel: '查看現金流',
          raw: { insightType: 'cashflow' },
        });
      }
    }
  } catch(e) { console.warn('[cashflow_alert]', e); }

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

// ══════════════════════════════════════════════════════
// 功能 A：AI 主動洞察（生成 insight 類型 inbox 項目）
// ══════════════════════════════════════════════════════
function getInsightItems() {
  const insights = [];
  const today = new Date();
  const yy = today.getFullYear(), mm = today.getMonth() + 1;
  const todayStr = toLocalISO(today).slice(0, 10);

  // ─ 條件1：月支出節奏 — 累積已超「應花」120% 以上 ─
  try {
    const wb = typeof getWeekBudget === 'function' ? getWeekBudget(today) : null;
    if (wb && wb.cumTotalShould > 0) {
      const overRatio = wb.cumTotalActual / wb.cumTotalShould;
      if (overRatio >= 1.2) {
        const id = `insight_overpace_${yy}_${mm}`;
        if (!isInboxItemDismissed(id)) {
          const over = wb.cumTotalActual - wb.cumTotalShould;
          insights.push({
            id, type: 'insight', icon: '📈',
            title: '本月支出節奏超前',
            subtitle: `照目前進度，本月超支 $${fmt(Math.round(over * (wb.periodDays / wb.daysElapsedInPeriod)))} 機率高`,
            note: `到今天為止已花 $${fmt(wb.cumTotalActual)}，應花 $${fmt(wb.cumTotalShould)}（${Math.round(overRatio*100)}%）`,
            date: todayStr, isNew: true, actionLabel: '查看週預算', raw: { insightType: 'overpace' },
          });
        }
      }
    }
  } catch(e) {}

  // ─ 條件2：特定分類本週花費 ≥ 週歷史平均 200% ─
  try {
    const wp = typeof getWeekPrediction === 'function' ? getWeekPrediction() : null;
    if (wp && wp.catResults) {
      wp.catResults.forEach(c => {
        if (!c.weekAmt || !c.predicted || c.predicted <= 0) return;
        const ratio = c.weekAmt / c.predicted;
        if (ratio < 2) return;
        const id = `insight_spike_${c.cat.id}_${yy}_${mm}`;
        if (isInboxItemDismissed(id)) return;
        insights.push({
          id, type: 'insight', icon: '🔥',
          title: `${c.cat.name} 消費異常飆高`,
          subtitle: `本週已花 $${fmt(c.weekAmt)}，是週均 $${fmt(Math.round(c.predicted))} 的 ${Math.round(ratio*100)}%`,
          note: '',
          date: todayStr, isNew: true, actionLabel: '查看報表', raw: { insightType: 'spike', catId: c.cat.id },
        });
      });
    }
  } catch(e) {}

  // ─ 條件3：連續 2 週衝動消費 > 15% ─
  try {
    const allTx = getTx();
    const IMPULSE = new Set(['impulse', 'emotion', 'social']);
    // 本週
    const wd = today.getDay(), mo = wd === 0 ? -6 : 1 - wd;
    const wkS = new Date(today); wkS.setDate(today.getDate() + mo); wkS.setHours(0,0,0,0);
    const wkE = new Date(wkS); wkE.setDate(wkS.getDate() + 6); wkE.setHours(23,59,59,999);
    // 上週
    const pwkS = new Date(wkS); pwkS.setDate(wkS.getDate() - 7);
    const pwkE = new Date(wkE); pwkE.setDate(wkE.getDate() - 7);
    const impPct = (start, end) => {
      const wtx = allTx.filter(t => { const d = new Date(t.at); return d >= start && d <= end; });
      const tot = wtx.reduce((s,t) => s + t.amount, 0);
      if (!tot) return 0;
      const imp = wtx.filter(t => (t.tags||[]).some(id => IMPULSE.has(id))).reduce((s,t) => s + t.amount, 0);
      return imp / tot * 100;
    };
    const thisPct = impPct(wkS, wkE);
    const lastPct = impPct(pwkS, pwkE);
    if (thisPct >= 15 && lastPct >= 15) {
      const id = `insight_impulse_${yy}_${mm}`;
      if (!isInboxItemDismissed(id)) {
        insights.push({
          id, type: 'insight', icon: '⚡',
          title: '連續 2 週衝動消費偏高',
          subtitle: `上週 ${Math.round(lastPct)}%、本週 ${Math.round(thisPct)}%，建議啟用「冷靜期」`,
          note: '',
          date: todayStr, isNew: true, actionLabel: '查看標籤分析', raw: { insightType: 'impulse' },
        });
      }
    }
  } catch(e) {}

  return insights;
}

// ══════════════════════════════════════════════════════
// 功能 B：未來 30 天現金流預測
// ══════════════════════════════════════════════════════
function getCashFlowForecast(days = 30) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const events = [];

  // 1) 未繳信用卡帳單（截止日在 days 天內）
  try {
    getPendingBills().forEach(bill => {
      const due = new Date(bill.year, bill.month - 1, bill.dueDay || 15);
      const diff = Math.ceil((due - today) / 86400000);
      if (diff >= 0 && diff <= days) {
        const card = cardFind(bill.cardId);
        events.push({
          date: due, diff, amount: bill.total,
          label: `💳 ${card?.name || '信用卡'} ${bill.month}月帳單`,
          type: 'bill', urgent: diff <= 3,
        });
      }
    });
  } catch(e) {}

  // 2) 未繳分期（本月 + 未來月份落在 days 內）
  try {
    const d0 = new Date(today); d0.setDate(1);
    const d1 = new Date(today.getTime() + days * 86400000);
    getInstallments().filter(i => i.status === 'active').forEach(inst => {
      if (!inst.startYM) return;
      const [sy, sm] = inst.startYM.split('-').map(Number);
      const paidSet = new Set(inst.paidMonths || []);
      for (let m = 0; m < inst.months; m++) {
        let iy = sy, imo = sm + m - 1;
        iy += Math.floor(imo / 12); imo = imo % 12 + 1;
        const ymStr = iy + '-' + String(imo).padStart(2, '0');
        if (paidSet.has(ymStr)) continue;
        // 假設每月 1 日為分期記帳日（月初提醒）
        const due = new Date(iy, imo - 1, 1);
        const diff = Math.ceil((due - today) / 86400000);
        if (diff >= 0 && diff <= days) {
          events.push({
            date: due, diff, amount: installmentPeriodAmt(inst, m),
            label: `📦 ${inst.name} 第${m+1}/${inst.months}期`,
            type: 'installment', urgent: false,
          });
        }
      }
    });
  } catch(e) {}

  // 3) 固定支出（今後 days 天內會到期的）
  try {
    const todayD = today.getDate(), todayM = today.getMonth() + 1, todayY = today.getFullYear();
    getRecurring().filter(r => r.type !== 'income' && r.amt > 0).forEach(rec => {
      // 找「今後 days 天內」最近一次到期日
      for (let offset = 0; offset <= days + 31; offset++) {
        const d = new Date(today.getTime() + offset * 86400000);
        if (d.getDate() !== rec.day) continue;
        const diff = offset;
        if (diff > days) break;
        // 檢查該月是否該觸發（interval）
        const dm = d.getMonth() + 1, dy = d.getFullYear();
        const startM = rec.startMonth || 1;
        const monthsFrom = (dy - 2024) * 12 + dm - startM;
        if (monthsFrom >= 0 && monthsFrom % (rec.interval || 1) === 0) {
          events.push({
            date: new Date(d), diff, amount: rec.amt,
            label: `🔄 ${rec.name}`,
            type: 'recurring', urgent: diff <= 2,
          });
        }
        break; // 每個 recurring 只加一次
      }
    });
  } catch(e) {}

  // 依日期排序
  events.sort((a, b) => a.date - b.date);

  // 目前總可用資產（錢包 + 帳戶）
  let totalBalance = 0;
  try {
    totalBalance += (getWal()?.balance || 0);
    [...getAccts(false), ...getAccts(true)].forEach(a => { totalBalance += (a.balance || 0); });
  } catch(e) {}

  const totalDue = events.reduce((s, e) => s + e.amount, 0);
  const isAlert = totalBalance > 0 && totalDue > totalBalance * 0.8;

  return { events, totalBalance, totalDue, isAlert, days };
}

// ══════════════════════════════════════════════════════
// 功能 C：想要 vs 需要 歷史趨勢（回溯 N 個週期月）
// ══════════════════════════════════════════════════════
function getWantNeedHistory(periodsBack = 4) {
  const WANT_TAGS    = new Set(['want']);
  const IMPULSE_TAGS = new Set(['impulse', 'emotion', 'social']);
  const allTx = getTx();
  const periods = [];
  let ref = new Date();

  for (let i = 0; i < periodsBack; i++) {
    const { start, end } = getBudgetPeriod(ref);
    const ptx = allTx.filter(t => { const d = new Date(t.at); return d >= start && d <= end; });
    const total = ptx.reduce((s,t) => s + t.amount, 0);
    let wantAmt = 0, impulseAmt = 0, needAmt = 0;
    ptx.forEach(t => {
      const tags = t.tags || [];
      if (tags.some(id => IMPULSE_TAGS.has(id)))    impulseAmt += t.amount;
      else if (tags.some(id => WANT_TAGS.has(id)))  wantAmt    += t.amount;
      else                                           needAmt    += t.amount;
    });
    const tagged = wantAmt + impulseAmt;
    periods.unshift({
      label:      `${start.getMonth()+1}/${start.getDate()}`,
      total,
      needPct:    total > 0 ? Math.round(needAmt    / total * 100) : 0,
      wantPct:    total > 0 ? Math.round(wantAmt    / total * 100) : 0,
      impulsePct: total > 0 ? Math.round(impulseAmt / total * 100) : 0,
      tagRate:    total > 0 ? Math.round(tagged      / total * 100) : 0,
    });
    ref = new Date(start.getTime() - 86400000);
  }
  return periods;
}

// ── 儲蓄目標追蹤 ─────────────────────────────────────
function getGoals()        { return DB.get('savings_goals') || []; }
function saveGoals(list)   { DB.set('savings_goals', list); }

// ── 徽章系統用的數據函數（安全、獨立、不影響既有計算）──────
// 最佳單月儲蓄率（掃近 12 個自然月，取最高）
function getBestSavingsRate() {
  const incomes = (typeof getIncomes === 'function') ? getIncomes() : [];
  if (!incomes.length) return 0;
  const now = new Date();
  let best = 0;
  for (let i = 0; i < 12; i++) {
    const y = now.getFullYear(), m = now.getMonth() - i;
    const d = new Date(y, m, 1);
    const yy = d.getFullYear(), mm = d.getMonth() + 1;
    const inc = incomes.filter(x => { const dt=new Date(x.at||''); return dt.getFullYear()===yy && dt.getMonth()+1===mm; })
                       .reduce((s,x)=>s+(x.amount||0),0);
    if (inc <= 0) continue;
    const spent = txByMonth(yy, mm).reduce((s,t)=>s+t.amount,0);
    const rate = Math.round((inc - spent) / inc * 100);
    if (rate > best) best = rate;
  }
  return best;
}

// 想買清單冷靜後放棄的次數（衝動消費的勝利）
function getCooldownGiveUpCount() {
  try {
    const list = JSON.parse(localStorage.getItem('wish_list') || '[]');
    return list.filter(w => w.decision === 'skip').length;
  } catch(e) { return 0; }
}

// 單月「需要」金額 > 「想要」金額 的月數（近 12 月，理性消費）
function getNeedOverWantMonths() {
  const tx = getTx();
  if (!tx.length) return 0;
  const now = new Date();
  let cnt = 0;
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yy = d.getFullYear(), mm = d.getMonth() + 1;
    const mtx = tx.filter(t => { const dt=new Date(t.at); return dt.getFullYear()===yy && dt.getMonth()+1===mm; });
    if (!mtx.length) continue;
    let need=0, want=0;
    mtx.forEach(t => {
      const tags = t.tags || [];
      if (tags.includes('need')) need += t.amount;
      if (tags.includes('want')) want += t.amount;
    });
    if (need > 0 && need > want) cnt++;
  }
  return cnt;
}

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
