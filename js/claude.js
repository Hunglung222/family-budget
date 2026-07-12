'use strict';
// ══════════════════════════════════════════════════════════
//  Claude API 統一入口（v14.1 新增）
//
//  背景：App 內原本有 11 處各自手寫 fetch('https://api.anthropic.com/v1/messages')
//  （add.html ×3、invest.html、js/advisor.js、js/assistant.js ×2、
//   knowledge.html、private.html、trade.html ×2），只有 assistant.js 的
//   fetchClaudeAPI 有重試機制、advisor.js 有 messages 清洗，其餘都沒有，
//   一旦把含多餘欄位（如對話歷史的 ts）的 messages 直接傳進去，就會重演
//   "Extra inputs are not permitted" 這類 API 報錯。
//
//  這裡把所有呼叫收斂成一個函數：aiComplete()。
//  舊呼叫點逐步遷移時，直接把原本的 fetch(...) 區塊換成這個函數即可，
//  行為（含錯誤處理）盡量與各自原本的寫法相容。
// ══════════════════════════════════════════════════════════

const CLAUDE_MODELS = {
  haiku:  'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
};

/**
 * 低階版本：回傳原生 fetch Response 物件，供需要自行處理 res.json()/串流/續接邏輯的呼叫端使用
 * （例如 assistant.js 的深聊：需要判斷 stop_reason === 'max_tokens' 來自動續接，
 *  這類邏輯留在呼叫端比硬塞進統一封裝更清楚，這裡只收斂「重試」這一層）。
 * 帶自動重試，處理暫時性錯誤 429/500-503/529（Anthropic 過載時常見，重試通常就能成功）。
 * @param {string} key
 * @param {Object} payload - Claude API 的 request body（model/max_tokens/messages/system...）
 * @param {number} [maxRetries=2]
 * @returns {Promise<Response>}
 */
async function fetchClaudeAPI(key, payload, maxRetries = 2, signal) {
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(payload),
        signal,
      });

      // 成功或不需重試的錯誤（401/403/400）→ 直接回傳
      if (res.ok || res.status === 401 || res.status === 403 || res.status === 400) {
        return res;
      }

      // 429 / 500 / 502 / 503 / 529 → 重試（指數退避）
      if ([429, 500, 502, 503, 529].includes(res.status) && attempt < maxRetries) {
        const waitMs = 1500 * Math.pow(2.5, attempt);
        console.warn(`[Claude] HTTP ${res.status}，${(waitMs/1000).toFixed(1)}s 後第 ${attempt+1} 次重試`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      return res;  // 已重試完仍失敗，回傳給上層處理
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1500 * Math.pow(2.5, attempt)));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr || new Error('Unexpected fetch failure');
}

/**
 * 統一呼叫 Claude API。
 * ⚠️ 命名注意：本函數原名 callClaude，但 js/assistant.js 早有一個同名的深聊主函數
 * callClaude(userMsg)（字串參數）。兩者若同名，在同時載入兩檔案的頁面（add.html/index.html…）
 * 會因後載入者覆蓋前者而互相衝突，導致本統一入口失效。故改名為 aiComplete 以避開衝突。
 * @param {Object} opts
 * @param {'haiku'|'sonnet'|string} [opts.model='haiku']  別名或完整 model 字串；未來升級模型只需改這裡的別名對照表
 * @param {string}  [opts.system]           system prompt（選填）
 * @param {Array}   opts.messages           訊息陣列，各則只會保留 {role, content}，其餘欄位自動清洗掉
 * @param {number}  [opts.maxTokens=1024]   max_tokens
 * @param {string}  [opts.apiKey]           不傳則自動從 localStorage 讀 claude_api_key
 * @param {number}  [opts.maxRetries=2]     429/500/502/503/529 時的重試次數（指數退避）
 * @param {AbortSignal} [opts.signal]       可選的中止訊號
 * @returns {Promise<{ok:boolean, text:string, error?:string, status?:number, model:string, raw?:Object}>}
 */
async function aiComplete(opts) {
  opts = opts || {};
  const key = opts.apiKey || (typeof getClaudeKey === 'function' ? getClaudeKey() : '') ||
              localStorage.getItem('claude_api_key') || '';
  const model = CLAUDE_MODELS[opts.model] || opts.model || CLAUDE_MODELS.haiku;

  if (!key) {
    return { ok: false, error: 'NO_KEY', text: '', model };
  }

  // 防禦性清洗：Claude API 只接受 messages 裡每則的 {role, content}，
  // 任何多餘欄位（例如本地儲存對話記錄時附的 ts、id）都會讓 API 直接 400。
  const cleanMessages = (Array.isArray(opts.messages) ? opts.messages : []).map(m => ({
    role: m.role,
    content: m.content,
  }));

  const payload = {
    model,
    max_tokens: opts.maxTokens || 1024,
    messages: cleanMessages,
  };
  if (opts.system) payload.system = opts.system;

  const maxRetries = (opts.maxRetries != null) ? opts.maxRetries : 2;

  try {
    const res = await fetchClaudeAPI(key, payload, maxRetries, opts.signal);

    if (res.ok) {
      const data = await res.json();
      const text = (data.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();
      return { ok: true, text, model, status: res.status, raw: data };
    }

    let errText = '';
    try { errText = (await res.json())?.error?.message || ''; } catch (e) {}
    return { ok: false, error: errText || `HTTP ${res.status}`, text: '', model, status: res.status };
  } catch (e) {
    if (opts.signal && opts.signal.aborted) {
      return { ok: false, error: 'ABORTED', text: '', model };
    }
    return { ok: false, error: e.message || 'NETWORK_ERROR', text: '', model };
  }
}

/**
 * 便利函式：呼叫 Claude 並預期回傳純 JSON（模型回應會先去除 ```json 包裹再解析）。
 * 解析失敗時 ok 為 false，text 保留原始回應方便除錯。
 */
async function aiCompleteJSON(opts) {
  const r = await aiComplete(opts);
  if (!r.ok) return r;
  let clean = r.text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  }
  try {
    const parsed = JSON.parse(clean);
    return { ...r, json: parsed };
  } catch (e) {
    return { ...r, ok: false, error: 'JSON_PARSE_FAILED' };
  }
}
