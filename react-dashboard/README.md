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

追蹤畫面不呼叫瀏覽器／手機 GPS、不顯示手機位置，也不自動掃描 BLE；資料來源為 Master 或手機轉送到雲端的 Slave 封包。Master Wi-Fi 設定由使用者另行按鈕啟動 Web Bluetooth，與追蹤資料來源分開。`upload_source=phone` 是項圈封包的轉送來源，仍保留這些 Slave 資料。

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

Service Worker 預先快取網站 HTML、JavaScript、CSS 與圖示。首次成功連線及完成快取後，可離線重新開啟介面。Supabase API 回應與地圖圖磚不加入 Service Worker 快取；已下載封包另存於 IndexedDB，重新開啟可恢復已登入帳號最近 24 小時的本機資料，離線歷史查詢可查看已下載資料。離線資料可能不完整，恢復連線後即時追蹤會重新核對雲端。

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

即時清單保留最近 24 小時資料。GPS 為 0,0 或無效時保留最後有效位置，同時顯示最新封包狀態；超過 35 分鐘未更新時顯示「× 未更新／最後顯示位置」，並保留最後有效位置。

即時與歷史共用軌跡處理：所有有效 GPS 都顯示定位點，相鄰取樣間隔大於 0 且不超過 2 分鐘以實線連接；20～35 分鐘以淡色虛線表示 30 分鐘定時回報的位置連接示意，其餘間隔不連線。GPS 缺失、Master 切換、同時間點及跨越日期變更線均中斷連線；重複事件與時間去重。分類依據是取樣間隔，並非裝置模式確認，不使用最新命令或健康回報推定歷史模式。

定時回報保留原始座標；連續取樣僅對偏離相鄰點中點不超過 5 公尺的內部點做 20% 輕度平滑，起終點與明顯轉彎保留。地圖分開顯示「連續軌跡估算」與「定位點間直線距離」，距離使用平滑前座標，排除未連線區段。虛線不代表實際行走路線，兩種距離均受 GPS 誤差及取樣間隔影響。不補推測位置，健康回報及室內固定位置不加入軌跡。

首次讀取最近 24 小時，之後每 5 秒從上次完成時間前 5 分鐘補查，每 10 分鐘重新核對 24 小時。背景分頁暫停更新，回到頁面補讀。單次查詢最多 25 萬筆、兩分鐘逾時，逾時／失敗顯示錯誤且保留上一份完整資料。

網頁的封包資料同時保存在記憶體與 IndexedDB，重新整理先恢復本機最近 24 小時資料，再從雲端核對，未移植手機 SQLite 或 Android 背景服務。歷史回放顯示查詢到的 GPS 軌跡，不套用手機歷史的固定位置分類。歷史詳細資訊的活動量只涵蓋此次已查詢資料，GPS 速度不是手機位置推算的速度。

## IndexedDB 本機封包儲存

移動路徑的時間選單提供「選擇 15 天內時段…」，進入歷史軌跡後可指定台灣時間的開始與結束時間（分鐘精度）。也可在歷史軌跡的「查詢方式」選擇「15 天內自訂時段」。連線時查詢 Supabase 並保存結果，離線時查詢 IndexedDB 已下載的封包；支援犬隻篩選、時間回放與 CSV 匯出。區間含開始、不含結束；仍受單次 25 萬筆及兩分鐘逾時限制，資料過多時需縮小時段或選擇單一 Master。原按日期查詢保留每次最多 7 天。

使用瀏覽器原生 IndexedDB，不需安裝套件或修改 Supabase。資料庫名稱為 `dogtracker-telemetry`：`packets` 保存解析後封包及原始 `raw` 資料，`accounts` 保存各帳號最近核對的 Master 授權。資料按帳號 ID 與事件 ID 隔離及去重，可在開發者工具 Application → IndexedDB 檢視。

即時同步與歷史查詢成功後保存下載結果，保留最近 15 天（依 received_at）；連線核對授權時清除過期與撤銷授權 Master 的封包。每次啟動仍重新查詢最近 24 小時雲端資料，不將快取視為完整資料。離線使用最近已知授權與已下載封包，歷史查詢標示資料可能不完整；不會自動下載全部歷史。登出後保留該帳號快取，其他帳號不會讀取。

IndexedDB 不可用或容量不足時顯示提示，雲端讀取與 CSV 匯出仍可使用。清除網站資料會刪除本機封包；不同瀏覽器、手機與網址來源各自獨立。本機開發重新開啟仍需啟動 Vite；正式 PWA 的離線介面由 Service Worker 提供，地圖圖磚與離線登入不在此功能範圍內。

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

地圖定位提示：最新 GPS 有效時顯示正常圖示；GPS 無效但最後有效位置在 35 分鐘內，顯示黃色驚嘆號與「顯示最後有效位置」；最後有效位置超過 35 分鐘才顯示 ×。健康回報不會刷新 GPS 有效時間。


## Master Wi-Fi 設定（Web Bluetooth）

分支：`feature/master-wifi-web-bluetooth`。登入畫面與上方導覽列皆有「Master Wi-Fi 設定」，Master 尚未連網時也能在附近配網。

1. 以支援 Web Bluetooth 的 Chrome／Edge 開啟 HTTPS 網站或 localhost，確認電腦／手機有藍牙。
2. 按「選擇並連線 Master」，由瀏覽器裝置選擇器選取附近的 DogGPS Master。選擇器只列出廣播配網服務 UUID 的裝置。
3. 連線後顯示 Master 目前連線 SSID 與已儲存清單（最多 10 筆，每頁 2 筆）。這不是附近 Wi-Fi 掃描結果。
4. 點選 SSID 可帶入表單，輸入密碼後送出；若是開放網路需明確勾選「此網路不需要密碼」。更新現有 SSID 時也必須重新輸入密碼。
5. 「Master 已受理」僅表示韌體將要求放入佇列，不保證儲存或連線成功；稍後按重新整理，查看目前連線與清單。
6. 刪除需要再次確認；關閉視窗或中斷連線會釋放 BLE 連線，清除表單密碼。

協定沿用 DogTracker Master 的 `BleTask.cpp`：service `7f510001-6d9e-4e2f-a671-8f3f2d49a001`、Wi-Fi characteristic `7f510003-6d9e-4e2f-a671-8f3f2d49a001`，write-with-response 後 read JSON。GATT 讀寫序列化並有 12 秒逾時；斷線後不自動重播密碼寫入。SSID／密碼分別限制 32／63 UTF-8 bytes，完整 JSON 不超過 160 bytes。Master3、Master5、Master201 本機原始碼已有相同 list/upsert/remove 協定；不具備該 characteristic 的舊韌體須先更新。

Wi-Fi 帳密不送入 Supabase／HTTP API、不儲存在 localStorage／sessionStorage，也不回讀已儲存密碼。此功能沿用裝置既有 BLE 存取方式；網站登入及雲端 Master 授權不等同 BLE 層的身分驗證。iPhone／iPad 等不支援 Web Bluetooth 的環境顯示替代提示，不能用這個頁面直接配網。

驗證：`node --test tests/master-wifi.test.js`、`npx playwright test --config playwright.wifi.config.js --grep "Master Wi-Fi"`（獨立 5186 埠）、`npm run build`。瀏覽器案例使用模擬 GATT，涵蓋清單分頁、寫入受理、刪除、斷線、手機排版、網路與儲存不含密碼。實機藍牙與 ESP32 實際重新連線尚待測試；未自動變更任何 Master 帳密。

Web Bluetooth 使用條件參考：https://developer.chrome.com/docs/capabilities/bluetooth


### 掃描 Master 附近的 Wi-Fi

連線 Master 後可按「掃描附近 Wi-Fi」，由 Master 而非瀏覽器／電腦掃描周邊網路。結果包含 SSID、dBm 訊號與是否需要密碼；點選後帶入表單，開放網路會選取免密碼設定，最後仍須按「傳送 Wi-Fi 設定」。已儲存清單與掃描清單分開顯示。

新增 BLE `scan`／`scan_results` 協定，掃描 ID 識別不可變的分頁快照，最多顯示訊號較強的 20 個 SSID。Master 尚未完成時持續輪詢，最多等待 45 秒；失敗、空清單、舊結果或斷線會明確提示。舊 Master 韌體回 invalid_action 時顯示需更新的訊息，手動配網仍可使用。

須先燒錄 XiaoMaster_201 同名分支的掃描韌體；Master3／5／7／9 尚未移植此掃描擴充。ESP32 Master 掃到的範圍、頻段與手機／電腦可能不同。隱藏 SSID 仍須手動輸入。此功能不會將掃描到的 SSID 自動上傳 Supabase。

模擬測試已涵蓋 pending、分頁、排序、空清單、失敗／過期結果、逾時、斷線、舊韌體相容及選取開放／加密網路。2026-11-05 已燒錄 Master201 並透過原生 BLE 完成兩輪實體掃描（6／8 個 SSID，約 8.8／8.7 秒），掃描後 HTTPS 上傳恢復。Master 排隊掃描時會暫停新 HTTPS 請求，避免掃描搶不到共用鎖。瀏覽器實體裝置選擇與掃描仍需手動檢查；自動瀏覽器測試使用模擬 GATT。
