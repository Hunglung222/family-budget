// ══════════════════════════════════════════════════════════════
// inbox.js  ─  家庭記帳通知收件匣（統一模組）
//
// 所有頁面共用同一份邏輯，消除 index.html / add.html 雙份程式碼的維護風險。
// 依賴：db.js（addTx、addIncome、dismissInboxItem、…）firebase.js
// ══════════════════════════════════════════════════════════════

// ─ 內部工具：確認清空後顯示空狀態 ─────────────────────────
function _inboxCheckEmpty() {
  const remaining = document.querySelectorAll('[id^="inbox-item-"]');
  if (!remaining.length) {
    const el = document.getElementById('inbox-list');
    if (el) el.innerHTML = [
      '<div style="text-align:center;padding:32px 0;color:var(--t3)">',
      '<div style="font-size:2rem;margin-bottom:8px">✅</div>',
      '<div style="font-size:.85rem">目前沒有待處理的通知</div>',
      '</div>',
    ].join('');
  }
}

// ─ 通知角標 ────────────────────────────────────────────────
function updateInboxBadge() {
  const count = typeof getUnreadInboxCount === 'function' ? getUnreadInboxCount() : 0;
  const badge = document.getElementById('inbox-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent  = count > 9 ? '9+' : count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// ─ 開啟收件匣 modal ─────────────────────────────────────────
function openInbox() {
  renderInboxList();
  if (typeof showModal === 'function') showModal('inbox-modal');
}

// ─ 渲染收件匣列表 ───────────────────────────────────────────
function renderInboxList() {
  const items  = typeof getInboxItems === 'function' ? getInboxItems() : [];
  const listEl = document.getElementById('inbox-list');
  if (!listEl) return;

  if (!items.length) {
    listEl.innerHTML = [
      '<div style="text-align:center;padding:32px 0;color:var(--t3)">',
      '<div style="font-size:2rem;margin-bottom:8px">✅</div>',
      '<div style="font-size:.85rem">目前沒有待處理的通知</div></div>',
    ].join('');
    return;
  }

  const iconColor = {
    pending_confirm: 'rgba(251,191,36,.15)',
    recurring:       'rgba(0,229,180,.1)',
    installment:     'rgba(99,102,241,.1)',
    bill_due:        'rgba(239,68,68,.12)',
    budget_alert:    'rgba(245,158,11,.12)',
    goal_reminder:   'rgba(0,229,180,.1)',
    receipt:         'rgba(99,102,241,.1)',
    insight:         'rgba(251,146,60,.15)',
    cashflow_alert:  'rgba(239,68,68,.12)',
  };
  const iconBorder = {
    pending_confirm: 'rgba(251,191,36,.3)',
    recurring:       'rgba(0,229,180,.3)',
    installment:     'rgba(99,102,241,.3)',
    bill_due:        'rgba(239,68,68,.3)',
    budget_alert:    'rgba(245,158,11,.3)',
    goal_reminder:   'rgba(0,229,180,.3)',
    receipt:         'rgba(99,102,241,.3)',
    insight:         'rgba(251,146,60,.3)',
    cashflow_alert:  'rgba(239,68,68,.3)',
  };

  listEl.innerHTML = items.map(item => [
    `<div id="inbox-item-${item.id}" style="background:var(--card2);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px">`,
    `  <div style="display:flex;gap:12px;align-items:flex-start">`,
    `    <div style="width:40px;height:40px;border-radius:50%;background:${iconColor[item.type]||'var(--card)'};border:1px solid ${iconBorder[item.type]||'var(--border)'};display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0">${item.icon}</div>`,
    `    <div style="flex:1;min-width:0">`,
    `      <div style="font-size:.88rem;font-weight:900;color:var(--t);margin-bottom:3px">${item.title}</div>`,
    `      <div style="font-size:.76rem;color:var(--t2);margin-bottom:${item.note?'3px':'0'}">${item.subtitle}</div>`,
    item.note ? `      <div style="font-size:.72rem;color:var(--t3)">備註：${item.note}</div>` : '',
    `      <div style="font-size:.68rem;color:var(--t3);margin-top:3px">${item.date}</div>`,
    `    </div>`,
    `  </div>`,
    `  <div id="inbox-action-${item.id}">`,
    `    <div style="display:flex;gap:7px;margin-top:12px">`,
    `      <button onclick="inboxDoAction('${item.id}')"`,
    `        style="flex:1;padding:9px;background:var(--p);color:#000;border:none;border-radius:var(--rs);font-size:.8rem;font-weight:700;cursor:pointer;font-family:inherit">`,
    `        ${item.actionLabel}`,
    `      </button>`,
    `      <button onclick="inboxDoDismiss('${item.id}')"`,
    `        style="padding:9px 14px;background:var(--card);color:var(--t3);border:1px solid var(--border);border-radius:var(--rs);font-size:.76rem;cursor:pointer;font-family:inherit">`,
    `        略過`,
    `      </button>`,
    `    </div>`,
    `  </div>`,
    `</div>`,
  ].join('')).join('');
}

// ─ 動作分派（統一入口）──────────────────────────────────────
function inboxDoAction(id) {
  const items = typeof getInboxItems === 'function' ? getInboxItems() : [];
  const item  = items.find(x => x.id === id);
  if (!item) return;

  switch (item.type) {
    case 'bill_due':
      if (typeof closeModal === 'function') closeModal('inbox-modal');
      location.href = './wallet.html';
      break;
    case 'budget_alert':
      if (typeof closeModal === 'function') closeModal('inbox-modal');
      location.href = './report.html';
      break;
    case 'receipt':
      if (typeof clearInboxReceipt === 'function') clearInboxReceipt(id);
      document.getElementById('inbox-item-' + id)?.remove();
      updateInboxBadge();
      break;
    case 'insight':
      if (typeof closeModal === 'function') closeModal('inbox-modal');
      location.href = './report.html';
      break;
    case 'cashflow_alert':
      if (typeof closeModal === 'function') closeModal('inbox-modal');
      location.href = './wallet.html';
      break;
    // 以下類型皆顯示 inline 快速確認表單
    case 'pending_confirm':
    case 'recurring':
    case 'installment':
    case 'goal_reminder':
      _inboxShowQuickConfirm(id, item);
      break;
    default:
      if (typeof closeModal === 'function') closeModal('inbox-modal');
  }
}

// ─ Inline 快速確認表單 ──────────────────────────────────────
function _inboxShowQuickConfirm(id, item) {
  const rec    = item.raw;
  const isInst = item.type === 'installment';
  const isGoal = item.type === 'goal_reminder';
  const isPend = item.type === 'pending_confirm';

  // 預填金額
  const defAmt = isInst ? (rec.monthlyAmt || rec.amount || 0)
               : isPend ? (rec.amount || 0)
               : isGoal ? ''
               : (rec.amt || 0);

  // 副標文字
  const subLabel = isGoal ? `目標：$${typeof fmt==='function'?fmt(rec.targetAmount||0):rec.targetAmount||0}，請輸入本期存入金額`
                 : isPend ? `分類：${typeof catName==='function'?catName(rec.cat):rec.cat}　付款：${rec.pay||'?'}`
                 : isInst ? `💳 信用卡　分類：${typeof catName==='function'?catName(rec.cat)||rec.cat||'未分類':'?'}`
                 : (() => {
                     const p = rec.pay==='acct'?'🏦 帳戶':rec.pay==='card'?'💳 信用卡':'💵 現金';
                     const c = typeof catName==='function'?catName(rec.cat)||rec.cat||'未分類':'?';
                     return `付款：${p}　分類：${c}`;
                   })();

  const confirmLabel = isGoal ? '✅ 更新進度'
                     : isPend ? '✅ 確認記帳'
                     : '✅ 確認記帳';

  const actionEl = document.getElementById('inbox-action-' + id);
  if (!actionEl) return;

  actionEl.innerHTML = [
    `<div style="background:rgba(255,255,255,.04);border-radius:10px;padding:10px;margin-top:8px">`,
    `  <div style="font-size:.75rem;color:var(--t2);margin-bottom:6px">${subLabel}</div>`,
    `  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">`,
    `    <span style="font-size:.82rem;color:var(--t2)">${isGoal?'存入 $':'金額 $'}</span>`,
    `    <input type="number" id="rc-quick-amt-${id}"`,
    `      value="${defAmt}" placeholder="輸入金額" inputmode="numeric"`,
    `      style="flex:1;padding:6px 10px;background:var(--card2);border:1px solid var(--border);`,
    `             border-radius:8px;color:var(--t);font-size:.88rem;font-family:inherit">`,
    `  </div>`,
    `  <div style="display:flex;gap:8px">`,
    `    <button onclick="_inboxConfirm('${id}')"`,
    `      style="flex:1;padding:8px;background:linear-gradient(135deg,var(--p),var(--p2));`,
    `             color:#000;border:none;border-radius:8px;font-weight:700;font-size:.85rem;`,
    `             cursor:pointer;font-family:inherit">${confirmLabel}</button>`,
    `    <button onclick="inboxDoDismiss('${id}')"`,
    `      style="padding:8px 14px;background:var(--card2);border:1px solid var(--border);`,
    `             color:var(--t2);border-radius:8px;font-size:.82rem;cursor:pointer;font-family:inherit">稍後</button>`,
    `  </div>`,
    `</div>`,
  ].join('');

  setTimeout(() => document.getElementById('rc-quick-amt-' + id)?.focus(), 80);
}

// ─ 確認記帳（所有需要 inline 輸入的 type 統一入口）──────────
function _inboxConfirm(id) {
  const items = typeof getInboxItems === 'function' ? getInboxItems() : [];
  const item  = items.find(x => x.id === id);
  if (!item) return;

  const rec   = item.raw;
  const amtEl = document.getElementById('rc-quick-amt-' + id);
  const amt   = parseInt(amtEl?.value) || 0;

  if (!amt) {
    if (typeof toast === 'function') toast('請輸入金額', 'warn');
    amtEl?.focus();
    return;
  }

  const _fmt  = typeof fmt  === 'function' ? fmt  : n => n;
  const _user = typeof currentUser === 'function' ? currentUser() : '';

  // ── 儲蓄目標更新 ──
  if (item.type === 'goal_reminder') {
    if (typeof updateGoal === 'function') updateGoal(rec.id, { current: (rec.current||0) + amt });
    if (typeof fbSyncGoals === 'function') fbSyncGoals();
    if (typeof dismissInboxItem === 'function') dismissInboxItem(id);
    _inboxRemoveItem(id);
    if (typeof toast === 'function') toast(`✅ ${rec.name} 進度 +$${_fmt(amt)}`);
    return;
  }

  // ── 待確認記帳（pending_confirm）──
  if (item.type === 'pending_confirm') {
    const tx = {
      amount: amt, cat: rec.cat, subCat: rec.subCat || '',
      detail: rec.detail, person: rec.person,
      pay: rec.pay, cardId: rec.cardId, icardId: rec.icardId, acctId: rec.acctId,
      tags: [], at: new Date().toISOString(),
    };
    const saved = typeof addTx === 'function' ? addTx(tx) : null;
    if (typeof fbAddTx          === 'function') fbAddTx(saved || tx);
    if (typeof removePendingRequest === 'function') removePendingRequest(id);
    if (typeof fbSyncPendingRequests === 'function') fbSyncPendingRequests();
    if (typeof discordOnAdd     === 'function') discordOnAdd(saved || tx);
    _inboxRemoveItem(id);
    if (typeof toast === 'function') toast(`✅ 已確認記帳 $${_fmt(amt)}`);
    return;
  }

  const isInst   = item.type === 'installment';
  const isIncome = !isInst && rec.type === 'income';

  // ── 固定收入 ──
  if (isIncome) {
    const inc = {
      amount: amt,
      source: rec.source || rec.name || '固定收入',
      person: _user, note: rec.name || '',
      at: new Date().toISOString(),
    };
    if (typeof addIncome    === 'function') addIncome(inc);
    if (typeof fbSyncIncomes === 'function') fbSyncIncomes();
    if (typeof fbMarkRecurringDone === 'function') fbMarkRecurringDone(id);
    else if (typeof dismissInboxItem === 'function') dismissInboxItem(id);
    _inboxRemoveItem(id);
    if (typeof toast === 'function') toast(`💰 已入帳：${inc.source} +$${_fmt(amt)}`);
    return;
  }

  // ── 固定支出 / 分期 ──
  const pay    = isInst ? 'card' : (rec.pay || 'cash');
  const cardId = isInst ? (rec.cardId||null) : (pay==='card' ? (rec.cardId||null) : null);
  const acctId = !isInst && pay==='acct' ? (rec.acctId||null) : null;

  const tx = {
    amount:  amt,
    cat:     rec.cat || '',
    detail:  rec.name || (isInst ? '分期付款' : '固定支出'),
    person:  _user,
    pay, cardId, acctId, icardId: null,
    at:      new Date().toISOString(), tags: [],
  };
  const saved = typeof addTx === 'function' ? addTx(tx) : null;
  if (typeof fbAddTx === 'function') fbAddTx(saved || tx);

  if (isInst && rec.id && rec.periodYM) {
    if (typeof markInstallmentPaid  === 'function') markInstallmentPaid(rec.id, rec.periodYM);
    if (typeof fbSyncInstallments   === 'function') fbSyncInstallments();
  }
  if (typeof fbSyncPersonal === 'function') fbSyncPersonal();
  if (!isInst) {
    if (typeof fbMarkRecurringDone === 'function') fbMarkRecurringDone(id);
    else if (typeof dismissInboxItem === 'function') dismissInboxItem(id);
  } else {
    if (typeof dismissInboxItem === 'function') dismissInboxItem(id);
  }
  if (typeof discordOnAdd === 'function') discordOnAdd(saved || tx);
  _inboxRemoveItem(id);
  if (typeof toast === 'function') toast(`✅ 已記帳：${tx.detail} -$${_fmt(amt)}`);
}

// ─ 移除 inbox item DOM 並更新角標 ──────────────────────────
function _inboxRemoveItem(id) {
  document.getElementById('inbox-item-' + id)?.remove();
  updateInboxBadge();
  _inboxCheckEmpty();
}

// ─ 略過（Dismiss）──────────────────────────────────────────
function inboxDoDismiss(id) {
  const items = typeof getInboxItems === 'function' ? getInboxItems() : [];
  const item  = items.find(x => x.id === id);
  // pending_confirm 只是暫時略過，不永久 dismiss
  if (item && item.type !== 'pending_confirm') {
    if (typeof dismissInboxItem === 'function') dismissInboxItem(id);
  }
  _inboxRemoveItem(id);
}

// ─ 全部清除 ────────────────────────────────────────────────
function clearAllInbox() {
  const items = typeof getInboxItems === 'function' ? getInboxItems() : [];
  items.forEach(item => {
    if (item.type !== 'pending_confirm' && typeof dismissInboxItem === 'function') {
      dismissInboxItem(item.id);
    }
  });
  renderInboxList();
  updateInboxBadge();
}

// ─ 向後相容的別名（舊程式碼使用舊函數名時不會報錯）──────────
const inboxActionAdd  = inboxDoAction;
const inboxDismissAdd = inboxDoDismiss;
const inboxAction     = inboxDoAction;
const inboxDismiss    = inboxDoDismiss;
// confirmRecurringTx 作為舊名別名（部分外部程式碼可能呼叫）
function confirmRecurringTx(id) { _inboxConfirm(id); }
function showRecurringQuickConfirm(id, item) { _inboxShowQuickConfirm(id, item); }
