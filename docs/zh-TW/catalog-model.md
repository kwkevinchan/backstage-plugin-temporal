# 流程和 catalog 的對應

[English](../catalog-model.md) | 繁體中文

這篇說明：為什麼 catalog 裡有 Workflow Type、卻沒有 workflow execution；外掛怎麼判斷一個流程屬於哪個實體；誰可以宣告這件事。設定方法在 [README](../../README.md#workflow-entities)（英文），這裡說明背後的設計。

- [catalog 裡有什麼](#catalog-裡有什麼)
- [流程怎麼對到實體](#流程怎麼對到實體)
- [子流程](#子流程)
- [權限查哪個實體](#權限查哪個實體)
- [一次請求的成本](#一次請求的成本)
- [考慮過但沒採用的做法](#考慮過但沒採用的做法)
- [誰可以宣告流程屬於哪個實體](#誰可以宣告流程屬於哪個實體)

## catalog 裡有什麼

catalog 放長期存在的東西：component、system、Workflow Type。執行時發生的事不放進去。

這裡會用到 Temporal 的三個名詞（見[入門](temporal-primer.md)）：

- **Workflow Type**：一份流程程式的名字，例如 `orderWorkflow`。
- **Workflow Execution**：這份程式實際跑的一次，用 Workflow ID 找，例如 `order-1001`。
- **Run**：一筆執行的其中一段，用 Run ID 找。整個流程重試或 continue-as-new 會開新的 run，Workflow ID 不變。

catalog 放的是 Workflow Type。執行和 run 留在 Temporal。

![catalog 裡的實體數量固定：一個帶 Temporal 標註的 component，和 TemporalWorkflow 實體（一個 Workflow Type 一個）。Temporal 存放流程的執行和它們的 run，數量一直增加。後端在每次請求時把執行對到實體，結果不存。](images/catalog-model.svg)

| 在 catalog 裡                                            | 不在 catalog 裡                   |
| -------------------------------------------------------- | --------------------------------- |
| `TemporalWorkflow` 實體：一個 Workflow Type 一個實體     | Workflow Execution（Workflow ID） |
| 任何實體上的標註（`temporal.io/*`）                      | Run（Run ID）                     |
| 其他實體用 `spec.dependsOn` 連到 `TemporalWorkflow` 實體 | 比對的結果                        |

實體的數量跟著 Workflow Type 的數量走，有人寫了新的流程程式才會變。執行的數量跟著流量走：一筆訂單就可能啟動一筆執行。執行只存在 Temporal，頁面要看時外掛才去讀。

Backstage 其他外掛也這樣處理執行時的資料。Kubernetes 外掛用 component 上的標註找 pod，不把 pod 放進 catalog。CI 外掛（GitHub Actions、Jenkins）用同樣的方式找 build，也不把 build 放進 catalog。

## 流程怎麼對到實體

下面**任一種**比中，執行就屬於這個實體：

1. **實體的標註或 spec。** 實體 `temporal.io/*` 標註的 Task Queue 和 workflow type 相符，各自有設定時才比。只設 Task Queue，就比中這個佇列上所有 workflow type。`TemporalWorkflow` 實體用它的 `spec.taskQueue` 和 `spec.workflowType`，規則相同。
2. **`entityRef` Search Attribute。** 執行的 Search Attribute（名稱設定在 `temporal.searchAttributes.entityRef`）裡是這個實體的 reference。這個值在流程啟動時設定，或由流程自己設定。沒有這個設定時，這種方式不啟用。
3. **實體依賴的 `TemporalWorkflow` 實體。** 實體在 `spec.dependsOn` 裡列了 `temporalworkflow:default/order-workflow`，而執行符合那個實體的 spec，或 Search Attribute `entityRef` 裡是那個實體的 reference。只往下找一層，最多 20 個，而且只算同一個 namespace、使用者有讀取權限的。

清單用 OR 把三種接成一個 visibility 查詢，所以沒有先後。單一流程（詳情頁和操作）時，後端對這個流程檢查同樣三條規則。先後只和權限有關，見下面兩節。

比對結果不存。改了標註，catalog 處理完這次變更後，下一次請求就用新的值。

## 子流程

子流程做的是父流程的一部分工作。子流程自己對不到實體時，後端看它的父流程，再看父流程的父流程，最多往上 **3 層**。祖先對到實體時，子流程就用那個實體和它的權限打開、操作。

往上找需要父流程的 run ID。只有 Workflow ID 的父流程，可能是另一個同 ID 的執行（之後的 run，或另一個 namespace），所以找到那裡就停，這個子流程不算在這個實體上。

## 權限查哪個實體

比對的結果決定讀取和操作權限查哪個實體。完整規則在[公開接口](public-interfaces.md#流程在哪個實體上檢查權限)的「流程在哪個實體上檢查權限」一節。簡單說，頁面透過一個實體打開流程時：

- 實體自己的標註、spec 或 Search Attribute 比中（流程本身或它的祖先），只查這個實體。
- 透過打開的實體所依賴的 `TemporalWorkflow` 實體比中，**兩個**實體都查：打開的實體，和比中的 `TemporalWorkflow` 實體。所以別的團隊的 component 透過 `dependsOn` 顯示這些執行時，Workflow Type 實體上的政策照樣生效。

第二個實體只在透過 `dependsOn` 比中時才查。另一個實體用自己的標註或 Search Attribute 比中同樣的執行時，只查那個實體，`TemporalWorkflow` 實體上的政策不會用到。要讓 owner 的政策生效，請限制誰能宣告這類比對，見[最後一節](#誰可以宣告流程屬於哪個實體)。

## 一次請求的成本

每次請求的工作量不會隨執行的數量增加：

| 請求                              | 後端做的事                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 實體的流程清單                    | 查實體的讀取權限並讀實體；對它依賴的 `TemporalWorkflow` 實體（最多 20 個）查讀取權限，讀允許的那些；然後送**一個** visibility 查詢，讀一頁                                                                                                                                                                                                |
| 單一流程                          | 照上面讀實體和相關實體；describe 這個流程（流程失敗、逾時、被終止或 continue-as-new 時，再讀它的最後一個事件）；流程自己對不到時，最多再 describe 3 個祖先；沒有 `workflowEntityRef`，而且打開的實體不是這個 workflow type 的 `TemporalWorkflow` 時，再用使用者的憑證查一次 catalog（依 kind 和 `spec.workflowType`），結果只用來顯示連結 |
| `TemporalWorkflow` 實體的統計卡片 | 照上面讀實體；然後取這個實體的總覽（`POST /workflow-types/overview`）：最多三個 visibility 呼叫，結果保留 60 秒；按 Refresh 會重新讀取                                                                                                                                                                                                    |

模組註冊的 workflow enricher 會跑在回傳的每一筆上，成本看模組而定。

查詢由 Temporal 的 visibility store 回答。執行開始或結束時，catalog 不做任何事。

## 考慮過但沒採用的做法

**用 entity provider 把執行或 run 寫進 catalog。** 這樣每筆執行都會是一個實體。沒有採用：

| 看的點         | 每次請求時比對（採用）                                                              | 執行當成 catalog 實體                                                                                    |
| -------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 規模和同步成本 | catalog 一個 Workflow Type 一個實體                                                 | 沒有上限。每筆執行都要經過 catalog 的處理。Temporal 過了保留期限刪掉已結束的執行後，實體還留著，要另外清 |
| 流程上的 owner | 設在 `TemporalWorkflow` 實體上；單一筆執行可以用 `entityRef` attribute 指定別的實體 | owner 還是要從 Workflow Type 或 Search Attribute 來：是副本，不是新的來源                                |
| 雙方確認歸屬   | 兩邊都已經能宣告：catalog（標註、spec、`dependsOn`）和 Temporal（Search Attribute） | 沒有幫助：還是要有人宣告                                                                                 |
| 資料來源       | 只有 Temporal。頁面上的狀態永遠是最新的                                             | 兩個來源。catalog 慢一個同步週期，清單和詳情頁可能不一致                                                 |

**替 Temporal 裡找到的每個 Workflow Type 自動建立 `TemporalWorkflow` 實體。** 實體數量不會太多，但 Temporal 不知道 Workflow Type 的 owner 和 system。Backstage 的慣例是由實體的作者在 YAML 檔裡宣告這些。這種 provider 以後可以做成獨立的模組，不用改模型。

**要求雙方都宣告才算。** 外掛可以只在 catalog 和 Search Attribute 一致時才算數。現在任一邊就夠，[下一節](#誰可以宣告流程屬於哪個實體)說明怎麼限制各邊。更嚴格的模式可以加在現在的比對上。

## 誰可以宣告流程屬於哪個實體

有兩種人可以讓執行出現在某個實體上，並套用那個實體的權限：

- **catalog 的作者。** 標註、`TemporalWorkflow` 的 spec 和 `spec.dependsOn` 都寫在 catalog 的 YAML 檔裡。能註冊或編輯實體的人，就能把它指到允許的 namespace 裡任何一個 Workflow Type，然後讀到那些執行，包括輸入和結果。請限制誰能註冊、編輯實體（catalog rules、審查 catalog 檔案）。
- **能啟動流程或設定 Search Attribute 的人。** `entityRef` Search Attribute 的可信程度和這些呼叫者一樣。請限制 Temporal namespace 的寫入權限；不希望其他寫入者決定歸屬時，不要設定 `temporal.searchAttributes.entityRef`。

外掛無法交叉驗證這些宣告，它顯示 catalog 和 Temporal 宣告的內容。外掛所有的信任邊界列在 README 的 [Security](../../README.md#security) 一節。
