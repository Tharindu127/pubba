import Foundation

private let defaultStopWords = ["the", "app", "and", "for", "web", "application", "mobile", "portal", "site", "website"]
private let defaultSimilar = #"\b(like|similar|alike|same stack|related to|anything else)\b"#
private let strong = 50.0

private struct Settings {
    let stop: Set<String>
    let typo: Double
    let partial: Bool
    let precise: Bool
    let distinct: Set<String>?
}

private struct Scored {
    let score: Double
    let by: String
    let name: String
}

private func significant(_ name: String, _ stop: Set<String>) -> [String] { words(name).filter { $0.jsLength > 2 && !stop.contains($0) } }

private func coverage(_ q: String, _ name: String, _ typo: Double) -> Double {
    let nameTokens = words(name), queryTokens = words(q)
    let inQuery = Double(nameTokens.filter { hasPhrase(q, $0, typoMinLength: typo) }.count) / Double(nameTokens.count)
    let explained = Double(queryTokens.filter { t in nameTokens.contains { w in t == w || hasPhrase(t, w, typoMinLength: typo) } }.count) / Double(queryTokens.count)
    return 0.5 * inQuery + 0.4 * explained
}

private func scoreName(_ q: String, _ name: String, _ isAlias: Bool, _ m: JSONObject, _ s: Settings) -> Scored? {
    let len = Double(name.jsLength)
    if name.isEmpty || len < m["minLength"].num(0) { return nil }
    let has = { (w: String) in hasPhrase(q, w, typoMinLength: s.typo) }
    if (m["mode"].str ?? "title") == "phrase" {
        if name.jsLength < 2 || !has(name) { return nil }
        let exact = !s.precise || containsName(q, name)
        return Scored(score: (exact ? 100 : 95) + len, by: isAlias ? "alias" : "phrase", name: name)
    }
    if containsName(q, name) { return Scored(score: 100 + len, by: isAlias ? "alias" : "name", name: name) }
    if s.precise && name.contains(" ") && has(name) { return Scored(score: 95 + len, by: isAlias ? "alias" : "name", name: name) }
    let ws = significant(name, s.stop)
    let hits = ws.filter(has).count
    if hits > 0 && hits == ws.count && Double(ws.joined().jsLength) > m["minWordsLength"].num(0) {
        return Scored(score: 50 + Double(hits) + (s.precise ? coverage(q, name, s.typo) : 0), by: "words", name: name)
    }
    if s.partial && ws.count >= 3 && hits >= 2 && hits == ws.count - 1 { return Scored(score: 40 + Double(hits), by: "words", name: name) }
    if let distinct = s.distinct {
        for w in ws where w.jsLength >= 5 && distinct.contains(w) && hasPhrase(q, w, typoMinLength: .infinity) {
            return Scored(score: 25, by: "distinct-word", name: w)
        }
    }
    if m["firstWord"].truthy, let first = ws.first, first.jsLength > 3, has(first) { return Scored(score: 20, by: "first-word", name: first) }
    return nil
}

/// Why an entity lights up for a trail: the strongest single contribution.
public struct Why: Sendable {
    public let link: Link
    public let from: String
    public let seed: String
    public let part: Double
}

/// How brightly each entity lights up for a trail. `order` is the order entities first lit up.
public struct Spread: Sendable {
    public let score: [String: Double]
    public let order: [String]
    public let why: [String: Why]
    public let seeds: [String: Double]
    public let sectionOnly: Set<String>
}

/// Answers from one graph: related items, what next, matching, sentences, measurement.
public final class Pubba: Sendable {
    public let graph: Graph
    let events: Events?
    public let track: Track
    private let similarRe: NSRegularExpression?

    public init(graph: Graph, events: Events? = nil) {
        self.graph = graph
        self.events = events
        self.track = Track(graph: graph, events: events)
        self.similarRe = try? NSRegularExpression(pattern: graph.config["match"].obj["similarPattern"].str ?? defaultSimilar)
    }

    /// Answers from a compiled bundle (`pubba compile`), exactly as the content it was compiled from.
    public static func load(_ json: String, events: Events? = nil) throws -> Pubba {
        Pubba(graph: try Graph(bundle: json), events: events)
    }

    /// Answers from a compiled bundle's bytes (a file or an asset).
    public static func load(_ data: Data, events: Events? = nil) throws -> Pubba {
        try load(String(decoding: data, as: UTF8.self), events: events)
    }

    public func get(_ id: String) -> Entity? { graph.entities[id] }

    /// The same graph, reporting to these events.
    public func with(events: Events?) -> Pubba { Pubba(graph: graph, events: events) }

    private func suggested(_ source: String, _ ids: [String], _ kinds: [String]) {
        guard let events = events, !ids.isEmpty else { return }
        var distinct: [String] = []
        for k in kinds where !distinct.contains(k) { distinct.append(k) }
        events.emit(JSONObject([("type", .string("suggested")), ("source", .string(source)), ("ids", .array(ids.map { .string($0) })), ("reasonKinds", .array(distinct.map { .string($0) }))]))
    }

    // MARK: - Matching

    /// Every entity a query could mean, best first.
    public func search(_ query: String, limit: Int = 10, types: [String]? = nil, templates: [String: Template]? = nil) -> [Match] {
        let q = normalize(query)
        if q.isEmpty { return [] }
        let mc = graph.config["match"].obj
        let s = Settings(
            stop: Set(mc["stopWords"]?.strings ?? defaultStopWords),
            typo: mc["typoMinLength"].num(4),
            partial: mc["partialWords"].truthy,
            precise: mc["precise"].truthy,
            distinct: mc["distinctWords"].truthy ? graph.distinctWords : nil
        )
        let ignore = (mc["ignore"]?.strings ?? []).map(normalize).filter { !$0.isEmpty }
        var out: [Match] = []
        for entity in graph.allEntities {
            if let types = types, !types.contains(entity.type) { continue }
            let m = graph.typeConfig(entity.type)["match"].obj
            if m["skip"].truthy { continue }
            var best: Scored? = nil
            for (raw, isAlias) in [(entity.label, false)] + entity.aliases.map({ ($0, true) }) {
                let name = normalize(raw)
                if ignore.contains(where: { name.jsContains($0) }) { continue }
                if let sc = scoreName(q, name, isAlias, m, s), best == nil || sc.score > best!.score { best = sc }
            }
            guard let b = best else { continue }
            let reason = Reason(kind: "match", by: b.by, name: b.name)
            out.append(Match(entity: entity, score: b.score, tier: Int(m["tier"].num(1)), reason: reason, text: renderReason(graph, reason, entity, templates: templates)))
        }
        let weak = { (x: Match) in s.precise && x.score < strong ? 1 : 0 }
        return Array(out.stableSorted { a, b in
            if weak(a) != weak(b) { return weak(a) < weak(b) }
            if a.tier != b.tier { return a.tier < b.tier }
            return a.score > b.score
        }.prefix(limit))
    }

    /// What a query means: one entity, things like one, or nothing here.
    public func match(_ query: String, similarLimit: Int = 3, templates: [String: Template]? = nil) -> MatchResult {
        let result = matchQuietly(query, similarLimit, templates)
        if let events = events {
            var e = JSONObject([("type", .string("matched")), ("intent", .string(result.intent))])
            if let entity = result.entity { e["entityType"] = .string(entity.type) }
            if let by = result.match?.reason.by, !by.isEmpty { e["by"] = .string(by) }
            events.emit(e)
        }
        return result
    }

    private func matchQuietly(_ query: String, _ similarLimit: Int, _ templates: [String: Template]?) -> MatchResult {
        let best = search(query, limit: 1, templates: templates).first
        let q = normalize(query)
        let mc = graph.config["match"].obj
        let typo = mc["typoMinLength"].num(4)
        var missing: (raw: String, name: String)? = nil
        for raw in mc["notHere"]?.strings ?? [] {
            let name = normalize(raw)
            if !name.isEmpty && hasPhrase(q, name, typoMinLength: typo) && (missing == nil || name.jsLength > missing!.name.jsLength) { missing = (raw, name) }
        }
        if let missing = missing {
            let bestName = best.map { ($0.reason.name?.isEmpty ?? true) ? normalize($0.entity.label) : $0.reason.name! }
            if bestName == nil || missing.name.jsLength > bestName!.jsLength { return MatchResult(query: query, intent: "none", notHere: missing.raw) }
        }
        guard let b = best else { return MatchResult(query: query, intent: "none") }
        let kinds = graph.typeConfig(b.entity.type)["similar"]
        if kinds != .bool(false), let re = similarRe, re.firstMatch(in: q, range: NSRange(q.startIndex..., in: q)) != nil {
            let similar = neighbours(b.entity.id, kinds?.strings)
                .filter { graph.isDestination($0.0) }
                .prefix(similarLimit)
                .map { e, l -> Related in
                    let r = reasonFromLink(l, itemId: e.id)
                    return Related(entity: e, weight: l.weight, link: l, reason: r, text: renderReason(graph, r, e, templates: templates))
                }
            if !similar.isEmpty { return MatchResult(query: query, intent: "similar", entity: b.entity, match: b, similar: Array(similar)) }
        }
        return MatchResult(query: query, intent: "entity", entity: b.entity, match: b)
    }

    // MARK: - Related and next

    private func neighbours(_ id: String, _ kinds: [String]?) -> [(Entity, Link)] {
        var out: [(Entity, Link)] = []
        for l in graph.adjacent[id] ?? [] {
            if let kinds = kinds, !kinds.contains(l.kind) { continue }
            if let e = graph.entities[l.otherEnd(id)] { out.append((e, l)) }
        }
        return out.stableSorted { $0.1.weight > $1.1.weight }
    }

    /// What is related to one entity, strongest link first, each with why.
    public func related(_ id: String, kinds: [String]? = nil, limit: Int? = nil, destinationsOnly: Bool = true, accept: ((Entity) -> Bool)? = nil, templates: [String: Template]? = nil) -> [Related] {
        var pairs = neighbours(id, kinds)
            .stableSorted { a, b in a.1.weight != b.1.weight ? a.1.weight > b.1.weight : graph.pull(a.1.kind) > graph.pull(b.1.kind) }
            .filter { e, _ in (!destinationsOnly || graph.isDestination(e)) && (accept?(e) ?? true) }
        if let limit = limit { pairs = Array(pairs.prefix(limit)) }
        let out = pairs.map { e, l -> Related in
            let r = reasonFromLink(l, itemId: e.id)
            return Related(entity: e, weight: l.weight, link: l, reason: r, text: renderReason(graph, r, e, templates: templates))
        }
        suggested("related", out.map(\.entity.id), out.map(\.reason.kind))
        return out
    }

    /// How brightly each entity lights up for this trail, with the strongest reason for each.
    public func spread(_ trail: [String]) -> Spread {
        let cfg = graph.config["next"].obj
        let recency = cfg["recency"].num(0.6)
        let second = cfg["secondStep"].num(0.4)
        let hub = cfg["hubDamping"].num(3)
        let boost = cfg["sectionBoost"].num(0.08)
        let sections = cfg["sections"].obj
        var score: [String: Double] = [:]
        var order: [String] = []
        var why: [String: Why] = [:]
        var sectionOnly = Set<String>()

        func add(_ id: String, _ part: Double) {
            if score[id] == nil { order.append(id) }
            score[id, default: 0] += part
        }
        func give(_ id: String, _ part: Double, _ link: Link, _ src: String, _ seed: String) {
            add(id, part)
            if part > (why[id]?.part ?? 0) { why[id] = Why(link: link, from: src, seed: seed, part: part) }
        }

        var seeds: [String: Double] = [:]
        var seedOrder: [String] = []
        for id in trail.reversed() where seeds[id] == nil {
            seeds[id] = pow(recency, Double(seedOrder.count))
            seedOrder.append(id)
        }
        for seed in seedOrder {
            let w = seeds[seed]!
            if seed.hasPrefix("section:") {
                guard let type = sections[String(seed.dropFirst(8))].str, !type.isEmpty else { continue }
                for e in graph.entityOrder where e.type == type {
                    add(e.id, w * boost * min(1, Double(graph.degree(e.id)) / 8))
                    sectionOnly.insert(e.id)
                }
                continue
            }
            for l1 in graph.adjacent[seed] ?? [] {
                let mid = l1.otherEnd(seed)
                let a = w * l1.weight * graph.pull(l1.kind)
                give(mid, a, l1, seed, seed)
                let carry = (a * second) / (1 + Double(graph.degree(mid)) / hub).squareRoot()
                for l2 in graph.adjacent[mid] ?? [] {
                    let far = l2.otherEnd(mid)
                    if far == seed { continue }
                    give(far, carry * l2.weight * graph.pull(l2.kind), l2, mid, seed)
                }
            }
        }
        return Spread(score: score, order: order, why: why, seeds: seeds, sectionOnly: sectionOnly)
    }

    /// The next things to suggest after this trail: unseen, worth going to, and mixed.
    public func next(_ trail: [String], limit: Int = 3, exclude: [String] = [], accept: ((Entity) -> Bool)? = nil, templates: [String: Template]? = nil) -> [Suggestion] {
        let sp = spread(trail)
        let skip = Set(sp.seeds.keys).union(exclude)
        var ranked: [(Entity, Double, Why?)] = []
        for id in sp.order {
            guard let e = graph.entities[id] else { continue }
            if !(sp.why[id] != nil || sp.sectionOnly.contains(id)) || !graph.isDestination(e) || skip.contains(id) || !(accept?(e) ?? true) { continue }
            ranked.append((e, sp.score[id]!, sp.why[id]))
        }
        let byScore = ranked.stableSorted { $0.1 > $1.1 }
        let cap = max(1, limit - 1)
        var taken: [Int] = []
        var perType: [String: Int] = [:]
        for (i, r) in byScore.enumerated() {
            if taken.count == limit { break }
            if perType[r.0.type, default: 0] >= cap { continue }
            perType[r.0.type, default: 0] += 1
            taken.append(i)
        }
        for i in byScore.indices where taken.count < limit && !taken.contains(i) { taken.append(i) }
        let out = taken.map { byScore[$0] }.stableSorted { $0.1 > $1.1 }.map { e, s, w -> Suggestion in
            let reason = w.map { reasonFromLink($0.link, itemId: e.id, seed: $0.seed) } ?? Reason(kind: "section")
            return Suggestion(entity: e, score: s, reason: reason, text: renderReason(graph, reason, e, templates: templates))
        }
        suggested("next", out.map(\.entity.id), out.map(\.reason.kind))
        return out
    }

    /// Type-ahead: names that start with (or contain) what's typed, nearest the trail first.
    public func autocomplete(_ typed: String, trail: [String] = [], limit: Int = 3, accept: ((Entity) -> Bool)? = nil, templates: [String: Template]? = nil) -> [Suggestion] {
        let q = normalize(typed)
        if q.jsLength < 2 { return [] }
        let near = spread(trail).score
        var hits: [(Entity, String, Double)] = []
        for e in graph.entityOrder {
            if !graph.isDestination(e) || !(accept?(e) ?? true) { continue }
            let name = normalize(e.label)
            let kind = name.jsHasPrefix(q) ? 3 : words(name).contains { $0.jsHasPrefix(q) } ? 2 : (q.jsLength >= 3 && name.jsContains(q)) ? 1 : 0
            if kind == 0 { continue }
            let by = kind == 3 ? "prefix" : kind == 2 ? "word-prefix" : "contains"
            hits.append((e, by, Double(kind * 10) + (near[e.id] ?? 0) * 5 + Double(min(graph.degree(e.id), 20)) / 20))
        }
        return hits.stableSorted { $0.2 > $1.2 }.prefix(limit).map { e, by, rank in
            let reason = Reason(kind: "typed", by: by)
            return Suggestion(entity: e, score: rank, reason: reason, text: renderReason(graph, reason, e, templates: templates))
        }
    }

    /// A reason as a sentence.
    public func explain(_ reason: Reason, _ item: Entity, templates: [String: Template]? = nil) -> String {
        renderReason(graph, reason, item, templates: templates)
    }

    /// A reason as a sentence, for an entity id.
    public func explain(_ reason: Reason, id: String, templates: [String: Template]? = nil) throws -> String {
        guard let e = graph.entities[id] else { throw PubbaError.noEntity(id) }
        return renderReason(graph, reason, e, templates: templates)
    }
}
