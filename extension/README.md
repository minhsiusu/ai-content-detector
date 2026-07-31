# AI 文章偵測器（開發版）

## 本機測試

1. 進入 `server` 執行 `npm install` 與 `npm run dev`，API 預設使用 `http://localhost:3100`。
2. Chrome 開啟 `chrome://extensions`。
3. 開啟「開發人員模式」。
4. 點「載入未封裝項目」，選擇本資料夾。
5. 將外掛固定在工具列。
6. 開啟一般新聞或部落格文章，點外掛圖示。

## 三種偵測模式

- 整篇文章：自動尋找 `article`、文章內容區或 `main`。
- 反白文字：先在頁面反白至少 30 字，再點外掛選擇此模式。
- 拖曳框選：選擇模式後，按住滑鼠左鍵拉出矩形；`Esc` 可取消。
- 點選圖片：移動滑鼠到圖片會出現紫色框，點一下就送往圖片分析 API；`Esc` 可取消。

框選模式會依畫面中的文字節點判斷，即使網站使用 `div/span` 拆分文章也能合併分析。它不會辨識圖片或掃描 PDF 裡的文字；後者需要另接 OCR。

圖片選取介面已完成。真正的圖片 AI 鑑識需要在 server 環境設定：

```text
AI_IMAGE_DETECT_URL
AI_IMAGE_DETECT_KEY
```

外部模型預期接受 `{ imageUrl, context }`，並回傳 `score`、`aiProbability` 或 `probability`。未設定時 API 會明確回傳 503，不會產生假的百分比。

目前正在改接 Gemini 提示詞分析模型；模型尚未設定完成前，文字分析 API 會回傳未設定錯誤。

若本機 server 使用的 port 不是 3100，請同步修改 `service-worker.js` 的 `API_BASE_URL` 與 `manifest.json` 的 `host_permissions`。
