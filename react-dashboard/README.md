# Pulse React Dashboard

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
