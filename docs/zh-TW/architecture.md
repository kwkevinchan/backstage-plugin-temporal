# 架構

[English](../architecture.md) | 繁體中文

這篇回答：外掛由哪些套件組成？每一層負責什麼？可以從哪裡擴充？為什麼這樣設計？在你選擇要裝的套件、寫後端模組或權限政策、或要參與開發之前，先讀這篇。安裝和設定請看 [README](../../README.md)（英文）；貢獻流程請看 [CONTRIBUTING.md](../../CONTRIBUTING.md)（英文）。

- [套件](#套件)
- [各層](#各層)
- [擴充點](#擴充點)
- [設計決定](#設計決定)

## 套件

![套件分成兩邊：Backstage app 裡是 temporal-frontend 和它的兩個模組；Backstage 後端裡是 temporal-backend 和它的兩個模組。每個模組只依賴它那一邊的核心；前端透過 HTTP 呼叫後端，並帶著一份共用定義的副本。](images/package-map.svg)

所有套件名稱都有 `@kwkevinchan/backstage-plugin-` 前綴。青綠色是核心，紫色是選用模組。每個套件的角色表在 [README](../../README.md#packages)，裡面也有[該裝哪些](../../README.md#packages)。

- **核心，後端**（`temporal-backend`）：提供 `/api/temporal`，讀取和操作流程、檢查存取權限、把 `TemporalWorkflow` kind 加進 catalog，並給其他後端程式共用的 Temporal client（`./node`）、擴充點（`./alpha`）和共用定義（`./common`）。一行 `backend.add()` 就全部裝好。
- **核心，前端**（`temporal-frontend`）：實體分頁、詳細頁、Workflows 頁和各操作的按鈕，兩套前端系統都支援。它需要後端。
- **Zigflow**（`temporal-module-zigflow`、`temporal-backend-module-zigflow`）：Definition 分頁。各自需要它那一邊的核心。
- **Scaffolder**（`scaffolder-backend-module-temporal`、`scaffolder-module-temporal`）：範本 action 和選擇流程的表單欄位。
- **只供開發**（不發佈）：`packages/app`、`packages/app-next`、`packages/backend`、`packages/example-worker`。

哪些組合能用：

| 你裝了                                                | 得到什麼                                                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 只有 `temporal-backend`                               | API（讀取、Query，以及各項操作（`temporal.control.enabled` 設為 false 時沒有））、`TemporalWorkflow` kind，以及給你自己的後端程式用的共用 client 和擴充點。 |
| `temporal-backend`，但後端沒有 catalog 外掛           | 同上，但沒有 kind：後端略過 catalog 模組。                                                                                                                  |
| `temporal-frontend` 加 `temporal-backend`             | 兩套前端系統裡外掛的每一頁；沒有 Definition 分頁，也沒有 Scaffolder 欄位。                                                                                  |
| `temporal-frontend`，但連不到 `temporal-backend`      | 頁面會載入，並顯示指名 `@kwkevinchan/backstage-plugin-temporal-backend` 的錯誤（後端整個連不到時，顯示請求本身的錯誤）；功能都不能用。                      |
| Zigflow 前端模組，但沒有 Zigflow 後端模組             | Definition 分頁說明後端沒有提供流程定義。                                                                                                                   |
| Zigflow 後端模組，但同一個後端沒有 `temporal-backend` | 後端略過這個模組；路由不存在。                                                                                                                              |
| Scaffolder 後端模組                                   | 三個 action，以使用者的身分呼叫連得到的 `temporal-backend`（可以在另一個後端）。那邊關掉操作時，`start` 和 `signal` 會失敗並說明原因。                      |

### 為什麼是兩個核心套件

後端是核心：沒有前端時，Backstage 的後端程式仍然可以透過它呼叫 Temporal。前端一定搭配後端，不會單獨安裝。`TemporalWorkflow` kind 是後端需要的（後端要讀這些實體來決定哪些流程屬於它們），所以跟著後端。操作是同一個功能的兩半，路由和按鈕，所以兩半各自放在那一邊的核心，由同一個設定鍵（`temporal.control.enabled`）控制。目標是最少設定就能上手：後端一個套件、一行 `backend.add()`，app 一個套件。

代價：

- **模組要匯入後端外掛套件。** 後端模組要匯入 `temporal-backend`：Zigflow 和 Scaffolder 的模組只匯入它的共用定義（`./common`），你自己寫的模組還會匯入 client 服務（`./node`）和擴充點（`./alpha`）。Backstage 的 lint 規則 `@backstage/no-mixed-plugin-imports` 會為此印出警告，但不會讓 lint 失敗。這些入口不會載入外掛本體（有測試檢查），但裝一個模組就會帶進整個後端套件和它的相依。
- **共用定義有兩份。** 前端外掛不能匯入後端外掛，所以 `temporal-frontend` 帶著 `temporal-backend/src/common` 的一份副本。副本是產生出來的（`yarn sync:common`），CI 會檢查；兩邊比對權限、服務和擴充點都是靠名稱或 ID，所以物件有兩份不會出問題。
- **操作預設開著。** 外掛一裝好就能改動流程；誰能做由權限政策決定，或用設定鍵整個關掉（見 [Security](../../README.md#security)）。

## 各層

`temporal-backend` 裡的一個請求依序經過四個資料夾（[圖一](how-it-works.md#圖一一個請求經過各層)）。表格和各個類別在 [CONTRIBUTING.md](../../CONTRIBUTING.md#backend-layout) 有說明；簡單說：

| 層              | 職責                                                                                                                                                     | 用 clean architecture 的詞 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `routes/`       | 解析並驗證請求，檢查權限（以及要啟動的流程或排程是否屬於該實體），記錄操作的稽核，呼叫 services。                                                        | Controllers                |
| `access/`       | `DefaultTemporalAccessService`：權限檢查和 catalog 查詢。                                                                                                | Authorization              |
| `services/`     | 四個查詢類別（`EntityWorkflowSources`、`WorkflowListQueries`、`WorkflowQueries`、`AiWorkflowQueries`），以及把 Temporal 資料轉成 API 型別的轉換。        | Use cases                  |
| `repositories/` | `TemporalReadRepository`（讀取的呼叫）、`callTemporal`（每個呼叫的期限和錯誤轉換）、Temporal 錯誤的轉換、排程 client，以及 External Storage 參照的解析。 | Gateways                   |

Model（API 型別）在 `src/common`，共用的 client 在 `src/node`。這些類別都是一般的類別；`plugin.ts` 建立並接起它們，外掛內部沒有 repository interface，也沒有依賴注入容器。改動流程的路由是獨立的 router（`routes/controlRoutes.ts`），除非 `temporal.control.enabled` 是 false，否則由 `plugin.ts` 掛上。讀取走 `TemporalReadRepository`。`WorkflowCommands`（操作）和 `WorkflowListQueries` 的排程清單自己用共用連線呼叫 Temporal：它們的每個方法本來就是一次呼叫。這些呼叫都經過 `callTemporal`（見[期限](#期限)）。實驗性的 LLM 紀錄解析放在 `services/llm/`。

### 期限

Temporal 的 client 不會替呼叫設期限：伺服器不回應時，呼叫會一直等下去。後端的每個呼叫都有期限，由 `repositories/` 的 `callTemporal` 用 `connection.withDeadline` 設定；它涵蓋呼叫裡發出的每個 gRPC 請求，排程 client 的也算在內。期限是常數，不是設定項：

| 呼叫                                                                                      | 期限       |
| ----------------------------------------------------------------------------------------- | ---------- |
| 單筆讀取：流程的 describe、一頁 history、排程的 describe                                  | 10 秒      |
| 清單和計數（`listWorkflowExecutions`、`countWorkflowExecutions`、排程清單連同它的每一頁） | 15 秒      |
| 操作：signal、cancel、terminate、start、rerun，排程的 pause、unpause、trigger             | 10 秒      |
| 使用者發的 query                                                                          | 35 秒      |
| 讀取流程 metadata 的 query                                                                | 5 秒       |
| update：送出，以及之後最多五次查詢結果的輪詢                                              | 每次 30 秒 |

沒有 Worker 回應的 query，Temporal 伺服器在 30 秒後結束；update 的送出和每次輪詢，伺服器最多 20 秒就回，還沒完成時回 update 目前的階段。query 和 update 的期限稍長一點，讓伺服器自己的回應先到；慢但在輪詢內完成的 update 會成功。

超過期限的呼叫回 `503`（「Temporal did not answer in time」；query、update 和操作是「No worker answered in time」）。被 Temporal 限流的呼叫（`RESOURCE_EXHAUSTED`：被限流的是後端自己的連線，不是這位使用者）和開不了的連線（「Temporal is not reachable」，和伺服器無法使用時一樣）也回 `503`。期限不跟著 HTTP 請求：瀏覽器放棄的請求，仍會等它的呼叫結束。

授權服務位在 routes 和 services 之間，但它也會用到查詢 service（要讀過流程才能決定誰能看）。在查詢 service 之中，`EntityWorkflowSources` 被另外三個用，`WorkflowQueries` 被 `WorkflowListQueries` 和 `AiWorkflowQueries` 用；沒有任何一個依賴到用到它的類別。

前端方面，`TemporalClient`（預設的 `temporalApiRef`）透過後端讀取與操作。各操作的按鈕自己讀 `temporal.control.enabled`，是 false 時什麼都不顯示，兩套前端系統都一樣。畫面使用 `@backstage/ui`。

## 擴充點

不用改外掛就能擴充它。用法和範例在 [Extending](../../README.md#extending)；下表列出有哪些。

| 你想要                         | 使用                                                                                                                                               | 位置                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 在詳細頁加按鈕                 | `TemporalWorkflowActionBlueprint`（新前端系統）或 `workflowActions`（舊系統）                                                                      | `temporal-frontend/alpha`、`temporal-frontend` |
| 在詳細頁加分頁                 | `TemporalWorkflowSectionBlueprint` 或 `workflowSections`                                                                                           | `temporal-frontend/alpha`、`temporal-frontend` |
| 在流程清單上方加控制項         | `TemporalWorkflowListActionBlueprint` 或 `workflowListActions`                                                                                     | `temporal-frontend/alpha`、`temporal-frontend` |
| 從別的外掛呼叫這個外掛         | `temporalApiRef`                                                                                                                                   | `temporal-frontend`                            |
| 從其他後端程式呼叫 Temporal    | `temporalServiceRef`（`getClient()`）                                                                                                              | `temporal-backend/node`                        |
| 加一個會改動流程的後端 action  | `temporalControlExtensionPoint.addControlAction()`；以 `POST …/actions/:actionId` 提供，走同樣的授權檢查、它自己的權限、選用的 `filter` 和稽核紀錄 | `temporal-backend/alpha`                       |
| 把後端 action 顯示成按鈕       | `TemporalControlActionBlueprint` 或 `createTemporalControlActionDef()`                                                                             | `temporal-frontend`（`/alpha`）                |
| 替流程摘要補資料               | `temporalWorkflowEnricherExtensionPoint.addWorkflowEnricher()`；它只能加 enricher，自訂操作用 `temporalControlExtensionPoint`                      | `temporal-backend/alpha`                       |
| 讓後端認得某個框架的模型呼叫   | `temporalLlmAdapterExtensionPoint.addLlmAdapter()`（實驗性）；轉接器讀得出的步驟會顯示成模型呼叫                                                   | `temporal-backend/alpha`                       |
| 在自己的路由重用外掛的存取檢查 | `temporalAccessServiceRef`（`loadWorkflow()`、`authorizeOn()`）                                                                                    | `temporal-backend/alpha`                       |
| 用別的方式決定存取             | 為 `temporalAccessServiceRef` 加自己的 factory；預設的 factory 就會被略過                                                                          | 後端                                           |
| 為流程加權限規則               | 用 `temporalWorkflowPermissionResourceRef` 呼叫 `permissionsRegistry.addPermissionRules`                                                           | `temporal-backend/alpha`                       |
| 限制誰能做什麼                 | 用外掛的權限和條件寫 Backstage 權限政策                                                                                                            | [Permissions](../../README.md#permissions)     |

自訂 action 拿到的 Temporal client 帶著後端的連線和憑證：可以碰到 Namespace 裡的每一個流程，以及這些憑證能到的其他 Namespace，但權限只檢查了這次請求的那個流程。會動到其他流程的 action 必須自己檢查那些流程的權限；見 [Extending](../../README.md#extending)。

## 設計決定

下面是程式碼所依賴的決定，以及理由。

- **操作放在核心裡，由一個設定鍵控制。** `temporal.control.enabled: false` 會拿掉改動流程的路由（回 404，不是 403）和它們的按鈕，所以只想看流程的安裝可以確定後端沒有這種路由。自訂 action 的擴充點仍然註冊，所以加了 action 的模組照樣能啟動。
- **授權服務只有一份，共用。** 讀取路徑和操作路徑呼叫同一個 `loadWorkflow()`。模組透過 `temporalAccessServiceRef` 重用它，而不是重寫檢查，所以「誰能看這個流程」只有一個定義。這個 interface 是外掛裡唯一刻意設的契約（見 [CONTRIBUTING.md](../../CONTRIBUTING.md#backend-layout)）。
- **共用定義：後端是正本，前端是副本。** 前端和後端必須對型別、權限名稱和路徑有一致的看法。`temporal-backend/src/common` 是唯一的來源，用一份 fixture 測試；`temporal-frontend/src/common` 由它產生，CI 會檢查兩邊一致。
- **外掛沒有資料庫。** Temporal 本來就是記錄系統。外掛每次都向它查詢，只保留小的記憶體快取（已結束 Run 的進度），所以沒有需要搬移或維持一致的資料。
- **流程屬於哪個實體，靠比對而不是登記。** 實體的流程是：流程類型相同且在它的 Task Queue 上（標註或 `TemporalWorkflow` spec），或在 Search Attribute 裡帶著它的參照。catalog 裡不會為每次執行存任何東西。
- **一個 `TemporalWorkflow` 實體就是一個 Workflow Type，元件用 `dependsOn` 連過去。** `dependsOn` 的語意正好符合這個關係（「需要它才能運作」），catalog 圖和 about 卡片本來就會顯示它，而且不需要為其他 kind 另外寫 processor（[README](../../README.md#workflow-entities)）。
- **流程是一種權限資源。** `temporal.workflow.list` 和 `temporal.workflow.history.list` 是 `temporal-workflow` 上的資源權限，規則（流程類型、Task Queue、Namespace、啟動者）由後端轉成清單用的 Temporal visibility 查詢。實體權限則留在 catalog 實體上，所以 catalog 的規則（例如 `isEntityOwner`）可以用。
- **外掛不讀 External Storage 裡的 Payload。** 要讀就得在外掛裡放 AWS 憑證和 SDK，還要有一個放著客戶資料的 bucket 的讀取權限，而外掛只是用來看流程的。它只顯示 Payload 存在哪裡，並可選用一個連到你自己主控台的連結，誰能讀物件由那個主控台的權限決定（[Large payloads](../../README.md#large-payloads-external-storage)）。
- **一般的類別，不事先做抽象。** 沒有 repository interface，也沒有容器：各層就是資料夾，由 `plugin.ts` 把物件互相傳進去。
- **SDK 的 major 就是外掛的 major。** 後端用 `@temporalio/client` 1.x；它出新的 major，外掛的套件就出新的 major（[Compatibility](../../README.md#compatibility)）。
- **選用的套件不進不需要的 app。** Zigflow 分頁拆成兩個套件，沒有 Zigflow 的 app 就不帶 YAML 編輯器。官方 Temporal AI 整合的 LLM 畫面放在 `components/llm/` 和 `services/llm/`，不需要設定；Event Groups 也是從事件紀錄直接讀。
- **Worker 寫入的格式，兩邊都有測試。** 官方 Temporal AI 整合的 payload 和 Event Groups 以 history 錄在 `test-fixtures/llm-integrations` 與 `test-fixtures/event-groups`；後端用自己的程式碼讀回，前端畫面測試讀同一批 history 建出的 graph。

回到[文件索引](README.md)。
