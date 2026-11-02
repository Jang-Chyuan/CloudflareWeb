# DogTracker Web

參考 `C:\Dog_Reactive\DogTracker` 的 Slave 追蹤畫面製作，以 React、Vite 與 Google Maps 顯示 Supabase 雲端犬隻資料。

## 功能

- 使用 DogTracker App 的 Supabase Email／密碼帳號登入、恢復登入及登出。
- 每 5 秒讀取已授權 Master 的 Slave 資料，每隻狗合併為一個位置。
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
VITE_GOOGLE_MAPS_API_KEY=YOUR_GOOGLE_MAPS_API_KEY
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

Build variables and secrets 需設定 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY` 與 `VITE_GOOGLE_MAPS_API_KEY`，設定後重新建置。Vite 在建置時將這些公開前端設定寫入程式；Worker 執行時變數不會更新靜態網站。

Google Maps 設定：在 Google Cloud 專案啟用帳務與 Maps JavaScript API。API Key 設定網站來源限制，允許正式網站及本地測試網址（如 `http://127.0.0.1:5173/*`、`http://localhost:5173/*`），API 限制只允許 Maps JavaScript API。前端金鑰會出現在瀏覽器中，請以來源與 API 限制管理使用範圍。本專案使用 OverlayView 自訂狗圖示與標籤，不需要 Map ID。地圖內建道路／衛星切換；未設定金鑰時顯示錯誤訊息，犬隻清單仍可查看。地圖 SDK 與底圖不納入離線快取。

官方文件：[載入 API](https://developers.google.com/maps/documentation/javascript/load-maps-js-api)、[自訂覆蓋層](https://developers.google.com/maps/documentation/javascript/customoverlays)。瀏覽器測試使用離線 Maps API 模擬檢查覆蓋層與追蹤互動；實際底圖、帳務／網域授權及道路／衛星切換需以有效金鑰另行驗證。

`wrangler.jsonc` 指定上傳 `./dist`，不可部署 `src` 或原始專案目錄。

## 資料與範圍

Slave 座標除以 1,000,000，速度與 HDOP 除以 100，活動量除以 1,000，比例沿用原 App。手機轉送封包使用 `phone_received_at` 顯示觀測時間；下載游標仍使用保留微秒的 `received_at` 與 `event_id`。

即時清單保留最近 24 小時資料。GPS 為 0,0 或無效時保留最後有效位置，同時顯示最新封包狀態；超過 35 分鐘未更新時顯示「× 未更新／最後顯示位置」，並保留最後有效位置。軌跡不跨越 GPS 缺失、超過 2 分鐘的間隔或 Master 切換，沿用三點平滑與高速權重。USB 已連接或近期室內／窗邊結果符合原規則時可使用固定位置。

首次讀取最近 24 小時，之後每 5 秒從上次完成時間前 5 分鐘補查，每 10 分鐘重新核對 24 小時。背景分頁暫停更新，回到頁面補讀。單次查詢最多 25 萬筆、兩分鐘逾時，逾時／失敗顯示錯誤且保留上一份完整資料。

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


## Master 201 / Slave 102 tracking／sleep

犬隻卡片只在 Master 201／Slave 102 顯示「開始追蹤 tracking」「停止追蹤 sleep」。網頁透過登入 session 呼叫 RPC create_device_command，成功寫入 public.device_commands 後顯示等待 Master，每 3 秒更新最新命令狀態。離線不接受新命令；不會離線排程。相同動作在 HTTP 結果不明時重試沿用 request_id 去重。命令有效期 60 秒。

先在 Supabase SQL Editor 執行 supabase/migrations/202611010001_device_commands.sql，再部署前端。此 migration 相容已核對的既有 device_commands 表，保留資料與 radio_command_id identity。也可在已登入並連結正確專案的 Supabase CLI 檢查 db push --dry-run 後執行 db push；不要將其他未確認的 migration 一起部署。

權限沿用 device_members：沿用既有網站與 slave_names 的 Master 層級授權：使用者在 device_members 有 gateway_id=master_201 即可控制此 Master 的 Slave 102；slave_id 不額外作控制限制。目前線上 master_201 的 membership 使用預設 slave_id=4，不能誤判為無 Master 權限。若日後要區分每個 Slave 的控制權，應另外設計控制授權欄位。authenticated 僅可 SELECT，不可直接 INSERT／UPDATE。RPC 從 auth.uid() 取得操作者，驗證目標與授權後寫入，service_role 可供後續裝置端函式更新狀態；前端不含 secret key。

本次範圍是網頁送命令入表。Master 拉取、租約及 ACK 結果回報尚須另外實作，沒有消費端時 queued 不代表 Slave 已執行。畫面可顯示 queued 命令本地到期，但資料庫 expired 狀態需由未來消費端／排程維護。每次明確的新操作建立新命令，不自動取代舊命令。radio_command_id 沿用資料庫 identity，Master 橋接層須使用此 ID，並避免與自動健康檢查 ID 衝突；網頁不自行產生無線命令 ID。sleep 停止連續追蹤並保留定期回報。

已於 2026-11-01 對 dog-gps 專案套用上述 SQL（透過 CLI db query --file，未變更 migration history）。線上回滾驗證腳本：tests/device-commands.rollback.sql；可驗證兩種動作、重試去重、錯誤目標、RLS 與未授權拒絕。測試會回滾所有命令資料，但 identity sequence 可能前進。此版本前端尚未發布至 Cloudflare。


命令介面：要求開始追蹤／要求省電待機使用中性色外框，與裝置模式分開呈現。只有最新命令 status=confirmed、reported_mode 有效且 completed_at 可解析時顯示已確認模式與台灣時間；等待、過期、失敗、離線或狀態讀取失敗時顯示未知。綠色僅用於已確認的追蹤中。

Map label status: the newer report for the same Master/Slave supplies packet time, battery and RSSI (dog_telemetry vs dog_health, compared by received_at). GPS always uses the last valid dog_telemetry fix; names still use slave_names. Invalid fields in the selected report remain unavailable rather than borrowing older values.
