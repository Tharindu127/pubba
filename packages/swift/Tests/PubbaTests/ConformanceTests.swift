import Foundation
import XCTest
@testable import Pubba

/// The Swift runtime against the shared conformance suite (../../../../conformance).
final class ConformanceTests: XCTestCase {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../conformance").standardized

    func lines(_ name: String) throws -> [JSONObject] {
        try String(contentsOf: root.appendingPathComponent("cases/\(name)"), encoding: .utf8)
            .split(separator: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            .map { try JSON.parse(String($0)).object! }
    }

    func testTextHelpers() throws {
        for c in try lines("text.jsonl") {
            let got: JSONValue
            switch c["op"].str {
            case "normalize": got = .string(normalize(c["input"].str!))
            case "distance": got = .number(Double(editDistance(c["a"].str!, c["b"].str!)))
            default: got = .bool(closeTo(c["token"].str, c["word"].str!, typoMinLength: c["typoMinLength"]?.number ?? .infinity))
            }
            XCTAssertNil(Harness.diff(got, c["expect"]), JSON.stringify(.object(c)))
        }
    }

    func testBundles() throws {
        let names = try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("bundles").path)
            .filter { $0.hasSuffix(".json") }.map { String($0.dropLast(5)) }.sorted()
        XCTAssertFalse(names.isEmpty)
        var total = 0
        for name in names {
            let pubba = try Pubba.load(try Data(contentsOf: root.appendingPathComponent("bundles/\(name).json")))
            var failures: [String] = []
            let cases = try lines("\(name).jsonl")
            for var c in cases {
                let expect = c["expect"]
                c["expect"] = nil
                let d: String?
                do { d = Harness.diff(try Harness.run(pubba, c), expect) } catch { d = "threw \(error)" }
                if let d = d { failures.append(String(JSON.stringify(.object(c)).prefix(140)) + "\n    " + d) }
            }
            total += cases.count
            XCTAssert(failures.isEmpty, "\(name): \(failures.count) of \(cases.count) cases differ:\n  " + failures.prefix(5).joined(separator: "\n  "))
        }
        print("conformance: \(total) cases over \(names.count) bundles")
    }

    func testSwiftAPI() throws {
        let pubba = try Pubba.load(try Data(contentsOf: root.appendingPathComponent("bundles/portfolio-fiction.json")))
        XCTAssertEqual(pubba.match("synthpd").entity?.id, "project:synthpad")
        let guide = Guide(pubba, route: { "app://items/\($0.id)" })
        let reply = guide.ask("anything like kiri wallet")
        XCTAssertEqual(reply.kind, "similar")
        XCTAssertEqual(reply.action?.url, "app://items/project:kiri-merchant")
        var events: [PubbaEvent] = []
        let tracked = Guide(pubba.with(events: { let e = Events(); e.on { events.append($0) }; return e }()))
        tracked.follow("project:kiri-merchant", via: "typed")
        XCTAssertEqual(tracked.trail.get(), ["project:kiri-merchant"])
        XCTAssertTrue(summarise(events).usedGuide)
    }
}
