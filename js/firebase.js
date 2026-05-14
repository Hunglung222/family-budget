'use strict';
// Firebase config 集中在 auth.js 管理，此處直接取用已初始化的 app
let _db=null;
function getDb(){
  if(_db)return _db;
  try{_db=firebase.firestore();}
  catch(e){console.warn('[FB]',e);}
  return _db;
}

// ── 共用記帳 ─────────────────────────────────────────
async function fbAddTx(tx){try{await getDb().collection('transactions').doc(tx.id).set(tx);}catch(e){console.warn('[FB]addTx',e);}}
async function fbDelTx(id){try{await getDb().collection('transactions').doc(id).delete();}catch(e){}}
function fbListenTx(cb){
  try{return getDb().collection('transactions').orderBy('at','desc').onSnapshot(snap=>{
    const l=[];snap.forEach(d=>l.push(d.data()));DB.set('tx',l);cb&&cb();
  },e=>console.warn('[FB]listen',e));}
  catch(e){return()=>{};}
}

// ── 個人資料同步（依 uid 隔離） ──────────────────────
async function fbSyncPersonal(){
  const u=uid();
  try{
    const doc={
      wal:    getWal(),
      cards:  getCards(),
      icards: getIcards(),
      accts:  getAccts(false),
      bills:  getCardBills(),
      syncAt: Date.now(),
    };
    await getDb().collection('personal').doc(u).set(doc);
    // 同步卡名對照表（讓對方看到正確卡名）
    await fbSyncCardNames();
  }catch(e){console.warn('[FB]syncPersonal',e);}
}

async function fbPullPersonal(){
  const u=uid();
  try{
    const d=await getDb().collection('personal').doc(u).get();
    if(!d.exists)return;
    const data=d.data();
    // 用時間戳記判斷：只有雲端比本地新才覆蓋
    const localWal=getWal();
    if(data.wal && data.wal.updatedAt > (localWal.updatedAt||0)){
      DB.set(pKey('wal'), data.wal);
    }
    if(data.cards)  DB.set(pKey('cards'),  data.cards);
    // icards 加時間戳記保護：只有雲端比本地新才覆蓋，避免蓋掉剛扣款的新餘額
    if(data.icards){
      const localIcards = getIcards();
      const localTs = Math.max(...localIcards.map(c=>c._localTs||0), 0);
      const cloudTs = data.syncAt || 0;
      if(cloudTs >= localTs) DB.set(pKey('icards'), data.icards);
    }
    if(data.accts)  DB.set(pKey('accts'),  data.accts);
    if(data.bills)  DB.set(pKey('bills'),  data.bills);
  }catch(e){console.warn('[FB]pullPersonal',e);}
}

// ── 共用帳戶同步 ─────────────────────────────────────
async function fbSyncSharedAccts(){
  try{await getDb().collection('shared').doc('accts').set({list:getAccts(true),updatedAt:Date.now()});}
  catch(e){}
}
async function fbPullSharedAccts(){
  try{
    const d=await getDb().collection('shared').doc('accts').get();
    if(d.exists&&d.data().list) DB.set('shared_accts',d.data().list);
  }catch(e){}
}

// ── 信用卡名稱共用對照表（讓盈慧看到宏龍的卡名）────
async function fbSyncCardNames(){
  try{
    // 把所有人的卡名整合成對照表 {cardId: cardName}
    const cards  = getCards()  || [];
    const icards = getIcards() || [];
    const map = {};
    cards.forEach(c  => { map[c.id] = c.name + (c.last4?'('+c.last4+')':''); });
    icards.forEach(c => { map[c.id] = c.name; });
    if(Object.keys(map).length === 0) return;
    // merge 方式：不覆蓋別人的卡，只加自己的
    const existing = await getDb().collection('shared').doc('card_names').get();
    const existingMap = existing.exists ? (existing.data().map || {}) : {};
    const merged = {...existingMap, ...map};
    await getDb().collection('shared').doc('card_names').set({map: merged, updatedAt: Date.now()});
  }catch(e){console.warn('[FB]syncCardNames',e);}
}
async function fbPullCardNames(){
  try{
    const d = await getDb().collection('shared').doc('card_names').get();
    if(d.exists && d.data().map) DB.set('shared_card_names', d.data().map);
  }catch(e){console.warn('[FB]pullCardNames',e);}
}
// 查詢卡名（優先用共用對照表，fallback 用本地）
function getCardName(cardId){
  if(!cardId) return '';
  // 先查本地
  const localCard = cardFind(cardId);
  if(localCard && localCard.name) return localCard.name + (localCard.last4?'('+localCard.last4+')':'');
  // 再查共用對照表
  const sharedMap = DB.get('shared_card_names') || {};
  return sharedMap[cardId] || '信用卡';
}


// ── 初始拉取全部資料 ─────────────────────────────────
async function fbPullAll(){
  try{
    const db = getDb();
    // 共用記帳
    const ts = await db.collection('transactions').orderBy('at','desc').get();
    const tl = []; ts.forEach(d=>tl.push(d.data())); if(tl.length) DB.set('tx',tl);
    // 個人資料
    await fbPullPersonal();
    // 同步自己的卡名到共用對照表（讓對方看到）
    await fbSyncCardNames();
    // 共用帳戶
    await fbPullSharedAccts();
    // 信用卡名稱對照表
    await fbPullCardNames();
    // 分類 & 預算
    const cd = await db.collection('shared').doc('cats').get();
    if(cd.exists && cd.data().list) DB.set('cats', cd.data().list);
    // 消費標籤定義
    await fbPullTxTags();
    const bd = await db.collection('shared').doc('budgets').get();
    if(bd.exists) DB.set('budgets', bd.data());
    // App 共用設定（webhook、claude key）
    await fbPullAppConfig();
    // 對方共用的卡片清單
    await fbPullSharedCardList();
    // 同步自己的共用卡片（讓對方能拉到）
    await fbSyncSharedCardList();
    // 宏龍私密資料（只有 kevin 會執行）
    await fbPullPrivateData();
    return true;
  }catch(e){console.warn('[FB]pullAll',e);return false;}
}

// ── 啟動時拉取 App 共用設定（多裝置一致）────────────
async function fbPullAppConfig(){
  try{
    const appCfg = await getDb().collection('shared').doc('app_config').get();
    if(!appCfg.exists) return;
    const cfg = appCfg.data();
    const localUpdated = parseInt(localStorage.getItem('app_config_updated')||'0');
    const cloudUpdated = cfg.updatedAt || 0;
    const localWebhook = localStorage.getItem('discord_webhook')||'';
    const localClaude  = localStorage.getItem('claude_api_key')||'';
    const needSync = cloudUpdated > localUpdated || !localWebhook || !localClaude;
    if(needSync){
      if(cfg.discordWebhook){
        localStorage.setItem('discord_webhook', cfg.discordWebhook);
        saveDiscord({webhook: cfg.discordWebhook});
      }
      if(cfg.geminiKey) localStorage.setItem('gemini_api_key', cfg.geminiKey);
      if(cfg.claudeKey) localStorage.setItem('claude_api_key', cfg.claudeKey);
      localStorage.setItem('app_config_updated', String(cloudUpdated));
      console.log('[FB] App config 已同步，更新者：', cfg.updatedBy||'');
    }
  }catch(e){console.warn('[FB]pullAppConfig',e);}
}

// ── 同步 App 共用設定（宏龍設定後，盈慧自動同步）──
async function fbSyncAppConfig(){
  try{
    const webhook   = localStorage.getItem('discord_webhook')||'';
    const geminiKey = localStorage.getItem('gemini_api_key')||'';
    const claudeKey = localStorage.getItem('claude_api_key')||'';
    const discordCfg = getDiscord();
    if(webhook||geminiKey||claudeKey){
      await getDb().collection('shared').doc('app_config').set({
        discordWebhook: webhook,
        geminiKey: geminiKey,
        claudeKey: claudeKey,
        dailyHour:   discordCfg.dailyHour   || 21,
        weeklyHour:  discordCfg.weeklyHour  || 8,
        onDaily:     discordCfg.onDaily    !== false,
        onWeekly:    discordCfg.onWeekly    === true,
        onMonthly:   discordCfg.onMonthly   === true,   // 補上：月結算開關
        monthlyDay:  discordCfg.monthlyDay  || 11,      // 補上：月結算發送日
        updatedAt: Date.now(),
        updatedBy: localStorage.getItem('current_user')||'',
      });
    }
  }catch(e){console.warn('[FB]appConfig',e);}
}

// ── 私密記帳 Firebase 同步（只有 kevin 本人能讀寫）──────────────────
async function fbAddPrivTx(tx) {
  if (!isKevin()) return;
  try {
    await getDb().collection('private_tx').doc(uid()).collection('items').doc(tx.id).set(tx);
  } catch(e) { console.warn('[FB]addPrivTx', e); }
}

async function fbDelPrivTx(id) {
  if (!isKevin()) return;
  try {
    await getDb().collection('private_tx').doc(uid()).collection('items').doc(id).delete();
  } catch(e) { console.warn('[FB]delPrivTx', e); }
}

async function fbEditPrivTx(id, updates) {
  if (!isKevin()) return;
  try {
    await getDb().collection('private_tx').doc(uid()).collection('items').doc(id).update(updates);
  } catch(e) { console.warn('[FB]editPrivTx', e); }
}

async function fbPullPrivTx() {
  if (!isKevin()) return;
  try {
    const snap = await getDb().collection('private_tx').doc(uid()).collection('items')
      .orderBy('at','desc').get();
    if (snap.empty) return;
    const items = snap.docs.map(d => d.data());
    // 與本地合併（以 Firebase 為主）
    const localList = getPrivTx();
    const localIds = new Set(localList.map(t=>t.id));
    // 合併並去重（以 id 為唯一鍵）
    const mergedMap = new Map();
    [...items, ...localList].forEach(t => { if(!mergedMap.has(t.id)) mergedMap.set(t.id, t); });
    const merged = [...mergedMap.values()].sort((a,b)=>new Date(b.at)-new Date(a.at));
    const {DB} = window; if(typeof DB!=='undefined') DB.set(pPrivKey('tx'), merged);
    else localStorage.setItem('db_priv_'+uid()+'_tx', JSON.stringify(merged));
    console.log('[FB] 私密記帳已拉取', merged.length, '筆');
  } catch(e) { console.warn('[FB]pullPrivTx', e); }
}

// ── 備忘錄 Firebase 同步（只有 kevin 本人能讀寫）──────────────────
async function fbAddMemo(memo) {
  if (!isKevin()) return;
  try {
    await getDb().collection('memos').doc(uid()).collection('items').doc(memo.id).set(memo);
  } catch(e) { console.warn('[FB]addMemo', e); }
}

async function fbEditMemo(id, updates) {
  if (!isKevin()) return;
  try {
    await getDb().collection('memos').doc(uid()).collection('items').doc(id).update({
      ...updates, updatedAt: new Date().toISOString()
    });
  } catch(e) { console.warn('[FB]editMemo', e); }
}

async function fbDelMemo(id) {
  if (!isKevin()) return;
  try {
    await getDb().collection('memos').doc(uid()).collection('items').doc(id).delete();
  } catch(e) { console.warn('[FB]delMemo', e); }
}

async function fbPullMemos() {
  if (!isKevin()) return;
  try {
    const snap = await getDb().collection('memos').doc(uid()).collection('items')
      .orderBy('at','desc').get();
    if (snap.empty) return;
    const items = snap.docs.map(d => d.data());
    const localList = getMemos();
    // 合併並去重（以 id 為唯一鍵）
    const mergedMap = new Map();
    [...items, ...localList].forEach(m => { if(!mergedMap.has(m.id)) mergedMap.set(m.id, m); });
    const merged = [...mergedMap.values()].sort((a,b)=>new Date(b.at)-new Date(a.at));
    const {DB} = window; if(typeof DB!=='undefined') DB.set(pPrivKey('memos'), merged);
    else localStorage.setItem('db_priv_'+uid()+'_memos', JSON.stringify(merged));
    console.log('[FB] 備忘錄已拉取', merged.length, '筆');
  } catch(e) { console.warn('[FB]pullMemos', e); }
}

// 登入後自動拉取私密資料
async function fbPullPrivateData() {
  if (!isKevin()) return;
  await fbPullPrivTx();
  await fbPullMemos();
}

async function fbSyncWal(){await fbSyncPersonal();}
async function fbSyncCards(){await fbSyncPersonal(); await fbSyncSharedCardList();}
async function fbSyncIcards(){await fbSyncPersonal(); await fbSyncSharedCardList();}

// ── 共用卡片清單同步（讓對方看到我設為共用的卡）──────
async function fbSyncSharedCardList() {
  try {
    const myCards  = getMySharedCards()  || [];
    const myIcards = getMySharedIcards() || [];
    const myName   = localStorage.getItem('current_user') || '';
    const myUid    = uid();
    // 只存對方看得到需要的欄位，不存 history（避免資料過大）
    const cards  = myCards.map(c  => ({id:c.id, name:c.name, last4:c.last4, color:c.color, cutDay:c.cutDay, dueDay:c.dueDay, owner:myUid, ownerName:myName}));
    const icards = myIcards.map(c => ({id:c.id, name:c.name, balance:c.balance||0, owner:myUid, ownerName:myName}));
    await getDb().collection('shared').doc('shared_cards_'+myUid).set({
      cards, icards, updatedAt: Date.now(), ownerName: myName,
    });
    console.log('[FB] 共用卡片已上傳', cards.length, '張信用卡,', icards.length, '張悠遊卡');
  } catch(e) { console.warn('[FB]syncSharedCardList', e); }
}

async function fbPullSharedCardList() {
  try {
    const myUid = uid();
    // 取得另一位使用者的共用卡片（掃描 shared_cards_ 開頭的文件，排除自己的）
    const snap = await getDb().collection('shared').get();
    let allSharedCards  = [];
    let allSharedIcards = [];
    snap.forEach(doc => {
      const id = doc.id;
      if (!id.startsWith('shared_cards_')) return;
      if (id === 'shared_cards_' + myUid) return; // 跳過自己的
      const data = doc.data();
      if (data.cards)  allSharedCards  = [...allSharedCards,  ...data.cards];
      if (data.icards) allSharedIcards = [...allSharedIcards, ...data.icards];
    });
    DB.set('shared_cards',  allSharedCards);
    DB.set('shared_icards', allSharedIcards);
    if (allSharedCards.length || allSharedIcards.length) {
      console.log('[FB] 已拉取共用卡片', allSharedCards.length, '張信用卡,', allSharedIcards.length, '張悠遊卡');
    }
  } catch(e) { console.warn('[FB]pullSharedCardList', e); }
}

async function fbSyncTxTags(){
  try{
    await getDb().collection('shared').doc('tx_tags').set({list:getTxTags(),updatedAt:Date.now()});
  }catch(e){console.warn('[FB]syncTxTags',e);}
}
async function fbPullTxTags(){
  try{
    const d=await getDb().collection('shared').doc('tx_tags').get();
    if(d.exists&&d.data().list) DB.set('tx_tags',d.data().list);
  }catch(e){console.warn('[FB]pullTxTags',e);}
}

async function fbSyncCats(){
  try{
    await getDb().collection('shared').doc('cats').set({list:getCats(),updatedAt:Date.now()});
  }catch(e){console.warn('[FB]syncCats',e);}
}

async function fbSyncBudgets(){
  try{await getDb().collection('shared').doc('budgets').set(getBudgetConfig());}catch(e){}
}
async function fbClearAll(){
  try{
    const db=getDb(),sn=await db.collection('transactions').get();
    const b=db.batch();sn.forEach(d=>b.delete(d.ref));
    ['personal','shared'].forEach(c=>['main','accts','cats','budgets'].forEach(d=>
      b.delete(db.collection(c).doc(d))));
    await b.commit();
  }catch(e){console.warn('[FB]clear',e);}
}


// ── Discord 通知系統 ──────────────────────────────────
function getWebhook(){return localStorage.getItem('discord_webhook')||getDiscord().webhook||'';}

async function discordSend(msg){
  const url=getWebhook();if(!url)return;
  try{await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:msg})});}
  catch(e){console.warn('[Discord]',e);}
}

// discordOnAddWithComment：由 add.html 的 getFunnyComment 呼叫，附帶角色說的話
async function discordOnAddWithComment(tx, comment, charName){
  const cfg=getDiscord();if(!cfg.onAdd||!getWebhook())return;
  const pay=tx.pay==='cash'?'💵現金':tx.pay==='icard'?'🎫悠遊卡':tx.pay==='acct'?(()=>{const isShared=(tx.acctId||'').startsWith('shared_');const accts=(typeof getAccts==='function'?getAccts(isShared):[])||[];const a=accts.find(x=>x.id===tx.acctId);return '🏦'+(a?a.name:'帳戶');})():`💳信用卡(${cardFind(tx.cardId)?.name||''})`;

  const namePrefix = charName ? `**${charName}**：` : '';
  await discordSend(`💰 **${tx.person}** 記帳\n📂 ${catName(tx.cat)}${tx.subCat?' › '+tx.subCat:''}\n📝 ${tx.detail||'（無明細）'}\n💵 **$${fmt(tx.amount)}** ${pay}\n🕐 ${fmtD(tx.at)} ${fmtT(tx.at)}\n💬 ${namePrefix}${comment}`);
}

// discordOnAdd：無 Claude Key 時的 fallback，不附帶趣味話
async function discordOnAdd(tx){
  const cfg=getDiscord();if(!cfg.onAdd||!getWebhook())return;
  const pay=tx.pay==='cash'?'💵現金':tx.pay==='icard'?'🎫悠遊卡':tx.pay==='acct'?(()=>{const isShared=(tx.acctId||'').startsWith('shared_');const accts=(typeof getAccts==='function'?getAccts(isShared):[])||[];const a=accts.find(x=>x.id===tx.acctId);return '🏦'+(a?a.name:'帳戶');})():`💳信用卡(${cardFind(tx.cardId)?.name||''})`;

  await discordSend(`💰 **${tx.person}** 記帳\n📂 ${catName(tx.cat)}${tx.subCat?' › '+tx.subCat:''}\n📝 ${tx.detail||'（無明細）'}\n💵 **$${fmt(tx.amount)}** ${pay}\n🕐 ${fmtD(tx.at)} ${fmtT(tx.at)}`);
}

async function checkBudgetAlert(tx){
  const cfg=getDiscord();
  const limit=getBudget(tx.cat);if(!limit)return null;
  const spent=txByPeriod().filter(t=>t.cat===tx.cat).reduce((s,t)=>s+t.amount,0);
  const pct=spent/limit*100;
  const threshold=cfg.budgetPct||80;
  if(cfg.onBudget&&getWebhook()&&(pct>=100||(pct>=threshold&&pct-tx.amount/limit*100<threshold))){
    const emoji=pct>=100?'🚨':'⚠️';
    await discordSend(`${emoji} **預算警示** — ${catName(tx.cat)}\n已用 **$${fmt(spent)}** / $${fmt(limit)}（${Math.round(pct)}%）\n週期：${fmtPeriod()}`);
  }
  return {spent,limit,pct};
}

async function discordBillReminder(){
  const bills=getPendingBills();
  if(!bills.length)return;
  const now=new Date();
  for(const bill of bills){
    const card=cardFind(bill.cardId);if(!card)continue;
    const due=new Date(bill.year, bill.month-1, bill.dueDay||15);
    const diff=Math.ceil((due-now)/(864e5));
    if(diff<=3&&diff>=0){
      await discordSend(`💳 **信用卡繳費提醒**\n${card.name} ${bill.month}月帳單\n應繳金額：**$${fmt(bill.total)}**\n繳費截止：${bill.year}/${bill.month}/${bill.dueDay||15}\n⏰ 還有 ${diff} 天！`);
    }
  }
}

async function discordDailySummary(){
  const cfg=getDiscord();if(!cfg.onDaily||!getWebhook())return;
  const key='discord_daily_'+new Date().toDateString();
  if(localStorage.getItem(key))return;
  const now=new Date(),s=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const today=getTx().filter(t=>{const d=new Date(t.at);return d>=s&&d<new Date(s.getTime()+864e5);});
  if(!today.length)return;
  const total=today.reduce((s,t)=>s+t.amount,0);
  const lines=today.map(t=>`• ${catName(t.cat)} ${t.detail||''} **$${fmt(t.amount)}** (${t.person})`).join('\n');
  await discordSend(`📊 **家庭記帳日結算** ${now.getMonth()+1}/${now.getDate()}\n${lines}\n\n💰 今日合計：**$${fmt(total)}**`);
  localStorage.setItem(key,'1');
}

function scheduleNotifications(){
  if(!getWebhook())return;
  const cfg=getDiscord();
  const now=new Date(),target=new Date();
  target.setHours(cfg.dailyHour||21,0,0,0);
  if(target<=now)target.setDate(target.getDate()+1);
  setTimeout(async()=>{
    await discordDailySummary();
    await discordBillReminder();
    setInterval(async()=>{await discordDailySummary();await discordBillReminder();},864e5);
  },target-now);
}

// alias：index.html 呼叫 scheduleDailyDiscord()，確保兩個名稱都能用
const scheduleDailyDiscord = scheduleNotifications;

getDb();
