'use strict';
const DB={
  get(k){try{return JSON.parse(localStorage.getItem(k))}catch{return null}},
  set(k,v){localStorage.setItem(k,JSON.stringify(v))},
  del(k){localStorage.removeItem(k)},
};
const DEF_CATS=[
  {id:'food',name:'🍜 餐飲',color:'#10b981',sub:['早餐','午餐','晚餐','飲料','零食','聚餐']},
  {id:'transport',name:'🚌 交通',color:'#3b82f6',sub:['加油','捷運/公車','停車費','計程車','高鐵']},
  {id:'shopping',name:'🛍️ 購物',color:'#f59e0b',sub:['服飾','3C','日用品','網購']},
  {id:'home',name:'🏠 居家',color:'#ec4899',sub:['房租','水費','電費','瓦斯','網路']},
  {id:'medical',name:'💊 醫療',color:'#8b5cf6',sub:['掛號','藥費','健檢','牙科']},
  {id:'entertain',name:'🎬 娛樂',color:'#06b6d4',sub:['電影','遊戲','訂閱','旅遊']},
  {id:'education',name:'📚 教育',color:'#84cc16',sub:['學費','補習','課程']},
  {id:'child',name:'👶 育兒',color:'#f97316',sub:['奶粉','玩具','衣物','托育']},
  {id:'other',name:'📦 其他',color:'#94a3b8',sub:['禮金','捐款','雜費']},
];

function initDB(){
  const mg=(o,n)=>{const v=localStorage.getItem(o);if(v&&!DB.get(n)){try{DB.set(n,JSON.parse(v))}catch{}}localStorage.removeItem(o);};
  ['fb_transactions:tx','fb_wallet:wal','fb_categories:cats','fb_cards:cards','fb_budgets:bud','fb_tx:tx'].forEach(p=>{const[o,n]=p.split(':');mg(o,n);});
  if(!DB.get('cats'))    DB.set('cats',   DEF_CATS);
  if(!DB.get('cards'))   DB.set('cards',  []);
  if(!DB.get('icards'))  DB.set('icards', []);
  if(!DB.get('wal'))     DB.set('wal',    {balance:0,history:[]});
  if(!DB.get('bud'))     DB.set('bud',    {});       // 舊格式相容
  if(!DB.get('budgets')) DB.set('budgets',{startDay:1,items:{}}); // 新預算
  if(!DB.get('tx'))      DB.set('tx',     []);
  if(!DB.get('hints'))   DB.set('hints',  {});
  if(!DB.get('prefs'))   DB.set('prefs',  {theme:'dark',accent:'teal',lastCat:'',lastPay:'cash'});
  if(!DB.get('discord')) DB.set('discord',{
    webhook:'',
    onAdd:true,       // 每筆記帳通知
    onDaily:true,     // 每日結算
    dailyHour:21,     // 每日通知時間
    onBudget:true,    // 預算警示
    budgetPct:80,     // 警示百分比
    onWeekly:false,   // 每週摘要
  });
}

// ── 交易 ─────────────────────────────────────────────
function getTx(){return DB.get('tx')||[];}
function addTx(tx){
  const list=getTx();
  tx.id=Date.now().toString(36)+Math.random().toString(36).slice(2,5);
  tx.at=tx.at||new Date().toISOString();
  list.unshift(tx);DB.set('tx',list);
  if(tx.pay==='cash') walOut(tx.amount,tx.detail||catName(tx.cat));
  if(tx.pay==='icard'&&tx.icardId) icardOut(tx.icardId,tx.amount,tx.detail||catName(tx.cat));
  rememberHint(tx.cat,tx.subCat,tx.detail);
  const p=getPrefs();p.lastCat=tx.cat;p.lastPay=tx.pay;DB.set('prefs',p);
  return tx;
}
function delTx(id){
  const list=getTx(),tx=list.find(t=>t.id===id);
  DB.set('tx',list.filter(t=>t.id!==id));
  if(tx){if(tx.pay==='cash')walIn(tx.amount,'刪除還原');if(tx.pay==='icard'&&tx.icardId)icardIn(tx.icardId,tx.amount,'刪除還原');}
}
function txByMonth(y,m){return getTx().filter(t=>{const d=new Date(t.at);return d.getFullYear()===y&&d.getMonth()+1===m;});}
function txByRange(f,e){const s=new Date(f),en=new Date(e);en.setHours(23,59,59);return getTx().filter(t=>{const d=new Date(t.at);return d>=s&&d<=en;});}

// ── 預算週期計算 ─────────────────────────────────────
// 根據 startDay（起始日）算出當前週期的開始和結束日期
function getBudgetPeriod(now){
  now=now||new Date();
  const cfg=getBudgetConfig();
  const startDay=cfg.startDay||1;
  const y=now.getFullYear(),m=now.getMonth()+1,d=now.getDate();
  let periodStart,periodEnd;
  if(d>=startDay){
    // 本月 startDay ~ 下月 startDay-1
    periodStart=new Date(y,m-1,startDay);
    periodEnd=new Date(y,m,startDay-1);
  }else{
    // 上月 startDay ~ 本月 startDay-1
    periodStart=new Date(y,m-2,startDay);
    periodEnd=new Date(y,m-1,startDay-1);
  }
  periodEnd.setHours(23,59,59,999);
  return{start:periodStart,end:periodEnd};
}
function txByPeriod(){
  const{start,end}=getBudgetPeriod();
  return getTx().filter(t=>{const d=new Date(t.at);return d>=start&&d<=end;});
}
function fmtPeriod(){
  const{start,end}=getBudgetPeriod();
  return `${start.getMonth()+1}/${start.getDate()} ～ ${end.getMonth()+1}/${end.getDate()}`;
}

// ── 錢包 ─────────────────────────────────────────────
function getWal(){return DB.get('wal')||{balance:0,history:[]};}
function walIn(n,note){const w=getWal();w.balance+=n;w.history.unshift({type:'in',amount:n,note,time:new Date().toISOString()});DB.set('wal',w);}
function walOut(n,note){const w=getWal();w.balance=Math.max(0,w.balance-n);w.history.unshift({type:'out',amount:n,note,time:new Date().toISOString()});DB.set('wal',w);}

// ── 信用卡 ────────────────────────────────────────────
function getCards(){return DB.get('cards')||[];}
function cardFind(id){return getCards().find(c=>c.id===id)||null;}
function addCard(c){const l=getCards();c.id='cc_'+Date.now().toString(36);l.push(c);DB.set('cards',l);}
function delCard(id){DB.set('cards',getCards().filter(c=>c.id!==id));}

// ── 悠遊卡 ────────────────────────────────────────────
function getIcards(){return DB.get('icards')||[];}
function icardFind(id){return getIcards().find(c=>c.id===id)||null;}
function addIcard(c){const l=getIcards();c.id='ic_'+Date.now().toString(36);c.balance=c.balance||0;c.history=[];l.push(c);DB.set('icards',l);return c;}
function delIcard(id){DB.set('icards',getIcards().filter(c=>c.id!==id));}
function icardTopup(id,amount,payMethod,note){
  const list=getIcards(),idx=list.findIndex(c=>c.id===id);if(idx<0)return;
  list[idx].balance=(list[idx].balance||0)+amount;list[idx].history=list[idx].history||[];
  list[idx].history.unshift({type:'topup',amount,payMethod,note,time:new Date().toISOString()});
  DB.set('icards',list);if(payMethod==='cash')walOut(amount,list[idx].name+' 加值');return list[idx];
}
function icardOut(id,amount,note){const list=getIcards(),idx=list.findIndex(c=>c.id===id);if(idx<0)return;list[idx].balance=Math.max(0,(list[idx].balance||0)-amount);list[idx].history=list[idx].history||[];list[idx].history.unshift({type:'out',amount,note,time:new Date().toISOString()});DB.set('icards',list);}
function icardIn(id,amount,note){const list=getIcards(),idx=list.findIndex(c=>c.id===id);if(idx<0)return;list[idx].balance=(list[idx].balance||0)+amount;list[idx].history=list[idx].history||[];list[idx].history.unshift({type:'in',amount,note,time:new Date().toISOString()});DB.set('icards',list);}

// ── 分類 ─────────────────────────────────────────────
function getCats(){return DB.get('cats')||DEF_CATS;}
function catFind(id){return getCats().find(c=>c.id===id)||{name:id,color:'#94a3b8',sub:[]};}
function catName(id){return catFind(id).name;}
function addCat(c){const l=getCats();c.id='cat_'+Date.now().toString(36);l.push(c);DB.set('cats',l);}
function delCat(id){DB.set('cats',getCats().filter(c=>c.id!==id));}

// ── 預算（新版，含週期） ──────────────────────────────
function getBudgetConfig(){return DB.get('budgets')||{startDay:1,items:{}};}
function saveBudgetConfig(cfg){DB.set('budgets',cfg);}
function getBudgetItem(catId){return(getBudgetConfig().items||{})[catId]||{limit:0};}
function setBudgetItem(catId,limit){const cfg=getBudgetConfig();if(!cfg.items)cfg.items={};cfg.items[catId]={limit};saveBudgetConfig(cfg);}
function getBudgetStartDay(){return getBudgetConfig().startDay||1;}
function setBudgetStartDay(day){const cfg=getBudgetConfig();cfg.startDay=day;saveBudgetConfig(cfg);}
// 相容舊版
function getBudget(id){return getBudgetItem(id).limit||0;}
function setBudget(id,n){setBudgetItem(id,n);}

// ── Discord 設定 ─────────────────────────────────────
function getDiscord(){return DB.get('discord')||{webhook:'',onAdd:true,onDaily:true,dailyHour:21,onBudget:true,budgetPct:80,onWeekly:false};}
function saveDiscord(cfg){DB.set('discord',{...getDiscord(),...cfg});}

// ── 偏好設定 ─────────────────────────────────────────
function getPrefs(){return DB.get('prefs')||{theme:'dark',accent:'teal',lastCat:'',lastPay:'cash'};}
function setPrefs(p){DB.set('prefs',{...getPrefs(),...p});applyTheme();}

// ── 智慧輸入記憶 ─────────────────────────────────────
function getHints(){return DB.get('hints')||{};}
function rememberHint(cat,subCat,detail){
  if(!cat||!detail)return;const h=getHints();if(!h[cat])h[cat]={};const key=subCat||'_';if(!h[cat][key])h[cat][key]=[];
  h[cat][key]=[detail,...h[cat][key].filter(d=>d!==detail)].slice(0,10);DB.set('hints',h);
}
function getDetailHints(cat,subCat){const h=getHints();if(!h[cat])return[];return h[cat][subCat||'_']||[];}
function getAllDetailHints(cat){const h=getHints();if(!h[cat])return[];return Object.values(h[cat]).flat().filter((v,i,a)=>a.indexOf(v)===i).slice(0,20);}

// ── 統計 ─────────────────────────────────────────────
function calcStats(list){
  const total=list.reduce((s,x)=>s+x.amount,0);
  const cash=list.filter(x=>x.pay==='cash').reduce((s,x)=>s+x.amount,0);
  const card=list.filter(x=>x.pay==='card').reduce((s,x)=>s+x.amount,0);
  const icard=list.filter(x=>x.pay==='icard').reduce((s,x)=>s+x.amount,0);
  const byCat={},byCard={},byIcard={},byPerson={};
  list.forEach(x=>{
    byCat[x.cat]=(byCat[x.cat]||0)+x.amount;byPerson[x.person]=(byPerson[x.person]||0)+x.amount;
    if(x.pay==='card'&&x.cardId)byCard[x.cardId]=(byCard[x.cardId]||0)+x.amount;
    if(x.pay==='icard'&&x.icardId)byIcard[x.icardId]=(byIcard[x.icardId]||0)+x.amount;
  });
  return{total,cash,card,icard,byCat,byCard,byIcard,byPerson};
}

// ── 格式化 ────────────────────────────────────────────
function fmt(n){return Number(n).toLocaleString('zh-TW');}
function fmtT(s){const d=new Date(s);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function fmtD(s){const d=new Date(s);return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;}
function groupDay(list){const g={};[...list].sort((a,b)=>new Date(b.at)-new Date(a.at)).forEach(t=>{const k=fmtD(t.at);if(!g[k])g[k]=[];g[k].push(t);});return g;}

// ── 清除 ─────────────────────────────────────────────
function clearAll(){['tx','wal','cats','cards','icards','bud','budgets','hints','discord','fb_tx','fb_wallet','fb_cats','fb_cards','fb_budgets','fb_transactions','fb_categories'].forEach(k=>localStorage.removeItem(k));}

// ── 主題系統 ─────────────────────────────────────────
const ACCENTS={teal:{p:'#00e5b4',p2:'#00b48e',pdim:'rgba(0,229,180,.13)'},blue:{p:'#4f8ef7',p2:'#2563eb',pdim:'rgba(79,142,247,.13)'},pink:{p:'#f472b6',p2:'#db2777',pdim:'rgba(244,114,182,.13)'},purple:{p:'#a78bfa',p2:'#7c3aed',pdim:'rgba(167,139,250,.13)'},yellow:{p:'#fbbf24',p2:'#d97706',pdim:'rgba(251,191,36,.13)'},green:{p:'#4ade80',p2:'#16a34a',pdim:'rgba(74,222,128,.13)'}};
const THEMES={dark:{bg:'#0a0f1e',bg2:'#111827',card:'#1a2235',card2:'#202d42',border:'#2a3550',t:'#e8edf8',t2:'#8896b3',t3:'#4a5670'},light:{bg:'#f0f4f8',bg2:'#ffffff',card:'#ffffff',card2:'#f8fafc',border:'#e2e8f0',t:'#1a202c',t2:'#64748b',t3:'#94a3b8'}};
function applyTheme(){const p=getPrefs(),th=THEMES[p.theme]||THEMES.dark,ac=ACCENTS[p.accent]||ACCENTS.teal,r=document.documentElement;Object.entries(th).forEach(([k,v])=>r.style.setProperty('--'+k,v));r.style.setProperty('--p',ac.p);r.style.setProperty('--p2',ac.p2);r.style.setProperty('--pdim',ac.pdim);}
function currentUser(){return localStorage.getItem('current_user')||'宏龍';}

initDB();
