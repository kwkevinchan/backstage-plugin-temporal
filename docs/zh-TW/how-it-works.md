# 運作方式

[English](../how-it-works.md) | 繁體中文

這篇回答：一個請求怎麼從瀏覽器走到 Temporal 再回來？權限檢查和稽核紀錄在哪裡？選用的模組接在哪裡？內容用兩個請求來說明：打開一次執行的詳細頁（讀取），和在那一頁按 Cancel（操作）。接著再看一個比較長的情境：Scaffolder 範本啟動流程、等它、再對它送 Update。

外掛做兩件事：把 Temporal 的流程顯示在 Backstage 裡；除非 `temporal.control.enabled` 是 false，也讓人從 Backstage 操作流程。它沒有自己的資料庫，每次請求都向 Temporal 查詢，並由 Backstage 的權限框架決定使用者能看什麼。

## 圖一：一個請求經過各層

![看和做兩種請求由上往下經過同樣的層：瀏覽器、Routes、Access 授權、Services、Repositories、共用連線，最後到 Temporal。兩者共用同一個授權檢查；操作多一道操作權限和稽核紀錄。](images/request-path.svg)

青綠色是讀取路徑，橘色是操作路徑（改動流程的路由，除非 `temporal.control.enabled` 是 false）。兩條路經過同樣的層、同一個授權檢查。之後，讀取交給查詢 service；操作要再過第二道操作權限，並且整段包在稽核紀錄裡。兩者都從同一條連線到 Temporal。各層的說明見[架構](architecture.md#各層)。

### 讀取：打開詳細頁

1. 頁面用 `TemporalClient` 呼叫後端，Backstage 的 `fetchApi` 會自動帶上使用者的 token。
2. `routes/router.ts` 認出使用者，從網址取出 Namespace 和 workflow ID。它不做任何判斷，只負責轉交。
3. `TemporalAccessService.loadWorkflow()` 依序檢查：Namespace 在允許清單裡（否則 `400`）；使用者對這個頁面所屬的實體有 read 權限（否則 `403`）；實體存在於 catalog 而且使用者看得到，流程也屬於這個實體（否則 `404`）。沒有指定實體就打開的流程（從 Workflows 頁進來）改由 list 權限允許；如果不適用，就看流程的 `entityRef` Search Attribute 決定要對哪個實體檢查權限。
4. `WorkflowQueries` 透過 `TemporalReadRepository` 讀取流程，把 Temporal 的資料轉成外掛自己的 API 型別。Memo 存在 S3 的流程，由 `PayloadStore` 負責取回，並核對 SHA-256。
5. JSON 回到頁面。Temporal 那邊的錯誤會轉成對應的 HTTP 狀態，例如連不上時回 `503`。

清單走同樣的層，只是入口不同：路由向授權服務要實體的 read 權限（`loadEntity`），再由 `WorkflowListQueries` 組出查詢。Workflows 頁則改問 list 權限，後端把它的條件轉成 visibility 查詢。

### 操作：按 Cancel

1. 按鈕來自前端外掛，確認之後送出 `POST …/cancel`。
2. `controlRoutes.ts` 先呼叫同一個 `loadWorkflow()`。看不到某個流程的人，也就不能操作它。
3. 再做第二道檢查：實體上的 `temporal.workflow.cancel` 權限。能讀不代表能取消。流程也必須還在執行，否則回 `409`。
4. `audited()` 先開一筆稽核事件，執行 `WorkflowCommands.cancel()`，並記下成功或失敗。
5. `WorkflowCommands` 用共用連線送出取消請求，身分是 Backstage 使用者；頁面接著重新讀取流程。

### 圖一看得出來的事

- **沒有資料庫。** 外掛是 Temporal 前面的一層。每次請求都向 Temporal 查，再用 Backstage 的權限決定給不給看。
- **授權只有一份。** 後端外掛提供 `TemporalAccessService`（`temporalAccessServiceRef`），改動流程的路由和各模組都用它，不會有兩套可能不一致的檢查。
- **操作那一欄可以整個關掉。** 設 `temporal.control.enabled: false`，後端就沒有任何會改動流程的路由，頁面都是唯讀的。

## 圖二：從範本到決定

這個情境是：Scaffolder 範本啟動一個流程，等流程需要人決定的那一刻，再送出一個給決定的 Update。流程的程式碼是你自己的；這張圖沒有用到本版本庫的任何流程。

![時間由上往下的四個階段：使用者執行範本，範本步驟用該使用者的身分透過外掛啟動流程；另一個步驟等到流程設定搜尋屬性；Update 經外掛送進流程，流程接著結束。每一次外掛呼叫都先檢查權限。](images/request-sequence.svg)

橘色箭頭是操作（改動流程的路由），青綠色是讀取，紫色是你自己的程式（Worker 和它送出的東西），黑色是 Backstage 和 Temporal 自己的動作，虛線是回應。時間由上往下。

1. **啟動。** 使用者送出範本。範本的 `temporal:workflow:start` 步驟**以該使用者的身分**呼叫外掛後端。外掛檢查實體的 start 權限，確認流程類型和 Task Queue 是這個實體自己的，開一筆稽核事件，設定 `entityRef` 和 `initiator` Search Attribute，然後啟動流程，回 `201` 和 workflow ID。Temporal 把工作放進 Task Queue，由 Worker 執行流程。
2. **等待。** `temporal:workflow:wait` 步驟輪詢 `GET …/workflows/:workflowId`（第一次立刻查，之後先隔 `intervalSeconds` 秒、預設 5 秒，間隔逐次加倍，最多 `maxIntervalSeconds` 秒、預設 30 秒），直到 `untilSearchAttribute` 指定的 Bool Search Attribute 變成 true。流程走到需要決定的地方就會設定它，這時範本就能結束，並附上流程的連結。
3. **決定。** 有人送出 Update：從詳細頁的 **Update…** 對話框，或用另一個範本，其 `temporal:workflow:signal` 步驟設 `kind: update`。外掛通過授權檢查，檢查 update 權限，核對名稱是否在 `temporal.control.allowedUpdates` 內，開稽核事件，再帶著使用者的身分送出 Update。流程的 validator 檢查它，handler 記下決定，結果（或 validator 的錯誤）回到使用者。
4. **收尾。** 流程繼續執行、清掉屬性並結束。頁面再用圖一的路徑讀取它。

### 圖二看得出來的事

- **外掛出現三次：** 啟動流程、讓範本輪詢流程狀態、把 Update 送進流程。每一次都先檢查權限。流程本身在你的 Worker 裡執行；等待決定的時候它只是停著，狀態由 Temporal 保存。
- **範本步驟以執行範本的使用者的身分執行**，不是 Scaffolder 自己的身分，所以權限和稽核紀錄都算在那個使用者身上。那個使用者的 token 從建立任務起大約一小時到期，所以 `wait` 最長 3600 秒；用服務憑證啟動的任務則以那個服務的身分執行。見 [Scaffolder 模組的 README](../../plugins/scaffolder-backend-module-temporal/README.md)（英文）。
- **決定可以走不同的路，檢查也不同。** 走外掛的 update 端點（對話框和範本步驟都是），檢查的是 update 權限和 `allowedUpdates`；使用者有沒有資格做這個決定，則由你流程裡的 update handler 判斷，請在那裡檢查（實體的 `spec.messages` 可以用 `userField` 把登入的使用者預填進參數，但請求也可以不透過表單送出）。如果需要在外掛這一層多加規則，可以註冊自己的 control action，它走同樣的兩道權限檢查和稽核，並且可以加上自己的規則；見[擴充點](architecture.md#擴充點)。

## 選用模組接在哪裡

後端外掛本身會在 catalog 加一個 processor，讓 catalog 接受 `TemporalWorkflow` 實體並產生它們的關係；除非 `temporal.control.enabled` 是 false，它也提供圖一橘色那一欄的各種操作。

| 模組                                                           | 接在哪一層        | 做什麼                                                                                                                |
| -------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `scaffolder-backend-module-temporal`                           | Routes 的前面     | 範本步驟 `temporal:workflow:start`、`wait`、`signal` 以使用者的身分呼叫同樣的 HTTP 路由，所以權限和稽核都一樣。       |
| `scaffolder-module-temporal`                                   | 瀏覽器            | Create 表單裡的 `TemporalWorkflowPicker` 欄位，資料來自外掛的路由。                                                   |
| `temporal-module-zigflow` 和 `temporal-backend-module-zigflow` | 瀏覽器和 Routes   | 一個 **Definition** 分頁，和一條讀取實體 YAML 定義檔的路由。                                                          |
| 你自己的 control action                                        | 改動流程的 Routes | 用 `temporalControlExtensionPoint` 註冊；以 `POST …/actions/:actionId` 提供，走同樣的授權檢查、自己的權限和稽核紀錄。 |
| 你自己的 workflow enricher                                     | Services          | 用 `temporalExtensionPoint` 註冊；在回傳流程摘要和詳細資料之前補上欄位。                                              |

回到[文件索引](README.md)，或繼續讀[架構](architecture.md)。
