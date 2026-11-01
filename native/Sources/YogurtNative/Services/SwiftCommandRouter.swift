import Foundation

/// Write routes (and the private receipt reads) by method and path, mirroring src/app/api.
struct SwiftCommandRouter: Sendable {
    let context: SwiftCommandContext
    init(database: SwiftDatabase, authentication: SwiftAuthentication, dataRoot: URL) {
        context = SwiftCommandContext(database: database, authentication: authentication, dataRoot: dataRoot)
    }

    /// nil when no route matches, so the engine answers 404.
    func handle(_ request: SwiftCommandRequest) async throws -> EngineResponse? {
        let parts = request.path.split(separator: "/", omittingEmptySubsequences: false).dropFirst().map(String.init)
        guard parts.count >= 2, parts[0] == "api" else { return nil }
        let route = Array(parts.dropFirst())
        let inventory = SwiftInventoryCommands(context: context), refills = SwiftRefillCommands(context: context)
        switch (request.method, route) {
        case ("POST", ["inventory", "receive"]): return try await inventory.receive(request)
        case ("POST", ["inventory", "adjust"]): return try await inventory.adjust(request)
        case ("POST", ["production-batches"]): return try await SwiftProductionCommands(context: context).create(request)
        case ("POST", ["restock-visits"]): return try await SwiftFinanceCommands(context: context).restock(request)
        case ("POST", ["settlements", "pay"]): return try await SwiftFinanceCommands(context: context).pay(request)
        case ("POST", ["refills"]): return try await refills.create(request)
        case ("PATCH", let path) where path.count == 2 && path[0] == "refills": return try await refills.update(request, id: path[1])
        case ("POST", ["uploads", "receipts"]): return try await SwiftReceiptStorage(context: context).upload(request)
        case ("GET", let path) where path.count == 2 && path[0] == "receipts": return try await SwiftReceiptStorage(context: context).download(request, name: path[1], head: false)
        case ("HEAD", let path) where path.count == 2 && path[0] == "receipts": return try await SwiftReceiptStorage(context: context).download(request, name: path[1], head: true)
        case ("POST", ["expenses"]): return try await SwiftExpenseCommands(context: context).create(request)
        case ("PATCH", let path) where path.count == 2 && path[0] == "expenses": return try await SwiftExpenseCommands(context: context).update(request, id: path[1])
        case ("DELETE", let path) where path.count == 2 && path[0] == "expenses": return try await SwiftExpenseCommands(context: context).void(request, id: path[1])
        case ("POST", ["expense-categories"]): return try await SwiftExpenseCommands(context: context).category(request)
        case ("POST", ["daily-closing"]): return try await SwiftExpenseCommands(context: context).closeDay(request)
        case ("POST", ["products"]): return try await SwiftCatalogCommands(context: context).createProduct(request)
        case ("PATCH", let path) where path.count == 2 && path[0] == "products": return try await SwiftCatalogCommands(context: context).updateProduct(request, id: path[1])
        case ("POST", ["materials"]): return try await SwiftCatalogCommands(context: context).createMaterial(request)
        case ("PATCH", let path) where path.count == 2 && path[0] == "materials": return try await SwiftCatalogCommands(context: context).updateMaterial(request, id: path[1])
        case ("POST", ["recipes"]): return try await SwiftCatalogCommands(context: context).createRecipe(request)
        case ("POST", ["finished-goods", "adjust"]): return try await SwiftCatalogCommands(context: context).adjustFinishedGoods(request)
        case ("POST", ["stores"]): return try await SwiftStoreCommands(context: context).create(request)
        case ("PATCH", let path) where path.count == 2 && path[0] == "stores": return try await SwiftStoreCommands(context: context).update(request, id: path[1])
        case ("DELETE", let path) where path.count == 2 && path[0] == "stores": return try await SwiftStoreCommands(context: context).deactivate(request, id: path[1])
        case ("PATCH", let path) where path.count == 2 && path[0] == "fridges": return try await SwiftStoreCommands(context: context).updateFridge(request, id: path[1])
        default: return nil
        }
    }
}
