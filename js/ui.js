'use strict';
// ═══════════════════════════════════════
//  ui.js — 共用 UI 元件
// ═══════════════════════════════════════

// Toast 通知
let _toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// 底部導航（標記當前頁）
function renderNav(active) {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  const items = [
    { href:'./index.html',    ic:'🏠', label:'首頁',   key:'home'     },
    { href:'./report.html',   ic:'📊', label:'報表',   key:'report'   },
    { href:'./add.html',      ic:null,  label:'',       key:'add', isAdd:true },
    { href:'./wallet.html',   ic:'👛', label:'錢包',   key:'wallet'   },
    { href:'./settings.html', ic:'⚙️', label:'設定',  key:'settings' },
  ];
  nav.innerHTML = items.map(it => {
    if (it.isAdd) return `
      <a class="ni ni-add${active==='add'?' on':''}" href="${it.href}">
        <div class="fab">➕</div>
      </a>`;
    return `
      <a class="ni${active===it.key?' on':''}" href="${it.href}">
        <span class="ic">${it.ic}</span>
        <span>${it.label}</span>
      </a>`;
  }).join('');
}

// 確認 Modal（bottom sheet）
function showConfirm(title, msg, onOk) {
  let ov = document.getElementById('_confirm_ov');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = '_confirm_ov';
    ov.innerHTML = `
      <div class="ov" id="_confirm_modal">
        <div class="sheet">
          <div class="sh"></div>
          <div class="st" id="_c_title"></div>
          <p id="_c_msg" style="color:var(--t2);font-size:.9rem;margin-bottom:18px;line-height:1.6"></p>
          <div class="btn-row">
            <button class="btn btn-s" onclick="closeConfirm()">取消</button>
            <button class="btn btn-d" id="_c_ok">確認</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);
  }
  document.getElementById('_c_title').textContent = title;
  document.getElementById('_c_msg').textContent   = msg;
  document.getElementById('_confirm_modal').classList.add('show');
  document.getElementById('_c_ok').onclick = () => { onOk(); closeConfirm(); };
}
function closeConfirm() {
  const m = document.getElementById('_confirm_modal');
  if (m) m.classList.remove('show');
}

// 分類圖示與顏色類別對照
const CAT_IC = { food:'🍜', transport:'🚌', shopping:'🛍️', home:'🏠', medical:'💊', entertain:'🎬', education:'📚', child:'👶', other:'📦' };
const CAT_CL = { food:'', transport:'b', shopping:'w', home:'pk', medical:'pu', entertain:'b', education:'', child:'w', other:'' };
