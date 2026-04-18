'use strict';
const FB_CFG = {
  apiKey:"AIzaSyA2FVuIV_5sMUxd851XhTcSMQIg0m1Lh6M",
  authDomain:"family-budget-aed64.firebaseapp.com",
  projectId:"family-budget-aed64",
  storageBucket:"family-budget-aed64.firebasestorage.app",
  messagingSenderId:"714512661107",
  appId:"1:714512661107:web:022f9c7f7b828b5eb9c806",
};
const COL={TX:'transactions',WAL:'wallet',CATS:'categories',CARDS:'cards',BUD:'budgets'};
let _db=null;
function getDb(){
  if(_db)return _db;
  try{if(!firebase.apps.length)firebase.initializeApp(FB_CFG);_db=firebase.firestore();}
  catch(e){console.warn('[FB]',e);}
  return _db;
}
async function fbAddTx(tx){try{await getDb().collection(COL.TX).doc(tx.id).set(tx);}catch(e){console.warn('[FB]addTx',e);}}
async function fbDelTx(id){try{await getDb().collection(COL.TX).doc(id).delete();}catch(e){console.warn('[FB]delTx',e);}}
function fbListenTx(cb){
  try{return getDb().collection(COL.TX).orderBy('at','desc').onSnapshot(s=>{const l=[];s.forEach(d=>l.push(d.data()));DB.set('tx',l);cb&&cb();},e=>console.warn('[FB]listen',e));}
  catch(e){return()=>{};}
}
async function fbSyncWal(){try{await getDb().collection(COL.WAL).doc('main').set(getWal());}catch(e){}}
function fbListenWal(cb){
  try{return getDb().collection(COL.WAL).doc('main').onSnapshot(d=>{if(d.exists){DB.set('wal',d.data());cb&&cb();}});}
  catch(e){return()=>{};}
}
async function fbSyncCards(){try{await getDb().collection(COL.CARDS).doc('main').set({list:getCards()});}catch(e){}}
async function fbPullAll(){
  try{
    const db=getDb();
    const ts=await db.collection(COL.TX).orderBy('at','desc').get();
    const tl=[];ts.forEach(d=>tl.push(d.data()));if(tl.length)DB.set('tx',tl);
    const wd=await db.collection(COL.WAL).doc('main').get();if(wd.exists)DB.set('wal',wd.data());
    const cd=await db.collection(COL.CATS).doc('main').get();if(cd.exists&&cd.data().list)DB.set('cats',cd.data().list);
    const crd=await db.collection(COL.CARDS).doc('main').get();if(crd.exists&&crd.data().list)DB.set('cards',crd.data().list);
    const bd=await db.collection(COL.BUD).doc('main').get();if(bd.exists)DB.set('bud',bd.data());
    return true;
  }catch(e){console.warn('[FB]pull',e);return false;}
}
async function fbClearAll(){
  try{
    const db=getDb();const sn=await db.collection(COL.TX).get();
    const b=db.batch();sn.forEach(d=>b.delete(d.ref));
    [COL.WAL,COL.CATS,COL.CARDS,COL.BUD].forEach(c=>b.delete(db.collection(c).doc('main')));
    await b.commit();
  }catch(e){console.warn('[FB]clear',e);}
}

// ── Discord 每日結算通知 ──────────────────────────────
const DISCORD_WEBHOOK = ''; // 在此填入 Webhook URL

async function discordNotify(msg) {
  if (!DISCORD_WEBHOOK) return;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ content: msg }),
    });
  } catch(e) { console.warn('[Discord]', e); }
}

async function discordDailySummary() {
  const now = new Date();
  const txs = txByMonth(now.getFullYear(), now.getMonth()+1);
  const today = txs.filter(t => fmtD(t.at) === fmtD(now.toISOString()));
  if (!today.length) return;
  const total = today.reduce((s,t)=>s+t.amount, 0);
  const lines = today.map(t=>`• ${catName(t.cat)} ${t.detail||''} **$${fmt(t.amount)}** (${t.person})`).join('\n');
  const msg = `📊 **家庭記帳 ${fmtD(now.toISOString())} 日結算**\n${lines}\n💰 今日合計：**$${fmt(total)}**`;
  await discordNotify(msg);
}

// 每天排程（若當天還未發送則發送）
function scheduleDailyDiscord() {
  const key = 'discord_sent_' + new Date().toDateString();
  if (localStorage.getItem(key)) return;
  const now = new Date();
  const target = new Date(); target.setHours(21,0,0,0);
  const ms = target > now ? target-now : 0;
  setTimeout(async () => {
    await discordDailySummary();
    localStorage.setItem(key, '1');
  }, ms);
}

getDb();
