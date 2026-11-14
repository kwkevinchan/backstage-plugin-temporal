# 公開接口

[English](../public-interfaces.md) | 繁體中文

這篇回答：這個版本庫以外的程式可以依賴什麼？每一部分接在哪裡？它列出所有別的安裝會依賴、改了就會弄壞別人的接口：npm 入口、後端和前端的擴充點、HTTP API、權限、設定鍵、catalog 標註和 kind、外掛寫進 Temporal 的資料，以及 Scaffolder 和 Zigflow 模組。每一類都附一個可以照抄的短範例。

要在自己的 Backstage 裝這套外掛、寫模組擴充它、或從別的程式呼叫它時讀這篇。安裝步驟和每個設定的意思以 [README](../../README.md)（英文）為準，這篇用連結指過去，不重複。接口背後的分層見[架構](architecture.md)和[運作方式](how-it-works.md)。

- [穩定度](#穩定度)
- [接口在哪裡](#接口在哪裡)
- [npm 入口](#npm-入口)
- [後端擴充](#後端擴充)
- [前端擴充](#前端擴充)
- [HTTP API](#http-api)
- [權限](#權限)
- [設定鍵](#設定鍵)
- [Catalog：標註和 `TemporalWorkflow` kind](#catalog標註和-temporalworkflow-kind)
- [外掛寫出的資料](#外掛寫出的資料)
- [Scaffolder](#scaffolder)
- [Zigflow](#zigflow)
- [實驗性：迴圈和 LLM 步驟](#實驗性迴圈和-llm-步驟)
- [範例](#範例)
- [不公開的部分](#不公開的部分)
- [讓這篇保持正確](#讓這篇保持正確)

## 穩定度

每個匯出的名稱在文件註解裡都有 release tag，[API report](#讓這篇保持正確) 的每一行也會標出來：

| 標記      | 意思                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `@public` | 正式支援的 API。`1.0.0` 之前，minor 版本仍可能改動它，changelog 會寫出來（[README](../../README.md)）。                                |
| `@alpha`  | 可以用，但版本之間不保證相容。`./alpha` 入口只有這一種，`./ui` 也是；`./common` 有 30 個（實驗性的名稱）。                             |
| 實驗性    | 迴圈和 LLM 畫面（`temporal.experimental.aiWorkflows`）。第一版之前會大幅改動或移除，見[實驗性](#實驗性迴圈和-llm-步驟)。不要依賴它們。 |

HTTP API、權限、設定鍵、標註、kind 和 search attribute 沒有自己的標記：它們跟著提供或讀取它們的套件（`temporal-backend`，`@public`），實驗性的路由和設定鍵除外。

## 接口在哪裡

![外掛的接口在哪裡。Backstage app 裡，你的 app 和外掛使用 temporal-frontend 的 npm 入口（1）和擴充：blueprint、props、temporalApiRef（2）。瀏覽器、其他後端外掛和 Scaffolder 模組呼叫 /api/temporal 底下的 HTTP API（3）。Backstage 後端裡，你的模組使用擴充點和 service ref（4），你的權限政策使用權限和條件（5），catalog 多了 TemporalWorkflow kind，外掛讀取這個 kind 和實體上的標註（6），app-config 放 temporal 設定鍵（7）。後端用 @temporalio/client 連到 Temporal，並寫入 search attribute、identity 和稽核事件（8）。Worker 執行你的流程程式。](images/interfaces-overview.svg)

每個數字是一類接口，下面各節照這個順序。青綠色是前端用的，橘色是後端程式用的，紫色是跨過程序邊界的（HTTP、Temporal）。

1. **npm 入口**：六個套件的入口（[npm 入口](#npm-入口)）。
2. **前端擴充**：blueprint、舊系統的 props 和 `temporalApiRef`（[前端擴充](#前端擴充)）。
3. **HTTP API**：`/api/temporal` 底下（[HTTP API](#http-api)）。
4. **後端擴充**：service ref 和擴充點（[後端擴充](#後端擴充)）。
5. **權限**：給你的權限政策用的權限和條件（[權限](#權限)）。
6. **Catalog**：`TemporalWorkflow` kind 和標註（[Catalog](#catalog標註和-temporalworkflow-kind)）。
7. **設定**：`temporal` 底下的鍵（[設定鍵](#設定鍵)）。
8. **外掛寫出的資料**：寫進 Temporal 和稽核紀錄的內容（[外掛寫出的資料](#外掛寫出的資料)）。

## npm 入口

![六個發佈套件和它們的入口，每格是名稱數、release tag 和 API report 檔。temporal-backend：. 3 個 public（report.api.md），./alpha 19 個 alpha（report-alpha.api.md），./node 3 個 public（report-node.api.md），./common 126 個，其中 96 個 public、30 個是實驗性的 alpha（report-common.api.md）。temporal-frontend：. 23 個 public，./alpha 6 個 alpha，./common 同樣 126 個，./ui 24 個 alpha，只給同捆套件用（report-ui.api.md）。temporal-backend-module-zigflow：. 1 個 public。temporal-module-zigflow：. 1 個 public，./alpha 2 個 alpha。scaffolder-backend-module-temporal：. 1 個 public。scaffolder-module-temporal：. 2 個 public，./alpha 2 個 alpha。](images/entry-points.svg)

套件名稱都以 `@kwkevinchan/backstage-plugin-` 開頭。每個入口完整、自動產生的清單是它的 API report（最後一欄）；下面的表格說明每個名稱的用途。

| 套件                                 | 入口       | 名稱數 | 標記                      | 給誰用                             | API report                                                                            |
| ------------------------------------ | ---------- | -----: | ------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `temporal-backend`                   | `.`        |      3 | `@public`                 | 安裝後端                           | [`report.api.md`](../../plugins/temporal-backend/report.api.md)                       |
|                                      | `./node`   |      3 | `@public`                 | 需要 Temporal 的其他後端程式       | [`report-node.api.md`](../../plugins/temporal-backend/report-node.api.md)             |
|                                      | `./alpha`  |     19 | `@alpha`                  | 後端模組和權限政策                 | [`report-alpha.api.md`](../../plugins/temporal-backend/report-alpha.api.md)           |
|                                      | `./common` |    126 | `@public` 96、`@alpha` 30 | 型別、路徑、權限、標註（後端程式） | [`report-common.api.md`](../../plugins/temporal-backend/report-common.api.md)         |
| `temporal-frontend`                  | `.`        |     23 | `@public`                 | 舊前端系統，以及寫擴充用的型別     | [`report.api.md`](../../plugins/temporal-frontend/report.api.md)                      |
|                                      | `./alpha`  |      6 | `@alpha`                  | 新前端系統：外掛和 blueprint       | [`report-alpha.api.md`](../../plugins/temporal-frontend/report-alpha.api.md)          |
|                                      | `./common` |    126 | `@public` 96、`@alpha` 30 | 同一份定義，給前端程式用           | [`report-common.api.md`](../../plugins/temporal-frontend/report-common.api.md)        |
|                                      | `./ui`     |     24 | `@alpha`                  | 只給本版本庫的同捆套件             | [`report-ui.api.md`](../../plugins/temporal-frontend/report-ui.api.md)                |
| `temporal-backend-module-zigflow`    | `.`        |      1 | `@public`                 | 安裝模組                           | [`report.api.md`](../../plugins/temporal-backend-module-zigflow/report.api.md)        |
| `temporal-module-zigflow`            | `.`        |      1 | `@public`                 | 舊前端系統                         | [`report.api.md`](../../plugins/temporal-module-zigflow/report.api.md)                |
|                                      | `./alpha`  |      2 | `@alpha`                  | 新前端系統                         | [`report-alpha.api.md`](../../plugins/temporal-module-zigflow/report-alpha.api.md)    |
| `scaffolder-backend-module-temporal` | `.`        |      1 | `@public`                 | 安裝模組                           | [`report.api.md`](../../plugins/scaffolder-backend-module-temporal/report.api.md)     |
| `scaffolder-module-temporal`         | `.`        |      2 | `@public`                 | 舊前端系統                         | [`report.api.md`](../../plugins/scaffolder-module-temporal/report.api.md)             |
|                                      | `./alpha`  |      2 | `@alpha`                  | 新前端系統                         | [`report-alpha.api.md`](../../plugins/scaffolder-module-temporal/report-alpha.api.md) |

前端的 `./common` 是後端那份產生出來的副本（前端外掛不能匯入後端外掛），兩份 report 完全相同。從你那一邊的套件匯入。給模組用的入口（後端的 `./node`、`./alpha`、`./common`）不會載入外掛本體。

### `temporal-backend`

| 名稱                                                                                                                                              | 入口      | 是什麼                                                                                                | 什麼時候用                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `default`                                                                                                                                         | `.`       | Feature loader：`temporalPlugin`、`temporalAccessServiceFactory`、`catalogModuleTemporalWorkflowKind` | 安裝後端：`backend.add(import('…-temporal-backend'))`  |
| `temporalPlugin`                                                                                                                                  | `.`       | 後端外掛（`pluginId: 'temporal'`）                                                                    | 一個一個加功能，例如不要 catalog 模組                  |
| `catalogModuleTemporalWorkflowKind`                                                                                                               | `.`       | Catalog 模組（`catalog` / `temporal-workflow-kind`），帶 kind 的 processor                            | catalog 在另一個後端執行                               |
| `temporalServiceRef`                                                                                                                              | `./node`  | 共用 Temporal 連線的 root service ref（`temporal.client`）                                            | 其他後端程式要呼叫 Temporal，或你要換掉連線            |
| `TemporalService`                                                                                                                                 | `./node`  | 它的 interface：`getClient()`、`getConnection()`、namespace、search attribute 名稱、Web UI 連結       | 使用或實作這個服務                                     |
| `TemporalSearchAttributeNames`                                                                                                                    | `./node`  | `{ entityRef?, initiator? }`，設定的屬性名稱                                                          | 讀 `getSearchAttributeNames()`                         |
| `temporalAccessServiceRef`                                                                                                                        | `./alpha` | 存取檢查的 plugin scope service ref（`temporal.access`）                                              | 你的模組有自己的路由、要用同樣的檢查，或要自己決定存取 |
| `temporalAccessServiceFactory`                                                                                                                    | `./alpha` | 那個 ref 的預設 factory                                                                               | 只加 `temporalPlugin` 時                               |
| `TemporalAccessService` 和型別 `TemporalAccessibleWorkflow`、`TemporalEntityContext`、`TemporalWorkflowAccessLevel`                               | `./alpha` | 存取的 interface（[見下](#temporalaccessserviceref)）                                                 | 同上                                                   |
| `temporalControlExtensionPoint`、`TemporalControlExtensionPoint`、`TemporalControlAction`、`TemporalControlActionContext`                         | `./alpha` | 自訂流程操作                                                                                          | 加一個你自己的操作                                     |
| `temporalWorkflowEnricherExtensionPoint`、`TemporalWorkflowEnricherExtensionPoint`、`TemporalWorkflowEnricher`、`TemporalWorkflowEnricherContext` | `./alpha` | 流程摘要的 enricher                                                                                   | 在列表和詳細資料加上資料                               |
| `temporalWorkflowPermissionResourceRef`、`TemporalWorkflowQuery`                                                                                  | `./alpha` | `temporal-workflow` 權限 resource，以及規則在列表時轉成什麼                                           | 加權限規則                                             |
| `temporalWorkflowPermissionRules`                                                                                                                 | `./alpha` | 這個 resource 的四條規則                                                                              | 用其他工具組條件                                       |
| `temporalWorkflowConditions`、`createTemporalWorkflowConditionalDecision`                                                                         | `./alpha` | list 權限的條件和條件式決定                                                                           | 你的權限政策                                           |

### `./common`（兩個核心套件都有）

126 個名稱分組如下，每個名稱都在 [report](../../plugins/temporal-backend/report-common.api.md) 裡。

| 分組（原始檔）                                     | 名稱                                                                                                                                                                                                                                                                                                                                                                                                                                             | 誰會用                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| 流程（`types.ts`，15）                             | `WorkflowRef`、`WorkflowSummary`、`WorkflowDetail`、`WorkflowStatus`、`WORKFLOW_STATUSES`、`WorkflowFailure`、`PendingActivity`、`WorkflowListResponse`、`WorkflowStatsResponse`、`WorkflowHistoryEvent`、`WorkflowHistoryResponse`、`WorkflowStepsResponse`、`ActivityStep`、`DecodedPayload`、`ExternalPayload`                                                                                                                                | HTTP API 的呼叫端、enricher、自訂操作    |
| 步驟圖和進度（`graph.ts`，10）                     | `WorkflowGraphResponse`、`WorkflowGraphNode`、`WorkflowGraphEdge`、`WorkflowNodeKind`、`WorkflowNodeStatus`、`WorkflowNodeAttempt`、`WorkflowNodeEvent`、`WorkflowDeadline`、`WorkflowRunChain`、`WorkflowProgressResponse`                                                                                                                                                                                                                      | `…/graph`、`…/progress` 的呼叫端         |
| 操作（`controls.ts`，10）                          | `WorkflowControlOperation`、`WorkflowMessageRequest`、`WorkflowMessageResponse`、`WorkflowStartRequest`、`WorkflowStartResponse`、`WorkflowHandler`、`WorkflowHandlersResponse`、`buildWorkflowOperationPath`、`buildWorkflowActionPath`、`buildWorkflowHandlersPath`                                                                                                                                                                            | 操作流程的呼叫端                         |
| 排程（`schedules.ts`，8）                          | `TemporalSchedule`、`TemporalScheduleAction`、`TemporalScheduleListResponse`、`TemporalScheduleNoteRequest`、`TemporalScheduleOperation`、`SCHEDULES_PATH`、`buildEntitySchedulesPath`、`buildScheduleOperationPath`                                                                                                                                                                                                                             | 排程路由的呼叫端                         |
| 路徑（`paths.ts`，4）                              | `buildWorkflowPath`、`buildEntityWorkflowsPath`、`buildEntityWorkflowStatsPath`、`WORKFLOWS_PATH`                                                                                                                                                                                                                                                                                                                                                | 組 HTTP API 路徑                         |
| 權限（`permissions.ts`，16）                       | 11 個權限（`temporalWorkflowReadPermission` … `temporalWorkflowRerunPermission`，見[權限](#權限)）、`temporalPermissions`、`temporalControlPermissions`、`RESOURCE_TYPE_TEMPORAL_WORKFLOW`、`parseTemporalWorkflowResourceRef`、`stringifyTemporalWorkflowResourceRef`                                                                                                                                                                           | 權限政策、自訂操作、按鈕                 |
| 標註（`annotations.ts`，13）                       | `TEMPORAL_NAMESPACE_ANNOTATION`、`TEMPORAL_TASK_QUEUE_ANNOTATION`、`TEMPORAL_WORKFLOW_TYPE_ANNOTATION`、`TemporalAnnotations`、`parseTemporalAnnotations`、`InvalidTemporalAnnotationError`、`isTemporalAvailable`、`getDependsOnTemporalWorkflowRefs`、`isValidNamespaceName`、`isValidTaskQueueName`、`isValidWorkflowTypeName`、`isValidWorkflowIdPrefix`、`NAME_PATTERN_SOURCES`                                                             | 實體頁、catalog processor、驗證          |
| `TemporalWorkflow` kind（`workflowEntity.ts`，10） | `TEMPORAL_WORKFLOW_API_VERSION`、`TEMPORAL_WORKFLOW_KIND`、`TemporalWorkflowEntityV1alpha1`、`temporalWorkflowEntityV1alpha1Schema`、`isTemporalWorkflowEntity`、`isTemporalWorkflowEntityRef`、`parseTemporalWorkflowSpec`、`InvalidTemporalWorkflowSpecError`、`getTemporalWorkflowSource`、`getTemporalWorkflowExampleArgs`                                                                                                                   | 讀取流程實體的程式                       |
| 訊息（`messages.ts`，6）                           | `TemporalWorkflowMessageSpec`、`TemporalWorkflowMessagesSpec`、`temporalWorkflowMessageSchema`、`getTemporalWorkflowMessages`、`mergeWorkflowHandlers`、`exampleArgs`                                                                                                                                                                                                                                                                            | kind 的 `spec.messages`                  |
| 定義（`definition.ts`，4）                         | `TEMPORAL_DEFINITION_FORMATS`、`TemporalDefinitionFormat`、`TemporalWorkflowDefinitionSpec`、`getTemporalWorkflowDefinitionSpec`                                                                                                                                                                                                                                                                                                                 | kind 的 `spec.definition`                |
| 實驗性：迴圈（`loops.ts`，10）                     | `LOOP_MARKER_MEMO_KEY`、`LOOP_STATE_MEMO_KEY`、`LOOP_STATE_QUERY`、`WorkflowLoopGroup`、`WorkflowLoopMarker`、`WorkflowLoopRound`、`WorkflowLoopRun`、`WorkflowLoopStatus`、`WorkflowLoopStep`、`WorkflowLoopsResponse`                                                                                                                                                                                                                          | [實驗性](#實驗性迴圈和-llm-步驟)：不要用 |
| 實驗性：LLM（`llm.ts`，20）                        | `LLM_MARKER_PREFIX`、`LLM_RECORD_KEY`、`LLM_RECORD_VERSION`、`LLM_SEMCONV_VERSION`、`LLM_TOOL_RESULT_KEY`、`TOOL_MARKER_PREFIX`、`addLlmUsage`、`buildLlmCallPath`、`parseLlmMarker`、`WorkflowLlmCallResponse`、`WorkflowLlmMarker`、`WorkflowLlmMessage`、`WorkflowLlmPart`、`WorkflowLlmRecord`、`WorkflowLlmRecordState`、`WorkflowLlmSummary`、`WorkflowLlmToolCallRef`、`WorkflowLlmToolExecution`、`WorkflowLlmUsage`、`WorkflowToolLink` | [實驗性](#實驗性迴圈和-llm-步驟)：不要用 |

### `temporal-frontend`

| 名稱                                                                                                                                                                              | 入口      | 是什麼                                                | 什麼時候用                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------- | ---------------------------------- |
| `default`                                                                                                                                                                         | `./alpha` | 新前端系統的外掛，有 9 個擴充（[ID](#extension-id)）  | 裝在新系統的 app                   |
| `TemporalWorkflowActionBlueprint`、`TemporalWorkflowSectionBlueprint`、`TemporalWorkflowListActionBlueprint`、`TemporalScheduleActionBlueprint`、`TemporalControlActionBlueprint` | `./alpha` | 五個 blueprint（[見下](#blueprint-和-props)）         | 加按鈕、分頁或控制項               |
| `temporalPlugin`                                                                                                                                                                  | `.`       | 舊系統的外掛                                          | 舊 app 的 `createApp({ plugins })` |
| `EntityTemporalContent`、`EntityTemporalContentProps`                                                                                                                             | `.`       | 實體分頁和它的 props                                  | 舊系統的 `EntityPage.tsx`          |
| `TemporalPage`、`TemporalPageProps`                                                                                                                                               | `.`       | Workflows 頁和它的 props                              | 舊系統的 `App.tsx`                 |
| `EntityTemporalWorkflowSummaryCard`、`EntityTemporalRelatedWorkflowsCard`                                                                                                         | `.`       | `TemporalWorkflow` 實體和依賴它的實體的總覽卡片       | 舊系統的實體頁                     |
| `isTemporalAvailable`、`isTemporalWorkflowEntity`、`getDependsOnTemporalWorkflowRefs`                                                                                             | `.`       | 給 `EntitySwitch` 和 `if` 用的條件（`./common` 也有） | 舊系統的實體頁                     |
| `TemporalWorkflowActionDef`、`TemporalWorkflowSectionDef`、`TemporalWorkflowListActionDef`、`TemporalScheduleActionDef`                                                           | `.`       | 舊系統 props 收的型別                                 | 舊系統的 props                     |
| `TemporalWorkflowExtensionProps`、`TemporalWorkflowListActionProps`、`TemporalScheduleActionProps`                                                                                | `.`       | 你的元件收到的 props，兩套系統相同                    | 寫按鈕、分頁或控制項               |
| `useTemporalWorkflow`                                                                                                                                                             | `.`       | 在詳細頁裡面取得目前的流程                            | 分頁裡較深層的元件                 |
| `createTemporalControlActionDef`、`TemporalControlActionButtonOptions`                                                                                                            | `.`       | 舊系統的 action，按鈕會執行後端的自訂操作             | 舊系統的 `workflowActions`         |
| `temporalApiRef`、`TemporalApi`、`TemporalClient`                                                                                                                                 | `.`       | 後端的 client：ref、interface 和預設實作              | 其他外掛呼叫後端，或換掉 client    |

`./ui`（步驟圖畫布、狀態工具、面板、class 名稱）是給同版本一起發佈的 `temporal-module-zigflow` 用的。裡面的名稱都是 `@alpha`、不保證相容，其他套件不應該使用。

### 模組

| 套件                                 | 名稱                                                                      | 入口      | 是什麼                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------- |
| `temporal-backend-module-zigflow`    | `default`                                                                 | `.`       | 後端模組 `temporal` / `zigflow`：定義檔的路由                                           |
| `temporal-module-zigflow`            | `EntityTemporalDefinitionContent`                                         | `.`       | 舊系統的 Definition 分頁                                                                |
|                                      | `default`、`temporalDefinitionContent`                                    | `./alpha` | `temporal` 的前端模組，含 `entity-content:temporal/definition`                          |
| `scaffolder-backend-module-temporal` | `default`                                                                 | `.`       | 後端模組 `scaffolder` / `temporal`：三個範本 action                                     |
| `scaffolder-module-temporal`         | `TemporalWorkflowPickerFieldExtension`、`TemporalWorkflowPickerUiOptions` | `.`       | 舊系統的表單欄位和它的 `ui:options`                                                     |
|                                      | `default`、`temporalWorkflowPickerFormField`                              | `./alpha` | `scaffolder` 的前端模組，含 `scaffolder-form-field:scaffolder/temporal-workflow-picker` |

## 後端擴充

![temporal-backend 內部，請求往下經過四層：routes（router.ts 是讀取和 Query；controlRoutes.ts 是操作，只在 temporal.control.enabled 為 true 時掛上）、access（TemporalAccessService，ref 是 temporalAccessServiceRef，搭配權限框架和 catalog）、services（WorkflowQueries 等查詢類別、WorkflowCommands），再經 TemporalService（temporalServiceRef，root scope）到 Temporal。左邊是外掛的模組：temporalControlExtensionPoint 把自訂操作接到操作路由，temporalWorkflowEnricherExtensionPoint 把 enricher 接到查詢，你自己的路由使用 temporalAccessServiceRef，Zigflow 模組在 /api/temporal 下加一條路由並自己檢查讀取權限。右邊是其他後端程式：Scaffolder 模組以使用者身分呼叫 HTTP API，你的其他外掛依賴 temporalServiceRef，你為 temporalAccessServiceRef 或 temporalServiceRef 提供的 factory 會取代預設的。](images/backend-interfaces.svg)

四個接口，分別在四層。其餘的類別由外掛自己建立，不匯出（見[不公開的部分](#不公開的部分)）。

### `temporalServiceRef`

`@kwkevinchan/backstage-plugin-temporal-backend/node`，`@public`。**root** scope 的服務：整個後端共用一條 Temporal 連線，讀 `temporal.connection`。預設 factory 跟著 ref 一起，所以任何外掛或模組都能直接依賴它，不必再裝別的。

| 成員                                               | 回傳                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `getClient({ namespace? })`                        | `@temporalio/client` 的 `Client`；不允許的 namespace 會被拒絕        |
| `getConnection()`                                  | 共用的 `Connection`（第一次使用時建立，關機時關閉）                  |
| `getDefaultNamespace()`                            | `temporal.connection.defaultNamespace`                               |
| `getAllowedNamespaces()`、`isNamespaceAllowed(ns)` | `temporal.connection.namespaces`（一定包含預設 namespace）           |
| `getSearchAttributeNames()`                        | 從 `temporal.searchAttributes` 來的 `TemporalSearchAttributeNames`   |
| `getWebUiUrl(ref)`                                 | Temporal Web UI 的連結；沒有 `temporal.webUi.baseUrl` 時是 undefined |

外掛自己的每一次 Temporal 呼叫，讀取和操作都一樣，都經過這個服務。為這個 ref 加上你自己的 factory，就會在所有地方換掉連線（[範例](#自己提供-temporalserviceref)），例如內建連線不支援的用戶端憑證（mTLS）。

### `temporalAccessServiceRef`

`./alpha`，`@alpha`。`temporal` 外掛的 **plugin** scope 服務：外掛每條路由都會跑的檢查。外掛的模組（也就是 `createBackendModule({ pluginId: 'temporal' })`）在自己的路由裡用它，讓「誰能看這個流程」只有一個定義。

| 方法                                                                             | 做什麼                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadWorkflow(ref, { entityRef?, level, credentials })`                          | 讀流程並做完所有檢查：先查 namespace；有 `entityRef` 時檢查那個實體上的 `read` 或 `history` 權限；沒有時先用 list 權限判斷流程本身，不允許才改看流程 search attribute 指的實體（[順序](#流程在哪個實體上檢查權限)） |
| `authorizeOn(permission, entityRef, credentials)`                                | 在實體上檢查一個 `catalog-entity` 權限；沒有實體時要求無條件 ALLOW                                                                                                                                                  |
| `loadEntity(entityRef, permission, credentials)`                                 | 先檢查權限，再讀實體和它依賴的 `TemporalWorkflow` 實體                                                                                                                                                              |
| `canListAll`、`authorizeWorkflowList`、`canReadPayloads`、`linkWorkflowEntities` | list 權限、它的 visibility 查詢、history 權限、連到流程實體                                                                                                                                                         |

套件的預設匯出會裝上預設 factory（`temporalAccessServiceFactory`）。要用別的方式決定存取，就為這個 ref 加上你自己的 factory，預設的會被略過。這個 ref 是 plugin scope，其他外掛用不到：從其他外掛請改以使用者身分呼叫 [HTTP API](#http-api)。

### `temporalControlExtensionPoint`

`./alpha`，`@alpha`。`addControlAction(action)` 加一個自訂操作，路由是 `POST …/actions/:actionId`（[流程](#一次自訂操作從按鈕到-temporal)）。`TemporalControlAction` 的欄位：

| 欄位         | 意思                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `id`         | 英文字母、數字、`.`、`_`、`-`，以字母開頭；不能重複（重複會讓啟動失敗）                                             |
| `permission` | 在 `handle` 執行前，對流程所屬實體檢查的 `catalog-entity` 權限                                                      |
| `filter?`    | `(workflow: WorkflowDetail) => boolean`；false 時回 `409`                                                           |
| `handle`     | `(ref, body, { entity?, workflow, credentials, client }) => Promise<JsonValue \| void>`；回傳值以 `{ result }` 送回 |

即使 `temporal.control.enabled` 是 false，擴充點也會註冊，所以模組照樣能啟動；它們的操作會被略過並記一筆警告。`client` 用後端的憑證，可以碰到 namespace 裡的每個流程：會動到其他流程的操作，要自己用 `temporalAccessServiceRef` 檢查那些流程。

### `temporalWorkflowEnricherExtensionPoint`

`./alpha`，`@alpha`。`addWorkflowEnricher({ id, enrich })` 在流程摘要上加資料：`enrich(items, { entity?, namespace, credentials })` 依加入順序，在透過實體讀取流程的地方執行：實體的流程列表，以及透過實體讀取的詳細資料（以 `entityRef` 傳入，或 list 權限不允許時改用的 search attribute 實體）。Workflows 頁的列表、以 list 權限開啟的詳細資料不會執行。把你的資料放在每筆摘要的 `extensions[id]`（`WorkflowSummary.extensions`）；回傳的欄位會合併進摘要。前端不會自己顯示它，要搭配一個讀它的[分頁或按鈕](#blueprint-和-props)。丟出錯誤的 enricher 會被略過並記一筆警告；id 重複會讓外掛啟動失敗。不要假設 `entity` 一定有值：之後跨實體的列表可能在沒有實體時也執行 enricher。

### Feature loader 和 catalog 模組

`backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'))` 會加三個 feature：`temporalPlugin`、`temporalAccessServiceFactory`、`catalogModuleTemporalWorkflowKind`。catalog 模組是 `catalog` 外掛的模組；後端沒有 catalog 時會被略過，拆開部署時要把它加到執行 catalog 的那個後端。沒有它，catalog 會拒收 `TemporalWorkflow` 實體。

## 前端擴充

![前端擴充出現在哪裡。右邊是實體分頁和 Workflows 頁：流程列表上方是 list action（先是 Start workflow，再來是你的），每個排程上是 schedule action，一次執行的詳細頁上，動作列放 action（Signal、Cancel 等操作，再來是你的，然後是 Query 和 Refresh），section 是 Steps、Timeline、Events、Details 後面的分頁。左邊是新前端系統：五個 blueprint 接到 api:temporal/workflow-extensions（不匯出）的 actions、sections、listActions、scheduleActions 輸入；舊前端系統：EntityTemporalContent 和 TemporalPage 的 workflowActions、workflowSections、workflowListActions、scheduleActions props，以及 createTemporalControlActionDef。兩條路徑到同一個位置，props 在前，同一個 id 只留一個。元件拿到 TemporalWorkflowExtensionProps 或用 useTemporalWorkflow()，並透過 temporalApiRef（api:temporal，TemporalClient）呼叫後端。](images/frontend-mounts.svg)

### Blueprint 和 props

兩套前端系統填的是同樣頁面（實體分頁和 Workflows 頁）上的同樣四個位置。頁面先放舊系統的 props，再放 `api:temporal/workflow-extensions` 收集到的擴充，同一個 `id` 只留一個。

| 位置             | 新系統（`./alpha`）                                                 | 輸入              | 舊系統的 prop（`EntityTemporalContent`、`TemporalPage`） | 元件收到                          | `filter` 收到      |
| ---------------- | ------------------------------------------------------------------- | ----------------- | -------------------------------------------------------- | --------------------------------- | ------------------ |
| 詳細頁的動作列   | `TemporalWorkflowActionBlueprint`、`TemporalControlActionBlueprint` | `actions`         | `workflowActions`（`TemporalWorkflowActionDef[]`）       | `TemporalWorkflowExtensionProps`  | `WorkflowDetail`   |
| 詳細頁的分頁     | `TemporalWorkflowSectionBlueprint`（需要 `title`）                  | `sections`        | `workflowSections`（`TemporalWorkflowSectionDef[]`）     | `TemporalWorkflowExtensionProps`  | `WorkflowDetail`   |
| 流程列表上方     | `TemporalWorkflowListActionBlueprint`                               | `listActions`     | `workflowListActions`                                    | `TemporalWorkflowListActionProps` | `{ entity? }`      |
| 排程列表的每一列 | `TemporalScheduleActionBlueprint`                                   | `scheduleActions` | `scheduleActions`                                        | `TemporalScheduleActionProps`     | `TemporalSchedule` |

外掛自己的操作也放在這些位置：新系統是擴充 `temporal-workflow-action:temporal/controls`、`temporal-workflow-list-action:temporal/start`、`temporal-schedule-action:temporal/controls`；舊系統是 `EntityTemporalContent` 和 `TemporalPage` 把它們放在你的前面。`temporal.control.enabled` 是 false 時它們什麼都不顯示，`TemporalControlActionBlueprint` 和 `createTemporalControlActionDef` 產生的按鈕也一樣；你自己寫的其他擴充不會看這個設定鍵。

各個 blueprint 和它產生的擴充的 kind：

| Blueprint                             | Kind                            |
| ------------------------------------- | ------------------------------- |
| `TemporalWorkflowActionBlueprint`     | `temporal-workflow-action`      |
| `TemporalControlActionBlueprint`      | `temporal-control-action`       |
| `TemporalWorkflowSectionBlueprint`    | `temporal-workflow-section`     |
| `TemporalWorkflowListActionBlueprint` | `temporal-workflow-list-action` |
| `TemporalScheduleActionBlueprint`     | `temporal-schedule-action`      |

`TemporalControlActionBlueprint`（舊系統是 `createTemporalControlActionDef`）是做好的 action：一個按鈕，替後端的操作呼叫 `runWorkflowAction()`。參數是 `TemporalControlActionButtonOptions`（`actionId`、`label`、`confirm?`、`body?(workflow)`、`permission?`）加上 `filter?`。給了 `permission`，沒有這個權限的使用者看到的按鈕會停用。

### `TemporalWorkflowExtensionProps`

action 和 section 收到的 props，也是在詳細頁裡 `useTemporalWorkflow()` 的回傳值（在詳細頁以外呼叫會丟出錯誤）：

| 欄位                | 是什麼                                                                        |
| ------------------- | ----------------------------------------------------------------------------- |
| `workflow`          | 顯示中的 `WorkflowDetail`，含 enricher 加上的 `extensions`                    |
| `entity?`           | 頁面所屬的 catalog 實體；Workflows 頁上沒有                                   |
| `reload()`          | 重新讀取流程，例如你的按鈕改動了它之後                                        |
| `workflowHref(ref)` | 同一頁（實體分頁或 Workflows 頁）上另一次執行的詳細頁連結，例如剛啟動的那一次 |

list action 收到 `{ entity?, workflowHref(ref) }`；schedule action 收到 `{ schedule, entity?, reload() }`。

### `temporalApiRef`

`temporalApiRef`（`plugin.temporal.api`）和它的 interface `TemporalApi` 是 [HTTP API](#http-api) 的 client：讀取（`listEntityWorkflows`、`listWorkflows`、`getWorkflow`、`getWorkflowGraph`…）和操作（`startWorkflow`、`signalWorkflow`、`runWorkflowAction`…）。針對單一流程的方法都收流程所屬的 `entityRef`，後端在它上面檢查權限。你的擴充和其他外掛用 `useApi` 呼叫它；外掛提供 `TemporalClient` 作為預設（新系統是擴充 `api:temporal`，舊系統是 `temporalPlugin`）。

它和擴充的收集是兩回事：`api:temporal/workflow-extensions` 只替頁面收集 blueprint 的輸出，而且不匯出。換掉 `api:temporal` 會改變每個頁面和擴充跟後端溝通的方式（[範例](#覆寫一個擴充)）。

### Extension ID

新系統的外掛有這些擴充。用 `temporalPlugin.getExtension(id).override(...)` 加 `temporalPlugin.withOverrides(...)` 改它，或在 `app.extensions` 停用它：

| ID                                             | 是什麼                                   |
| ---------------------------------------------- | ---------------------------------------- |
| `page:temporal`                                | `/temporal` 上的 Workflows 頁            |
| `entity-content:temporal`                      | 實體的 Temporal 分頁                     |
| `entity-card:temporal/workflow-summary`        | `TemporalWorkflow` 實體的摘要卡片        |
| `entity-card:temporal/related-workflows`       | 依賴流程實體的實體上的流程實體卡片       |
| `api:temporal`                                 | `temporalApiRef`，預設 `TemporalClient`  |
| `api:temporal/workflow-extensions`             | blueprint 的收集點；可以停用，不能替換   |
| `temporal-workflow-action:temporal/controls`   | Signal、Update、Cancel、Terminate、Rerun |
| `temporal-workflow-list-action:temporal/start` | Start workflow                           |
| `temporal-schedule-action:temporal/controls`   | Pause、Resume、Run now                   |

模組另外加上 `entity-content:temporal/definition`（Zigflow）和 `scaffolder-form-field:scaffolder/temporal-workflow-picker`（Scaffolder）。你用 blueprint 做的擴充，ID 的形式是 `<kind>:<plugin ID>/<name>`，例如 `temporal` 外掛的模組裡，`TemporalControlActionBlueprint.make({ name: 'escalate' })` 產生的按鈕是 `temporal-control-action:temporal/escalate`。

### 路由和連結

外掛有兩個 route ref：`root`（Workflows 頁，`temporal:root`）和 `entityContent`（實體分頁，`temporal:entity-content`）。舊系統是主入口的 `temporalPlugin.routes.root`、`temporalPlugin.routes.entityContent`；新系統是 `./alpha` 預設匯出上同樣的 `routes`。其他外掛用 `useRouteRef(temporalPlugin.routes.root)` 連到 Workflows 頁。

在這兩個頁面底下，一次執行的詳細頁在 `namespaces/:namespace/workflows/:workflowId[/runs/:runId]`：Workflows 頁在 `/temporal` 時就是 `/temporal/namespaces/:namespace/workflows/:workflowId/runs/:runId`，也就是頁面路徑後面接 `./common` 的 `buildWorkflowPath`。Scaffolder 模組的 `workflowUrl` 輸出用的就是這個形狀。

## HTTP API

所有路由都在後端外掛的 base URL `/api/temporal` 底下，需要 Backstage 的憑證：使用者 token，或其他後端外掛代表某個使用者取得的 token。

> **服務身分不經過權限政策。** 用後端外掛自己的身分（`auth.getOwnServiceCredentials()`）呼叫時是 service principal，Backstage 對 service principal 的每個權限都直接允許，不會問權限政策（除非 token 帶有 `accessRestrictions`）。這樣的呼叫端可以讀取和操作允許的 namespace 裡的每個流程。只在「可以做外掛能做的所有事」的程式裡用它；要照使用者的權限，請用 `auth.getPluginRequestToken({ onBehalfOf: <使用者的憑證> })`（[範例](#從其他後端呼叫-http-api)）。

`:wf` 代表 `namespaces/:namespace/workflows/:workflowId`，後面可以接 `/runs/:runId`（不帶 run ID 時是最新一次執行）。`:wf` 底下的每條路由和排程操作都收 `?entityRef=`，也就是流程顯示時所屬的實體。

#### 流程在哪個實體上檢查權限

- 有 `entityRef`：檢查那個實體上的讀取（`temporal.workflow.read`）或歷史（`temporal.workflow.history.read`）權限，而且流程必須是它的流程（否則 `404`）。
- 沒有：先用 list 權限判斷流程本身（`temporal.workflow.list`；history 層級還要 `temporal.workflow.history.list`），條件也會套用。不允許時，改對流程 `searchAttributes.entityRef` 屬性指的實體做上面的檢查；流程沒有這個屬性就拒絕（`403`）。
- 操作接著檢查自己的權限：在讀取時用的實體上，否則在 search attribute 指的實體上；兩者都沒有時，這個權限必須無條件允許。

錯誤是 Backstage 的錯誤格式：`400` 輸入錯誤、`403` 拒絕、`404` 找不到、`409` 衝突（流程不在執行中、操作的 filter 拒絕，或 Temporal 拒絕：workflow ID 已被使用、排程狀態不對）、`503` 連不到 Temporal 或沒有及時回應。後端沒有提供的路由回**沒有內容**的 `404`：`temporal.control.enabled` 為 false 時的操作路由，以及沒裝 Zigflow 後端模組時的定義路由。兩個列表路由收 `searchAttribute`：一個必須為 true 的 `Bool` search attribute 名稱。

讀取一定提供：

| 方法和路徑                                            | 權限                                          | 請求                                                                                                               | 回應                           |
| ----------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `GET /entities/:kind/:namespace/:name/workflows`      | `temporal.workflow.read`（實體）              | `status`、`allRuns`、`searchAttribute`、`pageSize`、`pageToken`                                                    | `WorkflowListResponse`         |
| `GET /entities/:kind/:namespace/:name/workflow-stats` | `temporal.workflow.read`（實體）              | `limit`                                                                                                            | `WorkflowStatsResponse`        |
| `GET /entities/:kind/:namespace/:name/schedules`      | `temporal.workflow.read`（實體）              |                                                                                                                    | `TemporalScheduleListResponse` |
| `GET /workflows`                                      | `temporal.workflow.list`（條件轉成查詢）      | `namespace`、`status`、`allRuns`、`workflowType`、`workflowId`（前綴）、`searchAttribute`、`pageSize`、`pageToken` | `WorkflowListResponse`         |
| `GET /schedules`                                      | `temporal.workflow.list`，無條件              | `namespace`                                                                                                        | `TemporalScheduleListResponse` |
| `GET /:wf`                                            | read 層級                                     | `entityRef`                                                                                                        | `WorkflowDetail`               |
| `GET /:wf/graph`                                      | read 層級；有 history 層級才含輸入和結果      | `entityRef`                                                                                                        | `WorkflowGraphResponse`        |
| `GET /:wf/progress`                                   | read 層級                                     | `entityRef`                                                                                                        | `WorkflowProgressResponse`     |
| `GET /:wf/handlers`                                   | read 層級                                     | `entityRef`                                                                                                        | `WorkflowHandlersResponse`     |
| `GET /:wf/history`                                    | history 層級                                  | `entityRef`、`pageSize`、`pageToken`                                                                               | `WorkflowHistoryResponse`      |
| `GET /:wf/steps`                                      | history 層級                                  | `entityRef`                                                                                                        | `WorkflowStepsResponse`        |
| `GET /:wf/payloads/download`                          | history 層級                                  | `entityRef`、`key`                                                                                                 | payload 的內容                 |
| `POST /:wf/query`                                     | read 層級加 `temporal.workflow.query`；有稽核 | `WorkflowMessageRequest`                                                                                           | `WorkflowMessageResponse`      |
| `GET /:wf/loops`                                      | read 層級。**實驗性**                         | `entityRef`                                                                                                        | `WorkflowLoopsResponse`        |
| `GET /:wf/llm-calls/:eventId`                         | history 層級。**實驗性**                      | `entityRef`                                                                                                        | `WorkflowLlmCallResponse`      |

read 和 history 層級照[流程在哪個實體上檢查權限](#流程在哪個實體上檢查權限)決定。實驗性路由在 `temporal.experimental.aiWorkflows` 不是 true 時回 `404`。

操作在 `temporal.control.enabled` 不是 false 時提供；是 false 時路由不存在，回沒有錯誤內容的 `404`。每個操作都會記稽核（[事件 ID](#外掛寫出的資料)）：

| 方法和路徑                                                                    | 權限                                                                                                       | 請求                                            | 回應                                              |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| `POST /entities/:kind/:namespace/:name/workflows`                             | 實體上的 `temporal.workflow.start`（不檢查 read 層級）；只能是它的 workflow type 和 task queue             | `WorkflowStartRequest`                          | `201` `WorkflowStartResponse`                     |
| `POST /workflows`                                                             | `temporal.workflow.list` 和 `temporal.workflow.start`，都要無條件（不檢查 read 層級）                      | `WorkflowStartRequest`                          | `201` `WorkflowStartResponse`                     |
| `POST /:wf/signal`                                                            | read 層級加 `temporal.workflow.signal`；只限執行中                                                         | `WorkflowMessageRequest`                        | `202` `{}`                                        |
| `POST /:wf/update`                                                            | read 層級加 `temporal.workflow.update`；只限執行中                                                         | `WorkflowMessageRequest`                        | `WorkflowMessageResponse`                         |
| `POST /:wf/cancel`                                                            | read 層級加 `temporal.workflow.cancel`；只限執行中                                                         |                                                 | `202` `{}`                                        |
| `POST /:wf/terminate`                                                         | read 層級加 `temporal.workflow.terminate`；只限執行中                                                      | `{ reason? }`                                   | `{}`                                              |
| `POST /:wf/rerun`                                                             | read 層級加 `temporal.workflow.rerun`                                                                      | `{ workflowId? }`                               | `201` `WorkflowStartResponse`                     |
| `POST /:wf/actions/:actionId`                                                 | read 層級，再來是操作的 `permission`，再來是它的 `filter`；不認得的 `actionId` 回 `404`                    | 任何 JSON                                       | `WorkflowMessageResponse`（`{ result }` 或 `{}`） |
| `POST /namespaces/:namespace/schedules/:scheduleId/(pause\|unpause\|trigger)` | `?entityRef=` 實體上的 `temporal.workflow.start`（排程必須啟動它的流程），否則要無條件（不檢查 read 層級） | `TemporalScheduleNoteRequest`（`trigger` 不收） | `202` `{}`                                        |

Zigflow 後端模組另外加上 `GET /entities/:kind/:namespace/:name/definition`（有 `spec.definition` 的 `TemporalWorkflow` 實體上的 `temporal.workflow.read`）。以上 25 條（讀取 15、操作 9、Zigflow 模組 1）是外掛自己的路由。因為外掛註冊了權限 resource type，權限框架也會在 `/api/temporal` 底下提供 `GET /.well-known/backstage/permissions/metadata` 和 `POST /.well-known/backstage/permissions/apply-conditions`；呼叫它們的是權限後端，不是你的程式。

`./common` 的路徑工具（`buildWorkflowPath`、`buildEntityWorkflowsPath`、`buildWorkflowOperationPath`、`buildWorkflowActionPath`…）可以組出這些路徑，請用它們而不要手寫。從瀏覽器請改用 `temporalApiRef`。

### 一次自訂操作，從按鈕到 Temporal

![一次自訂操作的九個步驟。瀏覽器裡：（1）TemporalControlActionBlueprint 的按鈕，你給的參數有 label、confirm、body、permission（讓按鈕停用）和 filter（決定是否顯示）；（2）TemporalApi.runWorkflowAction()；（3）POST /api/temporal/namespaces/:namespace/workflows/:workflowId/runs/:runId/actions/:actionId。後端裡：（4）只有 temporal.control.enabled 為 true 時這條路由才存在，actionId 也必須已註冊，否則 404；（5）loadWorkflow() 檢查 namespace 和實體上的讀取權限；（6）authorizeOn() 檢查這個操作的權限，否則 403；（7）操作的 filter，否則 409；（8）稽核記錄 workflow-action；（9）action.handle() 拿到實體、流程、身分和 Temporal client 並呼叫 Temporal。回傳值以 { result } 送回，按鈕顯示結果。你的程式在第 1、7、9 步執行。](images/action-flow.svg)

內建的操作也是同樣的順序，只是權限不同、中間沒有你的程式。Query 在讀取路由下用同樣方式執行，所以操作關閉時 Query 仍然在。

## 權限

外掛註冊 11 個權限（`./common` 的 `temporalPermissions`；其中會改動流程的六個是 `temporalControlPermissions`）。寫政策時用這些物件或名稱；每個權限的意思和政策範例在 [README](../../README.md#permissions)。

| 權限                             | 匯出名稱                                | Resource type       | 隨操作一起關閉   |
| -------------------------------- | --------------------------------------- | ------------------- | ---------------- |
| `temporal.workflow.read`         | `temporalWorkflowReadPermission`        | `catalog-entity`    |                  |
| `temporal.workflow.history.read` | `temporalWorkflowHistoryReadPermission` | `catalog-entity`    |                  |
| `temporal.workflow.list`         | `temporalWorkflowListPermission`        | `temporal-workflow` |                  |
| `temporal.workflow.history.list` | `temporalWorkflowHistoryListPermission` | `temporal-workflow` |                  |
| `temporal.workflow.query`        | `temporalWorkflowQueryPermission`       | `catalog-entity`    |                  |
| `temporal.workflow.start`        | `temporalWorkflowStartPermission`       | `catalog-entity`    | 是（含排程操作） |
| `temporal.workflow.signal`       | `temporalWorkflowSignalPermission`      | `catalog-entity`    | 是               |
| `temporal.workflow.update`       | `temporalWorkflowUpdatePermission`      | `catalog-entity`    | 是               |
| `temporal.workflow.cancel`       | `temporalWorkflowCancelPermission`      | `catalog-entity`    | 是               |
| `temporal.workflow.terminate`    | `temporalWorkflowTerminatePermission`   | `catalog-entity`    | 是               |
| `temporal.workflow.rerun`        | `temporalWorkflowRerunPermission`       | `catalog-entity`    | 是               |

`catalog-entity` 權限用 catalog 的規則和條件（`@backstage/plugin-catalog-backend/alpha` 的 `catalogConditions`）。`temporal-workflow` resource type（`RESOURCE_TYPE_TEMPORAL_WORKFLOW`、`temporalWorkflowPermissionResourceRef`）有四條規則，條件是 `./alpha` 的 `temporalWorkflowConditions`，配 `createTemporalWorkflowConditionalDecision`：

| 規則                | 條件              | 參數            |
| ------------------- | ----------------- | --------------- |
| `HAS_WORKFLOW_TYPE` | `hasWorkflowType` | `workflowTypes` |
| `HAS_TASK_QUEUE`    | `hasTaskQueue`    | `taskQueues`    |
| `IN_NAMESPACE`      | `inNamespace`     | `namespaces`    |
| `IS_INITIATOR`      | `isInitiator`     | `claims`        |

外掛的模組可以用 `coreServices.permissionsRegistry.addPermissionRules` 和 `temporalWorkflowPermissionResourceRef` 加規則；規則的 `toQuery` 回傳 `TemporalWorkflowQuery`（visibility 查詢，或 `{ namespaces }`、`{ initiators }`）。自訂操作的權限是一個 `catalog-entity` 權限，通常就用上面其中一個。

## 設定鍵

所有鍵都在 `temporal` 底下。schema 是三個套件的 `config.d.ts`：[`temporal-backend`](../../plugins/temporal-backend/config.d.ts)（下表除了 `definitions` 的全部）、[`temporal-frontend`](../../plugins/temporal-frontend/config.d.ts)（瀏覽器看得到的鍵）和 [`temporal-backend-module-zigflow`](../../plugins/temporal-backend-module-zigflow/config.d.ts)。預設值和意思見 [README](../../README.md#configuration)。

| 鍵                                                                                                                        | 誰讀                                   | 瀏覽器看得到 |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------ |
| `connection.address`                                                                                                      | 後端（`temporalServiceRef`）           |              |
| `connection.namespaces`、`connection.tls`、`connection.auth.type`                                                         | 後端                                   |              |
| `connection.auth.token`                                                                                                   | 後端；secret                           |              |
| `connection.defaultNamespace`                                                                                             | 後端、前端、Scaffolder 後端模組        | 是           |
| `webUi.baseUrl`                                                                                                           | 後端、前端                             | 是           |
| `searchAttributes.entityRef`、`searchAttributes.initiator`                                                                | 後端                                   |              |
| `control.enabled`                                                                                                         | 後端（掛上操作路由）、前端（顯示按鈕） | 是           |
| `control.allowedSignals`、`control.allowedUpdates`                                                                        | 後端（拒絕）、前端（提供選項）         | 是           |
| `externalStorage.s3.bucket`、`.driverName`、`.endpoint`、`.region`、`.forcePathStyle`、`.maxInlineBytes`、`.previewBytes` | 後端                                   |              |
| `externalStorage.s3.credentials.accessKeyId`、`.secretAccessKey`、`.sessionToken`                                         | 後端；後兩個是 secret                  |              |
| `definitions.maxBytes`、`definitions.readFileLocations`                                                                   | Zigflow 後端模組                       |              |
| `experimental.aiWorkflows`                                                                                                | 後端。**實驗性**                       |              |

Scaffolder 後端模組另外讀 Backstage 本身的 `app.baseUrl`，用來產生 `workflowUrl` 輸出。

## Catalog：標註和 `TemporalWorkflow` kind

任何實體上的標註（常數在 `./common`）：

| 標註                        | 常數                                | 值                        |
| --------------------------- | ----------------------------------- | ------------------------- |
| `temporal.io/namespace`     | `TEMPORAL_NAMESPACE_ANNOTATION`     | Namespace                 |
| `temporal.io/task-queue`    | `TEMPORAL_TASK_QUEUE_ANNOTATION`    | Task queue                |
| `temporal.io/workflow-type` | `TEMPORAL_WORKFLOW_TYPE_ANNOTATION` | Workflow type，以逗號分隔 |

Kind：`apiVersion: temporal.io/v1alpha1`、`kind: TemporalWorkflow`（`TemporalWorkflowEntityV1alpha1`，schema 是 `temporalWorkflowEntityV1alpha1Schema`），一個實體對應一個 workflow type。

| `spec` 欄位    | 必填 | 意思                                                                                          |
| -------------- | ---- | --------------------------------------------------------------------------------------------- |
| `owner`        | 是   | 擁有者 reference（`ownedBy` / `ownerOf`）                                                     |
| `workflowType` | 是   | Workflow type                                                                                 |
| `taskQueue`    |      | 它的 task queue                                                                               |
| `namespace`    |      | 它的 namespace；預設是 `connection.defaultNamespace`                                          |
| `system`       |      | System reference（`partOf` / `hasPart`）                                                      |
| `lifecycle`    |      | 和 component 一樣                                                                             |
| `dependsOn`    |      | Reference（`dependsOn` / `dependencyOf`）                                                     |
| `exampleInput` |      | 「Start workflow」預先填入的參數                                                              |
| `messages`     |      | `signals`、`updates`、`queries`：`name`、`description`、`inputSchema`、`example`、`userField` |
| `definition`   |      | `format`（`serverless-workflow` 或 `source`）、`target`、`symbol`（Definition 分頁）          |

其他實體用標準的 `spec.dependsOn` 連到流程實體（`temporalworkflow:default/order-workflow`）。細節和範例見 [README](../../README.md#workflow-entities)。

## 外掛寫出的資料

其他系統會讀這些，所以它們也是接口：

- **Search attribute。** 從 Backstage（頁面、API、Scaffolder）啟動或重跑的流程，在設定了對應鍵時，`temporal.searchAttributes.entityRef` 會寫入實體 reference（從實體啟動時），`temporal.searchAttributes.initiator` 會寫入使用者。兩者都必須是 Temporal 裡註冊好的 `Keyword` 屬性。重跑保留原本那次執行的屬性，並設定 initiator。

  外掛對**每個**流程都會讀這兩個屬性，不管是誰寫的：實體 reference 會把流程加進那個實體的列表，並決定權限在哪個實體上檢查；initiator 是 `IS_INITIATOR` 規則比對的對象。在 Backstage 以外啟動流程的程式設了這兩個屬性，效果相同，所以只設成流程真正所屬的實體和使用者。

- **Identity。** 操作以 `backstage:<使用者實體 reference>`（或 `backstage:<服務 subject>`）作為 Temporal identity，會顯示在歷史裡。
- **稽核事件**（auditor 服務，外掛 `temporal`）：`workflow-start`、`workflow-signal`、`workflow-update`、`workflow-query`、`workflow-cancel`、`workflow-terminate`、`workflow-rerun`、`workflow-action`、`schedule-pause`、`schedule-unpause`、`schedule-trigger`，metadata 裡有 namespace、流程和實體。severity：`workflow-query` 是 `low`，`workflow-terminate` 是 `high`，其餘是 `medium`。

你的 Worker 寫的 memo 只有下面的實驗性畫面會讀。外掛另外會讀 Temporal External Storage 的 reference，那是 SDK 的 S3 driver 用它自己的格式寫的。

## Scaffolder

`@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal` 加上三個範本 action。它們以執行範本的使用者身分呼叫外掛的 HTTP API（可以在外掛以外的另一個後端執行）：

| Action                     | 輸入                                                                                                                                                                      | 輸出                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `temporal:workflow:start`  | `entityRef`，或 `workflowType` 和 `taskQueue`；`namespace`、`workflowId`、`args`                                                                                          | `namespace`、`workflowId`、`runId`、`workflowUrl` |
| `temporal:workflow:wait`   | `workflowId`、`runId`、`namespace`、`entityRef`；`untilSearchAttribute`、`timeoutSeconds`、`intervalSeconds`、`maxIntervalSeconds`、`failIfNotCompleted`、`includeResult` | `status`、`runId`、`result`、`searchAttributes`   |
| `temporal:workflow:signal` | `workflowId`、`runId`、`namespace`、`entityRef`；`kind`（`signal` 或 `update`）、`name`、`args`                                                                           | `result`（update 的結果）                         |

`start` 和 `signal` 需要操作路由；`wait` 只讀取（流程本身，以及結果要用的 `/steps`）。`@kwkevinchan/backstage-plugin-scaffolder-module-temporal` 加上表單欄位 `TemporalWorkflowPicker`，值是 workflow ID；它的 `ui:options` 是 `TemporalWorkflowPickerUiOptions`（`entityRef`、`workflowType`、`namespace`、`status`、`searchAttribute`）。action 的 schema 會顯示在 Scaffolder 的 actions 頁面；另見[模組的 README](../../plugins/scaffolder-backend-module-temporal/README.md)（英文）。

## Zigflow

`temporal-backend-module-zigflow` 提供 `TemporalWorkflow` 實體的定義檔（路由見上，設定鍵 `definitions.*`）；`temporal-module-zigflow` 把它顯示在 **Definition** 分頁（舊系統是 `EntityTemporalDefinitionContent`，掛在流程實體頁的 `/definition`；新系統是 `entity-content:temporal/definition`）。這條路由的回應（`WorkflowDefinitionResponse`）不匯出：兩個模組一起發佈，路由只給這個分頁用。

## 實驗性：迴圈和 LLM 步驟

> **實驗性。第一版之前會大幅改動或移除，不要依賴。**

用 `temporal.experimental.aiWorkflows: true` 開啟，預設關閉。目前有：

- 路由 `GET /:wf/loops` 和 `GET /:wf/llm-calls/:eventId`，以及 `TemporalApi` 的 `getWorkflowLoops`、`getLlmCall`（`@alpha`）；
- `./common` 裡 `loops.ts` 和 `llm.ts` 的名稱（見上表），以及 `WorkflowGraphNode`、`WorkflowGraphResponse` 的 `loop`、`loops`、`llm`、`tool` 欄位；
- `@kwkevinchan/temporal-workflow-kit`（未發佈）在 Worker 裡寫的 memo 鍵和 query。

這裡刻意不提供範例。

## 範例

每個範例都在這個版本庫上編譯過；開發用的 app（`packages/app`、`packages/app-next`、`packages/backend`）用的是同樣的寫法。匯入一律寫完整套件名。

### 安裝

後端，`packages/backend/src/index.ts`：

```ts
backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'));
// 選用：Definition 分頁和範本 action。
backend.add(
  import('@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow'),
);
backend.add(
  import('@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal'),
);
```

App，新前端系統：

```ts
import temporalPlugin from '@kwkevinchan/backstage-plugin-temporal-frontend/alpha';
import temporalZigflowModule from '@kwkevinchan/backstage-plugin-temporal-module-zigflow/alpha';

export default createApp({
  features: [temporalPlugin, temporalZigflowModule /* ... */],
});
```

舊前端系統和 catalog 規則見 [README](../../README.md#installation)。

### 加一個自訂操作

後端模組加上操作：

```ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import { temporalControlExtensionPoint } from '@kwkevinchan/backstage-plugin-temporal-backend/alpha';
import { temporalWorkflowUpdatePermission } from '@kwkevinchan/backstage-plugin-temporal-backend/common';

export const temporalModuleEscalate = createBackendModule({
  pluginId: 'temporal',
  moduleId: 'escalate',
  register(reg) {
    reg.registerInit({
      deps: { temporal: temporalControlExtensionPoint },
      async init({ temporal }) {
        temporal.addControlAction({
          id: 'escalate',
          permission: temporalWorkflowUpdatePermission,
          filter: workflow => workflow.status === 'Running',
          async handle(ref, _body, { client }) {
            const handle = client.workflow.getHandle(ref.workflowId, ref.runId);
            const result = await handle.executeUpdate('setPriority', {
              args: ['high'],
            });
            return result as { priority: string };
          },
        });
      },
    });
  },
});
```

App 把它顯示成按鈕，新系統：

```ts
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { TemporalControlActionBlueprint } from '@kwkevinchan/backstage-plugin-temporal-frontend/alpha';
import { temporalWorkflowUpdatePermission } from '@kwkevinchan/backstage-plugin-temporal-frontend/common';

const escalateButton = TemporalControlActionBlueprint.make({
  name: 'escalate',
  params: {
    actionId: 'escalate',
    label: 'Escalate',
    confirm: 'Raise the priority to high?',
    permission: temporalWorkflowUpdatePermission,
    filter: workflow => workflow.status === 'Running',
  },
});

export const temporalExtensionsModule = createFrontendModule({
  pluginId: 'temporal',
  extensions: [escalateButton],
});
```

舊系統放在 `EntityTemporalContent` 和 `TemporalPage` 的 `workflowActions`：

```tsx
<EntityTemporalContent
  workflowActions={[
    createTemporalControlActionDef({
      actionId: 'escalate',
      label: 'Escalate',
      filter: workflow => workflow.status === 'Running',
    }),
  ]}
/>
```

開發用的後端有更完整的版本（`packages/backend/src/escalateAction.ts`）。

### 加一個 enricher

```ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import { temporalWorkflowEnricherExtensionPoint } from '@kwkevinchan/backstage-plugin-temporal-backend/alpha';

export const temporalModuleOwner = createBackendModule({
  pluginId: 'temporal',
  moduleId: 'owner',
  register(reg) {
    reg.registerInit({
      deps: { temporal: temporalWorkflowEnricherExtensionPoint },
      async init({ temporal }) {
        temporal.addWorkflowEnricher({
          id: 'owner',
          async enrich(items, { entity }) {
            const owner = entity?.spec?.owner ?? null;
            return items.map(item => ({
              ...item,
              extensions: { ...item.extensions, owner },
            }));
          },
        });
      },
    });
  },
});
```

在前端，這個值就是 `workflow.extensions?.owner`，見下一個範例；只在 enricher 有執行的頁面拿得到（Workflows 頁沒有，見[擴充點](#temporalworkflowenricherextensionpoint)）。

### 在詳細頁加一個分頁

```tsx
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { Text } from '@backstage/ui';
import { TemporalWorkflowSectionBlueprint } from '@kwkevinchan/backstage-plugin-temporal-frontend/alpha';
import type { TemporalWorkflowExtensionProps } from '@kwkevinchan/backstage-plugin-temporal-frontend';

export function OwnerSection(props: TemporalWorkflowExtensionProps) {
  const owner = props.workflow.extensions?.owner;
  return <Text>Owner: {typeof owner === 'string' ? owner : 'unknown'}</Text>;
}

const ownerSection = TemporalWorkflowSectionBlueprint.make({
  name: 'owner',
  params: {
    title: 'Owner',
    loader: async () => OwnerSection,
  },
});

export const temporalTabsModule = createFrontendModule({
  pluginId: 'temporal',
  extensions: [ownerSection],
});
```

舊系統：把 `workflowSections={[{ id: 'owner', title: 'Owner', component: OwnerSection }]}` 傳給 `EntityTemporalContent` 和 `TemporalPage`。分頁裡較深層的元件用 `useTemporalWorkflow()` 拿到同樣的 props。這個分頁讀的是上面 enricher 的資料，所以在 Workflows 頁會顯示 "unknown"。

### 覆寫一個擴充

```ts
import temporalPlugin from '@kwkevinchan/backstage-plugin-temporal-frontend/alpha';

export default createApp({
  features: [
    temporalPlugin.withOverrides({
      extensions: [
        temporalPlugin
          .getExtension('page:temporal')
          .override({ params: { path: '/pipelines', title: 'Pipelines' } }),
      ],
    }),
  ],
});
```

Scaffolder action 的 `workflowUrl` 輸出仍然指向 `/temporal`：模組是用這個路徑組出來的。

`api:temporal` 的參數要用 callback 給；換成你自己的 `TemporalApi` 時寫 `params: defineParams => defineParams({ api: temporalApiRef, deps: {}, factory: () => myClient })`（[README](../../README.md#extending)）。

### 自己提供 `temporalServiceRef`

例如使用用戶端憑證的連線。factory 必須實作整個 `TemporalService`，因為外掛每個成員都會用到；把它和外掛一起加到後端（`backend.add(mtlsTemporalServiceFactory)`）：

```ts
import { readFileSync } from 'node:fs';
import {
  coreServices,
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import { Client, Connection } from '@temporalio/client';
import type { WorkflowRef } from '@kwkevinchan/backstage-plugin-temporal-backend/common';
import {
  TemporalService,
  temporalServiceRef,
} from '@kwkevinchan/backstage-plugin-temporal-backend/node';

export const mtlsTemporalServiceFactory = createServiceFactory({
  service: temporalServiceRef,
  deps: {
    config: coreServices.rootConfig,
    lifecycle: coreServices.rootLifecycle,
  },
  factory({ config, lifecycle }) {
    const address = config.getString('temporal.connection.address');
    const defaultNamespace =
      config.getOptionalString('temporal.connection.defaultNamespace') ??
      'default';
    const namespaces = [
      ...new Set([
        defaultNamespace,
        ...(config.getOptionalStringArray('temporal.connection.namespaces') ??
          []),
      ]),
    ];
    const webUi = config.getOptionalString('temporal.webUi.baseUrl');
    let connection: Promise<Connection> | undefined;
    const clients = new Map<string, Promise<Client>>();
    const service: TemporalService = {
      getConnection() {
        connection ??= Connection.connect({
          address,
          tls: {
            clientCertPair: {
              crt: readFileSync('/etc/temporal/tls.crt'),
              key: readFileSync('/etc/temporal/tls.key'),
            },
          },
        }).catch(error => {
          // Connect again on the next call instead of keeping the failure.
          connection = undefined;
          throw error;
        });
        return connection;
      },
      getClient(options) {
        const namespace = options?.namespace ?? defaultNamespace;
        if (!namespaces.includes(namespace)) {
          return Promise.reject(
            new Error(`Temporal namespace is not allowed: ${namespace}`),
          );
        }
        let client = clients.get(namespace);
        if (!client) {
          client = service
            .getConnection()
            .then(c => new Client({ connection: c, namespace }));
          client.catch(() => clients.delete(namespace));
          clients.set(namespace, client);
        }
        return client;
      },
      getDefaultNamespace: () => defaultNamespace,
      getAllowedNamespaces: () => [...namespaces],
      isNamespaceAllowed: namespace => namespaces.includes(namespace),
      getSearchAttributeNames: () => ({
        entityRef: config.getOptionalString(
          'temporal.searchAttributes.entityRef',
        ),
        initiator: config.getOptionalString(
          'temporal.searchAttributes.initiator',
        ),
      }),
      getWebUiUrl(ref: WorkflowRef) {
        if (!webUi) return undefined;
        const workflow = `${webUi}/namespaces/${encodeURIComponent(
          ref.namespace,
        )}/workflows/${encodeURIComponent(ref.workflowId)}`;
        // The Web UI addresses a run as …/workflows/:workflowId/:runId/history.
        return ref.runId
          ? `${workflow}/${encodeURIComponent(ref.runId)}/history`
          : workflow;
      },
    };
    lifecycle.addShutdownHook(async () => {
      if (connection) await (await connection).close();
    });
    return service;
  },
});
```

如果只是要在你自己的外掛裡用這條連線，依賴 `temporalServiceRef` 就好（[README](../../README.md#extending)）。

### 從其他後端呼叫 HTTP API

以某個請求的使用者身分（`credentials` 來自 `httpAuth.credentials(req)`），讓外掛的權限檢查和稽核照常生效，和 Scaffolder 模組的做法一樣：

```ts
import {
  AuthService,
  BackstageCredentials,
  DiscoveryService,
} from '@backstage/backend-plugin-api';
import { parseEntityRef } from '@backstage/catalog-model';
import { ResponseError } from '@backstage/errors';
import {
  buildEntityWorkflowsPath,
  WorkflowListResponse,
} from '@kwkevinchan/backstage-plugin-temporal-backend/common';

export async function listRunningWorkflows(
  services: { discovery: DiscoveryService; auth: AuthService },
  entityRef: string,
  credentials: BackstageCredentials,
): Promise<WorkflowListResponse> {
  const baseUrl = await services.discovery.getBaseUrl('temporal');
  const { token } = await services.auth.getPluginRequestToken({
    onBehalfOf: credentials,
    targetPluginId: 'temporal',
  });
  const path = buildEntityWorkflowsPath(parseEntityRef(entityRef));
  const response = await fetch(`${baseUrl}${path}?status=Running`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw await ResponseError.fromResponse(response);
  return (await response.json()) as WorkflowListResponse;
}
```

不要為了繞過拒絕而改用 `auth.getOwnServiceCredentials()`：service principal 的每個權限都會直接允許，不會問權限政策（見 [HTTP API](#http-api)）。從前端外掛請改用 `useApi(temporalApiRef)`（`listEntityWorkflows(entityRef, { status: 'Running' })`）。

## 不公開的部分

常被問到的，以及該用什麼代替：

| 你在找                                                              | 為什麼不匯出                        | 改用                                                                                        |
| ------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `DefaultTemporalService`，或包一層內建連線的方法                    | 它的選項跟著設定 schema，之後可能變 | 依賴 `temporalServiceRef`，或實作 `TemporalService`（[範例](#自己提供-temporalserviceref)） |
| `DefaultTemporalAccessService`                                      | 檢查只透過 interface 這一個約定提供 | `temporalAccessServiceRef`，或為它提供自己的 factory                                        |
| 各個 router、`WorkflowQueries`、`WorkflowCommands`、repository      | 內部分層，由 `plugin.ts` 接起來     | HTTP API、擴充點                                                                            |
| `temporalWorkflowExtensionsApiRef`、`TemporalWorkflowExtensionsApi` | 收集 blueprint 是實作細節           | blueprint；要拿掉所有擴充就停用 `api:temporal/workflow-extensions`                          |
| `TemporalWorkflowProvider`                                          | 詳細頁自己會提供流程                | 在詳細頁裡用 `useTemporalWorkflow()`；其他地方用 props                                      |
| 外掛的擴充本身（`temporalPage`…）                                   | 匯出擴充會把它們的參數固定下來      | `getExtension(id)` 和 `withOverrides()`（[ID](#extension-id)）                              |
| Zigflow 的型別（`WorkflowDefinitionResponse`…）                     | 這條路由只給 Definition 分頁用      | Definition 分頁                                                                             |
| 在前端匯入 `@kwkevinchan/backstage-plugin-temporal-backend/common`  | 前端外掛不能匯入後端外掛            | `@kwkevinchan/backstage-plugin-temporal-frontend/common`，同一份定義                        |
| 在你的外掛用 `./ui` 的元件                                          | 不保證相容，是為 Zigflow 模組做的   | `@backstage/ui`                                                                             |

## 讓這篇保持正確

每個發佈套件的每個入口都有一份 API report：`report.api.md` 和 `report-<入口>.api.md`，放在套件的 `package.json` 旁邊，由 [API Extractor](https://api-extractor.com/) 透過 `@backstage/repo-tools` 產生，做法和 Backstage 版本庫相同。CI（Verify job 裡型別檢查之後的 **API reports** 步驟）會在 report 和匯出對不上時失敗。改了匯出之後：

```sh
yarn build:api-reports   # 型別檢查，再寫出 report
```

把改過的 report 和程式一起提交。公開接口有變動時，pull request 裡就會出現 report 的 diff。如果變動新增、移除或改名了這篇列出的名稱，在同一個 pull request 更新這篇。

有些 report 帶著 API Extractor 寫進去的警告（`// Warning: ...`），`temporal-backend` 和 `temporal-frontend` 允許這些警告（`--allow-warnings`）；新增的警告仍然會出現在 report 的 diff 裡。大部分是預期的：一個入口的型別引用了同一套件另一個入口的型別（例如 `TemporalApi` 和 `./common` 的回應型別），這個版本庫不會重複匯出。其餘是步驟圖型別上的實驗性欄位（`@public` 型別引用 `@alpha` 型別），會跟實驗性畫面一起改。

回到[文件索引](README.md)。
