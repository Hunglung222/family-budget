'use strict';
// ═══════════════════════════════════════
//  firebase.js — Firestore 雙向同步
// ═══════════════════════════════════════
const FB_CFG = {
  apiKey:            "AIzaSyA2FVuIV_5sMUxd851XhTcSMQIg0m1Lh6M",
  authDomain:        "family-budget-aed64.firebaseapp.com",
  projectId:         "family-budget-aed64",
  storageBucket:     "family-budget-aed64.firebasestorage.app",
  messagingSenderId: "714512661107",
  appId:             "1:714512661107:web:022f9c7f7b828b5eb9c806",
};

const COL = { TX:'transactions', WAL:'wallet', CATS:'categories', CARDS:'cards', BUD:'budgets' };

let _db = null;
function getDb() {
  if (_db) return _db;
  try {
    if (!firebase.apps.length) firebase.initializeApp(FB_CFG);
    _db = firebase.firestore();
  } catch(e) { console.warn('[FB]', e); }
  return _db;
}

// 交易
async function fbAddTx(tx) {
  try { await getDb().collection(COL.TX).doc(tx.id).set(tx); } catch(e) { console.warn('[FB] addTx', e); }
}
async function fbDelTx(id) {
  try { await getDb().collection(COL.TX).doc(id).delete(); } catch(e) { console.warn('[FB] delTx', e); }
}

// 即時監聽交易（回傳 unsubscribe 函式）
function fbListenTx(onChange) {
  try {
    return getDb().collection(COL.TX).orderBy('at','desc')
      .onSnapshot(snap => {
        const list = []; snap.forEach(d => list.push(d.data()));
        DB.set('tx', list);
        onChange && onChange();
      }, e => console.warn('[FB] listen', e));
  } catch(e) { console.warn('[FB] listenInit', e); return () => {}; }
}

// 錢包
async function fbSyncWal() {
  try { await getDb().collection(COL.WAL).doc('main').set(getWal()); } catch(e) {}
}
function fbListenWal(onChange) {
  try {
    return getDb().collection(COL.WAL).doc('main')
      .onSnapshot(doc => { if (doc.exists) { DB.set('wal', doc.data()); onChange && onChange(); } });
  } catch(e) { return () => {}; }
}

// 首次載入：從雲端拉回全部資料
async function fbPullAll() {
  try {
    const db = getDb();
    const txSnap = await db.collection(COL.TX).orderBy('at','desc').get();
    const txList = []; txSnap.forEach(d => txList.push(d.data()));
    if (txList.length) DB.set('tx', txList);

    const walDoc = await db.collection(COL.WAL).doc('main').get();
    if (walDoc.exists) DB.set('wal', walDoc.data());

    const catDoc = await db.collection(COL.CATS).doc('main').get();
    if (catDoc.exists && catDoc.data().list) DB.set('cats', catDoc.data().list);

    const cardDoc = await db.collection(COL.CARDS).doc('main').get();
    if (cardDoc.exists && cardDoc.data().list) DB.set('cards', cardDoc.data().list);

    const budDoc = await db.collection(COL.BUD).doc('main').get();
    if (budDoc.exists) DB.set('bud', budDoc.data());

    return true;
  } catch(e) { console.warn('[FB] pullAll', e); return false; }
}

// 清除雲端
async function fbClearAll() {
  try {
    const db = getDb();
    const snap = await db.collection(COL.TX).get();
    const batch = db.batch();
    snap.forEach(d => batch.delete(d.ref));
    [COL.WAL, COL.CATS, COL.CARDS, COL.BUD].forEach(col =>
      batch.delete(db.collection(col).doc('main'))
    );
    await batch.commit();
  } catch(e) { console.warn('[FB] clearAll', e); }
}

// 初始化
getDb();
