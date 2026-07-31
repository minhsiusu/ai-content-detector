# AI Content Detector

這是一套 Chrome Manifest V3 擴充功能，可分析繁體中文文章與網頁圖片的 AI 內容風險。後端使用 Gemini 分析文字、Sightengine `genai` 分析圖片，以 C2PA 內容憑證補充圖片來源資訊，並提供不消耗 API 額度的本機影像鑑識訊號。

偵測結果只代表風險訊號，不能證明作者身分或內容來源。

## 專案結構

```text
extension/  Chrome 擴充功能
server/     Node.js + Express API
```

## 環境需求

- Node.js 14.21.3 或更新版本
- Chrome 或 Chromium 瀏覽器
- Gemini API Key
- Sightengine API 帳號與密鑰（圖片像素分析）
- `c2patool.exe`（Windows 上的 C2PA 憑證檢查）

## 後端設定與啟動

在 `server/.env` 設定：

```dotenv
PORT=3200

GEMINI_ENABLED=true
GEMINI_API_KEY=請填自己的金鑰
GEMINI_MODEL=gemini-3.5-flash-lite

SIGHTENGINE_ENABLED=true
SIGHTENGINE_API_USER=請填自己的帳號
SIGHTENGINE_API_SECRET=請填自己的密鑰
```

請勿提交 `server/.env` 或在前端程式放置 API Key。專案刻意不提供 `.env.example`；上方僅列出必要欄位。

安裝、檢查、測試及啟動：

```powershell
cd server
npm install
npm run check
npm test
npm run dev
```

後端預設位址為 `http://localhost:3200`，健康檢查位址為：

```text
http://localhost:3200/health
```

## 載入 Chrome 擴充功能

1. 開啟 `chrome://extensions`。
2. 啟用「開發人員模式」。
3. 選擇「載入未封裝項目」。
4. 選取本專案的 `extension` 資料夾。
5. 修改擴充功能後，請重新載入擴充功能並重新整理測試頁面。

目前後端與擴充功能預設使用 `http://localhost:3200`。

## 功能與限制

- 文字分析最少 255 字、最多 50,000 字，且文章須以繁體中文為主。
- 圖片像素分析目前需要可公開存取的 `http` 或 `https` 圖片網址。
- 圖片分析會額外檢查圖片品質、雜訊殘差、FFT 頻率分布、邊緣一致性，以及 JPEG／縮放後的特徵穩定性。
- 本機鑑識目前解析 JPEG 與 PNG；其他格式仍可使用 Sightengine 與 C2PA，介面會標示本機分析不可用。
- 本機鑑識規則尚未以真人／AI 圖片資料集校準，只作為 Sightengine 與 C2PA 的輔助說明，不會單獨證明圖片來源。
- `blob:`、Canvas、登入後圖片與無公開網址圖片尚未完整支援。
- C2PA 沒有找到憑證只表示來源未知，不能據此判定圖片不是 AI 生成。

完整交接資訊與後續開發方向請參閱 [PROJECT_HANDOFF_AND_MIGRATION.md](PROJECT_HANDOFF_AND_MIGRATION.md)。
