# AI Content Detector：專案遷移與接續開發說明

更新日期：2026-07-31

這份文件是本專案的「搬家說明」與「開發交接紀錄」。將整個專案移到新資料夾後，只要在新的 Codex 對話中請它先閱讀本文件，就能快速理解目前做到哪裡。

> 安全提醒：本文件不包含 Gemini、Sightengine 等 API Key。請勿把 `server/.env` 的內容貼到對話、GitHub 或公開畫面。

## 1. 專案目前用途

這已經不是原本的 `uiui` 公司網站，而是獨立用途的 Chrome AI 內容偵測外掛。

目前只需要保留：

```text
ai-content-detector/
├─ extension/                         Chrome Manifest V3 外掛
│  ├─ manifest.json
│  ├─ service-worker.js
│  ├─ content.js
│  ├─ content.css
│  └─ README.md
├─ server/                            Node.js + Express API
│  ├─ package.json
│  ├─ package-lock.json
│  ├─ .env                            私密設定，不可提交 Git
│  ├─ tools/
│  │  └─ c2patool.exe                 C2PA 工具，不提交 Git
│  └─ src/
│     ├─ app.js
│     ├─ text-detector.js
│     ├─ traditional-chinese-detector.js
│     ├─ image-detector.js
│     ├─ c2pa-detector.js
│     └─ prompts/
│        └─ text-analysis-prompt.js
├─ .gitignore
├─ README.md
└─ PROJECT_HANDOFF_AND_MIGRATION.md
```

已經移除、不應搬回來的舊系統：

- Nuxt、Vue、Firebase
- EJS 與後台
- 購物網站相關程式
- 舊 `pages`、`components`、`store`、`admin`、`static`
- Copyleaks 及其 API 設定

## 2. 目前完成的功能

### 文字偵測

- 使用 Gemini API，不再使用 Copyleaks。
- 目前模型設定為 `gemini-3.5-flash-lite`。
- 最少選取 255 個字，最多 50,000 字。
- 僅支援「以繁體中文為主要內容」的文章。
- 送出 Gemini 前會先在本機檢查語言，不合格不會消耗 API 用量。
- 可以混入少量英文、數字、日語生活用語與專有名詞。
- 日語語境會辨識例如：
  - `草`、`w`、`www`、`笑`、`（笑）` 可能代表笑。
  - `推し`、`かわいい`、`やばい`、`すごい`、`尊い`。
  - 日文姓名、品牌、作品名稱及稱謂。
- 自然的中外文混用不應直接提高 AI 分數。
- 會分析：
  - AI 內容風險
  - 規避偵測風險
  - 過度使用 icon／emoji
  - 標點與空格過度工整
  - 錯字、選字及輸入法痕跡
  - 連接詞、段落與格式規律
- 結果是風險參考，不是作者身分的絕對證明。

### 圖片偵測

- 使用 Sightengine `genai` 模型做像素層級 AI 圖片風險分析。
- 使用 `c2patool.exe` 檢查 C2PA 內容憑證。
- C2PA 和 Sightengine 會一起執行：
  - Sightengine：模型判斷信心。
  - C2PA：圖片來源與編輯歷程的憑證。
- 沒有 C2PA 只代表「來源未知」，不能因此認定圖片不是 AI。
- 目前圖片網址需為可公開存取的 `http` 或 `https` 網址。
- `blob:`、登入後圖片與 Canvas 圖片尚未完整支援。
- 已加入五項不消耗 API 額度的本機輔助分析：圖片品質、雜訊殘差、FFT 頻率分布、邊緣一致性與壓縮／縮放穩定性。
- 本機規則輸出獨立風險與可靠度，不會直接混入 Sightengine 百分比；正式調整門檻前仍需建立測試資料集校準。
- 為維持 Node 14 並避免舊影像框架的安全公告，本機鑑識使用 `jpeg-js` 與 `pngjs`，目前只解析 JPEG／PNG；其他格式會安全降級但不影響 Sightengine／C2PA。

### 外掛介面

- 僅保留反白文字分析與點選圖片分析；整篇文章與拖曳框選功能已移除。
- 顯示文字與圖片的分析結果。
- 結果面板可以垂直捲動。
- 結果頁上、下方都有「返回偵測選項」。
- 已移除不需要的「偵測模式」顯示列。

## 3. 執行環境

目前後端預設網址：

```text
http://localhost:3200
```

健康檢查：

```text
http://localhost:3200/health
```

正常時會回傳 JSON。若瀏覽器開啟根網址出現 `Cannot GET /`，不一定是故障；本專案主要提供 API，請改開 `/health`。

目前曾使用的 Node.js 版本：

```text
Node.js 14.21.3
```

## 4. 私密環境設定

`server/.env` 應至少包含以下欄位，但本文件不記錄真正的 Key：

```dotenv
PORT=3200

GEMINI_ENABLED=true
GEMINI_API_KEY=請填自己的金鑰
GEMINI_MODEL=gemini-3.5-flash-lite

SIGHTENGINE_ENABLED=true
SIGHTENGINE_API_USER=請填自己的帳號
SIGHTENGINE_API_SECRET=請填自己的密鑰
```

注意：

- `.env` 已被 `.gitignore` 排除。
- 專案沒有 `.env.example`，這是先前明確決定刪除的。
- 不要執行 `git add -f server/.env`。
- 若 API Key 曾出現在公開畫面，應立即到服務平台撤銷並重建。

## 5. 平常啟動方式

開啟命令提示字元或 PowerShell：

```powershell
cd C:\project\ai-content-detector\server
npm install
npm run dev
```

也可以：

```powershell
node src/app.js
```

看到以下訊息代表後端已啟動：

```text
AI detector API listening on http://localhost:3200
```

如果出現 `EADDRINUSE`，代表 3200 已經有另一個後端程序在執行。不要再啟動第二次，先測試：

```text
http://localhost:3200/health
```

## 6. Chrome 外掛載入方式

1. 開啟 `chrome://extensions`。
2. 開啟右上角「開發人員模式」。
3. 點「載入未封裝項目」。
4. 選擇新專案內的 `extension` 資料夾，不要選整個專案，也不要選上層「文件」資料夾。
5. 每次修改外掛程式後，在擴充功能頁按「重新載入」。
6. 重新整理要測試的網頁，再按外掛按鈕。

`extension/manifest.json` 與 `extension/service-worker.js` 的後端位置目前都應指向：

```text
http://localhost:3200
```

## 7. 從 uiui 完整分離 Git

建議新專案位置：

```text
C:\project\ai-content-detector
```

最重要的原則：

- 複製程式碼。
- 不要把舊專案的 `.git` 複製到新專案。
- 不要直接刪除原本 `super2025_uiui` 裡的 `.git`。
- `server/.env` 和 `server/tools/c2patool.exe` 不在 Git 中，搬家時要另外確認它們有安全地搬過去。
- `server/node_modules` 可以不搬，之後執行 `npm install` 重建即可。

搬完後，在新資料夾執行：

```powershell
cd C:\project\ai-content-detector
git init
git add .
git status
git commit -m "Initial commit: AI content detector extension"
```

確認新的 Git 根目錄：

```powershell
git rev-parse --show-toplevel
```

正確結果應該是：

```text
C:/project/ai-content-detector
```

再檢查敏感檔案沒有被追蹤：

```powershell
git check-ignore -v server/.env
git check-ignore -v server/tools/c2patool.exe
```

兩個命令都應顯示由 `.gitignore` 排除。如果沒有輸出，先不要提交。

## 8. 搬家後的基本驗證

在新專案根目錄執行：

```powershell
cd server
npm install
npm run check
npm run dev
```

接著：

1. 開啟 `http://localhost:3200/health`。
2. 確認回傳的 Gemini、Sightengine、C2PA 狀態。
3. 到 `chrome://extensions` 移除或停用指向舊資料夾的外掛。
4. 從新資料夾重新載入 `extension`。
5. 用一篇至少 255 字、以繁體中文為主的文章測試。
6. 再用一張公開圖片網址測試 Sightengine 與 C2PA。

## 9. 搬家後如何接續 Codex 對話

對話紀錄本身不一定會隨資料夾自動搬移，但開啟新資料夾後，可以在新的 Codex 對話貼上：

```text
請先完整閱讀 PROJECT_HANDOFF_AND_MIGRATION.md 與 README.md，
再檢查目前程式碼及 git status。
這是從 super2025_uiui 分離出來的 Chrome AI Content Detector。
請依交接文件接續開發，不要恢復 Nuxt、Vue、Firebase、購物網站或 Copyleaks。
不要顯示或提交 server/.env 內的任何金鑰。
```

Codex 仍應重新檢查實際程式碼，因為本文件是交接摘要，程式碼才是最終依據。

## 10. 下一階段建議

目前較值得優先處理的項目：

1. 改善圖片取得方式，支援 `blob:`、Canvas、需登入網站與無公開 URL 的圖片。
2. 把文字分析結果細分到句子或段落，不要只把整段套用同一總分。
3. 建立繁體中文測試資料集，分成人寫、AI 寫、AI 改寫與混合內容。
4. ~~對 Gemini 輸出做固定格式驗證，避免模型回傳異常格式。~~ 已完成：使用 JSON Schema，並在後端嚴格驗證分數、列舉、必填文字與信號結構。
5. 加上錯誤狀態與 API 用量提示。
6. 正式發佈前，將本機後端部署到 HTTPS 伺服器，並限制 API 存取。

## 11. 重要判斷原則

- AI 文字或圖片偵測都有誤判，不應宣稱 0% 或 100% 能證明來源。
- 提示詞判斷是語言模型意見，不是專門訓練的鑑識模型。
- C2PA 是來源憑證，不等於萬能 AI 偵測器。
- API Key 只能存在後端，絕對不能放進 Chrome 外掛的 JavaScript。
- Chrome 外掛若直接呼叫第三方模型並帶 Key，使用者可以取得該 Key，因此必須經過自己的後端。

