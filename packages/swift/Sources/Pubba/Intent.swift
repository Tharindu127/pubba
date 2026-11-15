import Foundation

// Intent profiles (SPEC 5.7, 5.8): a guess at why this visit is happening, from
// the trail alone. Once one intent is likely, it leans suggestions towards what
// it boosts, within 0.5-2x, so it reorders but never hides. Nothing is stored.

/// The visitor's likely intent moved this suggestion: which intent, and its boost.
public struct ReasonIntent: Sendable, Equatable {
    public let id: String
    public let boost: Double
    public init(id: String, boost: Double) { self.id = id; self.boost = boost }
}

/// A trail step that pointed to an intent; `via` is the neighbour it pointed through, when that counted more.
public struct IntentEvidence: Sendable, Equatable {
    public let step: String
    public let via: String?
    public let weight: Double

    public var json: JSONObject {
        var o = JSONObject()
        o["step"] = .string(step)
        if let via = via { o["via"] = .string(via) }
        o["weight"] = .number(weight)
        return o
    }
}

/// Why a visit is likely happening: `likely` is nil while browsing, with too few steps, or with no intents.
public struct IntentReading: Sendable, Equatable {
    public let likely: String?
    public let confidence: Double
    /// Each intent's share, then `browsing`'s, in order.
    public let scores: [(String, Double)]
    /// The steps behind the top intent.
    public let evidence: [IntentEvidence]

    public static func == (a: IntentReading, b: IntentReading) -> Bool {
        a.likely == b.likely && a.confidence == b.confidence && a.evidence == b.evidence && a.scores.map(\.0) == b.scores.map(\.0) && a.scores.map(\.1) == b.scores.map(\.1)
    }

    public var json: JSONObject {
        JSONObject([
            ("likely", likely.map { .string($0) } ?? .null),
            ("confidence", .number(confidence)),
            ("scores", .object(JSONObject(scores.map { ($0.0, .number($0.1)) }))),
            ("evidence", .array(evidence.map { .object($0.json) })),
        ])
    }
}

/// The configured intents, in order ("browsing" is reserved).
public func intentsOf(_ g: Graph) -> [(String, JSONObject)] {
    g.config["intents"].obj.pairs.compactMap { id, c in id == "browsing" ? nil : c.object.map { (id, $0) } }
}

private func findIntent(_ g: Graph, _ intent: String) -> JSONObject? {
    intentsOf(g).first { $0.0 == intent }?.1
}

/// Why this visit is likely happening, from the trail alone.
public func readIntent(_ g: Graph, _ trail: [String]) -> IntentReading {
    let intents = intentsOf(g)
    let settings = g.config["intent"].obj
    let minConfidence = settings["minConfidence"].num(0.5)
    let minSteps = settings["minSteps"].num(2)
    let share = settings["neighbours"].num(0.5)
    let next = g.config["next"].obj
    let recency = next["recency"].num(0.6)
    let sections = next["sections"].obj

    var seeds: [(String, Double)] = []
    for id in trail.reversed() where !seeds.contains(where: { $0.0 == id }) {
        seeds.append((id, pow(recency, Double(seeds.count))))
    }
    let steps = seeds.filter { !$0.0.hasPrefix("section:") && g.find($0.0) != nil }.count

    var raw: [Double] = []
    var evidence: [[IntentEvidence]] = []
    for (_, intent) in intents {
        let signals = intent["signals"].obj
        let e = signals["entities"].obj, t = signals["types"].obj, k = signals["kinds"].obj
        var sum = 0.0
        var ev: [IntentEvidence] = []
        for (step, w) in seeds {
            var via: String? = nil
            let part: Double
            if step.hasPrefix("section:") {
                guard let type = sections[String(step.dropFirst(8))].str, !type.isEmpty else { continue }
                part = w * t[type].num(0)
            } else {
                guard let entity = g.find(step) else { continue }
                let own = e[entity.id].num(0) + t[entity.type].num(0)
                var best = 0.0
                var bestVia: String? = nil
                for l in g.adjacent[step] ?? [] {
                    let n = l.otherEnd(step)
                    let v = l.weight * (e[n].num(0) + k[l.kind].num(0))
                    if v > best {
                        best = v
                        bestVia = n
                    }
                }
                let near = share * best
                if near > own { via = bestVia }
                part = w * (own + near)
            }
            sum += part
            if part > 0 { ev.append(IntentEvidence(step: step, via: via, weight: part)) }
        }
        raw.append(max(0, sum))
        evidence.append(ev)
    }

    var sumRaw = 0.0
    for r in raw { sumRaw += r }
    let total = 1 + sumRaw
    var scores: [(String, Double)] = []
    var top = -1
    for i in intents.indices {
        scores.append((intents[i].0, raw[i] / total))
        if top < 0 || raw[i] > raw[top] { top = i }
    }
    scores.append(("browsing", 1 / total))
    let confidence = top < 0 ? 0 : raw[top] / total
    let likely = top >= 0 && raw[top] > 0 && confidence >= minConfidence && Double(steps) >= minSteps ? intents[top].0 : nil
    return IntentReading(likely: likely, confidence: confidence, scores: scores, evidence: top < 0 ? [] : evidence[top])
}

/// The intent to apply: "auto" works it out from the trail, an id names one, nil is none.
public func resolveIntent(_ g: Graph, _ trail: [String], _ option: String?) -> String? {
    guard let option = option, !intentsOf(g).isEmpty else { return nil }
    if option == "auto" { return readIntent(g, trail).likely }
    return findIntent(g, option) != nil ? option : nil
}

/// How much an intent leans towards an entity reached by a link: clamped to 0.5-2.
public func intentBoost(_ g: Graph, _ intent: String, _ e: Entity, _ link: Link?) -> Double {
    let b = findIntent(g, intent)?["boost"].obj ?? JSONObject()
    let v = b["types"].obj[e.type].num(1) * b["entities"].obj[e.id].num(1) * (link.map { b["kinds"].obj[$0.kind].num(1) } ?? 1)
    return min(2, max(0.5, v))
}

/// An intent's label, for the `{intent}` token.
public func intentLabel(_ g: Graph, _ intent: String) -> String {
    findIntent(g, intent)?["label"].str ?? intent
}
