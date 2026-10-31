# Native implementation interfaces

All native app Swift sources live in `native/Sources/YogurtNative`; target macOS15+, Swift tools6 (language mode5 initially). Root owns Core/, Components.swift, main app/login/overview/shell and runtime. OperationsViews.swift and ManagementViews.swift have disjoint owners. Do not write another @main, shared models or package configuration in domain files.

## Shared Swift interfaces

`JSONValue: Codable, Equatable, Sendable, Identifiable` cases `.object([String:JSONValue])`, `.array([JSONValue])`, `.string(String)`, `.number(Decimal)`, `.bool(Bool)`, `.null`. Subscript `[String]` returns `.null` if absent; computed `.text: String`, `.array: [JSONValue]`, `.object: [String:JSONValue]`, `.bool: Bool`, `.decimal: Decimal`, `.double: Double`, `.id: String`; helper `text(_ key:String) -> String`. Use monetary/quantity strings in editable payloads, integer JSON numbers only where existing APIs require them. No authority for money is moved to client.

`@MainActor final class FeatureState: ObservableObject`: `@Published var data:JSONValue`, `loading:Bool`, `error:String?`, `source:String`, `generatedAt:String`; `func load(_ model:AppModel, _ resource:String, query:[String:String]=[:]) async` and `func refresh() async`. Views own `@StateObject var state=FeatureState()` and call load in .task. Retain old content during errors/refresh; source!=database disables writes.

`@MainActor final class AppModel: ObservableObject`: `session:NativeSession?`, `selected:Destination`, `notice:String?`, `startupState:String`, `ready:Bool`, `startupError:String?`, `canWrite:Bool`; `func read(_ resource:String,query:[String:String]=[:]) async throws -> NativeReadResponse`; `func mutate(_ path:String, body:JSONValue, method:String="POST", durable:Bool=true) async throws -> JSONValue`; `func openReceipt(_ path:String) async throws`; `func uploadReceipt(_ url:URL) async throws -> String`; `func exportCSV(name:String,headers:[String],rows:[[String]])`; `func navigate(_ destination:Destination, storeId:String?=nil)`; `contextStoreId:String?`; `func showNotice(_ text:String)`. Throws human-readable localized errors, never raw credentials.

`NativeSession` has `userId,fullName,email,role,source:String`; role strings admin/production/driver. `Destination: String, CaseIterable, Identifiable` cases `overview,stores,map,refills,driver,settlements,inventory,production,expenses,reports,operations,fridges,notifications,audit`; `title:String`, `symbol:String`, `domain:WorkDomain`, `isAllowed(role:String)->Bool`.

Shared components:
- `Workspace(title:String,subtitle:String="",domain:WorkDomain,@ViewBuilder actions:()->Actions,@ViewBuilder content:()->Content)` with defaults for empty actions convenience init.
- `ReadStateView(state:FeatureState,@ViewBuilder content:()->Content)` supplies native loading/error/retry/source states.
- `StatusLabel(_ text:String,tone:StatusTone=.neutral)`; tones neutral/info/success/warning/danger.
- `EmptyNotice(title:String,detail:String="",symbol:String="tray")`.
- `EditorField(key:String,label:String,kind:EditorField.Kind=.text,required:Bool=false,help:String="")`; kinds `.text,.multiline,.money,.integer,.decimal,.date,.choice([EditorChoice])`. `EditorChoice(id:String,label:String)`.
- `NativeEditor(title:String,fields:[EditorField],initial:[String:String]=[:],saveLabel:String="ບັນທຶກ",onSave:([String:String]) async throws -> Void)` handles busy/errors/dirty dismiss and preserves values on failure. Use for simple forms only, dedicated restock/production/closing workflows remain domain-specific.
- `Theme` static colors `cream,surface,evergreen,green,ink,muted,border,blue,mango,purple,danger`; `Theme.font(_ size:CGFloat=14,weight:Font.Weight=.regular)->Font` uses registered Noto Sans Lao.
- `MoneyText(_ value:JSONValue)` and `AmountText(_ value:Decimal, currency:Bool=true)` use precise display formatting; `canonicalDecimal(_ text:String,scale:Int=2,allowNegative:Bool=false) throws -> String` validates form decimal precision. `businessDateString(_ date:Date)->String` uses Asia/Vientiane YYYY-MM-DD.

## Native read resources

GET `/api/native/v1/<resource>?id=...&query=...&filter=...&page=...&period=...&historyPage=...` returns `{version:1,resource,source,generatedAt,data}`. `data` is the corresponding existing helper result (including its existing named arrays) plus explicitly described form/raw projections. Inspect src/lib/db-data.ts exported View types for exact nested display keys; do not guess fields.

- overview: `{dashboard:<getDashboardData result>,notifications:<getNotificationsData result>}`; reuse same dashboard promise.
- stores: `{stores:[StoreView],source}`.
- store?id: `{store:<raw safe editable Store projection>,view:<StoreView/detail>,refills:[],settlements:[],visits:[]}`. Editable decimals remain strings. Must include current fridge/inventory and raw contact/lat/lng/commission/electricity data.
- map: existing getMapData output.
- refills: existing getRefillsData output.
- restock?id: `{data:RestockStoreData,source}` (same nested shape as helper).
- inventory: existing getInventoryData output.
- production: existing getProductionData output + `materials` raw stock projections + `recipes` (id,finishedProductId,name,baseCups,version,items[rawMaterialId,quantityRequired,rawMaterial{name,unit,currentStock,avgCostPerUnit}]) for planner.
- settlements: existing getSettlementsData output (query/filter/page).
- expenses: existing getExpensesData output (query/filter/page/id).
- expense?id: `{expense:<safe raw record with decimal strings and edit snapshot>,stores:[id/name]}`.
- reports: existing getReportsData(businessReportRange(period)) output; period today/week/month.
- notifications: existing getNotificationsData output, role-filtered alerts.
- operations: `{products:[raw safe product projection],materials:[raw safe material projection],recipes:[raw version/item projections],backup:<readiness>,source}`; no user hashes/hidden user management.
- fridges: existing getFridgesData output + `stores:[id/name]`.
- audit: `{logs:[safe actor/store/metadata projection],total,page,totalPages,pageSize:50}`; query/filter/page validation.
- catalog: `{stores:[id,name,fridgeId],products:[id,code,name,retailPrice,shelfLifeDays],materials:[id,code,name,unit,currentStock,avgCostPerUnit],recipes:[planner projections],categories:[id,name]}`. Restrict projections to current role; drivers have product/store choices but no material cost/recipe data. Production has product/material/recipe choices, not finance categories.

Backend agent publishes exact deviations/additions before UI consumers rely on them. All existing mutation payloads are source-authoritative: read corresponding route.ts and components before constructing Swift requests. Preserve Idempotency-Key, X-Operation-User and snapshots. Known non-durable operations must call durable:false and reconcile on uncertainty rather than repeat blindly.

### Exact native read additions

All native reads require a currently valid database-backed session. Unknown resources return 404, invalid/duplicate/unsupported query parameters return 400, denied roles return 403, missing records return 404, and failed database reads return 503. Responses carry `Cache-Control: private, no-store, max-age=0`. Existing helper fallback results keep `source:"demo"`; they cannot authorize writes. Query text is trimmed and bounded to 200 characters (audit 120); pages are positive integers up to 1,000,000. Reports accept today/week/month; week maps to the existing seven-day Laos calendar helper. Settlements filters are pending/partial/paid/all; expenses all/month/electricity/transport/maintenance; audit all/update/adjust/expense/user.

Role policy: all roles read overview/stores/store/map/refills/notifications/catalog; admin and driver read restock/settlements; admin and production read inventory/production; admin alone reads expenses/expense/reports/operations/fridges/audit/closing. This adds production's read-only refill queue and driver's product catalog without changing any mutation role policy.

`refills` without parameters retains the active queue helper. `refills?id=<id>` is a narrow persisted lookup that also returns completed/cancelled requests, for reconciliation after a lost lifecycle response. It returns `{source:"database",refills:[{id,storeId,storeName,address,phone,status,requestedAt:ISO,deliveredAt:ISO|null,note,items:[{productId,code,name,quantity}],cheeseQty,mangoQty}]}` and 404 for an unknown id. Do not infer failure from absence in the active queue.

Safe raw product fields are `{id,code,name,sizeDescription,retailPrice:string,shelfLifeDays,isActive}`. Safe raw materials are `{id,code,name,category,unit,currentStock:string,minStockAlert:string,avgCostPerUnit:string,isActive}`. Every decimal in these raw projections is the database decimal's string representation. Integers remain JSON numbers. `inventory` adds `rawMaterials` beside the existing display `materials`; `production.materials` uses the raw material shape.

Planner/operations recipe fields are `{id,finishedProductId,name,baseCups,version,isDefault,finishedProduct:{id,code,name,isActive},items:[{rawMaterialId,quantityRequired:string,rawMaterial:<safe raw material>}]}`. Returned recipes are the default version for active products. `operations` returns `{source,products:[safe raw product],materials:[safe raw material],recipes:[planner recipe],backup:{ok,ageHours,restoreVerified,reasons}}`; its product/material lists include inactive rows for management. No users or account hashes are exposed.

`store?id` returns `{store,view,inventory,latestBalance:string,latestSettlement:null|{paidAmount:string,closingBalance:string,settlementDate:ISO},refills,settlements,visits}`. Raw `store` fields are `{id,name,contactName,phone,whatsapp,facebook,address,latitude:string|null,longitude:string|null,commissionRate:string,monthlyElectricity:string,fridgeStartDate:YYYY-MM-DD|null,isActive,fridge}`; contact fields retain nulls. `fridge` is null or `{id,assetCode,model,serialNo,capacityCups,status}`. `view` adds `stock,due` and keeps display numeric coordinates/commission/electricity. `inventory` is `[{id,productId,currentStock,lastAuditDate:ISO|null,product:<safe raw product>}]` from the current fridge only. Archived stores remain readable for payment reconciliation; full audits still require active stores/current fridge. `latestBalance` is available without a fridge. Production receives only the existing visible latest payment summary; its `settlements` array is empty and the database query selects only that summary's three fields.

`store.refills` contains at most five active requests: `{id,storeId,storeName,status,requestedAt:ISO,deliveredAt:ISO|null,note,items:[{productId,code,name,quantity}]}`. `store.settlements` contains the latest eight records: `{id,receiptNumber,receiptPath,slipImageUrl,settlementDate:ISO,grossAmount:string,storeCommissionAmount:string,netPayableAmount:string,previousBalance:string,paidAmount:string,closingBalance:string,paymentStatus,paymentMethod}`. `receiptPath` is the persisted nullable `slipImageUrl`, not an invented settlement receipt route. Stored receipt attachments use the existing admin-only `/api/receipts/[name]` endpoint. `store.visits` contains the latest six completed visits `{id,visitDate:ISO,status}`.

`restock?id` retains `{source,data:<restock fields>}` inside the envelope data. `data.previousBalance`, `data.store.commissionRate`, and `data.lines[].retailPrice` are exact decimal strings. It adds `data.expectedFinancialSnapshot:{previousBalance:string,commissionRate:string,retailPrices:[{productId,retailPrice:string}]}` for unchanged submission with the existing restock mutation. Previous stock/refill counts remain integer fields from the authoritative helper. A store without a current fridge has no restock record; payment-only workflows use the store's `latestBalance`.

`settlements.settlements[]` retains every existing display key and adds `{settlementId,receiptNumber,receiptPath,slipImageUrl,settlementDate:ISO|null,previousBalance:string|null,paymentMethod,grossAmount:string|null,storeCommissionAmount:string|null,netPayableAmount:string|null,paidAmount:string|null,closingBalanceExact:string|null}` from persisted records on the current bounded page. Its existing `id` may be a receipt number; use `settlementId` for the database identity. Missing supplemental fields are null rather than fabricated receipt data.

`expense?id` returns `{expense:{id,category,amount:string,incurredAt:YYYY-MM-DD,storeId,storeName,note,receiptUrl,expectedExpenseSnapshot:{category,amount:string,incurredAt:YYYY-MM-DD,storeId,note,receiptUrl}},stores:[{id,name}]}`. Retain the original snapshot and nullable values for PATCH; do not rebuild it from edited fields. Voided records are unavailable for editing.

`closing?date=YYYY-MM-DD` is an admin-only read returning `{closingDate:YYYY-MM-DD,snapshot:null|{id,cashAmount:string,bankAmount:string,expenseAmount:string,note:string|null}}` using the existing daily-closing snapshot helper. Submit the original nullable snapshot as `expectedSnapshot` when saving through `/api/daily-closing`.

`audit` returns `{logs,total,page,totalPages,pageSize:50,query,filter}` with bounded pages. Each log is `{id,action,entityType,entityId,storeId,summary,createdAt:ISO,user:null|{fullName,role},store:null|{name},metadata}`; credential-bearing metadata keys are removed recursively. `catalog.stores` is `[{id,name,fridgeId}]`, products are `[{id,code,name,retailPrice:string,shelfLifeDays}]`, and material/recipe fields use the raw shapes above. Drivers receive empty materials/recipes/categories arrays. Production receives empty stores/categories arrays. Admin categories are `[{id,name}]`.

`overview.dashboard.settlements` is empty for every role because the native overview does not display those records. `ownerNet` is zero for non-admin roles; driver material rows are empty, and production outstanding is zero. The previously visible seven-day `weeklyGross` aggregate remains available. Notifications are filtered by the existing page access policy. `reports` adds `range:{from:ISO,to:ISO,timeZone:"Asia/Vientiane"}` from the same authoritative calculator range; `to` is exclusive.
