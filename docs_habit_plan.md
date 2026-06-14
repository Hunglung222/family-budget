# 📋 記帳習慣養成系統 — 完整企劃

> 目標：讓宏龍和盈慧每天都願意打開 App 關心財務，靠習慣養成達成財務翻身。
> 核心信念：功能再多，沒有「每天打開」都是白搭。

---

## 一、行為科學三支柱

1. **損失規避（Loss Aversion）** — 人不想打斷連勝紀錄，比正向獎勵更有效
2. **Hook Model 迴路** — 提醒觸發 → 記帳行動 → 即時回饋 → 投入（養出習慣）
3. **情感連結** — 養成寵物會「餓/難過」，產生責任感

---

## 二、四大機制

### 機制 1：每日打卡 + 連續天數 🔥（第一波）
- 觸發點：每天首次打開 App 自動 check-in
- 顯示：首頁頂部「🔥 連續記帳第 N 天」
- **連續定義（已定案）：只要打開 App 就算**（重在習慣養成）
- 資料：Firebase `users/{uid}/streak` = `{current, longest, lastCheckIn}`
- 斷簽寬容：每月 1 次補簽卡（之後可加）

### 機制 2：成就徽章 🏅（第三波）
- 🌱 記帳新芽：連續 3 天
- 🔥 一週戰士：連續 7 天
- 💎 堅持達人：連續 30 天
- 👑 記帳之王：連續 100 天
- 🎯 預算守門員：單月所有分類沒超支
- 💰 儲蓄先鋒：達成一個儲蓄目標
- 🦊 早鳥：早上 8 點前完成記帳 ×10
- 徽章永久收藏在設定頁

### 機制 3：GAS 智慧提醒 ⏰（第一波）
- 跑在 Google 伺服器，**不需開 App** 也會推 Discord
- **時間（已定案）：每天 19:00（日報結算前 1 小時）**
- 邏輯：
  ```
  GAS 19:00 定時
    → 讀 Firestore 今日 transactions
    → 沒記帳 → 推「🦊 今天還沒記帳！連續 N 天別斷在今天」
    → 有記帳 → 推「✅ 今天記了 X 筆共 $Y，確認記完整了嗎？」
    → 連續快斷掉時語氣加強
  ```
- 技術細節（吸取過去經驗）：
  - 用 `hour === reminderHour` 判斷，cache TTL `3600`
  - 用 Firebase 持久化去重（CacheService 有 6 小時上限問題）
  - 時間可在設定頁調整

### 機制 4：電子雞養成 🥚→🐔（第三波，盈慧最愛）
- 把現有「狐狸小智/牡蠣寶寶」12 角色升級成會成長的寵物
- 成長階段：
  - 🥚 蛋（初始）
  - 🐣 幼體（連續 7 天）
  - 🐤 成長期（連續 30 天）
  - 🐔 成熟體（連續 100 天）
- 狀態反映行為：連續記帳→開心發光；1天沒記→餓了；2天+→難過（愧疚感）
- 餵食 = 完成記帳

---

## 三、實作順序

- **第一波（本次）**：機制 1 連續天數 + 機制 3 GAS 提醒
- **第二波**：機制 2 成就徽章（用 streak 資料就能算）
- **第三波**：機制 4 電子雞養成（視覺工程較重，獨立一波）

---

## 四、第一波技術規格

### App 端（js/db.js + index.html）
- `checkInToday()`：讀 `users/{uid}/streak`，比對 lastCheckIn
  - 今天已簽 → 不變
  - 昨天簽過 → current+1
  - 隔超過 1 天 → current 歸 1
  - 更新 longest
  - 寫回 Firebase + localStorage
- index.html 首頁頂部顯示火焰 + 連續天數
- 時區：用 `toLocalISO()`，絕不用 toISOString

### GAS 端（GAS_reminder 或併入現有 GAS v7）
- 新增 hourlyCheck 內判斷：`hour === reminderHour(預設19)`
- 讀今日 transactions（Firestore REST API）
- 讀 streak 取連續天數
- 組訊息推 Discord
- Firebase 去重：寫 `shared/reminder_done_YYYY_M_D`

### 設定頁（settings.html）
- 新增「記帳提醒時間」設定（預設 19:00）
- 寫入 Firebase 供 GAS 讀取

---

## 五、資料結構

```
Firebase: users/{uid}/streak
  current:     當前連續天數
  longest:     歷史最長
  lastCheckIn: 最後簽到日（toLocalISO 格式 YYYY-MM-DD）

Firebase: shared/settings
  reminderHour: 19   ← GAS 讀這個

Firebase: shared/reminder_done_2026_6_13   ← GAS 去重
```
