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
- [實驗性：模型呼叫和 Event Groups](#實驗性模型呼叫和-event-groups)
- [範例](#範例)
- [不公開的部分](#不公開的部分)
- [讓這篇保持正確](#讓這篇保持正確)

## 穩定度

每個匯出的名稱在文件註解裡都有 release tag，[API report](#讓這篇保持正確) 的每一行也會標出來：

| 標記      | 意思                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@public` | 正式支援的 API。`1.0.0` 之前，minor 版本仍可能改動它，changelog 會寫出來（[README](../../README.md)）。                                                               |
| `@alpha`  | 可以用，但版本之間不保證相容。`./alpha` 入口只有這一種，`./ui` 也是（它只在 minor 版本才會不相容，見 [`temporal`](#temporal)）；`./common` 有 13 個（實驗性的名稱）。 |
| 實驗性    | 模型呼叫的型別和 Event Groups。第一版之前會大幅改動，見[實驗性](#實驗性模型呼叫和-event-groups)。不要依賴它們。                                                       |

HTTP API、權限、設定鍵、標註、kind 和 search attribute 沒有自己的標記：它們跟著提供或讀取它們的套件（`temporal-backend`，`@public`），實驗性的路由和設定鍵除外。

## 接口在哪裡

![外掛的接口在哪裡。Backstage app 裡，你的 app 和外掛使用 temporal 的 npm 入口（1）和擴充：blueprint、props、temporalApiRef（2）。瀏覽器、其他後端外掛、Scaffolder 模組和 actions 模組呼叫 /api/temporal 底下的 HTTP API（3）。Backstage 後端裡，你的模組使用擴充點和 service ref（4），你的權限政策使用權限和條件（5），catalog 多了 TemporalWorkflow kind，外掛讀取這個 kind 和實體上的標註（6），app-config 放 temporal 設定鍵（7）。後端用 @temporalio/client 連到 Temporal，並寫入 search attribute、identity 和稽核事件（8）。Worker 執行你的流程程式。](images/interfaces-overview.svg)

每個數字是一類接口，下面各節照這個順序。青綠色是前端用的，橘色是後端程式用的，紫色是跨過程序邊界的（HTTP、Temporal）。

1. **npm 入口**：七個套件的入口（[npm 入口](#npm-入口)）。
2. **前端擴充**：blueprint、舊系統的 props 和 `temporalApiRef`（[前端擴充](#前端擴充)）。
3. **HTTP API**：`/api/temporal` 底下（[HTTP API](#http-api)）。
4. **後端擴充**：service ref 和擴充點（[後端擴充](#後端擴充)）。
5. **權限**：給你的權限政策用的權限和條件（[權限](#權限)）。
6. **Catalog**：`TemporalWorkflow` kind 和標註（[Catalog](#catalog標註和-temporalworkflow-kind)）。
7. **設定**：`temporal` 底下的鍵（[設定鍵](#設定鍵)）。
8. **外掛寫出的資料**：寫進 Temporal 和稽核紀錄的內容（[外掛寫出的資料](#外掛寫出的資料)）。

## npm 入口

![七個發佈套件和它們的入口，每格是名稱數、release tag 和 API report 檔。temporal-backend：. 3 個 public（report.api.md），./alpha 17 個 alpha（report-alpha.api.md），./node 12 個 public（report-node.api.md），./common 110 個，其中 97 個 public、13 個是實驗性的 alpha（report-common.api.md）。temporal：. 22 個 public，./alpha 6 個 alpha，./common 同樣 110 個，./ui 26 個 alpha，只給同捆套件用（report-ui.api.md）。temporal-backend-module-zigflow：. 1 個 public。temporal-module-zigflow：. 1 個 public，./alpha 2 個 alpha。temporal-backend-module-actions：. 1 個 public。scaffolder-backend-module-temporal：. 1 個 public。scaffolder-module-temporal：. 2 個 public，./alpha 2 個 alpha。](images/entry-points.svg)

套件名稱都以 `@kwkevinchan/backstage-plugin-` 開頭。每個入口完整、自動產生的清單是它的 API report（最後一欄）；下面的表格說明每個名稱的用途。

| 套件                                 | 入口       | 名稱數 | 標記                      | 給誰用                             | API report                                                                            |
| ------------------------------------ | ---------- | -----: | ------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `temporal-backend`                   | `.`        |      3 | `@public`                 | 安裝後端                           | [`report.api.md`](../../plugins/temporal-backend/report.api.md)                       |
|                                      | `./node`   |     12 | `@public`                 | 需要 Temporal 的其他後端程式       | [`report-node.api.md`](../../plugins/temporal-backend/report-node.api.md)             |
|                                      | `./alpha`  |     17 | `@alpha`                  | 後端模組和權限政策                 | [`report-alpha.api.md`](../../plugins/temporal-backend/report-alpha.api.md)           |
|                                      | `./common` |    110 | `@public` 97、`@alpha` 13 | 型別、路徑、權限、標註（後端程式） | [`report-common.api.md`](../../plugins/temporal-backend/report-common.api.md)         |
| `temporal`                           | `.`        |     22 | `@public`                 | 舊前端系統，以及寫擴充用的型別     | [`report.api.md`](../../plugins/temporal/report.api.md)                               |
|                                      | `./alpha`  |      6 | `@alpha`                  | 新前端系統：外掛和 blueprint       | [`report-alpha.api.md`](../../plugins/temporal/report-alpha.api.md)                   |
|                                      | `./common` |    110 | `@public` 97、`@alpha` 13 | 同一份定義，給前端程式用           | [`report-common.api.md`](../../plugins/temporal/report-common.api.md)                 |
|                                      | `./ui`     |     26 | `@alpha`                  | 只給本版本庫的同捆套件             | [`report-ui.api.md`](../../plugins/temporal/report-ui.api.md)                         |
| `temporal-backend-module-zigflow`    | `.`        |      1 | `@public`                 | 安裝模組                           | [`report.api.md`](../../plugins/temporal-backend-module-zigflow/report.api.md)        |
| `temporal-module-zigflow`            | `.`        |      1 | `@public`                 | 舊前端系統                         | [`report.api.md`](../../plugins/temporal-module-zigflow/report.api.md)                |
|                                      | `./alpha`  |      2 | `@alpha`                  | 新前端系統                         | [`report-alpha.api.md`](../../plugins/temporal-module-zigflow/report-alpha.api.md)    |
| `temporal-backend-module-actions`    | `.`        |      1 | `@public`                 | 安裝模組                           | [`report.api.md`](../../plugins/temporal-backend-module-actions/report.api.md)        |
| `scaffolder-backend-module-temporal` | `.`        |      1 | `@public`                 | 安裝模組                           | [`report.api.md`](../../plugins/scaffolder-backend-module-temporal/report.api.md)     |
| `scaffolder-module-temporal`         | `.`        |      2 | `@public`                 | 舊前端系統                         | [`report.api.md`](../../plugins/scaffolder-module-temporal/report.api.md)             |
|                                      | `./alpha`  |      2 | `@alpha`                  | 新前端系統                         | [`report-alpha.api.md`](../../plugins/scaffolder-module-temporal/report-alpha.api.md) |

前端的 `./common` 是後端那份產生出來的副本（前端外掛不能匯入後端外掛），兩份 report 完全相同。從你那一邊的套件匯入。給模組用的入口（後端的 `./node`、`./alpha`、`./common`）不會載入外掛本體。

### `temporal-backend`

| 名稱                                                                                                                      | 入口      | 是什麼                                                                                                | 什麼時候用                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `default`                                                                                                                 | `.`       | Feature loader：`temporalPlugin`、`temporalAccessServiceFactory`、`catalogModuleTemporalWorkflowKind` | 安裝後端：`backend.add(import('…-temporal-backend'))`                  |
| `temporalPlugin`                                                                                                          | `.`       | 後端外掛（`pluginId: 'temporal'`）                                                                    | 一個一個加功能，例如不要 catalog 模組                                  |
| `catalogModuleTemporalWorkflowKind`                                                                                       | `.`       | Catalog 模組（`catalog` / `temporal-workflow-kind`），帶 kind 的 processor                            | catalog 在另一個後端執行                                               |
| `temporalServiceRef`                                                                                                      | `./node`  | 共用 Temporal 連線的 root service ref（`temporal.client`）                                            | 其他後端程式要呼叫 Temporal，或你要換掉連線                            |
| `TemporalService`                                                                                                         | `./node`  | 它的 interface：`getClient()`、`getConnection()`、namespace、search attribute 名稱、Web UI 連結       | 使用或實作這個服務                                                     |
| `DefaultTemporalService`、`readTemporalServiceOptions`、`TemporalServiceOptions`、`TemporalConnectionAuth`                | `./node`  | 服務的預設實作，以及從設定讀出的選項                                                                  | 要擴充連線，例如加上用戶端憑證（[範例](#自己提供-temporalserviceref)） |
| `TemporalSearchAttributeNames`                                                                                            | `./node`  | `{ entityRef?, initiator? }`，設定的屬性名稱                                                          | 讀 `getSearchAttributeNames()`                                         |
| `TemporalPluginClient`                                                                                                    | `./node`  | 以使用者身分呼叫外掛路由的 client                                                                     | 你的後端模組要代使用者呼叫外掛                                         |
| `buildWorkflowUrl`、`continuedAsNewRunIdOf`                                                                               | `./node`  | run 在 Backstage 的連結；被拒的操作改接到哪個 run                                                     | 同上                                                                   |
| `resolveWorkflowNamespace`、`WorkflowNamespaceOptions`                                                                    | `./node`  | 流程的 namespace：給定的、實體的，或預設                                                              | 同上                                                                   |
| `temporalAccessServiceRef`                                                                                                | `./alpha` | 存取檢查的 plugin scope service ref（`temporal.access`）                                              | 你的模組有自己的路由、要用同樣的檢查，或要自己決定存取                 |
| `temporalAccessServiceFactory`                                                                                            | `./alpha` | 那個 ref 的預設 factory                                                                               | 只加 `temporalPlugin` 時                                               |
| `TemporalAccessService` 和型別 `TemporalAccessibleWorkflow`、`TemporalEntityContext`、`TemporalWorkflowEntityLoadResult`  | `./alpha` | 存取的 interface（[見下](#temporalaccessserviceref)）                                                 | 同上                                                                   |
| `temporalControlExtensionPoint`、`TemporalControlExtensionPoint`、`TemporalControlAction`、`TemporalControlActionContext` | `./alpha` | 自訂流程操作                                                                                          | 加一個你自己的操作                                                     |
| `temporalWorkflowPermissionResourceRef`、`TemporalWorkflowFilter`                                                         | `./alpha` | `temporal-workflow` 權限 resource，以及規則在列表時轉成什麼                                           | 加權限規則                                                             |
| `temporalWorkflowPermissionRules`                                                                                         | `./alpha` | 這個 resource 的四條規則                                                                              | 用其他工具組條件                                                       |
| `temporalWorkflowConditions`、`createTemporalWorkflowConditionalDecision`                                                 | `./alpha` | list 權限的條件和條件式決定                                                                           | 你的權限政策                                                           |
| `inCondition`、`quote`                                                                                                    | `./alpha` | 用檢查過的值組 visibility 查詢的條件；遇到不安全的值會拒絕                                            | 你的權限規則的 `toQuery`                                               |

### `./common`（兩個核心套件都有）

110 個名稱分組如下，每個名稱都在 [report](../../plugins/temporal-backend/report-common.api.md) 裡。

| 分組（原始檔）                                    | 名稱                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 誰會用                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 流程（`types.ts`，20）                            | `WorkflowRef`、`WorkflowRunRef`、`WorkflowSummary`、`WorkflowDetail`、`WorkflowStatus`、`WORKFLOW_STATUSES`、`WorkflowFailure`、`PendingActivity`、`RelatedWorkflows`、`WorkflowListResponse`、`WorkflowTypeOverview`、`WorkflowTypeOverviewRun`、`WorkflowTypeOverviewRequest`、`WorkflowTypeOverviewResponse`、`MAX_WORKFLOW_TYPE_OVERVIEW_REFS`、`WorkflowHistoryEvent`、`WorkflowHistoryResponse`、`WorkflowResultResponse`、`DecodedPayload`、`ExternalPayload` | HTTP API 的呼叫端、自訂操作                                                     |
| 步驟圖和進度（`graph.ts`，10）                    | `WorkflowGraphResponse`、`WorkflowGraphNode`、`WorkflowGraphEdge`、`WorkflowNodeKind`、`WorkflowNodeStatus`、`WorkflowNodeAttempt`、`WorkflowNodeEvent`、`WorkflowDeadline`、`WorkflowRunChain`、`WorkflowProgressResponse`                                                                                                                                                                                                                                          | `…/graph`、`…/progress` 的呼叫端                                                |
| 操作（`controls.ts`，12）                         | `WorkflowControlOperation`、`WorkflowMessageRequest`、`WorkflowUpdateRequest`、`WorkflowMessageResponse`、`WorkflowIdReusePolicy`、`WorkflowStartRequest`、`WorkflowStartResponse`、`WorkflowMessageDefinition`、`WorkflowMessageDefinitionsResponse`、`buildWorkflowOperationPath`、`buildWorkflowActionPath`、`buildWorkflowMessageDefinitionsPath`                                                                                                                | 操作流程的呼叫端                                                                |
| 排程（`schedules.ts`，8）                         | `TemporalSchedule`、`TemporalScheduleAction`、`TemporalScheduleListResponse`、`TemporalScheduleNoteRequest`、`TemporalScheduleOperation`、`SCHEDULES_PATH`、`buildEntitySchedulesPath`、`buildScheduleOperationPath`                                                                                                                                                                                                                                                 | 排程路由的呼叫端                                                                |
| 路徑（`paths.ts`，5）                             | `buildWorkflowPath`、`buildWorkflowRunPath`、`buildEntityWorkflowsPath`、`WORKFLOWS_PATH`、`WORKFLOW_TYPE_OVERVIEW_PATH`                                                                                                                                                                                                                                                                                                                                             | 組 HTTP API 路徑                                                                |
| 權限（`permissions.ts`，12）                      | 9 個權限（`temporalWorkflowReadPermission` … `temporalWorkflowRerunPermission`，見[權限](#權限)）、`temporalPermissions`、`temporalControlPermissions`、`RESOURCE_TYPE_TEMPORAL_WORKFLOW`                                                                                                                                                                                                                                                                            | 權限政策、自訂操作、按鈕                                                        |
| 標註（`annotations.ts`，12）                      | `TEMPORAL_NAMESPACE_ANNOTATION`、`TEMPORAL_TASK_QUEUE_ANNOTATION`、`TEMPORAL_WORKFLOW_TYPE_ANNOTATION`、`TemporalAnnotations`、`parseTemporalAnnotations`、`InvalidTemporalAnnotationError`、`isTemporalAvailable`、`getDependsOnTemporalWorkflowRefs`、`isValidNamespaceName`、`isValidTaskQueueName`、`isValidWorkflowTypeName`、`isValidWorkflowIdPrefix`                                                                                                         | 實體頁、catalog processor、驗證                                                 |
| `TemporalWorkflow` kind（`workflowEntity.ts`，9） | `TEMPORAL_WORKFLOW_API_VERSION`、`TEMPORAL_WORKFLOW_KIND`、`TemporalWorkflowEntityV1alpha1`、`isTemporalWorkflowEntity`、`isTemporalWorkflowEntityRef`、`parseTemporalWorkflowSpec`、`InvalidTemporalWorkflowSpecError`、`getTemporalWorkflowSource`、`getTemporalWorkflowExampleArgs`                                                                                                                                                                               | 讀取流程實體的程式                                                              |
| 訊息（`messages.ts`，5）                          | `TemporalWorkflowMessageSpec`、`TemporalWorkflowMessagesSpec`、`getTemporalWorkflowMessages`、`mergeWorkflowMessageDefinitions`、`exampleArgs`                                                                                                                                                                                                                                                                                                                       | kind 的 `spec.messages`                                                         |
| 定義（`definition.ts`，4）                        | `TEMPORAL_DEFINITION_FORMATS`、`TemporalDefinitionFormat`、`TemporalWorkflowDefinitionSpec`、`getTemporalWorkflowDefinitionSpec`                                                                                                                                                                                                                                                                                                                                     | kind 的 `spec.definition`                                                       |
| 實驗性：LLM（`llm.ts`，11）                       | `addLlmUsage`、`buildLlmCallPath`、`WorkflowLlmCallResponse`、`WorkflowLlmMessage`、`WorkflowLlmPart`、`WorkflowLlmRecord`、`WorkflowLlmRecordState`、`WorkflowLlmSummary`、`WorkflowLlmToolCallRef`、`WorkflowLlmUsage`、`WorkflowLlmToolLink`                                                                                                                                                                                                                      | [實驗性](#實驗性模型呼叫和-event-groups)：不要用                                |
| 實驗性：Event Groups（`eventGroups.ts`，2）       | `WorkflowEventGroup`、`WorkflowEventGroupKind`                                                                                                                                                                                                                                                                                                                                                                                                                       | [實驗性](#實驗性模型呼叫和-event-groups)：Event Groups 在 Temporal 是實驗性功能 |

`DecodedPayload` 維持現在的三種形狀（`{ encoding, value }`、`{ encoding, size, undecodable: true, metadata? }`、`{ encoding, external }`），之後的版本只會加選填欄位。

### `temporal`

| 名稱                                                                                                                                                                              | 入口      | 是什麼                                                | 什麼時候用                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------- | ---------------------------------- |
| `default`                                                                                                                                                                         | `./alpha` | 新前端系統的外掛，有 9 個擴充（[ID](#extension-id)）  | 裝在新系統的 app                   |
| `TemporalWorkflowActionBlueprint`、`TemporalWorkflowSectionBlueprint`、`TemporalWorkflowListActionBlueprint`、`TemporalScheduleActionBlueprint`、`TemporalControlActionBlueprint` | `./alpha` | 五個 blueprint（[見下](#blueprint-和-props)）         | 加按鈕、分頁或控制項               |
| `temporalPlugin`                                                                                                                                                                  | `.`       | 舊系統的外掛                                          | 舊 app 的 `createApp({ plugins })` |
| `EntityTemporalContent`、`EntityTemporalContentProps`                                                                                                                             | `.`       | 實體分頁和它的 props                                  | 舊系統的 `EntityPage.tsx`          |
| `TemporalPage`、`TemporalPageProps`                                                                                                                                               | `.`       | Temporal 頁和它的 props                               | 舊系統的 `App.tsx`                 |
| `EntityTemporalWorkflowSummaryCard`、`EntityTemporalRelatedWorkflowsCard`                                                                                                         | `.`       | `TemporalWorkflow` 實體和依賴它的實體的總覽卡片       | 舊系統的實體頁                     |
| `isTemporalAvailable`、`isTemporalWorkflowEntity`、`getDependsOnTemporalWorkflowRefs`                                                                                             | `.`       | 給 `EntitySwitch` 和 `if` 用的條件（`./common` 也有） | 舊系統的實體頁                     |
| `TemporalWorkflowActionDef`、`TemporalWorkflowSectionDef`、`TemporalWorkflowListActionDef`、`TemporalScheduleActionDef`                                                           | `.`       | 舊系統 props 收的型別                                 | 舊系統的 props                     |
| `TemporalWorkflowExtensionProps`、`TemporalWorkflowListActionProps`、`TemporalScheduleActionProps`                                                                                | `.`       | 你的元件收到的 props，兩套系統相同                    | 寫按鈕、分頁或控制項               |
| `createTemporalControlActionDef`、`TemporalControlActionButtonOptions`                                                                                                            | `.`       | 舊系統的 action，按鈕會執行後端的自訂操作             | 舊系統的 `workflowActions`         |
| `temporalApiRef`、`TemporalApi`、`TemporalClient`                                                                                                                                 | `.`       | 後端的 client：ref、interface 和預設實作              | 其他外掛呼叫後端，或換掉 client    |

`./ui`（步驟圖畫布、狀態工具、面板、class 名稱、`entityContentRouteRef`）是給同版本一起發佈的 `temporal-module-zigflow` 用的。裡面的名稱都是 `@alpha`：會讓它們不相容的改動，只出在 `^` 範圍不會接受的版本（外掛還在 `0.x` 時就是 minor 版本），所以模組對這個套件的 `^` 依賴是安全的。其他套件不應該使用。

### 模組

| 套件                                 | 名稱                                                                      | 入口      | 是什麼                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------- |
| `temporal-backend-module-zigflow`    | `default`                                                                 | `.`       | 後端模組 `temporal` / `zigflow`：定義檔的路由                                           |
| `temporal-module-zigflow`            | `EntityTemporalDefinitionContent`                                         | `.`       | 舊系統的 Definition 分頁                                                                |
|                                      | `default`、`temporalDefinitionContent`                                    | `./alpha` | `temporal` 的前端模組，含 `entity-content:temporal/definition`                          |
| `temporal-backend-module-actions`    | `default`                                                                 | `.`       | 後端模組 `temporal` / `actions`：actions registry 的五個 action                         |
| `scaffolder-backend-module-temporal` | `default`                                                                 | `.`       | 後端模組 `scaffolder` / `temporal`：四個範本 action                                     |
| `scaffolder-module-temporal`         | `TemporalWorkflowPickerFieldExtension`、`TemporalWorkflowPickerUiOptions` | `.`       | 舊系統的表單欄位和它的 `ui:options`                                                     |
|                                      | `default`、`temporalWorkflowPickerFormField`                              | `./alpha` | `scaffolder` 的前端模組，含 `scaffolder-form-field:scaffolder/temporal-workflow-picker` |

## 後端擴充

![temporal-backend 內部，請求往下經過四層：routes（router.ts 是讀取和 Query；controlRoutes.ts 是操作，只在 temporal.control.enabled 為 true 時掛上）、access（TemporalAccessService，ref 是 temporalAccessServiceRef，搭配權限框架和 catalog）、services（WorkflowQueries 等查詢類別、WorkflowCommands），再經 TemporalService（temporalServiceRef，root scope）到 Temporal。左邊是外掛的模組：temporalControlExtensionPoint 把自訂操作接到操作路由，你自己的路由使用 temporalAccessServiceRef，Zigflow 模組在 /api/temporal 下加一條路由，並經由 temporalAccessServiceRef 檢查讀取權限。右邊是其他後端程式：Scaffolder 模組以使用者身分呼叫 HTTP API，你的其他外掛依賴 temporalServiceRef，你為 temporalAccessServiceRef 或 temporalServiceRef 提供的 factory 會取代預設的。](images/backend-interfaces.svg)

四個接口。其餘的類別由外掛自己建立，不匯出（見[不公開的部分](#不公開的部分)）。

### `temporalServiceRef`

`@kwkevinchan/backstage-plugin-temporal-backend/node`，`@public`。**root** scope 的服務：整個後端共用一條 Temporal 連線，讀 `temporal.connection`。預設 factory 跟著 ref 一起，所以任何外掛或模組都能直接依賴它，不必再裝別的。

| 成員                            | 回傳                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `getClient({ namespace? })`     | `@temporalio/client` 的 `Client`；不允許的 namespace 會被拒絕                                   |
| `getConnection({ namespace? })` | 一個 namespace 的 `Connection`；預設服務所有 namespace 共用一條（第一次使用時建立，關機時關閉） |
| `getDefaultNamespace()`         | `temporal.connection.defaultNamespace`                                                          |
| `isNamespaceAllowed(ns)`        | `ns` 是否在 `temporal.connection.namespaces` 裡（一定包含預設 namespace）                       |
| `getSearchAttributeNames()`     | 從 `temporal.searchAttributes` 來的 `TemporalSearchAttributeNames`                              |
| `getWebUiUrl(ref)`              | Temporal Web UI 的連結；沒有 `temporal.webUi.baseUrl` 時是 undefined                            |

外掛自己的每一次 Temporal 呼叫，讀取和操作都一樣，都經過這個服務：在 `getConnection({ namespace })` 上，以 `Connection.withDeadline` 設期限。`getClient({ namespace })` 的 client 必須用同一條連線：自訂操作的期限設在它上面，在別條連線上的 client 呼叫沒有期限。為這個 ref 加上你自己的 factory，就會在所有地方換掉連線（[範例](#自己提供-temporalserviceref)），例如設定不支援的用戶端憑證（mTLS）。為此有匯出 `DefaultTemporalService`（預設實作）和 `readTemporalServiceOptions`（從 `temporal` 讀出它的選項）：繼承這個類別，覆寫 `getConnection` 和 `close`。

### `temporalAccessServiceRef`

`./alpha`，`@alpha`。`temporal` 外掛的 **plugin** scope 服務：外掛每條路由都會跑的檢查。外掛的模組（也就是 `createBackendModule({ pluginId: 'temporal' })`）在自己的路由裡用它，讓「誰能看這個流程」只有一個定義。

| 方法                                                        | 做什麼                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadWorkflow(ref, { entityRef?, credentials })`            | 讀流程並做完所有檢查：先查 namespace；有 `entityRef` 時檢查那個實體上的讀取權限；沒有時先用 list 權限判斷流程本身，不允許才改看流程 search attribute 指的實體（[順序](#流程在哪個實體上檢查權限)）。流程是透過依賴的 `TemporalWorkflow` 實體對到時，回傳 `matchedEntityRef`：那個實體上的權限也要檢查 |
| `authorizeOn(permission, entityRef, credentials)`           | 在實體上檢查一個 `catalog-entity` 權限；沒有實體時要求無條件 ALLOW                                                                                                                                                                                                                                    |
| `loadEntity(entityRef, permission, credentials)`            | 先檢查權限，再讀實體和它依賴的 `TemporalWorkflow` 實體                                                                                                                                                                                                                                                |
| `loadWorkflowEntities(entityRefs, permission, credentials)` | 用一次請求檢查多個 `TemporalWorkflow` 實體的權限，再讀出允許的實體；其他的不回傳，流程無法顯示的實體附上 `error`                                                                                                                                                                                      |
| `canListAll`、`authorizeWorkflowList`                       | list 權限和它的 visibility 查詢                                                                                                                                                                                                                                                                       |

套件的預設匯出會裝上預設 factory（`temporalAccessServiceFactory`）。要用別的方式決定存取，就為這個 ref 加上你自己的 factory，預設的會被略過。這個 ref 是 plugin scope，其他外掛用不到：從其他外掛請改以使用者身分呼叫 [HTTP API](#http-api)。

### `temporalControlExtensionPoint`

`./alpha`，`@alpha`。`addControlAction(action)` 加一個自訂操作，路由是 `POST …/actions/:actionId`（[流程](#一次自訂操作從按鈕到-temporal)）。`TemporalControlAction` 的欄位：

| 欄位         | 意思                                                                                                                                                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | 英文字母、數字、`.`、`_`、`-`，以字母開頭；不能重複（重複會讓啟動失敗）                                                                                                                                                                                                      |
| `permission` | 在 `handle` 執行前，對流程所屬實體檢查的 `catalog-entity` 權限                                                                                                                                                                                                               |
| `filter?`    | `(workflow: WorkflowDetail) => boolean`；false 時回 `409`                                                                                                                                                                                                                    |
| `handle`     | `(ref, body, { entity?, workflow, firstRunId?, credentials, client }) => Promise<JsonValue \| void>`；`ref` 是打開的那次執行，`firstRunId`（也是 `workflow.firstRunId`）是 Temporal 回報的執行鏈 ID，讓 action 自己決定要對單一 run 或整條鏈操作；回傳值以 `{ result }` 送回 |

即使 `temporal.control.enabled` 是 false，擴充點也會註冊，所以模組照樣能啟動；它們的操作會被略過並記一筆警告。`id` 格式不正確時，不論操作是否啟用，啟動都會失敗。`client` 帶著後端的連線：可以碰到 namespace 裡的每個流程，以及該連線的憑證能到的其他 namespace：會動到其他流程的操作，要自己用 `temporalAccessServiceRef` 檢查那些流程。

`handle` 丟出的錯誤照內建操作的方式回應：`@backstage/errors` 的錯誤用它自己的狀態碼；Temporal client 的 `WorkflowNotFoundError` 回 `404`、`WorkflowUpdateFailedError` 回 `400`、`WorkflowUpdateRPCTimeoutOrCancelledError` 回 `503`；gRPC 錯誤看它的 code（`NOT_FOUND` `404`、`INVALID_ARGUMENT` `400`、`ALREADY_EXISTS` 和 `FAILED_PRECONDITION` `409`、`UNAVAILABLE` 和 `DEADLINE_EXCEEDED` `503`）；其他的回 `500`。來自 Temporal 或 client 的錯誤，訊息是固定文字，不是 Temporal 說的原文（見 [HTTP API](#http-api)），只有一個例外：流程拒絕 update 時回應帶的失敗訊息（`400`）。`client` 連不上時回 `503`。整個操作裡 `client` 的每次呼叫共用一個 60 秒的期限。需要更久的操作，把呼叫包在 `client.connection.withDeadline(deadline, fn)` 裡：那裡給的期限會取代 `fn` 裡面那些呼叫的 60 秒。

### Feature loader 和 catalog 模組

`backend.add(import('@kwkevinchan/backstage-plugin-temporal-backend'))` 會加三個 feature：`temporalPlugin`、`temporalAccessServiceFactory`、`catalogModuleTemporalWorkflowKind`。catalog 模組是 `catalog` 外掛的模組；後端沒有 catalog 時會被略過，拆開部署時要把它加到執行 catalog 的那個後端。沒有它，catalog 會拒收 `TemporalWorkflow` 實體。

## 前端擴充

![前端擴充出現在哪裡。右邊是實體分頁和 Temporal 頁：流程列表上方是 list action（先是 Start workflow，再來是你的），每個排程上是 schedule action，一次執行的詳細頁上，動作列放 action（Signal、Cancel 等操作，再來是你的，然後是 Query 和 Refresh），section 是 Steps、Timeline、Events、Details 後面的分頁。左邊是新前端系統：五個 blueprint 接到 api:temporal/workflow-extensions（不匯出）的 actions、sections、listActions、scheduleActions 輸入；舊前端系統：EntityTemporalContent 和 TemporalPage 的 workflowActions、workflowSections、workflowListActions、scheduleActions props，以及 createTemporalControlActionDef。兩條路徑到同一個位置，props 在前，同一個 id 只留一個。元件拿到 TemporalWorkflowExtensionProps，並透過 temporalApiRef（api:temporal，TemporalClient）呼叫後端。](images/frontend-mounts.svg)

### Blueprint 和 props

兩套前端系統填的是同樣頁面（實體分頁和 Temporal 頁）上的同樣四個位置。頁面先放舊系統的 props，再放 `api:temporal/workflow-extensions` 收集到的擴充，同一個 `id` 只留一個。

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

`TemporalControlActionBlueprint`（舊系統是 `createTemporalControlActionDef`）是做好的 action：一個按鈕，替後端的操作呼叫 `runWorkflowAction()`。參數是 `TemporalControlActionButtonOptions`（`actionId`、`label`、`confirm?`、`permission?`）加上 `filter?`。給了 `permission`，沒有這個權限的使用者看到的按鈕會停用。

### `TemporalWorkflowExtensionProps`

action 和 section 收到的 props。測試元件時，用這些 props 渲染它：

| 欄位                | 是什麼                                                                       |
| ------------------- | ---------------------------------------------------------------------------- |
| `workflow`          | 顯示中的 `WorkflowDetail`                                                    |
| `entity?`           | 頁面所屬的 catalog 實體；Temporal 頁上沒有                                   |
| `reload()`          | 重新讀取流程，例如你的按鈕改動了它之後                                       |
| `workflowHref(ref)` | 同一頁（實體分頁或 Temporal 頁）上另一次執行的詳細頁連結，例如剛啟動的那一次 |

list action 收到 `{ entity?, workflowHref(ref) }`；schedule action 收到 `{ schedule, entity?, reload() }`。

### `temporalApiRef`

`temporalApiRef`（`plugin.temporal.api`）和它的 interface `TemporalApi` 是 [HTTP API](#http-api) 的 client：讀取（`listEntityWorkflows`、`listWorkflows`、`listWorkflowRuns`、`getWorkflow`、`getWorkflowGraph`…）和操作（`startWorkflow`、`signalWorkflow`、`runWorkflowAction`…）。針對一次執行的方法都收 `WorkflowRunRef`（帶 run ID）和流程所屬的 `entityRef`，後端在它上面檢查權限；`listWorkflowRuns` 列出一個 workflow ID 的所有 run。你的擴充和其他外掛用 `useApi` 呼叫它；外掛提供 `TemporalClient` 作為預設（新系統是擴充 `api:temporal`，舊系統是 `temporalPlugin`）。新方法會跟著它呼叫的後端路由在 minor 版本加入，這不算 breaking change。要換掉 client，請繼承 `TemporalClient`，只覆寫你要改的方法，新方法才會照常運作。

它和擴充的收集是兩回事：`api:temporal/workflow-extensions` 只替頁面收集 blueprint 的輸出，而且不匯出。換掉 `api:temporal` 會改變每個頁面和擴充跟後端溝通的方式（[範例](#覆寫一個擴充)）。

### Extension ID

新系統的外掛有這些擴充。用 `temporalPlugin.getExtension(id).override(...)` 加 `temporalPlugin.withOverrides(...)` 改它，或在 `app.extensions` 停用它：

| ID                                             | 是什麼                                   |
| ---------------------------------------------- | ---------------------------------------- |
| `page:temporal`                                | `/temporal` 上的 Temporal 頁             |
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

外掛有兩個 route ref：`root`（Temporal 頁，`temporal:root`）和 `entityContent`（實體分頁，`temporal:entity-content`）。舊系統是主入口的 `temporalPlugin.routes.root`、`temporalPlugin.routes.entityContent`；新系統是 `./alpha` 預設匯出上同樣的 `routes`。其他外掛用 `useRouteRef(temporalPlugin.routes.root)` 連到 Temporal 頁。

在這兩個頁面底下，一次執行的詳細頁在 `namespaces/:namespace/workflows/:workflowId/runs/:runId`：Temporal 頁在 `/temporal` 時就是 `/temporal/namespaces/:namespace/workflows/:workflowId/runs/:runId`，也就是頁面路徑後面接 `./common` 的 `buildWorkflowRunPath`。Scaffolder 模組（和 actions registry 模組）的 `workflowUrl` 輸出用的就是這個形狀，放在 `temporal.pagePath`（預設 `/temporal`）底下；`./node` 的 `buildWorkflowUrl` 會組出它。不帶 run 的 `namespaces/:namespace/workflows/:workflowId`（`buildWorkflowPath`）列出這個 workflow ID 的所有 run；只有一個 run 時直接打開那個 run。

## HTTP API

所有路由都在後端外掛的 base URL `/api/temporal` 底下，需要 Backstage 的憑證：使用者 token，或其他後端外掛代表某個使用者取得的 token。

HTTP API 的合約正本是 OpenAPI 規格 [`plugins/temporal-backend/src/schema/openapi.yaml`](../../plugins/temporal-backend/src/schema/openapi.yaml)，隨後端套件一起發佈：每個參數、請求內容、回應，以及每條路由檢查的權限。路由的測試會對照回應（以及不是 400 的請求）；另有對帳測試兩邊對照規格和程式。CI 會驗證規格（`yarn lint:openapi`）；見[OpenAPI spec](../../plugins/temporal-backend/README.md#openapi-spec)（英文）。下面的表格是總覽。

> **服務身分不經過權限政策。** 用後端外掛自己的身分（`auth.getOwnServiceCredentials()`）呼叫時是 service principal，Backstage 對 service principal 的每個權限都直接允許，不會問權限政策（除非 token 帶有 `accessRestrictions`）。這樣的呼叫端可以讀取和操作允許的 namespace 裡的每個流程。只在「可以做外掛能做的所有事」的程式裡用它；要照使用者的權限，請用 `auth.getPluginRequestToken({ onBehalfOf: <使用者的憑證> })`（[範例](#從其他後端呼叫-http-api)）。

`:wf` 代表 `namespaces/:namespace/workflows/:workflowId/runs/:runId`，也就是一次執行。`:wf` 底下的每條路由、workflow ID 的 run 清單和排程操作都收 `?entityRef=`，也就是流程顯示時所屬的實體。

#### 流程在哪個實體上檢查權限

- 有 `entityRef`：檢查那個實體上的讀取權限（`temporal.workflow.read`），而且流程必須是它的流程（否則 `404`）。當流程是透過開啟實體依賴的 `TemporalWorkflow` 實體對到時（含其子流程透過祖先對到時），權限檢查兩個實體：開啟的實體和實際對到的 `TemporalWorkflow` 實體都必須允許 `temporal.workflow.read` 和所有操作權限。開啟實體自己的 annotation 或 search attribute 就對得到流程時，只檢查開啟的實體。
- 沒有：先用 list 權限判斷流程本身（`temporal.workflow.list`），條件也會套用。不允許時，改對流程 `searchAttributes.entityRef` 屬性指的實體做上面的檢查。list 權限和實體上的讀取權限都不可能允許的呼叫者，在讀流程之前就回 `403`。其他人，除非 list 權限允許所有流程，打不開的流程（沒有這個屬性，或透過他讀不到的實體）回的 `404` 和流程不存在時一樣。
- 操作接著檢查自己的權限：在讀取時用的實體上（若透過依賴的 `TemporalWorkflow` 實體對到，也必須同時在對到的實體上允許）。由 list 權限允許的流程，讀取時沒有用到實體：這時操作只有在流程能以 search attribute 指的實體當作 `entityRef` 打開時（呼叫者能讀這個實體，流程在它的 namespace 裡，而且是它的流程），才改用這個實體，並且也檢查對到的 `TemporalWorkflow` 實體。任何能啟動流程的人都能設定這個屬性，所以沒通過檢查、不存在或讀不到的實體都視為沒有實體。沒有實體的流程，這個權限必須無條件允許。

錯誤是 Backstage 的錯誤格式：`400` 輸入錯誤、`401` 沒有有效的憑證、`403` 拒絕、`404` 找不到、`409` 衝突（`signal` 的流程不在執行中，已接續的 run 會在錯誤裡帶 `continuedAsNewRunId`；`update`、`terminate` 遇到整條執行鏈已結束，或同一個 workflow ID 已變成別條鏈（`cancel` 遇到已結束的鏈回 `202`，Temporal 不做任何事；Temporal 伺服器不回報鏈的 ID 時，這些操作只作用在打開的 run）；重跑還在執行中的 run；操作的 filter 拒絕，或 Temporal 拒絕：workflow ID 已被使用、排程狀態不對）、`503` 連不到 Temporal、Temporal 沒在呼叫的期限內回應、Temporal 在限流後端、Temporal 拒絕後端自己的憑證，或 query、update 沒有 Worker 及時回應。

**錯誤訊息。** 來自 Temporal 或其 client 的錯誤，訊息是固定文字。Temporal 說的原文（位址、visibility query、伺服器的細節）寫進後端的 log，附上呼叫名稱、namespace 和 gRPC 狀態，不會傳到瀏覽器。在 production 模式，路由也不會回傳 stack trace，或沒預期到的錯誤的訊息。

| 狀態  | 訊息                                                                                                                                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `404` | Temporal 沒有的東西回 `Not found in Temporal`。查找流程或實體的路由，訊息會帶呼叫者給的 ID 或參照                                                                                                                             |
| `400` | `Temporal rejected the request as invalid`；query 的處理器失敗或沒有這個名稱的處理器時是 `The workflow failed the query`。呼叫者自己輸入的問題（參數錯誤、不允許的 namespace）訊息會指出那個輸入                              |
| `409` | `The resource already exists in Temporal`、`The resource is not in a state that allows this`、`The workflow rejected the query`                                                                                               |
| `503` | `Temporal is not reachable`、`Temporal did not answer in time`、`Temporal is rate limiting the backend`、`Temporal refused the credentials of the backend`、`No worker answered in time`、`The update did not finish in time` |
| `500` | `Internal server error`                                                                                                                                                                                                       |

API 回傳的 Worker 訊息只有一種：流程拒絕 update 的失敗（`400`），那是流程自己的程式碼寫給呼叫者的。流程類型總覽每一項的 `error.message` 是 `Temporal is rate limiting the backend`（同時 `rateLimited: true`）、`Temporal did not answer in time` 或 `The numbers could not be read` 其中一個。

後端沒有提供的路由回**沒有內容**的 `404`：`temporal.control.enabled` 為 false 時的操作路由，以及沒裝 Zigflow 後端模組時的定義路由。兩個列表路由收 `searchAttribute`：一個必須為 true 的 `Bool` search attribute 名稱。

讀取一定提供：

| 方法和路徑                                         | 權限                                                                                                                                                    | 請求                                                                                                             | 回應                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `GET /entities/:kind/:namespace/:name/workflows`   | `temporal.workflow.read`（實體）                                                                                                                        | `status`、`allRuns`、`searchAttribute`、`pageSize`、`pageToken`                                                  | `WorkflowListResponse`               |
| `POST /workflow-types/overview`                    | 每個實體上的 `temporal.workflow.read`，一次請求檢查；讀不到的實體不回傳（不是回 `403`）                                                                 | `WorkflowTypeOverviewRequest`（1 到 25 個 `TemporalWorkflow` 參照）                                              | `WorkflowTypeOverviewResponse`       |
| `GET /entities/:kind/:namespace/:name/schedules`   | `temporal.workflow.read`（實體）                                                                                                                        |                                                                                                                  | `TemporalScheduleListResponse`       |
| `GET /workflows`                                   | `temporal.workflow.list`（條件轉成查詢）                                                                                                                | `namespace`、`status`、`allRuns`、`workflowType`、`workflowIdPrefix`、`searchAttribute`、`pageSize`、`pageToken` | `WorkflowListResponse`               |
| `GET /schedules`                                   | `temporal.workflow.list`，無條件                                                                                                                        | `namespace`                                                                                                      | `TemporalScheduleListResponse`       |
| `GET /namespaces/:namespace/workflows/:workflowId` | 有 `entityRef` 時是它上面的 `temporal.workflow.read`（只列它的 run；實體要在路徑的 namespace）；沒有時是 `temporal.workflow.list`，條件套用到每一個 run | `entityRef`、`pageSize`、`pageToken`                                                                             | `WorkflowListResponse`               |
| `GET /:wf`                                         | read                                                                                                                                                    | `entityRef`                                                                                                      | `WorkflowDetail`                     |
| `GET /:wf/graph`                                   | read（含輸入、結果、步驟的 summary、event group 的 label 和完整的失敗）                                                                                 | `entityRef`                                                                                                      | `WorkflowGraphResponse`              |
| `GET /:wf/progress`                                | read                                                                                                                                                    | `entityRef`                                                                                                      | `WorkflowProgressResponse`           |
| `GET /:wf/message-definitions`                     | read                                                                                                                                                    | `entityRef`                                                                                                      | `WorkflowMessageDefinitionsResponse` |
| `GET /:wf/history`                                 | read                                                                                                                                                    | `entityRef`、`pageSize`、`pageToken`                                                                             | `WorkflowHistoryResponse`            |
| `GET /:wf/result`                                  | read                                                                                                                                                    | `entityRef`                                                                                                      | `WorkflowResultResponse`             |
| `POST /:wf/query`                                  | read 加 `temporal.workflow.query`；有稽核                                                                                                               | `WorkflowMessageRequest`                                                                                         | `WorkflowMessageResponse`            |
| `GET /:wf/llm-calls/:eventId`                      | read。**實驗性**                                                                                                                                        | `entityRef`、`index`                                                                                             | `WorkflowLlmCallResponse`            |

`POST /workflow-types/overview` 的 `refresh: true` 會重新讀取數字，不用後端保留 60 秒的那份；重新讀取仍要排隊等總覽的速率限制。`TemporalWorkflow` 實體上的統計卡片使用這條路由，所以數字和 Temporal 頁的 Workflows 分頁一致。

read 照[流程在哪個實體上檢查權限](#流程在哪個實體上檢查權限)決定。

失敗一律是完整的 `WorkflowFailure`，含 `source`、`stackTrace`、`nonRetryable` 和 `cause` 原因鏈：`WorkflowDetail.failure` 和其中 pending activity 的 `lastFailure`（`GET /:wf`）、流程圖節點和各次嘗試的 `failure`（`GET /:wf/graph`）、`GET /:wf/result`，以及模型呼叫的紀錄（`GET /:wf/llm-calls/:eventId`）。流程圖和 `GET /:wf/progress` 的 `current` 文字只用最外層的訊息；`WorkflowLlmSummary.error` 是模型呼叫的錯誤類型，紀錄沒有類型時是 `error`。清單不含失敗。變更流程的路由在流程拒絕 update 時，回應裡帶拒絕的訊息和它的原因（`400`），和 update 成功時的結果一樣。訊息是 SDK 記錄的那一則；有些 SDK 會把原因串進這則訊息。

`WorkflowGraphResponse` 和 `WorkflowProgressResponse` 的 `totalSteps` 是目前已讀到的事件裡出現過的步驟數（執行中的流程這不是總數，因為後面還會跑幾步要等跑到才知道）。`truncated` 為 true 時表示事件超過後端讀取上限（`GET /:wf/graph` 為 5,000 個事件，`GET /:wf/progress` 為 1,000 個事件），數字只反映前段讀到的事件。`GET /:wf/llm-calls/:eventId` 使用相同的 5,000 個事件上限；若請求的 `eventId` 在截斷點之後，會回 `404` 並在訊息說明事件紀錄已截斷。這兩個端點都不快取事件紀錄，每次請求都重新讀一次。要限制負載，只對 Temporal 外掛設限流（`backend.rateLimit.global: false`，加上 `backend.rateLimit.plugin.temporal` 的 `window` 和 `incomingRequestLimit`；範例見 [README](../../README.md)）。不要設 `backend.rateLimit: true`：那會限制整個後端，預設每個 IP 每分鐘只能 5 個請求。限制是計算同一個 IP 在時間窗內的請求數，套用在外掛的所有路由，不是限制同時進行的讀取數。

workflow ID 的 run 清單包含已接續（continue-as-new）的 run。順序是 Temporal visibility store 回傳的順序：外掛不指定排序（SQL visibility 不接受 `ORDER BY`；它先列執行中的 run，再列已結束的，最後結束的在前）。超過 namespace 保留期限的 run 不會列出。帶 `entityRef` 時，實體流程的子流程不會列出，雖然用這個實體打得開它們的 run。workflow ID 含引號、反斜線或控制字元時無法列出（`400`）：請用 run ID 打開那次執行。

操作在 `temporal.control.enabled` 不是 false 時提供；是 false 時路由不存在，回沒有錯誤內容的 `404`。每個操作都會記稽核（[事件 ID](#外掛寫出的資料)）：

| 方法和路徑                                                                    | 權限                                                                                                                                                              | 請求                                            | 回應                                              |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| `POST /entities/:kind/:namespace/:name/workflows`                             | 實體上的 `temporal.workflow.start`（不檢查 read）；只能是它的 workflow type 和 task queue                                                                         | `WorkflowStartRequest`                          | `201` `WorkflowStartResponse`                     |
| `POST /workflows`                                                             | `temporal.workflow.list` 和 `temporal.workflow.start`，都要無條件（不檢查 read）                                                                                  | `WorkflowStartRequest`                          | `201` `WorkflowStartResponse`                     |
| `POST /:wf/signal`                                                            | read 加 `temporal.workflow.signal`；只限打開的那個執行中 run                                                                                                      | `WorkflowMessageRequest`                        | `202` `{}`                                        |
| `POST /:wf/update`                                                            | read 加 `temporal.workflow.update`；對同一條執行鏈操作（送 `firstExecutionRunId`、不帶 `runId`）                                                                  | `WorkflowUpdateRequest`                         | `WorkflowMessageResponse`                         |
| `POST /:wf/cancel`                                                            | read 加 `temporal.workflow.cancel`；對同一條執行鏈操作（送 `firstExecutionRunId`、不帶 `runId`）                                                                  |                                                 | `202` `{}`                                        |
| `POST /:wf/terminate`                                                         | read 加 `temporal.workflow.terminate`；對同一條執行鏈操作（送 `firstExecutionRunId`、不帶 `runId`）                                                               | `{ reason? }`                                   | `{}`                                              |
| `POST /:wf/rerun`                                                             | read 加 `temporal.workflow.rerun`；只限已結束                                                                                                                     | `{ workflowId? }`                               | `201` `WorkflowStartResponse`                     |
| `POST /:wf/actions/:actionId`                                                 | read，再來是操作的 `permission`，再來是它的 `filter`；不認得的 `actionId` 回 `404`，並記成失敗的 `workflow-action` 事件                                           | 任何 JSON                                       | `WorkflowMessageResponse`（`{ result }` 或 `{}`） |
| `POST /namespaces/:namespace/schedules/:scheduleId/(pause\|unpause\|trigger)` | `?entityRef=` 實體上的 `temporal.workflow.start`（排程必須啟動它的流程），否則要 `temporal.workflow.list` 和 `temporal.workflow.start`，都要無條件（不檢查 read） | `TemporalScheduleNoteRequest`（`trigger` 不收） | `202` `{}`                                        |

Zigflow 後端模組另外加上 `GET /entities/:kind/:namespace/:name/definition`（有 `spec.definition` 的 `TemporalWorkflow` 實體上的 `temporal.workflow.read`）。以上 25 條（讀取 15、操作 9、Zigflow 模組 1）是外掛自己的路由。因為外掛用了權限 registry（它的權限和 `temporal-workflow` resource type），後端也會掛上權限框架的路由，在 `/api/temporal` 底下提供 `GET /.well-known/backstage/permissions/metadata` 和 `POST /.well-known/backstage/permissions/apply-conditions`；呼叫它們的是權限後端，不是你的程式。外掛自己套用 `temporal-workflow` 的條件，所以不會為 `apply-conditions` 讀取流程：這個 resource type 的請求回 `501`。

`./common` 的路徑工具（`buildWorkflowPath`、`buildWorkflowRunPath`、`buildEntityWorkflowsPath`、`buildWorkflowOperationPath`、`buildWorkflowActionPath`…）可以組出這些路徑，請用它們而不要手寫。從瀏覽器請改用 `temporalApiRef`。

### 一次自訂操作，從按鈕到 Temporal

![一次自訂操作的九個步驟。瀏覽器裡：（1）TemporalControlActionBlueprint 的按鈕，你給的參數有 label、confirm、body、permission（讓按鈕停用）和 filter（決定是否顯示）；（2）TemporalApi.runWorkflowAction()；（3）POST /api/temporal/namespaces/:namespace/workflows/:workflowId/runs/:runId/actions/:actionId。後端裡：（4）只有 temporal.control.enabled 為 true 時這條路由才存在，actionId 也必須已註冊，否則 404；（5）loadWorkflow() 檢查 namespace 和實體上的讀取權限；（6）authorizeOn() 檢查這個操作的權限，否則 403；（7）操作的 filter，否則 409；（8）稽核記錄 workflow-action；（9）action.handle() 拿到實體、流程、身分和 Temporal client 並呼叫 Temporal。回傳值以 { result } 送回，按鈕顯示結果。你的程式在第 1、7、9 步執行。](images/action-flow.svg)

內建的操作也是同樣的順序，只是權限不同、中間沒有你的程式。`update`、`cancel`、`terminate` 的權限和實體歸屬是對畫面上打開的那個 run 檢查的，實際執行時透過 `firstExecutionRunId`（不帶 `runId`）作用在同一條執行鏈上目前在跑的 run（並確保不會誤傷後來重用同一個 workflow ID 的別條鏈）。外掛假設同一條執行鏈上的所有 run 屬於同一個實體：workflow ID 在一條鏈裡不會變，且 `continueAsNew` 未指定 search attribute 時 Temporal 會保留前一個 run 的值，但流程程式在 Continue-As-New 時仍可換掉 workflow type、task queue 或 search attribute；依這些欄位決定實體歸屬或下權限條件的環境，接續後的 run 有可能歸到另一個實體，設定政策時需自行留意。Query 在讀取路由下用同樣方式執行，所以操作關閉時 Query 仍然在。

## 權限

外掛註冊 9 個權限（`./common` 的 `temporalPermissions`；其中會改動流程的六個是 `temporalControlPermissions`）。寫政策時用這些物件或名稱；每個權限的意思和政策範例在 [README](../../README.md#permissions)。

| 權限                          | 匯出名稱                              | Resource type       | 隨操作一起關閉   |
| ----------------------------- | ------------------------------------- | ------------------- | ---------------- |
| `temporal.workflow.read`      | `temporalWorkflowReadPermission`      | `catalog-entity`    |                  |
| `temporal.workflow.list`      | `temporalWorkflowListPermission`      | `temporal-workflow` |                  |
| `temporal.workflow.query`     | `temporalWorkflowQueryPermission`     | `catalog-entity`    |                  |
| `temporal.workflow.start`     | `temporalWorkflowStartPermission`     | `catalog-entity`    | 是（含排程操作） |
| `temporal.workflow.signal`    | `temporalWorkflowSignalPermission`    | `catalog-entity`    | 是               |
| `temporal.workflow.update`    | `temporalWorkflowUpdatePermission`    | `catalog-entity`    | 是               |
| `temporal.workflow.cancel`    | `temporalWorkflowCancelPermission`    | `catalog-entity`    | 是               |
| `temporal.workflow.terminate` | `temporalWorkflowTerminatePermission` | `catalog-entity`    | 是               |
| `temporal.workflow.rerun`     | `temporalWorkflowRerunPermission`     | `catalog-entity`    | 是               |

`catalog-entity` 權限用 catalog 的規則和條件（`@backstage/plugin-catalog-backend/alpha` 的 `catalogConditions`）。`temporal-workflow` resource type（`RESOURCE_TYPE_TEMPORAL_WORKFLOW`、`temporalWorkflowPermissionResourceRef`）有四條規則，條件是 `./alpha` 的 `temporalWorkflowConditions`，配 `createTemporalWorkflowConditionalDecision`：

| 規則                | 條件              | 參數            |
| ------------------- | ----------------- | --------------- |
| `HAS_WORKFLOW_TYPE` | `hasWorkflowType` | `workflowTypes` |
| `HAS_TASK_QUEUE`    | `hasTaskQueue`    | `taskQueues`    |
| `IN_NAMESPACE`      | `inNamespace`     | `namespaces`    |
| `IS_INITIATOR`      | `isInitiator`     | `claims`        |

外掛的模組可以用 `coreServices.permissionsRegistry.addPermissionRules` 和 `temporalWorkflowPermissionResourceRef` 加規則；規則的 `toQuery` 回傳 `TemporalWorkflowFilter`（visibility 查詢，或 `{ namespaces }`、`{ initiators }`）。**注意**：`toQuery` 回傳的字串會直接接進 Temporal visibility 查詢，請用 `./alpha` 匯出的 `inCondition` 和 `quote` 組字串，不要直接拼接未檢查的值（空字串、未閉合的引號、註解、或括號不成對的字串都會被拒絕）。自訂操作的權限是一個 `catalog-entity` 權限，通常就用上面其中一個。

在外掛的程式裡，單獨出現的 query 指 Temporal 的 Query（由 worker 執行 query handler 的那個操作）。搜尋或列出流程用的條件一律叫 visibility 查詢或 filter，例如 `TemporalWorkflowFilter`、`buildEntityVisibilityQuery`。兩個例外：網址的查詢參數（`req.query`、`queryString`）沿用框架用語，權限規則的 `toQuery` 則是 Backstage 權限框架規定的名字。

## 設定鍵

所有鍵都在 `temporal` 底下。schema 是四個套件的 `config.d.ts`：[`temporal-backend`](../../plugins/temporal-backend/config.d.ts)（下表核心設定）、[`temporal`](../../plugins/temporal/config.d.ts)（瀏覽器看得到的鍵）、[`temporal-backend-module-zigflow`](../../plugins/temporal-backend-module-zigflow/config.d.ts)（`definitions.*`）和 [`temporal-backend-module-actions`](../../plugins/temporal-backend-module-actions/config.d.ts)（`actions.allowServiceWrites`）。預設值和意思見 [README](../../README.md#configuration)。

| 鍵                                                                                                                              | 誰讀                                                     | 瀏覽器看得到 |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------ |
| `connection.address`                                                                                                            | 後端（`temporalServiceRef`）                             |              |
| `connection.namespaces`、`connection.tls`、`connection.auth.type`                                                               | 後端                                                     |              |
| `connection.auth.token`                                                                                                         | 後端；secret                                             |              |
| `connection.defaultNamespace`                                                                                                   | 後端、前端、Scaffolder 後端模組                          | 是           |
| `webUi.baseUrl`                                                                                                                 | 後端、前端                                               | 是           |
| `searchAttributes.entityRef`、`searchAttributes.initiator`                                                                      | 後端                                                     |              |
| `control.enabled`                                                                                                               | 後端（掛上操作路由）、前端（顯示按鈕）                   | 是           |
| `control.allowedSignals`、`control.allowedUpdates`                                                                              | 後端（拒絕）、前端（提供選項）                           | 是           |
| `externalStorage.objectUrl`                                                                                                     | 前端                                                     | 是           |
| `overview.maxVisibilityCallsPerSecond`                                                                                          | 後端（每個 process、每個 namespace 預設每秒 5 次）       |              |
| `definitions.allow`、`definitions.maxBytes`、`definitions.readFileLocations`                                                    | Zigflow 後端模組                                         |              |
| `definitions.cacheTtlSeconds`、`definitions.cacheMaxEntries`、`definitions.maxConcurrentReads`、`definitions.maxReadsPerMinute` | Zigflow 後端模組（每個 process：URL 讀取快取與上限）     |              |
| `actions.allowServiceWrites`                                                                                                    | Actions registry 後端模組                                |              |
| `pagePath`                                                                                                                      | Scaffolder 和 actions registry 後端模組（`workflowUrl`） |              |

Scaffolder 和 actions registry 後端模組另外讀 Backstage 本身的 `app.baseUrl`，用來產生 `workflowUrl` 輸出。

## Catalog：標註和 `TemporalWorkflow` kind

任何實體上的標註（常數在 `./common`）：

| 標註                        | 常數                                | 值                        |
| --------------------------- | ----------------------------------- | ------------------------- |
| `temporal.io/namespace`     | `TEMPORAL_NAMESPACE_ANNOTATION`     | Namespace                 |
| `temporal.io/task-queue`    | `TEMPORAL_TASK_QUEUE_ANNOTATION`    | Task queue                |
| `temporal.io/workflow-type` | `TEMPORAL_WORKFLOW_TYPE_ANNOTATION` | Workflow type，以逗號分隔 |

Kind：`apiVersion: temporal.io/v1alpha1`、`kind: TemporalWorkflow`（`TemporalWorkflowEntityV1alpha1`；catalog 模組用它的 JSON schema 驗證），一個實體對應一個 workflow type。

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
| `definition`   |      | `format`（`serverless-workflow`）、`target`（Definition 分頁）                                |

其他實體用標準的 `spec.dependsOn` 連到流程實體（`temporalworkflow:default/order-workflow`）。這些對應關係（標註、`spec` 與 `spec.dependsOn`）由 catalog 實體的作者宣告，管理員應透過限制 catalog 的新增與編輯權限來控管邊界。細節和範例見 [README](../../README.md#workflow-entities)；設計的理由見[流程和 catalog 的對應](catalog-model.md)。

## 外掛寫出的資料

其他系統會讀這些，所以它們也是接口：

- **Search attribute。** 從 Backstage（頁面、API、Scaffolder）啟動或重跑的流程，在設定了對應鍵時，`temporal.searchAttributes.entityRef` 會寫入實體 reference（從實體啟動時），`temporal.searchAttributes.initiator` 會寫入使用者。兩者都必須是 Temporal 裡註冊好的 `Keyword` 屬性。重跑保留原本那次執行的屬性（Temporal 自己設定、名稱以 `Temporal` 開頭的除外），並設定 initiator。

  外掛對**每個**流程都會讀這兩個屬性，不管是誰寫的：實體 reference 會把流程加進那個實體的列表，並決定權限在哪個實體上檢查；initiator 是 `IS_INITIATOR` 規則比對的對象。這兩個屬性的可信度等同於能在對應 Temporal namespace 啟動流程或寫入 search attribute 的呼叫端，請限制 namespace 的寫入權限，或在外部寫入者不應影響歸屬與 `IS_INITIATOR` 時不要設定這兩個鍵。

- **Identity。** 操作以 `backstage:<使用者實體 reference>`（或 `backstage:<服務 subject>`）作為 Temporal identity，會顯示在歷史裡。
- **稽核事件**（auditor 服務，外掛 `temporal`）：`workflow-start`、`workflow-signal`、`workflow-update`、`workflow-query`、`workflow-cancel`、`workflow-terminate`、`workflow-rerun`、`workflow-action`、`schedule-pause`、`schedule-unpause`、`schedule-trigger`，metadata 裡有 namespace、流程和實體；`workflow-update`、`workflow-cancel`、`workflow-terminate` 還會附上打開的 `runId`、`firstRunId` 和 `scope: 'chain'`。severity 是 `medium`，只有 `workflow-terminate` 是 `high`，因為終止無法復原。事件在檢查權限和請求之前就建立，所以被拒絕或不合法的嘗試也會記成失敗，附上請求的目標（namespace、流程、run、`entityRef`）；網址上的值格式不合或過長時，初始稽核內容會寫成固定佔位值 `'<invalid>'`，不記錄原值。

  Backstage 預設的對應是 `low` 送到 `debug`，`medium`、`high`、`critical` 送到 `info`。後端預設只輸出 `info` 以上，所以 `low` 的事件不會出現在 log 裡。若要看到 `low` 的事件，可以把 `backend.auditor.severityLogLevelMappings.low` 設成 `info`（這是全域設定，會連 catalog 的讀取事件一起打開），或只用 logger override 提高這個外掛的稽核事件：

  ```yaml
  backend:
    logger:
      overrides:
        - matchers:
            plugin: temporal
            isAuditEvent: true
          level: debug
  ```

- **Log**（logger 服務，外掛 `temporal`）。訊息是固定字串，會變動的值放在欄位裡，所以可以用欄位篩選 log（`logger.child({ ... }).warn('固定訊息')`），流程 ID 是自由文字也一樣。欄位有：`namespace`、`workflowId`、`runId`、`firstRunId`、`workflowType`、`taskQueue`、`entityRef`、`scheduleId`（和稽核事件用的名稱一致），以及 `temporalCall`（對 Temporal 的呼叫類別，例如 `describeWorkflowExecution`、`schedule.list`）、`grpcCode`、`grpcStatus`、`durationMs`、`timeoutMs`、`permission`、`updateId`、`messageName`（signal、update 或 query 的名稱）、`errorName`。欄位名稱避開 Backstage 的 logger 已經在用的（`plugin`、`service`、`type`、`status`、`level`、`message`、`stack`）。

  每個對 Temporal 的呼叫都會以 `debug` 記下類別、namespace 和耗時。呼叫失敗時會帶 gRPC 狀態：伺服端或後端自己的憑證出問題時記 `warn`（`UNAVAILABLE`、`RESOURCE_EXHAUSTED`、`PERMISSION_DENIED`、`UNAUTHENTICATED`、`INTERNAL`、`UNKNOWN`、`UNIMPLEMENTED`，以及 query 以外的呼叫超過期限），請求本身造成的記 `debug`（`NOT_FOUND`、`INVALID_ARGUMENT`、`ALREADY_EXISTS`、`FAILED_PRECONDITION`、不存在的排程或 namespace、沒有 worker 回答的 query）。其他的 `warn`：外掛套不上的權限條件（這是政策的問題，呼叫者只看到被拒絕）、spec 不合法的 `TemporalWorkflow` 實體、開不起來的連線、輪詢結束時還沒完成的 update，以及失敗的定義檔。

  **不會**進 log 的：payload、signal／update／query 的參數和結果、token、請求和回應的 body。欄位只放 ID、名稱、狀態碼和耗時。

外掛會在詳情頁顯示流程的 memo。外掛另外會讀 Temporal External Storage 的 reference（SDK 的 S3 driver 用它自己的格式寫的），用來顯示存放的 Payload 在哪裡；外掛不讀存放的資料本身。設定 `externalStorage.objectUrl` 時，請將 `{bucket}` 放在路徑或固定受信任網域的子網域底下，不要把 `{bucket}` 當成整個 host（`https://{bucket}/…`），以免歷史紀錄裡的 bucket 值把連結導向任意 HTTPS 主機；若 `{bucket}` 出現在主機且其後固定網域不足兩段，前端會在瀏覽器 console 記一次警告且不產生連結。在多租戶共用的網域（`*.s3.amazonaws.com`、`*.blob.core.windows.net`、`storage.googleapis.com`）上，任何租戶的 bucket 都在同一個網域，請把自己的 bucket 名稱直接寫進範本，不要用 `{bucket}`。bucket 或 key 會形成 `.` 或 `..` 路徑段時，不產生連結。詳情頁只把形式和後端寫出的 reference 完全相同的 memo 項目顯示成外部儲存的 Payload。

## Scaffolder

`@kwkevinchan/backstage-plugin-scaffolder-backend-module-temporal` 加上四個範本 action。它們以執行範本的使用者身分呼叫外掛的 HTTP API（可以在外掛以外的另一個後端執行）：

| Action                     | 輸入                                                                                                                                                | 輸出                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `temporal:workflow:start`  | `entityRef`，或 `workflowType` 和 `taskQueue`；`namespace`、`workflowId`、`args`                                                                    | `namespace`、`workflowId`、`runId`、`workflowUrl` |
| `temporal:workflow:wait`   | `workflowId`、`runId`、`namespace`、`entityRef`；`untilSearchAttribute`、`timeoutSeconds`、`intervalSeconds`、`failIfNotCompleted`、`includeResult` | `status`、`runId`、`result`、`searchAttributes`   |
| `temporal:workflow:signal` | `workflowId`、`runId`、`namespace`、`entityRef`；`name`、`args`                                                                                     | `runId`                                           |
| `temporal:workflow:update` | `workflowId`、`runId`、`namespace`、`entityRef`；`name`、`args`                                                                                     | `result`、`runId`                                 |

`start`、`signal` 和 `update` 需要操作路由；`wait` 只讀取（流程本身，以及結果要用的 `/result`）。由於 `wait` 會把 `searchAttributes` 與（在 `includeResult: true` 時的）`result` 寫入 Scaffolder task 輸出，誰看得到這些輸出由 Scaffolder 的 task 權限決定，與 Temporal 的 `temporal.workflow.read` 權限無關。沒給 `runId` 時，`wait`、`signal` 和 `update` 從 workflow ID 的 run 清單查出最新的 run（剛啟動的流程可能還不在清單裡；接在 start 後面時請傳 `runId: ${{ steps.start.output.runId }}`）。`wait` 遇到已接續的 run 會換到接續的 run；`signal` 會輸出實際送到的 run，而且當它查到的 run 在這期間被接續時，會改送到接續的 run 一次。`@kwkevinchan/backstage-plugin-scaffolder-module-temporal` 加上表單欄位 `TemporalWorkflowPicker`，值是 workflow ID；它的 `ui:options` 是 `TemporalWorkflowPickerUiOptions`（`entityRef`、`workflowType`、`namespace`、`status`、`searchAttribute`）。action 的 schema 會顯示在 Scaffolder 的 actions 頁面；另見[模組的 README](../../plugins/scaffolder-backend-module-temporal/README.md)（英文）。
`temporal:workflow:wait` 結束後，下一個步驟可以用官方的 `notification:send` 通知相關的人，並把 `link` 設成 `steps.start.output.workflowUrl`。這個做法的限制、較長簽核的替代作法，以及完整範本，見 [Notify when a decision is needed](../../plugins/scaffolder-backend-module-temporal/README.md#notify-when-a-decision-is-needed)（英文）和 [`examples/templates/release-with-notification.yaml`](../../examples/templates/release-with-notification.yaml)。

## Actions registry

`@kwkevinchan/backstage-plugin-temporal-backend-module-actions` 在 Backstage 的 actions registry 註冊五個 action：`temporal:list-workflows`、`temporal:get-workflow`、`temporal:start-workflow`、`temporal:signal-workflow`、`temporal:update-workflow`。AI 助理或 MCP client（經 `@backstage/plugin-mcp-actions-backend`）以呼叫方的身分呼叫它們（登入的使用者；呼叫方以服務身分驗證時，則換為服務主體），走和頁面、Scaffolder action 同樣的 HTTP 路由，對使用者呼叫方的權限檢查和稽核紀錄都一樣。當呼叫方是服務主體（例如 `backend.auth.externalAccess` 的靜態 token）時，`auth.getPluginRequestToken` 會換發 `plugin:temporal` 憑證送往外掛後端，後端收到的請求主體、稽核 `actorId` 與 `initiator` search attribute 均為 `plugin:temporal`（而非靜態 token 的主體）；權限政策不套用在服務身分上，且帶 `permission` 或 `permissionAttribute` 限制的 `externalAccess` token 會在換發時因無法委派而遭拒絕（所有 action 皆失敗），只限 `plugin: temporal` 的 token 則可通過委派。此外，預設會以 `NotAllowedError` 拒絕服務主體呼叫會改動流程的三個寫入 action（`start-workflow`、`signal-workflow`、`update-workflow`），讀取 action（`list-workflows`、`get-workflow`）照舊可用；只有明確設定 `temporal.actions.allowServiceWrites: true` 時才開放服務主體寫入。要逐人檢查權限並記錄實際使用者，MCP client 需使用該使用者的 token。`list-workflows` 與 `get-workflow` 回傳的流程類型、步驟名稱、失敗訊息與 search attribute 皆為不可信資料（由 worker 或啟動流程者寫入，不應視為對代理程式的指示）；這兩個 action 為 `readOnly`，另外三個則標記為 `destructive`，client 應先向使用者確認再執行，不需寫入時也可用 `backend.actions.filter.exclude` 排除 `attributes: { destructive: true }`。取消、終止、重跑不是 action。action、屬性和 MCP 設定見[模組 README](../../plugins/temporal-backend-module-actions/README.md)。

## Zigflow

`temporal-backend-module-zigflow` 提供 `TemporalWorkflow` 實體的定義檔（路由見上，設定鍵 `definitions.*`）；`temporal-module-zigflow` 把它顯示在 **Definition** 分頁（舊系統是 `EntityTemporalDefinitionContent`，掛在流程實體頁的 `/definition`；新系統是 `entity-content:temporal/definition`）。在有設定 Backstage integration 的主機上，`temporal.definitions.allow` 必須指定 `paths`（未設時啟動會記警告），否則實體作者能讀取該 integration 憑證可存取的任何儲存庫；這條路由只讀 `.yaml` 和 `.yml` 檔，而且只有檔案是有效的定義時才回傳它的文字（解析有錯時，回應不含檔案內容），`file:` 目標必須是實體檔所在資料夾內的一般檔案（解析 symlink 之後也一樣），成功讀取的 URL 會在記憶體快取 `temporal.definitions.cacheTtlSeconds` 秒（預設 30，單一 process，不跨實例共享；失敗不快取），同時讀取數和每分鐘讀取數也有上限（`maxConcurrentReads`、`maxReadsPerMinute`），HTTP redirect 則依 Backstage 的 `UrlReader` 規則處理，而不會重新檢查 `temporal.definitions.allow`。這條路由的回應（`WorkflowDefinitionResponse`）不匯出：兩個模組一起發佈，路由只給這個分頁用。

## 實驗性：模型呼叫和 Event Groups

> **實驗性。第一版之前會大幅改動，不要依賴。**

- 模型呼叫和 tool call：一律開啟。路由 `GET /:wf/llm-calls/:eventId`、`TemporalApi` 的 `getLlmCall`（`@alpha`）、`./common` 裡 `llm.ts` 的名稱、`WorkflowGraphNode` 的 `llm`、`tool` 欄位。
- Event Groups：一律開啟，從事件紀錄讀出來。`./common` 裡 `eventGroups.ts` 的名稱、`WorkflowGraphNode` 的 `groups` 欄位，以及 `WorkflowGraphResponse` 的 `eventGroups`、`eventGroupsTruncated` 欄位（[README](../../README.md#event-groups)）。需要 Temporal server 1.32 以上和會寫 Event Groups 的 SDK（TypeScript SDK 1.23 以上）；版本不夠時這些欄位不會出現。Event Groups 在 Temporal 是實驗性功能，形狀跟著它變。

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
import temporalPlugin from '@kwkevinchan/backstage-plugin-temporal/alpha';
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
import { TemporalControlActionBlueprint } from '@kwkevinchan/backstage-plugin-temporal/alpha';
import { temporalWorkflowUpdatePermission } from '@kwkevinchan/backstage-plugin-temporal/common';

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

### 在詳細頁加一個分頁

```tsx
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { Text } from '@backstage/ui';
import { TemporalWorkflowSectionBlueprint } from '@kwkevinchan/backstage-plugin-temporal/alpha';
import type { TemporalWorkflowExtensionProps } from '@kwkevinchan/backstage-plugin-temporal';

export function OwnerSection(props: TemporalWorkflowExtensionProps) {
  const owner = props.entity?.spec?.owner;
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

舊系統：把 `workflowSections={[{ id: 'owner', title: 'Owner', component: OwnerSection }]}` 傳給 `EntityTemporalContent` 和 `TemporalPage`。分頁裡較深層的元件，把 props 往下傳給它。這個分頁讀的是實體的 owner，所以在沒有實體的 Temporal 頁會顯示 "unknown"。

### 覆寫一個擴充

```ts
import temporalPlugin from '@kwkevinchan/backstage-plugin-temporal/alpha';

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

Scaffolder action 和 actions registry 模組輸出的 `workflowUrl` 預設指向 `/temporal`。頁面掛在別的路徑時，設定 `temporal.pagePath`（例如 `/pipelines`），兩個模組就會用這個路徑組連結。

`api:temporal` 的參數要用 callback 給；換成你自己的 `TemporalApi` 時寫 `params: defineParams => defineParams({ api: temporalApiRef, deps: {}, factory: () => myClient })`（[README](../../README.md#extending)）。

### 自己提供 `temporalServiceRef`

例如使用用戶端憑證的連線。繼承 `DefaultTemporalService`：其他部分它照預設 factory 的方式從設定讀（`readTemporalServiceOptions`）；覆寫 `getConnection` 和 `close`：它的 `getClient` 是在 `this.getConnection()` 上建立 client，所以外掛的期限照樣有效。把 factory 和外掛一起加到後端（`backend.add(mtlsTemporalServiceFactory)`）：

```ts
import { readFileSync } from 'node:fs';
import {
  coreServices,
  createServiceFactory,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { Connection } from '@temporalio/client';
import {
  DefaultTemporalService,
  readTemporalServiceOptions,
  TemporalServiceOptions,
  temporalServiceRef,
} from '@kwkevinchan/backstage-plugin-temporal-backend/node';

/** The built-in service, with a client certificate on its connection. */
class MtlsTemporalService extends DefaultTemporalService {
  readonly #address: string;
  #connection?: Promise<Connection>;

  constructor(options: TemporalServiceOptions, logger?: LoggerService) {
    super(options, logger);
    this.#address = options.address;
  }

  getConnection(): Promise<Connection> {
    this.#connection ??= Connection.connect({
      address: this.#address,
      tls: {
        clientCertPair: {
          crt: readFileSync('/etc/temporal/tls.crt'),
          key: readFileSync('/etc/temporal/tls.key'),
        },
      },
    }).catch(error => {
      // Connect again on the next call instead of keeping the failure.
      this.#connection = undefined;
      throw error;
    });
    return this.#connection;
  }

  async close(): Promise<void> {
    const connection = this.#connection;
    this.#connection = undefined;
    // Drops the clients made on the connection.
    await super.close();
    if (connection) await (await connection).close();
  }
}

export const mtlsTemporalServiceFactory = createServiceFactory({
  service: temporalServiceRef,
  deps: {
    config: coreServices.rootConfig,
    logger: coreServices.rootLogger,
    lifecycle: coreServices.rootLifecycle,
  },
  factory({ config, logger, lifecycle }) {
    const temporal = new MtlsTemporalService(
      readTemporalServiceOptions(config),
      logger,
    );
    lifecycle.addShutdownHook(() => temporal.close());
    return temporal;
  },
});
```

不用這個類別、自己實作 `TemporalService` 時，要守 [`temporalServiceRef`](#temporalserviceref) 的規則：`getClient({ namespace })` 的 client 要建立在 `getConnection({ namespace })` 上。

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

| 你在找                                                              | 為什麼不匯出                                 | 改用                                                                 |
| ------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| `TemporalWorkflow` kind 的 JSON schema、名稱的 pattern              | 匯出它們，`spec` 每加一個欄位就是 API 的變動 | catalog 模組會驗證 kind；`./common` 的 `isValidNamespaceName` 等檢查 |
| 流程的 resource reference，讓其他外掛做授權                         | 外掛自己套用 `temporal-workflow` 的條件      | 以使用者身分呼叫 HTTP API（[範例](#從其他後端呼叫-http-api)）        |
| `DefaultTemporalAccessService`                                      | 檢查只透過 interface 這一個約定提供          | `temporalAccessServiceRef`，或為它提供自己的 factory                 |
| 各個 router、`WorkflowQueries`、`WorkflowCommands`、repository      | 內部分層，由 `plugin.ts` 接起來              | HTTP API、擴充點                                                     |
| `temporalWorkflowExtensionsApiRef`、`TemporalWorkflowExtensionsApi` | 收集 blueprint 是實作細節                    | blueprint；要拿掉所有擴充就停用 `api:temporal/workflow-extensions`   |
| 外掛的擴充本身（`temporalPage`…）                                   | 匯出擴充會把它們的參數固定下來               | `getExtension(id)` 和 `withOverrides()`（[ID](#extension-id)）       |
| Zigflow 的型別（`WorkflowDefinitionResponse`…）                     | 這條路由只給 Definition 分頁用               | Definition 分頁                                                      |
| 在前端匯入 `@kwkevinchan/backstage-plugin-temporal-backend/common`  | 前端外掛不能匯入後端外掛                     | `@kwkevinchan/backstage-plugin-temporal/common`，同一份定義          |
| 在你的外掛用 `./ui` 的元件                                          | 是為 Zigflow 模組做的，`@alpha`              | `@backstage/ui`                                                      |

## 讓這篇保持正確

每個發佈套件的每個入口都有一份 API report：`report.api.md` 和 `report-<入口>.api.md`，放在套件的 `package.json` 旁邊，由 [API Extractor](https://api-extractor.com/) 透過 `@backstage/repo-tools` 產生，做法和 Backstage 版本庫相同。CI（Verify job 裡型別檢查之後的 **API reports** 步驟）會在 report 和匯出對不上時失敗。改了匯出之後：

```sh
yarn build:api-reports   # 型別檢查，再寫出 report
```

把改過的 report 和程式一起提交。公開接口有變動時，pull request 裡就會出現 report 的 diff。HTTP API 另有自己的合約：[OpenAPI 規格](../../plugins/temporal-backend/src/schema/openapi.yaml)，改路由時一起改它；路由的測試、對帳測試和 `yarn lint:openapi` 會檢查它。如果變動新增、移除或改名了這篇列出的名稱，在同一個 pull request 更新這篇。

有些 report 帶著 API Extractor 寫進去的警告（`// Warning: ...`），`temporal-backend` 和 `temporal` 允許這些警告（`--allow-warnings`）；新增的警告仍然會出現在 report 的 diff 裡。這些警告全都是一個入口的型別引用了同一套件另一個入口的型別（例如 `TemporalApi` 和 `./common` 的回應型別），這個版本庫不會重複匯出。步驟圖型別上的三個實驗性欄位（`WorkflowGraphNode.llm`、`.tool` 和 `WorkflowGraphResponse.eventGroups`）標成 `@alpha`：它們可能在 minor 版本改變。

回到[文件索引](README.md)。
