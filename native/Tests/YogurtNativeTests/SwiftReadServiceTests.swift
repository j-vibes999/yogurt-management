import XCTest
@testable import YogurtNative

final class SwiftReadServiceTests: XCTestCase {
    func testRealSchemaLoginFreshRolesExactInventoryAndCatalog() async throws {
        let fixture = try LocalPostgresFixture(); defer { fixture.stop() }
        try fixture.applyRepositoryMigrations()
        let configuration = BackendConfiguration(databaseURL: fixture.url, sessionSecret: String(repeating: "fixture-only-secret-", count: 3), legacyReviewed: false)
        let database = try SwiftDatabase(configuration: configuration, verification: true); try await database.start()
        do {
            let hash = try SwiftCredentials.hashPassword("fixture password 123")
            try await database.execute("INSERT INTO users(id,email,password_hash,role,full_name) VALUES('admin','owner@example.test',$1,'admin','Owner')", [.string(hash)])
            try await database.execute("INSERT INTO raw_materials(id,code,name,category,unit,current_stock,min_stock_alert,avg_cost_per_unit) VALUES('milk','MILK','Milk','ingredient','kg',1.234567,2.000,9.8765)")
            try await database.execute("INSERT INTO finished_products(id,code,name,retail_price,shelf_life_days,is_active) VALUES('cheese','CHS','Cheese',12345.60,21,true),('inactive','OLD','Old',1,21,false)")
            let auth = SwiftAuthentication(database: database, configuration: configuration)
            let login = try await auth.login(body: .object(["email":.string(" OWNER@example.test "),"password":.string("fixture password 123")]))
            XCTAssertEqual(login.status, 200)
            let cookie = try XCTUnwrap(login.headers["Set-Cookie"])
            XCTAssertTrue(cookie.contains("Secure")); XCTAssertTrue(cookie.contains("Max-Age=43200"))
            let token = String(cookie.split(separator: ";")[0].dropFirst("yogurt_session=".count))
            let reads = SwiftReadService(database: database, authentication: auth, configuration: configuration, dataRoot: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
            let inventory = try await reads.load(resource: "inventory", queryItems: [], token: token)
            XCTAssertEqual(inventory.data["data"]["rawMaterials"].array.first?["currentStock"], .string("1.234567"))
            XCTAssertEqual(inventory.data["data"]["rawMaterials"].array.first?["avgCostPerUnit"], .string("9.8765"))
            let catalog = try await reads.load(resource: "catalog", queryItems: [], token: token)
            XCTAssertEqual(catalog.data["data"]["products"].array.count, 1)
            XCTAssertEqual(catalog.data["data"]["products"].array.first?["retailPrice"], .string("12345.6"))
            try await database.execute("UPDATE users SET role='driver',full_name='Current Driver' WHERE id='admin'")
            let identity = try await auth.authorize(token: token)
            XCTAssertEqual(identity.role,"driver"); XCTAssertEqual(identity.fullName,"Current Driver")
            do { _ = try await reads.load(resource:"inventory",queryItems:[],token:token); XCTFail("Driver read should fail") } catch let failure as SwiftServiceFailure { XCTAssertEqual(failure.status,403) }
            let driverCatalog = try await reads.load(resource:"catalog",queryItems:[],token:token)
            XCTAssertEqual(driverCatalog.data["data"]["materials"], .array([]))
            let logout = try await auth.logout(token:token); XCTAssertEqual(logout.status,303)
            do { _ = try await auth.authorize(token:token); XCTFail("Revoked session authorized") } catch let failure as SwiftServiceFailure { XCTAssertEqual(failure.status,401) }
            await database.stop()
        } catch { await database.stop(); throw error }
    }

    func testAllResourcesUseRealMigratedSchemaAndExactSnapshots() async throws {
        let fixture = try LocalPostgresFixture(); defer { fixture.stop() }; try fixture.applyRepositoryMigrations()
        let configuration = BackendConfiguration(databaseURL:fixture.url,sessionSecret:String(repeating:"fixture-only",count:4),legacyReviewed:false)
        let db = try SwiftDatabase(configuration:configuration,verification:true); try await db.start()
        do {
            let hash = try SwiftCredentials.hashPassword("fixture password 123")
            try await db.execute("INSERT INTO users(id,email,password_hash,role,full_name) VALUES('admin','owner@example.test',$1,'admin','Owner')",[.string(hash)])
            try await db.execute("INSERT INTO stores(id,name,commission_rate,monthly_electricity) VALUES('store','Shop',0.3,200000)")
            try await db.execute("INSERT INTO fridges(id,asset_code,current_store_id) VALUES('fridge','F1','store')")
            try await db.execute("INSERT INTO finished_products(id,code,name,retail_price,shelf_life_days) VALUES('product','CHS','Cheese',12345.60,21)")
            try await db.execute("INSERT INTO raw_materials(id,code,name,category,unit,current_stock,min_stock_alert,avg_cost_per_unit) VALUES('material','MILK','Milk','ingredient','kg',1.234567,2,9.8765)")
            try await db.execute("INSERT INTO recipes(id,finished_product_id,name,version,base_cups,is_default) VALUES('recipe','product','Recipe',1,100,true)")
            try await db.execute("INSERT INTO recipe_items(id,recipe_id,raw_material_id,quantity_required) VALUES('ri','recipe','material',1.2345)")
            try await db.execute("INSERT INTO fridge_inventory(id,store_id,fridge_id,finished_product_id,current_stock) VALUES('inv','store','fridge','product',12)")
            try await db.execute("INSERT INTO refill_requests(id,store_id,status,note) VALUES('refill','store','waiting','Refill')")
            try await db.execute("INSERT INTO refill_request_items(id,refill_request_id,finished_product_id,quantity) VALUES('rfi','refill','product',5)")
            try await db.execute("INSERT INTO expenses(id,category,amount,incurred_at,store_id,note) VALUES('expense','fuel',123.45,'2026-11-01 12:00','store','Fuel')")
            try await db.execute("INSERT INTO daily_closings(id,closing_date,cash_amount,bank_amount,expense_amount,created_by) VALUES('closing','2026-11-01 12:00',1,2.3,4.56,'admin')")
            try await db.execute("INSERT INTO audit_logs(id,action,entity_type,summary,metadata) VALUES('audit','update','expense','Updated','{\"nested\":{\"passwordHash\":\"hidden\",\"ok\":1},\"database_url\":\"hidden\"}'::jsonb)")
            let auth = SwiftAuthentication(database:db,configuration:configuration)
            let login = try await auth.login(body:.object(["email":.string("owner@example.test"),"password":.string("fixture password 123")]))
            let token = String(try XCTUnwrap(login.headers["Set-Cookie"]).split(separator:";")[0].dropFirst("yogurt_session=".count))
            let service = SwiftReadService(database:db,authentication:auth,configuration:configuration,dataRoot:FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
            for resource in ["overview","stores","store","map","refills","restock","inventory","production","settlements","expenses","expense","reports","notifications","operations","fridges","audit","catalog","closing"] {
                let items = ["store","restock"].contains(resource) ? [URLQueryItem(name:"id",value:"store")] : resource == "expense" ? [URLQueryItem(name:"id",value:"expense")] : resource == "closing" ? [URLQueryItem(name:"date",value:"2026-11-01")] : []
                let reply = try await service.load(resource:resource,queryItems:items,token:token)
                XCTAssertEqual(reply.status,200,resource); XCTAssertEqual(reply.data["source"],.string("database"),resource)
                XCTAssertEqual(reply.data["resource"],.string(resource)); XCTAssertFalse(reply.data["data"].object.isEmpty,resource)
                XCTAssertFalse(String(decoding:try reply.data.encoded(),as:UTF8.self).contains("hidden"),resource)
                if resource == "closing" { XCTAssertEqual(reply.data["data"]["snapshot"]["cashAmount"],.string("1.00")); XCTAssertEqual(reply.data["data"]["snapshot"]["bankAmount"],.string("2.30")) }
                if resource == "expense" { XCTAssertEqual(reply.data["data"]["expense"]["expectedExpenseSnapshot"]["amount"],.string("123.45")); XCTAssertEqual(reply.data["data"]["expense"]["incurredAt"],.string("2026-11-01")) }
                if resource == "restock" { XCTAssertEqual(reply.data["data"]["data"]["expectedFinancialSnapshot"]["commissionRate"],.string("0.3")); XCTAssertEqual(reply.data["data"]["data"]["lines"].array.first?["retailPrice"],.string("12345.6")) }
            }
            let counts = try await service.navigationCounts(token:token)
            XCTAssertEqual(counts.data["refill"],.integer(1)); XCTAssertEqual(counts.data["inventory"],.integer(1)); XCTAssertEqual(counts.data["driver"],.integer(1))
            await db.stop()
        } catch { await db.stop(); throw error }
    }

    func testStrictQueryGrammarAndLaosRanges() throws {
        XCTAssertThrowsError(try SwiftNativeQuery(resource:"store",items:[]))
        XCTAssertThrowsError(try SwiftNativeQuery(resource:"refills",items:[URLQueryItem(name:"id",value:"_bad")]))
        XCTAssertThrowsError(try SwiftNativeQuery(resource:"audit",items:[URLQueryItem(name:"page",value:"1"),URLQueryItem(name:"page",value:"2")]))
        XCTAssertThrowsError(try SwiftNativeQuery(resource:"closing",items:[URLQueryItem(name:"date",value:"2026-02-30")]))
        let range = try SwiftReadReports.range(period:"week",now: SwiftValue.utcDate("2026-10-31T18:00:00.000Z"))
        XCTAssertEqual(SwiftServiceJSON.iso(range.lowerBound),"2026-10-25T17:00:00.000Z")
        XCTAssertEqual(SwiftServiceJSON.iso(range.upperBound),"2026-11-01T17:00:00.000Z")
    }
}
