// ============================================================
// 家庭記帳 PWA - 理財 AI 助理
// assistant.js v1.0
// 功能：浮動對話介面、記帳、查詢、分析、對話保存
// ============================================================

(function() {
'use strict';

// ── 角色資料（與 add.html 同步）────────────────────────────
const CHARACTERS = [
  { id:'koala',    emoji:'🐨', name:'無尾熊可可', style:'軟萌溫柔、正能量滿滿，像媽媽一樣鼓勵你，說話暖心，偶爾撒嬌' },
  { id:'oyster',   emoji:'🦪', name:'牡蠣寶寶',   style:'莫名其妙、語出驚人、邏輯跳躍，讓人哭笑不得但忍不住想看' },
  { id:'fox',      emoji:'🦊', name:'狐狸小智',   style:'數據導向、邏輯清晰、像專業財務顧問，給具體可執行的理財建議' },
  { id:'frog',     emoji:'🐸', name:'青蛙呱呱',   style:'嘴巴很壞但其實關心你，每句話都在吐槽，說完又補一句安慰' },
  { id:'otter',    emoji:'🦦', name:'水獺阿福',   style:'超放鬆、佛系、什麼都覺得沒關係，充滿治癒感，讓人壓力全消' },
  { id:'hamster',  emoji:'🐹', name:'倉鼠米米',   style:'超級節省觀念，對每筆花費都心痛，各種省錢妙招脫口而出' },
  { id:'panda',    emoji:'🐼', name:'熊貓胖胖',   style:'什麼都跟吃扯上關係，人生哲學全是食物，超有梗的美食觀點' },
  { id:'hedgehog', emoji:'🦔', name:'刺蝟蓬蓬',   style:'一本正經、像專業會計師、非常重視數字精確度，完全不開玩笑' },
  { id:'cat',      emoji:'🐱', name:'貓咪嗚嗚',   style:'傲嬌、不在乎你但其實很在乎，貓式關心，說話帶刺但有溫度' },
  { id:'dog',      emoji:'🐶', name:'狗狗旺財',   style:'每次都超開心超興奮，用力鼓勵，元氣滿滿，讓人被感染活力' },
  { id:'owl',      emoji:'🦉', name:'貓頭鷹歐比', style:'充滿哲理、說話像古代智者，每句話都有深意，有點裝但很有料' },
  { id:'octopus',  emoji:'🐙', name:'章魚奧托',   style:'腦洞超大、思路跳躍、說話充滿意外，根本猜不到下一句是什麼' },
];

function getChar() {
  const id = localStorage.getItem('mascot_char') || 'koala';
  return CHARACTERS.find(c => c.id === id) || CHARACTERS[0];
}

// ── 對話歷史（session 內保存）──────────────────────────────
let chatHistory   = [];    // Claude 的多輪對話歷史
let pendingTx     = null;  // 待確認的記帳資料
let isOpen        = false;
let isLoading     = false;
let voiceRec      = null;

// ── 工具函數 ─────────────────────────────────────────────────
function fmt(n) { return Number(n).toLocaleString('zh-TW'); }
function today() { return new Date().toLocaleDateString('zh-TW', { year:'numeric', month:'2-digit', day:'2-digit' }); }

function getKey() { return localStorage.getItem('claude_api_key') || ''; }

// ── 取得記帳資料（最近 90 天）────────────────────────────────
function getTxData() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const txList = (typeof getTx === 'function' ? getTx() : [])
    .filter(t => new Date(t.at) >= cutoff && !t.private);
  return txList.map(t => ({
    date:   new Date(t.at).toLocaleDateString('zh-TW'),
    cat:    typeof catName === 'function' ? catName(t.cat) : t.cat,
    detail: t.detail || '',
    amount: t.amount,
    person: t.person || '',
    pay:    t.pay === 'cash' ? '現金' : t.pay === 'icard' ? '悠遊卡' : '信用卡'
  }));
}

function getCatList() {
  return (typeof getCats === 'function' ? getCats() : [])
    .map(c => `${c.id}(${c.name})`).join(', ');
}

function getCardList() {
  return (typeof getCards === 'function' ? getCards() : [])
    .map(c => `${c.id}:${c.name}(${c.last4})`).join(', ') || '無';
}

// ── 建立系統 Prompt ──────────────────────────────────────────
function buildSystemPrompt() {
  const char    = getChar();
  const txData  = getTxData();
  const txJson  = JSON.stringify(txData.slice(0, 200));
  const nowStr  = new Date().toLocaleDateString('zh-TW', {
    year:'numeric', month:'2-digit', day:'2-digit', weekday:'long'
  });

  return `你是「${char.name}」，一個家庭理財 AI 助理。
個性：${char.style}
今天日期：${nowStr}

你服務的是一對台灣夫妻：宏龍（kevin67222@gmail.com）和盈慧（gogosuperbird@gmail.com）。

你有三個能力：
1. 【記帳】幫用戶記錄消費，解析後回傳 JSON
2. 【查詢】查詢消費記錄並統計
3. 【分析】分析消費習慣，給理財建議

可用分類：${getCatList()}
信用卡清單：${getCardList()}

最近 90 天記帳資料（JSON格式）：
${txJson}

判斷規則：
- 如果用戶說的是「記帳/買了/花了/消費」類的話 → 解析為記帳意圖
- 如果用戶問「多少/花了/統計/比較/分析」→ 查詢或分析意圖
- 記帳時，回傳格式必須包含特殊標記 [RECORD] 開頭，後面接 JSON

記帳回傳格式（必須嚴格遵守）：
[RECORD]{"amount":數字,"cat":"分類id","detail":"說明","date":"YYYY-MM-DD","pay":"cash或card或icard","cardId":"信用卡id或null"}[/RECORD]
然後再用你的個性說一句確認的話。

查詢/分析時：直接用你的個性回答，可以用 emoji 和換行讓格式好看。
回答語言：繁體中文。`;
}

// ── 呼叫 Claude API ──────────────────────────────────────────
async function callClaude(userMsg) {
  const key = getKey();
  if (!key) return '請先在設定頁填入 Claude API Key 才能使用我喔！';

  chatHistory.push({ role: 'user', content: userMsg });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2048,
        system: buildSystemPrompt(),
        messages: chatHistory
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 429) return '我太忙了，請稍等一下再問我 ⏳';
      if (res.status === 401) return 'API Key 有問題，請到設定頁重新填入 🔑';
      throw new Error(`HTTP ${res.status}`);
    }

    const data  = await res.json();
    const reply = (data.content?.[0]?.text || '').trim();
    chatHistory.push({ role: 'assistant', content: reply });
    return reply;
  } catch(e) {
    chatHistory.pop(); // 移除失敗的 user message
    if (e.message.includes('fetch')) return '網路受限，請關閉 WiFi 改用行動網路 📶';
    return '發生錯誤：' + e.message;
  }
}

// ── 解析記帳意圖 ─────────────────────────────────────────────
function parseRecord(reply) {
  const match = reply.match(/\[RECORD\]([\s\S]*?)\[\/RECORD\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch(e) {
    return null;
  }
}

function getDisplayReply(reply) {
  return reply.replace(/\[RECORD\][\s\S]*?\[\/RECORD\]/g, '').trim();
}

// ── 確認記帳卡片 ─────────────────────────────────────────────
function buildConfirmCard(r) {
  const catLabel  = typeof catName === 'function' ? catName(r.cat) : r.cat;
  const payLabel  = r.pay === 'cash' ? '💵 現金' : r.pay === 'icard' ? '🎫 悠遊卡' : '💳 信用卡';
  const cardLabel = r.cardId && typeof cardFind === 'function'
    ? `(${cardFind(r.cardId)?.name || r.cardId})` : '';

  return `<div style="background:var(--pdim);border:1.5px solid var(--p);border-radius:12px;padding:12px 14px;margin:8px 0;font-size:.85rem">
    <div style="font-weight:700;color:var(--p);margin-bottom:6px">📋 確認記帳內容</div>
    <div style="color:var(--t1);line-height:2">
      📅 ${r.date}<br>
      📂 ${catLabel}<br>
      📝 ${r.detail || '（無說明）'}<br>
      💰 <b>$${fmt(r.amount)}</b><br>
      ${payLabel} ${cardLabel}
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button onclick="window._assistantConfirm()" style="flex:1;padding:9px;background:linear-gradient(135deg,var(--p),var(--p2));color:#000;border:none;border-radius:8px;font-weight:900;cursor:pointer;font-family:inherit;font-size:.85rem">✅ 確認記帳</button>
      <button onclick="window._assistantCancel()" style="flex:1;padding:9px;background:var(--card2);border:1px solid var(--border);color:var(--t2);border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;font-size:.85rem">❌ 取消</button>
    </div>
  </div>`;
}

// ── 確認記帳 ────────────────────────────────────────────────
window._assistantConfirm = function() {
  if (!pendingTx) return;
  const tx = pendingTx;
  pendingTx = null;

  // 解析日期
  const parts = tx.date.split('-').map(Number);
  const txObj = {
    amount:  tx.amount,
    cat:     tx.cat,
    detail:  tx.detail || '',
    pay:     tx.pay || 'cash',
    cardId:  tx.cardId || null,
    icardId: null,
    person:  localStorage.getItem('current_user') || '宏龍',
    at:      new Date(parts[0], parts[1]-1, parts[2], 12, 0, 0).toISOString()
  };

  if (typeof addTx === 'function')    addTx(txObj);
  if (typeof fbAddTx === 'function')  fbAddTx(txObj);
  if (typeof discordOnAddWithComment === 'function') {
    const char = getChar();
    discordOnAddWithComment(txObj, char.name + ' 透過 AI 助理幫你記帳了 ✨');
  }

  // 移除確認卡片，加入成功訊息
  const confirmCard = document.querySelector('#ast-msgs .confirm-card');
  if (confirmCard) confirmCard.remove();

  const char = getChar();
  appendMsg('assistant', `已幫你記好了！$${fmt(tx.amount)} 已存入 ✅\n${char.name}覺得你很棒，有在好好記帳 💪`);

  // 存到 Firebase 對話記錄
  saveConversation('[已確認記帳] $' + tx.amount + ' ' + (tx.detail||''));
};

window._assistantCancel = function() {
  pendingTx = null;
  const confirmCard = document.querySelector('#ast-msgs .confirm-card');
  if (confirmCard) confirmCard.remove();
  appendMsg('assistant', '好的，取消記帳了。需要修改什麼再告訴我 😊');
};

// ── 發送訊息 ─────────────────────────────────────────────────
async function sendMsg(text) {
  if (!text.trim() || isLoading) return;
  isLoading = true;

  appendMsg('user', text);
  clearInput();
  showTyping();

  const reply = await callClaude(text);
  hideTyping();

  const record = parseRecord(reply);
  const displayReply = getDisplayReply(reply);

  if (record && record.amount > 0) {
    pendingTx = record;
    appendMsg('assistant', displayReply, buildConfirmCard(record));
  } else {
    appendMsg('assistant', displayReply);
  }

  // 存到 Firebase + Discord
  saveChatLog(text, displayReply);
  isLoading = false;
}

// AI 對話記錄專用 Discord 頻道
const CHAT_LOG_WEBHOOK = 'https://discord.com/api/webhooks/1497601562782990407/agylbOyLjHrIGFu46LljF02wCGK4lZNdoqVHw_wOTSNIGxVuBnfBxm_Ozea8t3eZ0WIT';
async function saveChatLog(userMsg, assistantMsg) {
  try {
    // Firebase
    if (typeof getDb === 'function') {
      const uid  = localStorage.getItem('current_uid') || 'unknown';
      const data = {
        uid,
        user:      userMsg,
        assistant: assistantMsg,
        char:      getChar().name,
        at:        new Date().toISOString()
      };
      await getDb().collection('chat_logs').add(data);
    }

    // Discord（專用 #ai對話記錄 頻道）
    if (!CHAT_LOG_WEBHOOK) return;

    const char    = getChar();
    const nowStr  = new Date().toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit' });
    const person  = localStorage.getItem('current_user') || '';
    await fetch(CHAT_LOG_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: `💬 AI 對話記錄　${today()} ${nowStr}`,
          color: 0x6366F1,
          fields: [
            { name: `👤 ${person}`, value: userMsg,       inline: false },
            { name: `${char.emoji} ${char.name}`, value: assistantMsg.slice(0, 1024), inline: false }
          ],
          footer: { text: '家庭記帳 PWA · AI 助理' }
        }]
      })
    });
  } catch(e) {
    console.warn('[assistant] saveChatLog error:', e.message);
  }
}

function saveConversation(note) {
  saveChatLog(note, '✅ 記帳完成');
}


// ── Markdown 簡易渲染 ─────────────────────────────────────────
function renderMarkdown(text) {
  return text
    .replace(/^### (.+)$/gm, '<div style="font-weight:900;font-size:.9rem;color:var(--p);margin:8px 0 4px">$1</div>')
    .replace(/^## (.+)$/gm,  '<div style="font-weight:900;font-size:.95rem;color:var(--t1);margin:10px 0 4px">$1</div>')
    .replace(/^# (.+)$/gm,   '<div style="font-weight:900;font-size:1rem;color:var(--t1);margin:10px 0 4px">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:8px 0">')
    .replace(/^\|(.+)\|$/gm, (match, inner) => {
      if (/^[\s\-\|]+$/.test(inner)) return '';
      const cells = inner.split('|').map(c => c.trim());
      return '<div style="display:flex;gap:4px;margin:2px 0">' +
        cells.map(c => '<span style="flex:1;min-width:0;font-size:.8rem;padding:2px 4px;background:var(--card2);border-radius:4px;word-break:break-all">' + c + '</span>').join('') +
        '</div>';
    })
    .replace(/^[-] (.+)$/gm, '<div style="display:flex;gap:6px;margin:2px 0"><span style="color:var(--p);flex-shrink:0">•</span><span>$1</span></div>')
    .replace(/\n/g, '<br>');
}

// ── UI 操作函數 ──────────────────────────────────────────────
function appendMsg(role, text, extraHtml) {
  const msgs    = document.getElementById('ast-msgs');
  if (!msgs) return;
  const char    = getChar();
  const isUser  = role === 'user';
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `display:flex;align-items:flex-end;gap:8px;margin-bottom:12px;${isUser?'flex-direction:row-reverse':''}`;

  // 頭像
  const avatar = document.createElement('div');
  avatar.style.cssText = `width:32px;height:32px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.1rem;${isUser?'background:var(--pdim)':'background:linear-gradient(135deg,var(--p),var(--p2))'}`;
  avatar.textContent = isUser ? '👤' : char.emoji;

  // 訊息氣泡
  const bubble = document.createElement('div');
  bubble.style.cssText = `max-width:78%;padding:10px 13px;border-radius:${isUser?'16px 4px 16px 16px':'4px 16px 16px 16px'};font-size:.85rem;line-height:1.65;white-space:pre-wrap;word-break:break-word;${isUser?'background:var(--pdim);color:var(--p);':'background:var(--card2);color:var(--t1);border:1px solid var(--border);'}`;

  // 名字標示（助理才顯示）
  if (!isUser) {
    const nameTag = document.createElement('div');
    nameTag.style.cssText = 'font-size:.65rem;color:var(--t3);margin-bottom:3px;font-weight:700';
    nameTag.textContent   = char.name;
    bubble.appendChild(nameTag);
  }

  const textNode = document.createElement('div');
  if (isUser) {
    textNode.textContent = text; // 使用者訊息不渲染 markdown
  } else {
    textNode.innerHTML = renderMarkdown(text); // 助理訊息渲染 markdown
  }
  bubble.appendChild(textNode);

  if (extraHtml) {
    const extra = document.createElement('div');
    extra.className = 'confirm-card';
    extra.innerHTML = extraHtml;
    bubble.appendChild(extra);
  }

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  msgs.appendChild(wrapper);
  msgs.scrollTop = msgs.scrollHeight;
}

function showTyping() {
  const msgs = document.getElementById('ast-msgs');
  if (!msgs) return;
  const char  = getChar();
  const div   = document.createElement('div');
  div.id      = 'ast-typing';
  div.style.cssText = 'display:flex;align-items:flex-end;gap:8px;margin-bottom:12px';
  div.innerHTML = `
    <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--p2));display:flex;align-items:center;justify-content:center;font-size:1.1rem">${char.emoji}</div>
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:4px 16px 16px 16px;padding:12px 16px">
      <div style="display:flex;gap:5px;align-items:center">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--t3);animation:ast-bounce .9s infinite"></span>
        <span style="width:7px;height:7px;border-radius:50%;background:var(--t3);animation:ast-bounce .9s .2s infinite"></span>
        <span style="width:7px;height:7px;border-radius:50%;background:var(--t3);animation:ast-bounce .9s .4s infinite"></span>
      </div>
    </div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function hideTyping() {
  const el = document.getElementById('ast-typing');
  if (el) el.remove();
}

function clearInput() {
  const inp = document.getElementById('ast-input');
  if (inp) { inp.value = ''; inp.style.height = 'auto'; }
}

// ── 語音輸入 ─────────────────────────────────────────────────
function toggleVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('此裝置不支援語音輸入'); return; }

  if (voiceRec) {
    voiceRec.stop(); voiceRec = null; return;
  }

  const btn = document.getElementById('ast-voice');
  const rec = new SR();
  rec.lang = 'zh-TW'; rec.interimResults = false; rec.continuous = false;

  rec.onstart = () => {
    voiceRec = rec;
    if (btn) { btn.textContent = '🔴'; btn.style.color = '#f43f5e'; }
  };
  rec.onresult = (e) => {
    const text = e.results[0][0].transcript;
    const inp  = document.getElementById('ast-input');
    if (inp) inp.value = text;
    sendMsg(text);
  };
  rec.onerror = () => { voiceRec = null; if (btn) { btn.textContent = '🎤'; btn.style.color = ''; } };
  rec.onend   = () => { voiceRec = null; if (btn) { btn.textContent = '🎤'; btn.style.color = ''; } };
  rec.start();
}

// ── 開啟/關閉助理 ────────────────────────────────────────────
function openAssistant() {
  isOpen = true;
  document.getElementById('ast-panel').style.display  = 'flex';
  document.getElementById('ast-fab').style.display    = 'none';
  document.getElementById('ast-overlay').style.display= 'block';

  // 第一次開啟，送開場白
  if (chatHistory.length === 0) {
    const char   = getChar();
    const txList = getTxData();
    const todayTx = txList.filter(t => t.date === today());
    const todayTotal = todayTx.reduce((s, t) => s + t.amount, 0);

    let greeting = '';
    if (todayTotal > 0) {
      greeting = `嗨！今天已經記了 ${todayTx.length} 筆，共 $${fmt(todayTotal)}。有什麼想記帳或想問的嗎？`;
    } else {
      greeting = '嗨！今天還沒有記帳喔，有什麼消費要記錄嗎？或是想查詢什麼？';
    }
    appendMsg('assistant', greeting);
    chatHistory.push({ role: 'assistant', content: greeting });
  }

  // focus 輸入框
  setTimeout(() => {
    const inp = document.getElementById('ast-input');
    if (inp) inp.focus();
  }, 300);
}

function closeAssistant() {
  isOpen = false;
  document.getElementById('ast-panel').style.display   = 'none';
  document.getElementById('ast-fab').style.display     = 'flex';
  document.getElementById('ast-overlay').style.display = 'none';
}

// ── 建立 UI ──────────────────────────────────────────────────
function buildUI() {
  const char = getChar();

  // 動畫 CSS
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ast-bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }
    @keyframes ast-fadeup { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
    #ast-fab { animation: ast-fadeup .4s ease; }
    #ast-panel { animation: ast-fadeup .3s ease; }
    #ast-input:focus { outline: none; border-color: var(--p); }
    #ast-msgs::-webkit-scrollbar { width: 4px; }
    #ast-msgs::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
    .ast-quick { background:var(--card2); border:1px solid var(--border); color:var(--t2); border-radius:20px; padding:5px 12px; font-size:.72rem; cursor:pointer; font-family:inherit; white-space:nowrap; transition:all .15s; }
    .ast-quick:active { background:var(--pdim); border-color:var(--p); color:var(--p); }
  `;
  document.head.appendChild(style);

  // 遮罩
  const overlay = document.createElement('div');
  overlay.id    = 'ast-overlay';
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:299';
  overlay.onclick = closeAssistant;
  document.body.appendChild(overlay);

  // 浮動按鈕
  const fab = document.createElement('div');
  fab.id    = 'ast-fab';
  fab.style.cssText = `position:fixed;bottom:calc(68px + env(safe-area-inset-bottom,0px) + 16px);right:16px;z-index:300;width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--p2));display:flex;align-items:center;justify-content:center;font-size:1.5rem;cursor:pointer;box-shadow:0 4px 20px rgba(0,229,180,.45);transition:transform .2s`;
  fab.textContent = char.emoji;
  fab.onclick     = openAssistant;
  fab.onmouseenter = () => fab.style.transform = 'scale(1.1)';
  fab.onmouseleave = () => fab.style.transform = 'scale(1)';
  document.body.appendChild(fab);

  // 對話面板
  const panel = document.createElement('div');
  panel.id    = 'ast-panel';
  panel.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;z-index:300;max-width:480px;margin:0 auto;flex-direction:column;background:var(--bg);border-radius:20px 20px 0 0;box-shadow:0 -4px 32px rgba(0,0,0,.3);max-height:82vh';

  panel.innerHTML = `
    <!-- 標題列 -->
    <div style="display:flex;align-items:center;gap:10px;padding:14px 16px 10px;border-bottom:1px solid var(--border);flex-shrink:0">
      <div id="ast-hdr-icon" style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--p2));display:flex;align-items:center;justify-content:center;font-size:1.2rem">${char.emoji}</div>
      <div style="flex:1">
        <div id="ast-hdr-name" style="font-weight:800;font-size:.92rem">${char.name}</div>
        <div style="font-size:.68rem;color:var(--t3)">理財 AI 助理 · 隨時問我</div>
      </div>
      <button onclick="clearChat()" style="padding:5px 10px;background:var(--card2);border:1px solid var(--border);color:var(--t3);border-radius:8px;font-size:.68rem;cursor:pointer;font-family:inherit">清空</button>
      <button onclick="closeAssistant()" style="width:30px;height:30px;background:var(--card2);border:1px solid var(--border);color:var(--t2);border-radius:50%;font-size:1rem;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center">✕</button>
    </div>

    <!-- 快捷問題 -->
    <div style="display:flex;gap:6px;padding:8px 12px;overflow-x:auto;flex-shrink:0;scrollbar-width:none">
      <button class="ast-quick" onclick="quickAsk('今天花了多少？')">今天花多少</button>
      <button class="ast-quick" onclick="quickAsk('本週跟上週消費比較')">本週vs上週</button>
      <button class="ast-quick" onclick="quickAsk('這個月哪個分類花最多？')">最多分類</button>
      <button class="ast-quick" onclick="quickAsk('幫我分析消費習慣')">消費分析</button>
      <button class="ast-quick" onclick="quickAsk('照現在速度這個月會超支嗎？')">超支預測</button>
    </div>

    <!-- 訊息區 -->
    <div id="ast-msgs" style="flex:1;overflow-y:auto;padding:8px 12px 4px"></div>

    <!-- 輸入區 -->
    <div style="padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--border);flex-shrink:0">
      <div style="display:flex;gap:8px;align-items:flex-end">
        <textarea id="ast-input" rows="1"
          placeholder="問我任何財務問題，或說「幫我記帳...」"
          style="flex:1;background:var(--card2);border:1.5px solid var(--border);border-radius:12px;padding:10px 12px;font-size:.85rem;color:var(--t1);font-family:inherit;resize:none;line-height:1.5;max-height:100px;overflow-y:auto"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendAssistantMsg()}"
          oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px'"></textarea>
        <button id="ast-voice" onclick="toggleVoice()"
          style="width:38px;height:38px;border-radius:50%;background:var(--card2);border:1.5px solid var(--border);font-size:1.1rem;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">🎤</button>
        <button onclick="sendAssistantMsg()"
          style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--p2));border:none;color:#000;font-size:1.1rem;font-weight:900;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">➤</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
}

// ── 對外函數 ─────────────────────────────────────────────────
window.sendAssistantMsg = function() {
  const inp = document.getElementById('ast-input');
  if (inp && inp.value.trim()) sendMsg(inp.value.trim());
};

window.quickAsk = function(text) {
  sendMsg(text);
};

window.clearChat = function() {
  chatHistory = [];
  pendingTx   = null;
  const msgs  = document.getElementById('ast-msgs');
  if (msgs) msgs.innerHTML = '';
};

window.toggleVoice = toggleVoice;
window.closeAssistant = closeAssistant;

// ── 監聽角色切換（設定頁換角色後同步更新）────────────────────
window.addEventListener('storage', (e) => {
  if (e.key !== 'mascot_char') return;
  const char = getChar();
  const fab  = document.getElementById('ast-fab');
  const icon = document.getElementById('ast-hdr-icon');
  const name = document.getElementById('ast-hdr-name');
  if (fab)  fab.textContent   = char.emoji;
  if (icon) icon.textContent  = char.emoji;
  if (name) name.textContent  = char.name;
});

// ── 初始化 ───────────────────────────────────────────────────
function init() {
  buildUI();
  console.log('[Assistant] 理財 AI 助理已載入');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
