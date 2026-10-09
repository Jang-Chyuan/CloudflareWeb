# DogTracker Web

參考 `C:\Dog_Reactive\DogTracker` 的 Slave 追蹤畫面製作，以 React、Vite 與 Leaflet 顯示 Supabase 雲端犬隻資料。

## 功能

- 使用 DogTracker App 的 Supabase Email／密碼帳號登入、恢復登入及登出。
- 每 30 秒讀取已授權 Master 的 Slave 資料，每隻狗合併為一個位置。
- 地圖跟隨、單隻顯示／隱藏、過去 3 分鐘至 24 小時的移動路徑。
- 顯示最新封包、最後有效定位、速度、電量、衛星、HDOP、RSSI、SNR、USB 與活動量。
- 沿用 DogTracker 的環境分類模型，使用已結束的兩分鐘取樣視窗。
- 固定位置使用原專案的 `unlock-fixed-location` 與 `save_unlocked_fixed_location` 密碼解鎖流程。
- 以台灣日期查詢最多 7 天的歷史、Master／犬隻篩選、時間回放、CSV 匯出及原始封包。
- 響應式桌面與手機版面；犬隻別名與顯示偏好依帳號儲存在目前瀏覽器。

不呼叫瀏覽器／手機 GPS、不顯示手機位置，也不掃描 BLE；資料來源僅為 Master 或手機轉送到雲端的 Slave 封包。`upload_source=phone` 是項圈封包的轉送來源，仍保留這些 Slave 資料。

## Supabase

建立本機 `.env.local`（不提交至 GitHub）：

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

沿用現有 DogTracker 後端，不需修改資料庫 schema：

- `device_members`：讀取目前 `user_id` 的 `gateway_id`（`master_N`）授權。
- `dog_telemetry`：讀取 `event_id,master_id,slave_id,seq,received_at,payload,rssi,snr,upload_source,phone_received_at`。
- `slave_fixed_locations`：讀取固定位置設定。若此表未部署或無權限，顯示警示並使用 GPS 位置。
- Edge Function `unlock-fixed-location` 與 RPC `save_unlocked_fixed_location`：修改固定位置時使用。

使用者仍須由管理員授予 Master 存取權限，SELECT 必須沿用既有 RLS。網頁不建立帳號、授權或修改 RLS，不使用 service role／secret key。

原手機專案的解鎖 Edge Function 沒有 CORS 回應，瀏覽器無法直接呼叫。本專案的 `supabase/functions/unlock-fixed-location/index.ts` 沿用原驗證邏輯，另加入 OPTIONS 與 CORS headers；修改固定位置前需部署此版本至同一個 Supabase 專案：

```powershell
supabase functions deploy unlock-fixed-location --project-ref YOUR_PROJECT_REF
```

此步驟只更新函式，依賴原專案已部署的固定位置 migration 與 RPC。本次前端開發未部署或變更線上 Supabase。

## PWA 安裝與離線

使用 HTTPS 正式網址開啟後，支援的 Chrome／Edge／Android 瀏覽器會提供「安裝 DogTracker」入口，也可使用瀏覽器選單安裝。iPhone／iPad 使用 Safari 的「分享 → 加入主畫面」。安裝後以獨立視窗啟動。

Service Worker 預先快取網站 HTML、JavaScript、CSS 與圖示。首次成功連線及完成快取後，可離線重新開啟介面。Supabase 登入、犬隻資料與地圖圖磚不加入離線快取；斷線時顯示離線提示，已開啟頁面的記憶體資料可繼續查看，重新啟動不會恢復犬隻封包。恢復連線後即時追蹤會補讀資料。

新版本就緒時顯示更新提示，由使用者選擇「更新並重新開啟」，避免編輯設定途中自動重新載入。`public/_headers` 讓 Service Worker 與 manifest 重新驗證版本。PWA 僅在正式建置／preview 啟用，開發伺服器不註冊 Service Worker。

```powershell
npm.cmd run build
npm.cmd run preview
npm.cmd run test:pwa
```

PWA 測試使用正式建置，驗證 manifest、PNG 圖示、Service Worker、離線重新載入、離線導覽及安裝按鈕；離線快取不包含 Supabase API 或地圖圖磚。

## 本機開發

```powershell
cd C:\CloudflareWeb\react-dashboard
npm.cmd ci
npm.cmd run dev
```

開啟 http://localhost:5173。

## Cloudflare Workers 部署

在 Workers 的 GitHub 建置設定使用：

| 設定 | 值 |
| --- | --- |
| GitHub repository | `Jang-Chyuan/CloudflareWeb` |
| Branch | `main` |
| Root directory | `react-dashboard` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |

Build variables and secrets 需設定 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY`，設定後重新建置。Vite 在建置時將這兩個公開前端設定寫入程式；Worker 執行時變數不會更新靜態網站。

`wrangler.jsonc` 指定上傳 `./dist`，不可部署 `src` 或原始專案目錄。

## 資料與範圍

Slave 座標除以 1,000,000，速度與 HDOP 除以 100，活動量除以 1,000，比例沿用原 App。手機轉送封包使用 `phone_received_at` 顯示觀測時間；下載游標仍使用保留微秒的 `received_at` 與 `event_id`。

即時清單保留最近 24 小時資料。GPS 為 0,0 或無效時保留最後有效位置，同時顯示最新封包狀態；超過 3 分鐘未更新的圖示不顯示。軌跡不跨越 GPS 缺失、超過 2 分鐘的間隔或 Master 切換，沿用三點平滑與高速權重。USB 已連接或近期室內／窗邊結果符合原規則時可使用固定位置。

首次讀取最近 24 小時，之後每 30 秒從上次完成時間前 5 分鐘補查，每 10 分鐘重新核對 24 小時。背景分頁暫停更新，回到頁面補讀。單次查詢最多 25 萬筆、兩分鐘逾時，逾時／失敗顯示錯誤且保留上一份完整資料。

網頁的封包資料保存在記憶體，重新整理會再讀取，未移植手機 SQLite 或 Android 背景服務。歷史回放顯示查詢到的 GPS 軌跡，不套用手機歷史的固定位置分類。歷史詳細資訊的活動量只涵蓋此次已查詢資料，GPS 速度不是手機位置推算的速度。

## 驗證

```powershell
npm.cmd test
npm.cmd run test:browser
npm.cmd run build
```

資料測試涵蓋單位、手機轉送時間、無定位保留、失效與過期資料、固定位置、軌跡中斷、活動缺值、台灣日期與伺服器分頁限制。

瀏覽器測試使用獨立測試 API URL 與模擬帳號／封包，不讀寫正式 Supabase。涵蓋登入、犬隻地圖、跟隨、隱藏、詳細資訊、解鎖失敗、歷史回放、匯出、登出與手機版版面。Windows 優先使用已安裝的 Chrome／Edge；其他環境可執行 `npx playwright install chromium` 安裝測試瀏覽器。

模型與推論邏輯由參考專案的 `src/ml` 移植，僅將 CommonJS 匯出轉為 ES module。
