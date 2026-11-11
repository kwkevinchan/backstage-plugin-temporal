# 架構

[English](../architecture.md) | 繁體中文

這篇回答：外掛由哪些套件組成？每一層負責什麼？可以從哪裡擴充？為什麼這樣設計？在你選擇要裝的套件、寫後端模組或權限政策、或要參與開發之前，先讀這篇。安裝和設定請看 [README](../../README.md)（英文）；貢獻流程請看 [CONTRIBUTING.md](../../CONTRIBUTING.md)（英文）。

- [套件](#套件)
- [各層](#各層)
- [擴充點](#擴充點)
- [設計決定](#設計決定)

## 套件

![套件分成三層：Backstage app 的前端套件、Backstage 後端的後端套件，以及兩者都匯入的兩個函式庫 temporal-common 和 temporal-node。workflow kit 屬於 Worker 端，不在 Backstage 內。](images/package-map.svg)

所有套件名稱都有 `@kwkevinchan/backstage-plugin-` 前綴（workflow kit 例外，它是 `@kwkevinchan/temporal-workflow-kit`）。青綠色是核心，橘色是會改動流程的 control 模組，紫色是其他選用模組。每個套件的角色表在 [README](../../README.md#packages)，裡面也有[該裝哪些](../../README.md#packages)。

- **核心**（`temporal` 和 `temporal-backend`）：只讀取。前端有實體分頁、詳細頁和 Workflows 頁；後端提供 `/api/temporal` 並檢查存取權限。Query 屬於核心。
- **Control**（`temporal-module-control` 和 `temporal-backend-module-control`）：Start、Signal、Update、Cancel、Terminate、Rerun、Schedule 操作和自訂 action。沒有它們，外掛什麼都改不了。
- **Catalog**（`catalog-backend-module-temporal`）：`TemporalWorkflow` kind。
- **Scaffolder**（`scaffolder-backend-module-temporal`、`scaffolder-module-temporal`）：範本 action 和選擇流程的表單欄位。
- **Zigflow**（`temporal-module-zigflow`、`temporal-backend-module-zigflow`）：Definition 分頁。
- **函式庫**（`temporal-common`、`temporal-node`）：共用的程式碼，見下。
- **`temporal-workflow-kit`**：給你的 Worker 用，不在 Backstage 裡。實驗性、`private`、不發佈；它和實驗性的 AI 畫面一起。
- **只供開發**（不發佈）：`packages/app`、`packages/app-next`、`packages/backend`、`packages/example-worker`。

### 兩個函式庫

Backstage 的前端外掛不能匯入後端外掛，所以前後端都需要的東西都放在 `temporal-common`：API 型別、權限、URL 路徑、標註常數，以及 `TemporalWorkflow` kind 的 schema。寫權限政策和模組時請匯入它。

`temporal-node` 給和外掛搭配的後端程式用：`temporalServiceRef`（共用的 Temporal client）、`temporalExtensionPoint`（workflow enricher），以及 `/alpha` 裡的 `temporalAccessServiceRef`、`temporalControlExtensionPoint` 和 `temporal-workflow` 權限資源。後端模組依賴它而不是 `temporal-backend`，所以核心的內部可以改動而不會弄壞它們。

## 各層

`temporal-backend` 裡的一個請求依序經過四個資料夾（[圖一](how-it-works.md#圖一一個請求經過各層)）。表格和各個類別在 [CONTRIBUTING.md](../../CONTRIBUTING.md#backend-layout) 有說明；簡單說：

| 層              | 職責                                                                                                                                              | 用 clean architecture 的詞 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `routes/`       | 解析並驗證請求，呼叫 access 和 services。不做決定。                                                                                               | Controllers                |
| `access/`       | `DefaultTemporalAccessService`：權限檢查和 catalog 查詢。                                                                                         | Authorization              |
| `services/`     | 四個查詢類別（`EntityWorkflowSources`、`WorkflowListQueries`、`WorkflowQueries`、`AiWorkflowQueries`），以及把 Temporal 資料轉成 API 型別的轉換。 | Use cases                  |
| `repositories/` | `TemporalReadRepository`（呼叫 Temporal）和 `PayloadStore`（S3）。                                                                                | Gateways                   |

Model（API 型別）在 `temporal-common`，共用的 client 在 `temporal-node`。這些類別都是一般的類別；`plugin.ts` 建立並接起它們，外掛內部沒有 repository interface，也沒有依賴注入容器。control 模組只有 `routes/` 和 `services/`：`WorkflowCommands` 直接呼叫 Temporal。

授權服務位在 routes 和 services 之間，但它也會用到查詢 service（要讀過流程才能決定誰能看）。在查詢 service 之中，`EntityWorkflowSources` 被另外三個用，`WorkflowQueries` 被 `WorkflowListQueries` 和 `AiWorkflowQueries` 用；沒有任何一個依賴到用到它的類別。

前端方面，`TemporalClient`（預設的 `temporalApiRef`）透過後端讀取；control 模組加上 `temporalControlApiRef` 負責操作。畫面使用 `@backstage/ui`。

## 擴充點

不用改外掛就能擴充它。用法和範例在 [Extending](../../README.md#extending)；下表列出有哪些。

| 你想要                         | 使用                                                                                                                                               | 位置                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 在詳細頁加按鈕                 | `TemporalWorkflowActionBlueprint`（新前端系統）或 `workflowActions`（舊系統）                                                                      | `temporal/alpha`                           |
| 在詳細頁加分頁                 | `TemporalWorkflowSectionBlueprint` 或 `workflowSections`                                                                                           | `temporal/alpha`                           |
| 在流程清單上方加控制項         | `TemporalWorkflowListActionBlueprint` 或 `workflowListActions`                                                                                     | `temporal/alpha`                           |
| 從別的外掛呼叫這個外掛         | `temporalApiRef`、`temporalControlApiRef`                                                                                                          | 前端                                       |
| 加一個會改動流程的後端 action  | `temporalControlExtensionPoint.addControlAction()`；以 `POST …/actions/:actionId` 提供，走同樣的授權檢查、它自己的權限、選用的 `filter` 和稽核紀錄 | `temporal-node/alpha`                      |
| 把後端 action 顯示成按鈕       | `TemporalControlActionBlueprint` 或 `createTemporalControlActionDef()`                                                                             | `temporal-module-control`                  |
| 替流程摘要補資料               | `temporalExtensionPoint.addWorkflowEnricher()`                                                                                                     | `temporal-node`                            |
| 在自己的路由重用外掛的存取檢查 | `temporalAccessServiceRef`（`loadWorkflow()`、`authorizeOn()`）                                                                                    | `temporal-node/alpha`                      |
| 用別的方式決定存取             | 為 `temporalAccessServiceRef` 加自己的 factory；預設的 factory 就會被略過                                                                          | 後端                                       |
| 為流程加權限規則               | 用 `temporalWorkflowPermissionResourceRef` 呼叫 `permissionsRegistry.addPermissionRules`                                                           | `temporal-node/alpha`                      |
| 限制誰能做什麼                 | 用外掛的權限和條件寫 Backstage 權限政策                                                                                                            | [Permissions](../../README.md#permissions) |

自訂 action 拿到的 Temporal client，用後端的憑證，可以碰到 Namespace 裡的每一個流程，但權限只檢查了這次請求的那個流程。會動到其他流程的 action 必須自己檢查那些流程的權限；見 [Extending](../../README.md#extending)。

## 設計決定

下面是程式碼所依賴的決定，以及理由。

- **核心只讀，寫入放在獨立的模組。** 只想看流程的安裝可以確定後端沒有任何會改動流程的路由。要不要能操作，在安裝時就決定，而不只是政策時才決定。
- **授權服務只有一份，共用。** 讀取路徑和操作路徑呼叫同一個 `loadWorkflow()`。模組透過 `temporalAccessServiceRef` 重用它，而不是重寫檢查，所以「誰能看這個流程」只有一個定義。這個 interface 是外掛裡唯一刻意設的契約（見 [CONTRIBUTING.md](../../CONTRIBUTING.md#backend-layout)）。
- **共用的定義放在共用函式庫。** 前端和後端必須對型別、權限名稱和路徑有一致的看法。`temporal-common` 是唯一的來源；它的測試會用一份 fixture 檢查權限。
- **外掛沒有資料庫。** Temporal 本來就是記錄系統。外掛每次都向它查詢，只保留小的記憶體快取（已結束 Run 的進度；32 MiB 的已下載 Payload），所以沒有需要搬移或維持一致的資料。
- **流程屬於哪個實體，靠比對而不是登記。** 實體的流程是：流程類型相同且在它的 Task Queue 上（標註或 `TemporalWorkflow` spec），或在 Search Attribute 裡帶著它的參照。catalog 裡不會為每次執行存任何東西。
- **一個 `TemporalWorkflow` 實體就是一個 Workflow Type，元件用 `dependsOn` 連過去。** 它的意思就是這個連結的意思（「需要它才能運作」），catalog 圖和 about 卡片本來就會顯示，而且不需要為其他 kind 另外寫 processor（[README](../../README.md#workflow-entities)）。
- **流程是一種權限資源。** `temporal.workflow.list` 和 `temporal.workflow.history.list` 是 `temporal-workflow` 上的資源權限，規則（流程類型、Task Queue、Namespace、啟動者）由後端轉成清單用的 Temporal visibility 查詢。實體權限則留在 catalog 實體上，所以 catalog 的規則（例如 `isEntityOwner`）可以用。
- **下載走後端，不發 presigned URL。** presigned URL 在到期前，拿到的人都能用，繞過 Backstage 的權限檢查。代價是資料要經過後端，並有大小上限（[Large payloads](../../README.md#large-payloads-external-storage)）。
- **一般的類別，不事先做抽象。** 沒有 repository interface，也沒有容器：各層就是資料夾，由 `plugin.ts` 把物件互相傳進去。
- **SDK 的 major 就是外掛的 major。** 後端用 `@temporalio/client` 1.x；它出新的 major，外掛的套件就出新的 major（[Compatibility](../../README.md#compatibility)）。
- **選用的套件不進不需要的 app。** Zigflow 分頁拆成兩個套件，沒有 Zigflow 的 app 就不帶 YAML 編輯器；AI 畫面在開關後面，它在 Worker 端的 kit 也不發佈。
- **Worker 寫入的格式，兩邊都有測試。** workflow kit 寫入迴圈標記和 LLM 紀錄，後端用自己的程式碼讀回；兩邊都用共用的 fixture（`test-fixtures/`）測試。

回到[文件索引](README.md)。
