'use strict';
const FB_CFG={
  apiKey:"AIzaSyA2FVuIV_5sMUxd851XhTcSMQIg0m1Lh6M",
  authDomain:"family-budget-aed64.firebaseapp.com",
  projectId:"family-budget-aed64",
  storageBucket:"family-budget-aed64.firebasestorage.app",
  messagingSenderId:"714512661107",
  appId:"1:714512661107:web:022f9c7f7b828b5eb9c806",
};
let _db=null;
function getDb(){
  if(_db)return _db;
  try{if(!firebase.apps.length)firebase.initializeApp(FB_CFG);_db=firebase.firestore();}
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
    if(data.icards) DB.set(pKey('icards'), data.icards);
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


// ── 初始拉取全部資料 ─────────────────────────────────
async function fbPullAll(){
  try{
    const db = getDb();
    // 共用記帳
    const ts = await db.collection('transactions').orderBy('at','desc').get();
    const tl = []; ts.forEach(d=>tl.push(d.data())); if(tl.length) DB.set('tx',tl);
    // 個人資料
    await fbPullPersonal();
    // 共用帳戶
    await fbPullSharedAccts();
    // 分類 & 預算
    const cd = await db.collection('shared').doc('cats').get();
    if(cd.exists && cd.data().list) DB.set('cats', cd.data().list);
    const bd = await db.collection('shared').doc('budgets').get();
    if(bd.exists) DB.set('budgets', bd.data());
    // App 共用設定（webhook、claude key）
    await fbPullAppConfig();
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
        dailyHour:  discordCfg.dailyHour  || 21,
        weeklyHour: discordCfg.weeklyHour || 8,
        onDaily:    discordCfg.onDaily  !== false,
        onWeekly:   discordCfg.onWeekly === true,
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

// 相容舊版呼叫
async function fbSyncWal(){await fbSyncPersonal();}
async function fbSyncCards(){await fbSyncPersonal();}
async function fbSyncIcards(){await fbSyncPersonal();}
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

// 信用卡帳單 Discord 提醒
async function discordBillReminder(){
  const bills=getPendingBills();
  if(!bills.length)return;
  const now=new Date();
  for(const bill of bills){
    const card=cardFind(bill.cardId);if(!card)continue;
    // 距繳費日 3 天內提醒
    const due=new Date(bill.year, bill.month-1, bill.dueDay||15);
    const diff=Math.ceil((due-now)/(864e5));
    if(diff<=3&&diff>=0){
      await discordSend(`💳 **信用卡繳費提醒**\n${card.name} ${bill.month}月帳單\n應繳金額：**$${fmt(bill.total)}**\n繳費截止：${bill.year}/${bill.month}/${bill.dueDay||15}\n⏰ 還有 ${diff} 天！`);
    }
  }
}

// 相容舊版呼叫
async function fbSyncWal(){await fbSyncPersonal();}
async function fbSyncCards(){await fbSyncPersonal();}
async function fbSyncIcards(){await fbSyncPersonal();}
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

async function discordOnAdd(tx){
  const cfg=getDiscord();if(!cfg.onAdd||!getWebhook())return;
  const pay=tx.pay==='cash'?'💵現金':tx.pay==='icard'?'🎫悠遊卡':`💳信用卡(${cardFind(tx.cardId)?.name||''})`;
  // 取得趣味回應
  let funnyLine='';
  try{
    const key=localStorage.getItem('claude_api_key')||'';
    if(key){
      const catLabel=catName(tx.cat);
      const prompt=`你是記帳小夥伴，每次有人記帳後說一句話。這筆：${catLabel} ${tx.detail?'「'+tx.detail+'」':''} $${tx.amount}。說一句15~25字的話，風格隨機（幽默/鼓勵/理財提示/感嘆），加emoji，只回傳那句話。`;
      const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
        body:JSON.stringify({model:'claude-haiku-4-5',max_tokens:80,messages:[{role:'user',content:prompt}]})
      });
      if(res.ok){const d=await res.json();funnyLine='\n💬 '+(d.content?.[0]?.text||'').trim();}
    }
  }catch(e){console.warn('[discord mascot]',e.message);}
  await discordSend(`💰 **${tx.person}** 記帳\n📂 ${catName(tx.cat)}${tx.subCat?' › '+tx.subCat:''}\n📝 ${tx.detail||'（無明細）'}\n💵 **$${fmt(tx.amount)}** ${pay}\n🕐 ${fmtD(tx.at)} ${fmtT(tx.at)}${funnyLine}`);
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

getDb();
