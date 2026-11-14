import Foundation

/// The bundle format this runtime reads.
public let bundleFormat = 1

/// One thing on the site or in the app: a project, a skill, a product, a page.
public struct Entity: Sendable, Equatable, Identifiable {
    public let id: String
    public let type: String
    public let label: String
    public let short: String?
    public let aliases: [String]
    public let url: String?
    public let text: String?
    public let data: JSONObject?

    public init(id: String, type: String, label: String, short: String? = nil, aliases: [String] = [], url: String? = nil, text: String? = nil, data: JSONObject? = nil) {
        self.id = id; self.type = type; self.label = label; self.short = short
        self.aliases = aliases; self.url = url; self.text = text; self.data = data
    }

    /// How it reads inside a sentence.
    public var shortLabel: String { short ?? label }
}

/// A typed, weighted link between two entities.
public struct Link: Sendable, Equatable {
    public let from: String
    public let kind: String
    public let to: String
    public let weight: Double
    public let via: [String]?
    public let rule: String?

    public func otherEnd(_ id: String) -> String { from == id ? to : from }
}

/// Why something was suggested or matched, as data. `Pubba.explain` turns it into a sentence.
public struct Reason: Sendable, Equatable {
    public var kind: String
    public var to: String?
    public var direction: String?
    public var via: [String]?
    public var seed: String?
    public var by: String?
    public var name: String?

    public init(kind: String, to: String? = nil, direction: String? = nil, via: [String]? = nil, seed: String? = nil, by: String? = nil, name: String? = nil) {
        self.kind = kind; self.to = to; self.direction = direction; self.via = via
        self.seed = seed; self.by = by; self.name = name
    }

    /// The reason as JSON, absent fields left out.
    public var json: JSONObject {
        var o = JSONObject()
        o["kind"] = .string(kind)
        if let to = to { o["to"] = .string(to) }
        if let direction = direction { o["direction"] = .string(direction) }
        if let via = via { o["via"] = .array(via.map { .string($0) }) }
        if let seed = seed { o["seed"] = .string(seed) }
        if let by = by { o["by"] = .string(by) }
        if let name = name { o["name"] = .string(name) }
        return o
    }

    public init?(json o: JSONObject) {
        guard let kind = o["kind"].str else { return nil }
        self.init(kind: kind, to: o["to"].str, direction: o["direction"].str, via: o["via"]?.strings, seed: o["seed"].str, by: o["by"].str, name: o["name"].str)
    }
}

public struct Suggestion: Sendable {
    public let entity: Entity
    public let score: Double
    public let reason: Reason
    public let text: String
}

public struct Related: Sendable {
    public let entity: Entity
    public let weight: Double
    public let link: Link
    public let reason: Reason
    public let text: String
}

public struct Match: Sendable {
    public let entity: Entity
    public let score: Double
    public let tier: Int
    public let reason: Reason
    public let text: String
}

/// What a query means: `intent` is "entity", "similar" or "none".
public struct MatchResult: Sendable {
    public let query: String
    public let intent: String
    public var entity: Entity? = nil
    public var match: Match? = nil
    public var similar: [Related] = []
    public var notHere: String? = nil
}

/// A sentence template: text with tokens, JSON-shaped cases (as in a bundle), or code.
public enum Template: Sendable, ExpressibleByStringLiteral {
    case text(String)
    case json(JSONValue)
    case function(@Sendable (Reason, Entity, Entity?) -> String)

    public init(stringLiteral value: String) { self = .text(value) }

    init(_ v: JSONValue) {
        if let s = v.string { self = .text(s) } else { self = .json(v) }
    }

    var truthy: Bool {
        switch self {
        case let .text(s): return !s.isEmpty
        case let .json(v): return v.truthy
        case .function: return true
        }
    }
}

public enum PubbaError: Error, CustomStringConvertible {
    case notABundle
    case newerFormat(Double)
    case noEntity(String)

    public var description: String {
        switch self {
        case .notABundle: return "pubba: not a pubba bundle"
        case let .newerFormat(f): return "pubba: bundle format \(JSON.stringify(.number(f))) is newer than this runtime reads (\(bundleFormat)); upgrade pubba"
        case let .noEntity(id): return "pubba: no entity \(id)"
        }
    }
}

/// The graph inside a bundle: linked entities (in order), unlinked ones (matchable, never suggested), links and config.
public final class Graph: Sendable {
    public let entities: [String: Entity]
    public let entityOrder: [Entity]
    public let unlinked: [String: Entity]
    public let unlinkedOrder: [Entity]
    public let links: [Link]
    public let adjacent: [String: [Link]]
    public let config: JSONObject
    public let distinctWords: Set<String>

    init(entityOrder: [Entity], unlinkedOrder: [Entity], links: [Link], adjacent: [String: [Link]], config: JSONObject, distinctWords: Set<String>) {
        self.entityOrder = entityOrder
        self.unlinkedOrder = unlinkedOrder
        self.entities = Dictionary(entityOrder.map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })
        self.unlinked = Dictionary(unlinkedOrder.map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })
        self.links = links
        self.adjacent = adjacent
        self.config = config
        self.distinctWords = distinctWords
    }

    public var allEntities: [Entity] { entityOrder + unlinkedOrder }

    public func find(_ id: String) -> Entity? { entities[id] ?? unlinked[id] }

    public func degree(_ id: String) -> Int { adjacent[id]?.count ?? 0 }

    public func typeConfig(_ type: String) -> JSONObject { config["types"].obj[type].obj }

    public func isDestination(_ e: Entity) -> Bool { typeConfig(e.type)["destination"] != .bool(false) }

    public func pull(_ kind: String) -> Double { config["kinds"].obj[kind].obj["pull"].num(0.5) }

    public func kindLabel(_ kind: String) -> String { config["kinds"].obj[kind].obj["label"].str ?? kind.replacingOccurrences(of: "-", with: " ") }

    /// The graph inside a bundle's JSON text, after checking it is one this runtime can read.
    public convenience init(bundle json: String) throws {
        guard let b = try JSON.parse(json).object else { throw PubbaError.notABundle }
        try self.init(bundle: b)
    }

    /// The graph inside an already parsed bundle.
    public convenience init(bundle b: JSONObject) throws {
        guard let format = b["format"]?.number, let rawEntities = b["entities"]?.array, let rawLinks = b["links"]?.array else { throw PubbaError.notABundle }
        if Int(format.rounded(.down)) > bundleFormat { throw PubbaError.newerFormat(format) }
        var links: [Link] = []
        for raw in rawLinks {
            guard let l = raw.object, let from = l["from"].str, let kind = l["kind"].str, let to = l["to"].str, let weight = l["weight"]?.number else { throw PubbaError.notABundle }
            links.append(Link(from: from, kind: kind, to: to, weight: weight, via: l["via"]?.strings, rule: l["rule"].str))
        }
        var adjacent: [String: [Link]] = [:]
        for l in links {
            adjacent[l.from, default: []].append(l)
            adjacent[l.to, default: []].append(l)
        }
        var linked: [Entity] = [], unlinked: [Entity] = []
        var seen: [String: Int] = [:], seenUnlinked: [String: Int] = [:]
        for raw in rawEntities + (b["unlinked"]?.array ?? []) {
            guard let o = raw.object, let id = o["id"].str, let type = o["type"].str, let label = o["label"].str else { continue }
            let e = Entity(id: id, type: type, label: label, short: o["short"].str, aliases: o["aliases"]?.strings ?? [], url: o["url"].str, text: o["text"].str, data: o["data"]?.object)
            // A later entity with the same id replaces the earlier one in place, as a map would.
            if adjacent[id] != nil {
                if let i = seen[id] { linked[i] = e } else { seen[id] = linked.count; linked.append(e) }
            } else {
                if let i = seenUnlinked[id] { unlinked[i] = e } else { seenUnlinked[id] = unlinked.count; unlinked.append(e) }
            }
        }
        self.init(entityOrder: linked, unlinkedOrder: unlinked, links: links, adjacent: adjacent, config: b["config"]?.object ?? JSONObject(), distinctWords: Set(b["index"].obj["distinctWords"]?.strings ?? []))
    }
}
