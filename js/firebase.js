'use strict';
const FB_CFG={apiKey:"AIzaSyA2FVuIV_5sMUxd851XhTcSMQIg0m1Lh6M",authDomain:"family-budget-aed64.firebaseapp.com",projectId:"family-budget-aed64",storageBucket:"family-budget-aed64.firebasestorage.app",messagingSenderId:"714512661107",appId:"1:714512661107:web:022f9c7f7b828b5eb9c806"};
const COL={TX:'transactions',WAL:'wallet',CATS:'categories',CARDS:'cards',BUD:'budgets',ICARDS:'icards',DISCORD:'discord'};
let _db=null;
function getDb(){if(_db)return _db;try{if(!firebase.apps.length)firebase.initializeApp(FB_CFG);_db=firebase.firestore();}catch(e){console.warn('[FB]',e);}return _db;}

async function fbAddTx(tx){try{await getDb().collection(COL.TX).doc(tx.id).set(tx);}catch(e){console.warn('[FB]addTx',e);}}
async function fbDelTx(id){try{await getDb().collection(COL.TX).doc(id).delete();}catch(e){}}
function fbListenTx(cb){try{return getDb().collection(COL.TX).orderBy('at','desc').onSnapshot(s=>{const l=[];s.forEach(d=>l.push(d.data()));DB.set('tx',l);cb&&cb();},e=>console.warn(e));}catch(e){return()=>{};}}
async function fbSyncWal(){try{await getDb().collection(COL.WAL).doc('main').set(getWal());}catch(e){}}
function fbListenWal(cb){try{return getDb().collection(COL.WAL).doc('main').onSnapshot(d=>{if(d.exists){DB.set('wal',d.data());cb&&cb();}});}catch(e){return()=>{};}}
async function fbSyncCards(){try{await getDb().collection(COL.CARDS).doc('main').set({list:getCards()});}catch(e){}}
async function fbSyncIcards(){try{await getDb().collection(COL.ICARDS).doc('main').set({list:getIcards()});}catch(e){}}
async function fbSyncBudgets(){try{await getDb().collection(COL.BUD).doc('main').set(getBudgetConfig());}catch(e){}}
async function fbPullAll(){
  try{
    const db=getDb();
    const ts=await db.collection(COL.TX).orderBy('at','desc').get();const tl=[];ts.forEach(d=>tl.push(d.data()));if(tl.length)DB.set('tx',tl);
    const wd=await db.collection(COL.WAL).doc('main').get();if(wd.exists)DB.set('wal',wd.data());
    const cd=await db.collection(COL.CATS).doc('main').get();if(cd.exists&&cd.data().list)DB.set('cats',cd.data().list);
    const crd=await db.collection(COL.CARDS).doc('main').get();if(crd.exists&&crd.data().list)DB.set('cards',crd.data().list);
    const icd=await db.collection(COL.ICARDS).doc('main').get();if(icd.exists&&icd.data().list)DB.set('icards',icd.data().list);
    const bd=await db.collection(COL.BUD).doc('main').get();if(bd.exists)DB.set('budgets',bd.data());
    return true;
  }catch(e){console.warn('[FB]pull',e);return false;}
}
async function fbClearAll(){
  try{const db=getDb();const sn=await db.collection(COL.TX).get();const b=db.batch();sn.forEach(d=>b.delete(d.ref));[COL.WAL,COL.CATS,COL.CARDS,COL.ICARDS,COL.BUD].forEach(c=>b.delete(db.collection(c).doc('main')));await b.commit();}catch(e){}
}

// ═══════════════════════════════════════
//  Discord 通知系統
// ═══════════════════════════════════════
function getWebhook(){return localStorage.getItem('discord_webhook')||getDiscord().webhook||'';}

async function discordSend(msg){
  const url=getWebhook();if(!url)return;
  try{await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:msg})});}
  catch(e){console.warn('[Discord]',e);}
}

// 每筆記帳通知
async function discordOnAdd(tx){
  const cfg=getDiscord();if(!cfg.onAdd||!getWebhook())return;
  const pay=tx.pay==='cash'?'💵現金':tx.pay==='icard'?`🎫悠遊卡`:`💳信用卡`;
  const msg=`💰 **${tx.person}** 記帳\n📂 ${catName(tx.cat)}${tx.subCat?' › '+tx.subCat:''}\n📝 ${tx.detail||'（無明細）'}\n💵 **$${fmt(tx.amount)}** ${pay}\n🕐 ${fmtD(tx.at)} ${fmtT(tx.at)}`;
  await discordSend(msg);
}

// 預算警示通知
async function discordBudgetAlert(catId,spent,limit,pct){
  const cfg=getDiscord();if(!cfg.onBudget||!getWebhook())return;
  const emoji=pct>=100?'🚨':pct>=cfg.budgetPct?'⚠️':'';
  if(!emoji)return;
  const msg=`${emoji} **預算警示** — ${catName(catId)}\n已用 **$${fmt(spent)}** / $${fmt(limit)}\n達到 **${Math.round(pct)}%**（週期：${fmtPeriod()}）`;
  await discordSend(msg);
}

// 檢查並發送預算警示（記帳後呼叫）
async function checkBudgetAlert(tx){
  const cfg=getDiscord();if(!cfg.onBudget)return;
  const limit=getBudget(tx.cat);if(!limit)return;
  const periodTxs=txByPeriod().filter(t=>t.cat===tx.cat);
  const spent=periodTxs.reduce((s,t)=>s+t.amount,0);
  const pct=spent/limit*100;
  const threshold=cfg.budgetPct||80;
  // 達到設定百分比 or 超支
  if(pct>=100||(pct>=threshold&&pct-tx.amount/limit*100<threshold)){
    await discordBudgetAlert(tx.cat,spent,limit,pct);
  }
  return{spent,limit,pct};
}

// 每日結算通知
async function discordDailySummary(){
  const cfg=getDiscord();if(!cfg.onDaily||!getWebhook())return;
  const now=new Date();
  const todayKey='discord_daily_'+now.toDateString();
  if(localStorage.getItem(todayKey))return;
  const start=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const end=new Date(start.getTime()+864e5);
  const today=getTx().filter(t=>{const d=new Date(t.at);return d>=start&&d<end;});
  if(!today.length)return;
  const total=today.reduce((s,t)=>s+t.amount,0);
  const lines=today.map(t=>`• ${catName(t.cat)} ${t.detail||''} **$${fmt(t.amount)}** (${t.person})`).join('\n');
  const msg=`📊 **家庭記帳日結算** ${now.getMonth()+1}/${now.getDate()}\n${lines}\n\n💰 今日合計：**$${fmt(total)}**`;
  await discordSend(msg);
  localStorage.setItem(todayKey,'1');
}

// 每週摘要
async function discordWeeklySummary(){
  const cfg=getDiscord();if(!cfg.onWeekly||!getWebhook())return;
  const now=new Date();
  const weekKey='discord_weekly_'+Math.floor(now.getTime()/(7*864e5));
  if(localStorage.getItem(weekKey))return;
  const weekStart=new Date(now-now.getDay()*864e5);weekStart.setHours(0,0,0,0);
  const txs=getTx().filter(t=>new Date(t.at)>=weekStart);
  if(!txs.length)return;
  const s=calcStats(txs);
  const catLines=Object.entries(s.byCat).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([id,amt])=>`• ${catName(id)}: $${fmt(amt)}`).join('\n');
  const msg=`📈 **家庭記帳週摘要**\n💰 本週總支出：**$${fmt(s.total)}**\n\n**分類排行：**\n${catLines}\n\n🙋 宏龍：$${fmt(s.byPerson['宏龍']||0)}  🙋‍♀️ 盈慧：$${fmt(s.byPerson['盈慧']||0)}`;
  await discordSend(msg);
  localStorage.setItem(weekKey,'1');
}

// 排程每日通知
function scheduleNotifications(){
  const cfg=getDiscord();
  if(!getWebhook())return;
  const now=new Date();
  const target=new Date();target.setHours(cfg.dailyHour||21,0,0,0);
  if(target<=now)target.setDate(target.getDate()+1);
  const ms=target-now;
  setTimeout(async()=>{
    await discordDailySummary();
    await discordWeeklySummary();
    setInterval(async()=>{await discordDailySummary();await discordWeeklySummary();},864e5);
  },ms);
}

getDb();
