import Foundation

/// SQL identifiers/expressions in this file are source-controlled. User values only enter binds.
struct SwiftReadProjection: Sendable {
    let connection: SwiftSQLConnection
    let now: Date
    let role: String
    static func cheese(_ row: JSONValue) -> Bool { (row.text("code") + " " + row.text("name")).range(of:"CHS|cheese|ຊີສ",options:[.regularExpression,.caseInsensitive]) != nil }
    static func mango(_ row: JSONValue) -> Bool { (row.text("code") + " " + row.text("name")).range(of:"MNG|mango|ໝາກມ່ວງ",options:[.regularExpression,.caseInsensitive]) != nil }
    static let product = """
    json_build_object('id',p.id,'code',p.code,'name',p.name,'sizeDescription',p.size_description,'retailPrice',trim_scale(p.retail_price)::text,'shelfLifeDays',p.shelf_life_days,'isActive',p.is_active)
    """
    static let material = """
    json_build_object('id',m.id,'code',m.code,'name',m.name,'category',m.category,'unit',m.unit,'currentStock',trim_scale(m.current_stock)::text,'minStockAlert',trim_scale(m.min_stock_alert)::text,'avgCostPerUnit',trim_scale(m.avg_cost_per_unit)::text,'isActive',m.is_active)
    """
    static let fridge = """
    CASE WHEN f.id IS NULL THEN NULL ELSE json_build_object('id',f.id,'assetCode',f.asset_code,'model',f.model,'serialNo',f.serial_no,'capacityCups',f.capacity_cups,'status',f.status) END
    """
    static let items = """
    COALESCE((SELECT json_agg(json_build_object('productId',i.finished_product_id,'code',p.code,'name',p.name,'quantity',i.quantity)) FROM refill_request_items i JOIN finished_products p ON p.id=i.finished_product_id WHERE i.refill_request_id=r.id),'[]'::json)
    """
    func products(all: Bool = false) async throws -> [JSONValue] {
        try await connection.rows("SELECT \(Self.product) AS value FROM finished_products p WHERE ($1::boolean OR p.is_active) ORDER BY p.name",[.bool(all)]).map { $0["value"] }
    }
    func materials(all: Bool = false) async throws -> [JSONValue] {
        try await connection.rows("SELECT \(Self.material) AS value FROM raw_materials m WHERE ($1::boolean OR m.is_active) ORDER BY m.name",[.bool(all)]).map { $0["value"] }
    }
    static func materialDisplay(_ row: JSONValue) -> JSONValue {
        .object(["id":row["id"],"code":row["code"],"name":row["name"],"category":row["category"],"unit":row["unit"],"stock":.number(row["currentStock"].decimal),"minStock":.number(row["minStockAlert"].decimal),"avgCost":.number(row["avgCostPerUnit"].decimal)])
    }
    func recipes() async throws -> [JSONValue] {
        try await connection.rows("""
        SELECT r.id,r.finished_product_id AS "finishedProductId",r.name,r.base_cups AS "baseCups",r.version,r.is_default AS "isDefault",
        json_build_object('id',p.id,'code',p.code,'name',p.name,'isActive',p.is_active) AS "finishedProduct",
        COALESCE((SELECT json_agg(x.value ORDER BY x.material_id) FROM (SELECT i.raw_material_id AS material_id,json_build_object('rawMaterialId',i.raw_material_id,'quantityRequired',trim_scale(i.quantity_required)::text,'rawMaterial',\(Self.material)) AS value FROM recipe_items i JOIN raw_materials m ON m.id=i.raw_material_id WHERE i.recipe_id=r.id) x),'[]'::json) AS items
        FROM recipes r JOIN finished_products p ON p.id=r.finished_product_id WHERE r.is_default AND p.is_active ORDER BY r.name,r.id
        """)
    }
    func storeOptions(fridge: Bool = false) async throws -> [JSONValue] {
        let rows = try await connection.rows("SELECT s.id,s.name,f.id AS \"fridgeId\" FROM stores s LEFT JOIN fridges f ON f.current_store_id=s.id WHERE s.is_active ORDER BY s.name")
        return fridge ? rows : rows.map { .object(["id":$0["id"],"name":$0["name"]]) }
    }
    func stores() async throws -> [JSONValue] {
        let rows = try await connection.rows("""
        SELECT s.id,s.name,COALESCE(s.contact_name,'—') AS "contactName",COALESCE(s.phone,'—') AS phone,COALESCE(s.whatsapp,'—') AS whatsapp,COALESCE(s.facebook,'—') AS facebook,COALESCE(s.address,'—') AS address,s.commission_rate AS "commissionRate",s.fridge_start_date AS "fridgeStartDate",s.latitude,s.longitude,s.monthly_electricity AS "monthlyElectricity",
        \(Self.fridge) AS fridge,
        COALESCE((SELECT SUM(i.current_stock) FROM fridge_inventory i WHERE i.store_id=s.id AND i.fridge_id=f.id),0) AS stock,
        NOT EXISTS(SELECT FROM restock_visits v WHERE v.store_id=s.id AND v.status='completed' AND v.visit_date >= $1::timestamp) AS due
        FROM stores s LEFT JOIN fridges f ON f.current_store_id=s.id WHERE s.is_active ORDER BY s.name
        """,[.string(SwiftServiceJSON.iso(now.addingTimeInterval(-7 * 86400)))])
        return try rows.map { row in
            var fridge = row["fridge"]
            if fridge != .null { fridge = SwiftServiceJSON.replacing(fridge,["model":fridge["model"] == .null ? .string("—") : fridge["model"],"serialNo":fridge["serialNo"] == .null ? .string("—") : fridge["serialNo"]]) }
            return SwiftServiceJSON.replacing(row,["fridgeStartDate":try SwiftServiceJSON.displayDate(row["fridgeStartDate"]),"fridge":fridge])
        }
    }
    func map() async throws -> JSONValue {
        let rows = try await connection.rows("""
        SELECT s.id,s.name,COALESCE(s.address,'—') AS address,s.latitude,s.longitude,COALESCE(s.contact_name,'—') AS "contactName",COALESCE(s.phone,'—') AS phone,COALESCE(s.whatsapp,'—') AS whatsapp,
        COALESCE(f.capacity_cups,100) AS capacity,COALESCE(f.status::text,'active') AS "fridgeStatus",COALESCE(f.asset_code,'—') AS "assetCode",COALESCE(f.asset_code,'—') AS "fridgeNumber",
        COALESCE((SELECT SUM(i.current_stock) FROM fridge_inventory i WHERE i.store_id=s.id AND i.fridge_id=f.id),0) AS stock,
        NOT EXISTS(SELECT FROM restock_visits v WHERE v.store_id=s.id AND v.status='completed' AND v.visit_date >= $1::timestamp) AS due,
        (SELECT r.status FROM refill_requests r WHERE r.store_id=s.id AND r.status IN('waiting','preparing','delivering') ORDER BY r.requested_at DESC,r.id DESC LIMIT 1) AS "refillStatus",
        COALESCE((SELECT st.closing_balance FROM settlements st WHERE st.store_id=s.id ORDER BY st.settlement_date DESC,st.id DESC LIMIT 1),0) AS outstanding,
        COALESCE((SELECT json_agg(json_build_object('name',p.name,'quantity',i.current_stock)) FROM fridge_inventory i JOIN finished_products p ON p.id=i.finished_product_id WHERE i.store_id=s.id AND i.fridge_id=f.id),'[]'::json) AS yogurt
        FROM stores s LEFT JOIN fridges f ON f.current_store_id=s.id WHERE s.is_active AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL ORDER BY s.name
        """,[.string(SwiftServiceJSON.iso(now.addingTimeInterval(-7 * 86400)))])
        return .object(["source":.string("database"),"stores":.array(rows.map { SwiftServiceJSON.replacing($0,["lowStock":.bool($0["capacity"].decimal > 0 && $0["stock"].decimal <= $0["capacity"].decimal * Decimal(string:"0.35")!)]) })])
    }
    func refills(id: String? = nil) async throws -> [JSONValue] {
        let rows = try await connection.rows("""
        SELECT r.id,r.store_id AS "storeId",s.name AS "storeName",COALESCE(s.address,'—') AS address,COALESCE(s.phone,'—') AS phone,r.status,r.requested_at AS "requestedAt",r.delivered_at AS "deliveredAt",r.note,\(Self.items) AS items
        FROM refill_requests r JOIN stores s ON s.id=r.store_id WHERE (($1::text IS NULL AND r.status IN('waiting','preparing','delivering')) OR r.id=$1) ORDER BY r.requested_at ASC
        """,[id.map(JSONValue.string) ?? .null])
        if id != nil && rows.isEmpty { throw Self.notFound }
        return try rows.map { row in
            let items = row["items"].array
            let cheese = SwiftServiceJSON.sum(items.filter { Self.cheese($0) },"quantity")
            // List compatibility: a product matching both patterns is counted as cheese only.
            let mango = SwiftServiceJSON.sum(items.filter { Self.mango($0) && (id != nil || !Self.cheese($0)) },"quantity")
            var object = row.object
            object["cheeseQty"] = .number(cheese); object["mangoQty"] = .number(mango)
            object["requestedAt"] = try id == nil ? SwiftServiceJSON.displayDate(row["requestedAt"],mode:"time") : SwiftServiceJSON.iso(row["requestedAt"])
            if id == nil { object.removeValue(forKey:"deliveredAt"); if object["note"] == .null { object.removeValue(forKey:"note") } }
            else { object["deliveredAt"] = try SwiftServiceJSON.iso(row["deliveredAt"]) }
            return .object(object)
        }
    }
    static let notFound = SwiftServiceFailure(status:404,message:"ບໍ່ພົບລາຍການນີ້")

    func storeDetail(id: String) async throws -> JSONValue {
        guard let row = try await connection.rows("""
        SELECT s.id,s.name,s.contact_name AS "contactName",s.phone,s.whatsapp,s.facebook,s.address,trim_scale(s.latitude)::text AS latitude,trim_scale(s.longitude)::text AS longitude,trim_scale(s.commission_rate)::text AS "commissionRate",trim_scale(s.monthly_electricity)::text AS "monthlyElectricity",s.fridge_start_date AS "fridgeStartDate",s.is_active AS "isActive",\(Self.fridge) AS fridge,
        COALESCE((SELECT json_agg(json_build_object('id',i.id,'productId',i.finished_product_id,'currentStock',i.current_stock,'lastAuditDate',to_char(i.last_audit_date,'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),'product',\(Self.product)) ORDER BY p.name) FROM fridge_inventory i JOIN finished_products p ON p.id=i.finished_product_id WHERE i.store_id=s.id AND i.fridge_id=f.id),'[]'::json) AS inventory,
        COALESCE((SELECT json_agg(x) FROM (SELECT v.id,v.visit_date AS "visitDate",v.status FROM restock_visits v WHERE v.store_id=s.id AND v.status='completed' ORDER BY v.visit_date DESC,v.id DESC LIMIT 6) x),'[]'::json) AS visits,
        COALESCE((SELECT json_agg(x) FROM (SELECT r.id,r.status,r.requested_at AS "requestedAt",r.delivered_at AS "deliveredAt",r.note,\(Self.items) AS items FROM refill_requests r WHERE r.store_id=s.id AND r.status IN('waiting','preparing','delivering') ORDER BY r.requested_at DESC,r.id DESC LIMIT 5) x),'[]'::json) AS refills,
        COALESCE((SELECT json_agg(x) FROM (SELECT \(Self.settlementFields) FROM settlements st WHERE st.store_id=s.id ORDER BY st.settlement_date DESC,st.id DESC LIMIT $2::integer) x),'[]'::json) AS settlements
        FROM stores s LEFT JOIN fridges f ON f.current_store_id=s.id WHERE s.id=$1
        """,[.string(id),.integer(role == "production" ? 1 : 8)]).first else { throw Self.notFound }
        let storeKeys = ["id","name","contactName","phone","whatsapp","facebook","address","latitude","longitude","commissionRate","monthlyElectricity","fridgeStartDate","isActive","fridge"]
        var store = Dictionary(uniqueKeysWithValues:storeKeys.map { ($0,row[$0]) })
        store["fridgeStartDate"] = row["fridgeStartDate"] == .null ? .null : .string(businessDateString(try SwiftServiceJSON.date(row["fridgeStartDate"])))
        let inventory = row["inventory"].array
        let visits = try row["visits"].array.map { SwiftServiceJSON.replacing($0,["visitDate":try SwiftServiceJSON.iso($0["visitDate"])]) }
        var view = store
        for key in ["contactName","phone","whatsapp","facebook","address"] { if view[key] == .null { view[key] = .string("—") } }
        for key in ["latitude","longitude","commissionRate","monthlyElectricity"] { view[key] = row[key] == .null ? .null : .number(row[key].decimal) }
        view["stock"] = .number(SwiftServiceJSON.sum(inventory,"currentStock"))
        view["due"] = .bool(try visits.first.map { try SwiftServiceJSON.date($0["visitDate"]) < now.addingTimeInterval(-7 * 86400) } ?? true)
        let settlements = try row["settlements"].array.map { SwiftServiceJSON.replacing($0,["settlementDate":try SwiftServiceJSON.iso($0["settlementDate"])]) }
        let latest = settlements.first
        let refills = try row["refills"].array.map { SwiftServiceJSON.replacing($0,["storeId":row["id"],"storeName":row["name"],"requestedAt":try SwiftServiceJSON.iso($0["requestedAt"]),"deliveredAt":try SwiftServiceJSON.iso($0["deliveredAt"])]) }
        return .object(["store":.object(store),"view":.object(view),"inventory":.array(inventory),"latestBalance":latest?["closingBalance"] ?? .string("0"),"latestSettlement":latest.map { .object(["paidAmount":$0["paidAmount"],"closingBalance":$0["closingBalance"],"settlementDate":$0["settlementDate"]]) } ?? .null,"refills":.array(refills),"settlements":.array(role == "production" ? [] : settlements),"visits":.array(visits)])
    }
    static let settlementFields = """
    st.id,st.receipt_number AS "receiptNumber",st.slip_image_url AS "receiptPath",st.slip_image_url AS "slipImageUrl",st.settlement_date AS "settlementDate",trim_scale(st.gross_amount)::text AS "grossAmount",trim_scale(st.store_commission_amount)::text AS "storeCommissionAmount",trim_scale(st.net_payable_amount)::text AS "netPayableAmount",trim_scale(st.previous_balance)::text AS "previousBalance",trim_scale(st.paid_amount)::text AS "paidAmount",trim_scale(st.closing_balance)::text AS "closingBalance",st.payment_status AS "paymentStatus",st.payment_method AS "paymentMethod"
    """
    func restock(id: String) async throws -> JSONValue {
        guard let row = try await connection.rows("""
        SELECT json_build_object('id',s.id,'name',s.name,'address',COALESCE(s.address,'—'),'phone',COALESCE(s.phone,''),'whatsapp',COALESCE(s.whatsapp,''),'latitude',s.latitude,'longitude',s.longitude,'commissionRate',trim_scale(s.commission_rate)::text) AS store,
        json_build_object('assetCode',f.asset_code) AS fridge,
        COALESCE((SELECT trim_scale(st.closing_balance)::text FROM settlements st WHERE st.store_id=s.id ORDER BY st.settlement_date DESC,st.id DESC LIMIT 1),'0') AS "previousBalance",
        COALESCE((SELECT json_agg(json_build_object('productId',p.id,'name',p.name,'code',p.code,'retailPrice',trim_scale(p.retail_price)::text,'previousStock',i.current_stock,'refilledSinceAudit',COALESCE((SELECT SUM(ri.quantity) FROM refill_requests r JOIN refill_request_items ri ON ri.refill_request_id=r.id AND ri.finished_product_id=i.finished_product_id WHERE r.store_id=s.id AND r.status='completed' AND r.delivered_at IS NOT NULL AND (i.last_audit_date IS NULL OR r.delivered_at > i.last_audit_date)),0))) FROM fridge_inventory i JOIN finished_products p ON p.id=i.finished_product_id WHERE i.fridge_id=f.id AND i.store_id=s.id),'[]'::json) AS lines
        FROM stores s JOIN fridges f ON f.current_store_id=s.id WHERE s.id=$1 AND s.is_active
        """,[.string(id)]).first else { throw Self.notFound }
        let lines = row["lines"].array.map { line -> JSONValue in
            var object = line.object; object.removeValue(forKey:"code")
            object["color"] = .string(Self.cheese(line) ? "#f2c94c" : Self.mango(line) ? "#f2994a" : "#8aa39a")
            return .object(object)
        }
        return .object(["source":.string("database"),"data":SwiftServiceJSON.replacing(row,["lines":.array(lines),"expectedFinancialSnapshot":.object(["previousBalance":row["previousBalance"],"commissionRate":row["store"]["commissionRate"],"retailPrices":.array(lines.map { .object(["productId":$0["productId"],"retailPrice":$0["retailPrice"]]) })])])])
    }
    func expenses(_ query: SwiftNativeQuery) async throws -> JSONValue {
        let month = try SwiftReadReports.range(period:"month",now:now)
        let rows = try await connection.rows("""
        WITH filtered AS (
          SELECT e.id,COALESCE(NULLIF(e.note,''),e.category) AS label,e.category,e.amount,e.incurred_at AS "incurredAt",e.store_id AS "storeId",s.name AS "storeName",e.note,e.receipt_url AS "receiptUrl"
          FROM expenses e LEFT JOIN stores s ON s.id=e.store_id
          WHERE e.voided_at IS NULL AND ($1::text IS NULL OR e.id=$1)
          AND ($2='' OR position(lower($2) in lower(e.category))>0 OR position(lower($2) in lower(e.note))>0 OR position(lower($2) in lower(s.name))>0)
          AND ($3<>'month' OR (e.incurred_at >= $4::timestamp AND e.incurred_at < $5::timestamp))
          AND ($3 NOT IN('electricity','transport','maintenance') OR ($3='electricity' AND lower(btrim(e.category)) IN('electricity','ຄ່າໄຟ','ຄ່າໄຟຟ້າ')) OR ($3='transport' AND lower(btrim(e.category)) IN('transport','fuel','ຄ່າຂົນສົ່ງ','ຄ່ານ້ຳມັນ')) OR ($3='maintenance' AND lower(btrim(e.category)) IN('maintenance','ຄ່າສ້ອມແປງ')))
        ), meta AS (SELECT count(*) AS total,COALESCE(sum(amount),0) AS "totalAmount",greatest(1,ceil(count(*)::numeric/50))::integer AS "pageCount" FROM filtered),
        page AS (SELECT least($6::integer,"pageCount") AS page FROM meta),
        selected AS (SELECT * FROM filtered ORDER BY "incurredAt" DESC,id DESC LIMIT 50 OFFSET (SELECT (page-1)*50 FROM page))
        SELECT (SELECT row_to_json(m) FROM meta m) AS meta,(SELECT page FROM page) AS page,COALESCE((SELECT json_agg(x) FROM selected x),'[]'::json) AS expenses
        """,[query["id"].map(JSONValue.string) ?? .null,.string(query["query"] ?? ""),.string(query["filter"] ?? "all"),.string(SwiftServiceJSON.iso(month.lowerBound)),.string(SwiftServiceJSON.iso(month.upperBound)),.integer(query.integer("page") ?? 1)])
        let row = rows[0]; let meta = row["meta"]
        let expenses = try row["expenses"].array.map { SwiftServiceJSON.replacing($0,["incurredAt":try SwiftServiceJSON.displayDate($0["incurredAt"]),"incurredAtIso":.string(businessDateString(try SwiftServiceJSON.date($0["incurredAt"])))]) }
        return .object(["source":.string("database"),"expenses":.array(expenses),"totalAmount":meta["totalAmount"],"total":meta["total"],"server":.object(["page":row["page"],"pageCount":meta["pageCount"],"total":meta["total"],"query":.string(query["query"] ?? ""),"filter":.string(query["filter"] ?? "all")])])
    }
    func expense(id: String) async throws -> JSONValue {
        guard let row = try await connection.rows("SELECT e.id,e.category,trim_scale(e.amount)::text AS amount,e.incurred_at AS \"incurredAt\",e.store_id AS \"storeId\",e.note,e.receipt_url AS \"receiptUrl\",s.name AS \"storeName\" FROM expenses e LEFT JOIN stores s ON s.id=e.store_id WHERE e.id=$1 AND e.voided_at IS NULL",[.string(id)]).first else { throw Self.notFound }
        let day: JSONValue = .string(businessDateString(try SwiftServiceJSON.date(row["incurredAt"])))
        let snapshot: JSONValue = .object(["category":row["category"],"amount":row["amount"],"incurredAt":day,"storeId":row["storeId"],"note":row["note"],"receiptUrl":row["receiptUrl"]])
        return .object(["expense":SwiftServiceJSON.replacing(row,["incurredAt":day,"expectedExpenseSnapshot":snapshot]),"stores":.array(try await storeOptions())])
    }
    func settlements(_ query: SwiftNativeQuery) async throws -> JSONValue {
        let q = query["query"] ?? ""
        let date = try? SwiftValue.laosDayRange(q)
        let row = try await connection.rows("""
        WITH latest AS (SELECT DISTINCT ON(store_id) id,store_id,closing_balance,payment_status FROM settlements ORDER BY store_id,settlement_date DESC,id DESC),
        filtered AS (
          SELECT st.id FROM settlements st JOIN stores s ON s.id=st.store_id
          WHERE ($1='all' OR st.id IN(SELECT id FROM latest))
          AND ($1<>'pending' OR st.closing_balance>0) AND ($1<>'partial' OR st.payment_status='partial') AND ($1<>'paid' OR st.closing_balance<=0)
          AND ($2='' OR position(lower($2) in lower(st.receipt_number))>0 OR position(lower($2) in lower(s.name))>0 OR ($3::timestamp IS NOT NULL AND st.settlement_date >= $3::timestamp AND st.settlement_date < $4::timestamp))
        ),meta AS (SELECT count(*) AS total,greatest(1,ceil(count(*)::numeric/50))::integer AS "pageCount" FROM filtered),
        page AS (SELECT least($5::integer,"pageCount") AS page FROM meta),
        selected AS (
          SELECT \(Self.settlementFields),st.store_id AS "storeId",s.name AS "storeName",st.gross_amount AS gross,st.store_commission_amount AS commission,st.net_payable_amount AS net,st.paid_amount AS paid,st.closing_balance AS "closingBalanceDisplay",
          COALESCE((SELECT sum(i.subtotal_cost) FROM restock_visit_items i WHERE i.restock_visit_id=st.restock_visit_id),0) AS cogs,
          COALESCE((SELECT json_agg(json_build_object('productId',p.id,'code',p.code,'name',p.name,'unitsSold',i.units_sold)) FROM restock_visit_items i JOIN finished_products p ON p.id=i.finished_product_id WHERE i.restock_visit_id=st.restock_visit_id AND i.units_sold>0),'[]'::json) AS "productSales",
          COALESCE((SELECT SUM(i.units_sold) FROM restock_visit_items i JOIN finished_products p ON p.id=i.finished_product_id WHERE i.restock_visit_id=st.restock_visit_id AND (p.code||' '||p.name) ~* 'CHS|cheese|ຊີສ'),0) AS "cheeseSold",
          COALESCE((SELECT SUM(i.units_sold) FROM restock_visit_items i JOIN finished_products p ON p.id=i.finished_product_id WHERE i.restock_visit_id=st.restock_visit_id AND (p.code||' '||p.name) ~* 'MNG|mango|ໝາກມ່ວງ' AND (p.code||' '||p.name) !~* 'CHS|cheese|ຊີສ'),0) AS "mangoSold"
          FROM settlements st JOIN stores s ON s.id=st.store_id WHERE st.id IN(SELECT id FROM filtered) ORDER BY st.settlement_date DESC,st.id DESC LIMIT 50 OFFSET (SELECT (page-1)*50 FROM page)
        )
        SELECT (SELECT row_to_json(m) FROM meta m) AS meta,(SELECT page FROM page) AS page,
        COALESCE((SELECT json_agg(x) FROM selected x),'[]'::json) AS settlements,
        (SELECT json_build_object('pending',count(*) FILTER(WHERE closing_balance>0),'partial',count(*) FILTER(WHERE payment_status='partial'),'paid',count(*) FILTER(WHERE closing_balance<=0),'all',(SELECT count(*) FROM settlements)) FROM latest) AS counts,
        (SELECT COALESCE(sum(closing_balance),0) FROM latest) AS "currentOutstanding",(SELECT COALESCE(sum(paid_amount),0) FROM settlements) AS collected
        """,[.string(query["filter"] ?? "pending"),.string(q),date.map { .string(SwiftServiceJSON.iso($0.lowerBound)) } ?? .null,date.map { .string(SwiftServiceJSON.iso($0.upperBound)) } ?? .null,.integer(query.integer("page") ?? 1)])[0]
        let items = try row["settlements"].array.map { item -> JSONValue in
            var object = item.object
            object["settlementId"] = item["id"]; object["id"] = item["receiptNumber"] == .null ? item["id"] : item["receiptNumber"]
            object["periodLabel"] = try SwiftServiceJSON.displayDate(item["settlementDate"],mode:"period")
            object["settlementDate"] = try SwiftServiceJSON.iso(item["settlementDate"])
            object["closingBalanceExact"] = item["closingBalance"]; object["closingBalance"] = item["closingBalanceDisplay"]; object.removeValue(forKey:"closingBalanceDisplay")
            object["status"] = item["paymentStatus"]; object.removeValue(forKey:"paymentStatus")
            return .object(object)
        }
        return .object(["source":.string("database"),"settlements":.array(items),"currentOutstanding":row["currentOutstanding"],"collected":row["collected"],"pendingStores":row["counts"]["pending"],"server":.object(["page":row["page"],"pageCount":row["meta"]["pageCount"],"total":row["meta"]["total"],"query":.string(q),"filter":.string(query["filter"] ?? "pending"),"counts":row["counts"]])])
    }
    func audit(_ query: SwiftNativeQuery) async throws -> JSONValue {
        let row = try await connection.rows("""
        WITH filtered AS (
          SELECT a.id,a.action,a.entity_type AS "entityType",a.entity_id AS "entityId",a.store_id AS "storeId",a.summary,a.metadata,a.created_at AS "createdAt",CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('fullName',u.full_name,'role',u.role) END AS "user",CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object('name',s.name) END AS store
          FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN stores s ON s.id=a.store_id
          WHERE ($1 NOT IN('update','adjust') OR a.action=$1) AND ($1 NOT IN('expense','user') OR position(lower($1) in lower(a.entity_type))>0)
          AND ($2='' OR position(lower($2) in lower(a.summary))>0 OR position(lower($2) in lower(a.entity_type))>0 OR position(lower($2) in lower(s.name))>0 OR position(lower($2) in lower(u.full_name))>0)
        ),meta AS (SELECT count(*) AS total,greatest(1,ceil(count(*)::numeric/50))::integer AS "totalPages" FROM filtered),
        page AS (SELECT least($3::integer,"totalPages") AS page FROM meta),
        selected AS (SELECT * FROM filtered ORDER BY "createdAt" DESC,id DESC LIMIT 50 OFFSET (SELECT (page-1)*50 FROM page))
        SELECT (SELECT row_to_json(m) FROM meta m) AS meta,(SELECT page FROM page) AS page,COALESCE((SELECT json_agg(x) FROM selected x),'[]'::json) AS logs
        """,[.string(query["filter"] ?? "all"),.string(query["query"] ?? ""),.integer(query.integer("page") ?? 1)])[0]
        return .object(["logs":.array(try row["logs"].array.map { SwiftServiceJSON.replacing($0,["metadata":SwiftServiceJSON.safeMetadata($0["metadata"]),"createdAt":try SwiftServiceJSON.iso($0["createdAt"])]) }),"total":row["meta"]["total"],"totalPages":row["meta"]["totalPages"],"page":row["page"],"pageSize":.integer(50),"query":.string(query["query"] ?? ""),"filter":.string(query["filter"] ?? "all")])
    }
    func production(_ query: SwiftNativeQuery) async throws -> JSONValue {
        let row = try await connection.rows("""
        WITH active AS (SELECT b.id FROM production_batches b WHERE b.status='completed' AND b.quantity_remaining>0),
        selected_ids AS (SELECT b.id FROM production_batches b WHERE b.status='completed' AND ($1::boolean OR b.id IN(SELECT id FROM active))),
        meta AS (SELECT count(*) AS total,greatest(1,ceil(count(*)::numeric/50))::integer AS pages FROM selected_ids),
        page AS (SELECT least($2::integer,pages) AS page FROM meta),
        batches AS (SELECT b.id,b.batch_number AS "batchNumber",b.finished_product_id AS "productId",p.name AS "productName",b.quantity_produced AS "quantityProduced",b.quantity_remaining AS "quantityRemaining",b.total_material_cost AS "totalMaterialCost",b.unit_cost AS "unitCost",b.cost_known AS "costKnown",b.mfg_date AS "mfgDate",b.exp_date AS "expDate" FROM production_batches b JOIN finished_products p ON p.id=b.finished_product_id WHERE b.id IN(SELECT id FROM selected_ids) OR b.id IN(SELECT id FROM active)),
        selected AS (SELECT * FROM batches WHERE id IN(SELECT id FROM selected_ids) ORDER BY CASE WHEN $1::boolean THEN "mfgDate" END DESC,CASE WHEN $1::boolean THEN id END DESC,CASE WHEN NOT $1::boolean THEN "expDate" END ASC,CASE WHEN NOT $1::boolean THEN "mfgDate" END ASC,id ASC LIMIT CASE WHEN $1::boolean THEN 50 ELSE NULL END OFFSET CASE WHEN $1::boolean THEN (SELECT (page-1)*50 FROM page) ELSE 0 END),
        adjustment AS (SELECT * FROM batches WHERE id IN(SELECT id FROM active) ORDER BY "expDate",id),
        products AS (SELECT p.id,p.code,p.name,p.shelf_life_days AS "shelfLifeDays",COALESCE((SELECT sum(b.quantity_remaining) FROM production_batches b WHERE b.finished_product_id=p.id AND b.status='completed' AND b.quantity_remaining>0 AND b.exp_date >= $3::timestamp),0) AS "centralStock" FROM finished_products p WHERE p.is_active ORDER BY p.code)
        SELECT (SELECT row_to_json(m) FROM meta m) AS meta,(SELECT page FROM page) AS page,COALESCE((SELECT json_agg(x) FROM selected x),'[]'::json) AS batches,COALESCE((SELECT json_agg(x) FROM adjustment x),'[]'::json) AS adjustment,COALESCE((SELECT json_agg(x) FROM products x),'[]'::json) AS products
        """,[.bool(query["historyPage"] != nil),.integer(query.integer("historyPage") ?? 1),.string(SwiftServiceJSON.iso(now))])[0]
        func batch(_ value: JSONValue) throws -> JSONValue {
            let diff = try SwiftServiceJSON.date(value["expDate"]).timeIntervalSince(now)/86400
            return SwiftServiceJSON.replacing(value,["mfgDate":try SwiftServiceJSON.displayDate(value["mfgDate"]),"expDate":try SwiftServiceJSON.displayDate(value["expDate"]),"daysToExpiry":.integer(Int(diff < 0 ? floor(diff) : ceil(diff)))])
        }
        let batches = try row["batches"].array.map(batch)
        return .object(["source":.string("database"),"products":row["products"],"batches":.array(batches),"adjustmentBatches":.array(try query["historyPage"] == nil ? batches : row["adjustment"].array.map(batch)),"totalBatches":row["meta"]["total"],"pageCount":row["meta"]["pages"],"historyPage":query["historyPage"] == nil ? .null : row["page"],"centralStockTotal":.number(SwiftServiceJSON.sum(row["products"].array,"centralStock")),"materials":.array(try await materials()),"recipes":.array(try await recipes())])
    }
    func fridges() async throws -> [JSONValue] {
        try await connection.rows("""
        SELECT f.id,f.asset_code AS "assetCode",COALESCE(f.model,'—') AS model,COALESCE(f.serial_no,'—') AS "serialNo",f.capacity_cups AS "capacityCups",f.status,f.current_store_id AS "storeId",COALESCE(s.name,'ຍັງບໍ່ຕິດຕັ້ງ') AS "storeName",COALESCE((SELECT sum(i.current_stock) FROM fridge_inventory i WHERE i.fridge_id=f.id),0) AS "stockTotal"
        FROM fridges f LEFT JOIN stores s ON s.id=f.current_store_id ORDER BY f.asset_code
        """)
    }
    func closing(_ day: String) async throws -> JSONValue {
        let row = try await connection.rows("SELECT id,cash_amount AS \"cashAmount\",bank_amount AS \"bankAmount\",expense_amount AS \"expenseAmount\",note FROM daily_closings WHERE closing_date=$1::timestamp",[.string(day + "T12:00:00.000Z")]).first
        var snapshot: JSONValue = .null
        if let row {
            var object = row.object
            for key in ["cashAmount","bankAmount","expenseAmount"] { object[key] = .string(try SwiftValue.decimalString(row[key].decimal,scale:2)) }
            snapshot = .object(object)
        }
        return .object(["closingDate":.string(day),"snapshot":snapshot])
    }
}
