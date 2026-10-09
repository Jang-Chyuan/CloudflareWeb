# Pulse React Dashboard

## Cloudflare Workers 部署

GitHub 連線後，在 Cloudflare 的 Workers 建置設定使用：

- Root directory：`react-dashboard`
- Build command：`npm ci && npm run build`
- Deploy command：`npx wrangler deploy`

`wrangler.jsonc` 指定上傳 `dist` 建置產物，請勿將專案原始碼目錄當作靜態資源部署。

在建置環境變數（Build variables and secrets）設定 `VITE_SUPABASE_URL` 與
`VITE_SUPABASE_PUBLISHABLE_KEY`（Supabase 的前端 publishable key），然後重新建置部署。
Vite 在建置時將這些值寫入前端程式；只設定 Worker 執行時的變數並不會更新靜態網站。
本機 `.env.local` 不會提交至 GitHub。前端不可使用 Supabase service role 或 secret key。

目前頁面只讀取已登入使用者的 GPS 紀錄，尚未提供登入表單；未登入會顯示「請先登入」。

以 React 與 Vite 建立的繁體中文營運儀表板。所有數據皆為靜態示範資料，尚未串接 API 或登入服務。

## 開始使用

需要 Node.js 22 LTS 與 npm。

```powershell
cd C:\CloudflareWeb\react-dashboard
npm install
npm run dev
```

開啟終端機顯示的本機網址，預設為 http://localhost:5173。

## 正式建置

```powershell
npm run build
npm run preview
```

建置結果位於 `dist`，可用於靜態網站託管。

## 功能

- 營運指標與本週／本月切換
- SVG 營收趨勢圖、流量來源圖
- 訂單與客戶頁面
- 訂單搜尋、狀態篩選及 CSV 匯出（目前符合條件的訂單）
- 響應式版面與手機導覽選單

`src/main.jsx` 包含資料與 React 元件，`src/styles.css` 包含樣式。字型透過 Google Fonts 載入，無法連線時會使用系統備援字型。

## 驗證狀態

建立專案時，執行環境的終端機無法啟動，因此尚未執行 npm install、建置或瀏覽器驗證。
