/* ══════════════════════════════════════════════════════
 * 💬 家庭簡訊共用模組 chat.js
 * ──────────────────────────────────────────────────────
 * index.html 與 add.html 共用此模組，避免兩頁各自維護造成行為不一致
 * 資料層（getChatMessages/saveChatMessages 等）在 db.js
 * ══════════════════════════════════════════════════════ */

function updateChatBadge() {
  const count = getUnreadChatMessages().length;
  const badge = document.getElementById('chat-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function _chatScrollBottom() {
  const el = document.getElementById('chat-list');
  if (el) el.scrollTop = el.scrollHeight;
}

function openChat() {
  renderChatList();
  showModal('chat-modal');
  setTimeout(() => {
    _chatScrollBottom();
    document.getElementById('chat-input')?.focus();
  }, 80);
  markChatReadAndSync();
}

// 標記對方訊息已讀 → 存 local → 同步 server → 更新角標
function markChatReadAndSync() {
  if (markAllChatMessagesRead()) {
    fbSyncChatMessages();
    updateChatBadge();
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/\n/g,'<br>');
}

function renderChatList() {
  const msgs   = getChatMessages();
  const me     = chatMe();
  const listEl = document.getElementById('chat-list');
  if (!listEl) return;

  if (!msgs.length) {
    listEl.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--t3)">
      <div style="font-size:2.2rem;margin-bottom:8px">💬</div>
      <div style="font-size:.83rem">還沒有訊息，傳第一則給對方吧！</div>
    </div>`;
    return;
  }

  let lastDate = '';
  listEl.innerHTML = msgs.map(m => {
    const isMine  = me ? (m.from === me) : false;
    const dt      = new Date(m.createdAt);
    const dateStr = `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}`;
    const timeStr = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
    const isRead  = Array.isArray(m.readBy) && m.readBy.length >= 2;

    let dateDivider = '';
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      dateDivider = `<div style="text-align:center;margin:12px 0 8px">
        <span style="font-size:.68rem;color:var(--t3);background:var(--card2);padding:3px 10px;border-radius:20px">${dateStr}</span>
      </div>`;
    }

    const clickHandler = isMine ? `onclick="chatBubbleTap('${m.id}')"` : '';

    const bubble = isMine
      ? `<div style="display:flex;flex-direction:column;align-items:flex-end;margin-bottom:8px">
          <div style="display:flex;align-items:flex-end;gap:6px;max-width:82%">
            <div style="font-size:.6rem;color:var(--t3);flex-shrink:0;padding-bottom:2px;text-align:right">
              ${isRead ? '<span style="color:#f59e0b;font-weight:700">已讀</span>' : ''}<br>${timeStr}
            </div>
            <div ${clickHandler}
              style="cursor:pointer;background:linear-gradient(135deg,var(--p),var(--p2));color:#000;border-radius:18px 18px 4px 18px;padding:10px 14px;font-size:.88rem;line-height:1.55;word-break:break-word;-webkit-tap-highlight-color:rgba(0,0,0,.15);user-select:none">
              ${escHtml(m.text)}
            </div>
          </div>
        </div>`
      : `<div style="display:flex;flex-direction:column;align-items:flex-start;margin-bottom:8px">
          <div style="font-size:.65rem;color:var(--t3);margin-bottom:3px;margin-left:14px">${escHtml(m.from)}</div>
          <div style="display:flex;align-items:flex-end;gap:6px;max-width:82%">
            <div style="background:var(--card2);border:1px solid var(--border);color:var(--t);border-radius:18px 18px 18px 4px;padding:10px 14px;font-size:.88rem;line-height:1.55;word-break:break-word">
              ${escHtml(m.text)}
            </div>
            <div style="font-size:.6rem;color:var(--t3);flex-shrink:0;padding-bottom:2px">${timeStr}</div>
          </div>
        </div>`;

    return dateDivider + `<div id="cm-${m.id}">${bubble}</div>`;
  }).join('');
}

// 點自己的氣泡 → 展開刪除確認（inline，不用 confirm）
function chatBubbleTap(msgId) {
  const existing = document.getElementById('cm-del-' + msgId);
  if (existing) { existing.remove(); return; }
  document.querySelectorAll('[id^="cm-del-"]').forEach(el => el.remove());

  const me  = chatMe();
  const msg = getChatMessages().find(m => m.id === msgId);
  if (!msg || msg.from !== me) return;

  const container = document.getElementById('cm-' + msgId);
  if (!container) return;

  const delRow = document.createElement('div');
  delRow.id = 'cm-del-' + msgId;
  delRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin:-4px 0 6px;padding-right:2px';
  delRow.innerHTML = `
    <button onclick="doChatDelete('${msgId}')"
      style="font-size:.72rem;padding:5px 12px;background:#ef4444;color:#fff;border:none;border-radius:20px;cursor:pointer;font-family:inherit">
      🗑️ 刪除這則
    </button>
    <button onclick="document.getElementById('cm-del-${msgId}')?.remove()"
      style="font-size:.72rem;padding:5px 12px;background:var(--card2);color:var(--t3);border:1px solid var(--border);border-radius:20px;cursor:pointer;font-family:inherit">
      取消
    </button>`;
  container.appendChild(delRow);
}

function doChatDelete(msgId) {
  deleteChatMessage(msgId);
  fbSyncChatMessages();
  renderChatList();
  updateChatBadge();
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  if (text.length > 500) { toast('訊息太長囉（上限 500 字）', 'warn'); return; }

  const msg = addChatMessage(text);
  if (!msg) { toast('登入資訊尚未就緒，請稍後再試', 'warn'); return; }

  input.value = '';
  input.style.height = 'auto';

  renderChatList();
  setTimeout(_chatScrollBottom, 30);
  updateChatBadge();

  // 背景同步（不擋 UI）
  fbSyncChatMessages();
}

function showChatClearMenu() {
  const msgs = getChatMessages();
  if (!msgs.length) { toast('沒有訊息可以清除', 'info'); return; }
  showModal('chat-clear-modal');
}

function doChatClearAll() {
  clearAllChatMessages();
  fbSyncChatMessages();
  closeModal('chat-clear-modal');
  renderChatList();
  updateChatBadge();
  toast('對話記錄已全部清除', 'ok');
}
