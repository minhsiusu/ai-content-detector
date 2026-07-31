# AI Content Detector Chrome 外掛

## 本機測試

1. 在 `server` 執行 `npm install` 與 `npm run dev`；API 預設使用 `http://localhost:3200`。
2. Chrome 開啟 `chrome://extensions`。
3. 開啟「開發人員模式」。
4. 點「載入未封裝項目」，選擇本 `extension` 資料夾。
5. 將外掛固定在工具列。
6. 開啟一般網頁，點外掛圖示。

## 偵測方式

- 反白文字：先在頁面反白至少 255 個繁體中文字，再開啟外掛分析。
- 點選圖片：選擇功能後，將滑鼠移到圖片並點擊；按 `Esc` 可取消。

外掛只呼叫本機後端，不包含 Gemini 或 Sightengine 的 API Key。若修改後端連接埠，必須同步修改 `service-worker.js` 的 `API_BASE_URL` 與 `manifest.json` 的 `host_permissions`。
