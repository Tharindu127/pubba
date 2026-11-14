import Foundation
@testable import Pubba

/// The conformance harness for Swift: runs a case and returns its answer as JSON (see conformance/README.md).
enum Harness {
    static func s(_ x: String?) -> JSONValue { x.map { .string($0) } ?? .null }
    static func n(_ x: Double) -> JSONValue { .number(x) }
    static func obj(_ pairs: [(String, JSONValue)]) -> JSONValue { .object(JSONObject(pairs)) }

    static func chip(_ c: Chip) -> JSONValue {
        switch c {
        case let .question(q): return obj([("label", .string(q.label)), ("question", .string(q.question))])
        case let .entity(e):
            var o = JSONObject([("id", .string(e.id)), ("label", .string(e.label))])
            if let url = e.url { o["url"] = .string(url) }
            o["reason"] = .object(e.reason.json)
            o["text"] = .string(e.text)
            return .object(o)
        }
    }

    static func reply(_ r: Reply?) -> JSONValue {
        guard let r = r else { return .null }
        var o = JSONObject([("kind", .string(r.kind)), ("text", .string(r.text))])
        if let a = r.action {
            var ao = JSONObject([("type", .string(a.type)), ("id", .string(a.id))])
            if let url = a.url { ao["url"] = .string(url) }
            o["action"] = .object(ao)
        }
        o["chips"] = .array(r.chips.map(chip))
        if let m = r.match {
            o["match"] = obj([("id", .string(m.entity.id)), ("score", n(m.score)), ("tier", n(Double(m.tier))), ("by", s(m.reason.by)), ("name", s(m.reason.name))])
        }
        if let sim = r.similar { o["similar"] = .array(sim.map { chip(.entity($0)) }) }
        return .object(o)
    }

    static func weighted(_ x: Related) -> JSONValue { obj([("id", .string(x.entity.id)), ("weight", n(x.weight)), ("reason", .object(x.reason.json)), ("text", .string(x.text))]) }
    static func scored(_ x: Suggestion) -> JSONValue { obj([("id", .string(x.entity.id)), ("score", n(x.score)), ("reason", .object(x.reason.json)), ("text", .string(x.text))]) }

    static func runGuide(_ base: Pubba, _ steps: [JSONObject], _ o: JSONObject?) -> JSONValue {
        final class Clock { var ms = 0.0 }
        let clock = Clock()
        let events = Events(goals: ["contact"])
        var emitted: [JSONValue] = []
        events.on { emitted.append(.object($0)) }
        var accept: ((Entity) -> Bool)? = nil
        if let rules = o?["hide"]?.array {
            accept = { e in
                let label = e.label.lowercased()
                return !rules.contains { raw in
                    let r = raw.object ?? JSONObject()
                    let types = r["types"]?.strings ?? [], ids = r["ids"]?.strings ?? []
                    let inc = r["labelIncludes"]?.strings ?? [], ends = r["labelEndsWith"]?.strings ?? []
                    return (types.isEmpty || types.contains(e.type)) && (ids.isEmpty || ids.contains(e.id))
                        && (inc.isEmpty || inc.contains { label.contains($0) }) && (ends.isEmpty || ends.contains { label.hasSuffix($0) })
                }
            }
        }
        var fallback: ((FallbackContext) -> [Chip]?)? = nil
        if let fb = o?["fallback"]?.object {
            fallback = { ctx in
                let v = ctx.kind == "open" && ctx.entity != nil ? (fb["open." + ctx.entity!.type] ?? fb["open"]) : fb[ctx.kind]
                return v?.strings?.map { .question(QuestionChip($0)) }
            }
        }
        var line: ((Entity) -> String?)? = nil
        if let lines = o?["lines"]?.object { line = { lines[$0.id].str } }
        var templates: [String: String] = [:]
        for (k, v) in o?["templates"]?.object?.pairs ?? [] { templates[k] = v.string }
        var prefer: ((Entity) -> Bool)? = nil
        if let avoid = o?["nudgeAvoids"]?.strings { prefer = { !avoid.contains($0.type) } }
        let guide = Guide(
            base.with(events: events),
            chips: Int(o?["chips"]?.number ?? 3),
            prefer: prefer, accept: accept, fallback: fallback, line: line, templates: templates,
            now: { clock.ms }
        )
        var answers: [JSONValue] = []
        for st in steps {
            switch st["op"].str {
            case "visited": guide.visited(st["id"].str!); answers.append(.null)
            case "follow": guide.follow(st["id"].str!, via: st["via"].str!); answers.append(.null)
            case "ask": answers.append(reply(guide.ask(st["question"].str!)))
            case "nudge": answers.append(reply(guide.nudge()))
            case "chips": answers.append(.array(guide.chips(limit: st["limit"]?.number.map { Int($0) }).map(chip)))
            case "tick": clock.ms += st["ms"]!.number!; answers.append(.null)
            case "opened": guide.opened(); answers.append(.null)
            case "reached": guide.reached(st["goal"].str!); answers.append(.null)
            default: break
            }
        }
        return obj([("answers", .array(answers)), ("trail", .array(guide.trail.get().map { .string($0) })), ("events", .array(emitted))])
    }

    static func run(_ pubba: Pubba, _ c: JSONObject) throws -> JSONValue {
        switch c["op"].str {
        case "match":
            let m = pubba.match(c["query"].str!)
            var o = JSONObject([("intent", .string(m.intent)), ("entity", s(m.entity?.id))])
            if let x = m.match {
                o["score"] = n(x.score); o["tier"] = n(Double(x.tier)); o["by"] = s(x.reason.by); o["name"] = s(x.reason.name); o["text"] = .string(x.text)
            }
            o["similar"] = .array(m.similar.map(weighted))
            if let nh = m.notHere { o["notHere"] = .string(nh) }
            return .object(o)
        case "search":
            return .array(pubba.search(c["query"].str!, limit: Int(c["limit"]!.number!)).map { m in
                obj([("id", .string(m.entity.id)), ("score", n(m.score)), ("tier", n(Double(m.tier))), ("by", s(m.reason.by)), ("name", s(m.reason.name))])
            })
        case "next":
            return .array(pubba.next(c["trail"]!.strings!, limit: Int(c["limit"]!.number!), exclude: c["exclude"]?.strings ?? []).map(scored))
        case "related":
            return .array(pubba.related(c["id"].str!, kinds: c["kinds"]?.strings, limit: c["limit"]?.number.map { Int($0) }).map(weighted))
        case "autocomplete":
            return .array(pubba.autocomplete(c["typed"].str!, trail: c["trail"]!.strings!, limit: Int(c["limit"]!.number!)).map { x in
                obj([("id", .string(x.entity.id)), ("score", n(x.score)), ("by", s(x.reason.by))])
            })
        case "explain":
            return .string(try pubba.explain(Reason(json: c["reason"]!.object!)!, id: c["item"].str!))
        case "guide":
            return runGuide(pubba, c["steps"]!.array!.compactMap(\.object), c["options"]?.object)
        default:
            throw PubbaError.notABundle
        }
    }

    /// Equal as JSON, numbers to 1e-9. The path of the first difference, or nil.
    static func diff(_ a: JSONValue?, _ b: JSONValue?, _ path: String = "$") -> String? {
        let a = a ?? .null, b = b ?? .null
        switch (a, b) {
        case let (.number(x), .number(y)): return abs(x - y) <= 1e-9 ? nil : "\(path): \(x) != \(y)"
        case let (.array(x), .array(y)):
            if x.count != y.count { return "\(path): length \(x.count) != \(y.count)" }
            for i in x.indices { if let d = diff(x[i], y[i], "\(path)[\(i)]") { return d } }
            return nil
        case (.array, _), (_, .array): return "\(path): list vs not"
        case let (.object(x), .object(y)):
            let kx = x.keys.sorted(), ky = y.keys.sorted()
            if kx != ky { return "\(path): keys \(kx) != \(ky)" }
            for k in kx { if let d = diff(x[k], y[k], "\(path).\(k)") { return d } }
            return nil
        default: return a == b ? nil : "\(path): \(JSON.stringify(a)) != \(JSON.stringify(b))"
        }
    }
}
