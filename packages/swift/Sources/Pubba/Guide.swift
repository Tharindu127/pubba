import Foundation

// The headless guide (SPEC section 9): replies, chips, the trail and nudges, with no UI.

public let defaultGuideTemplates: [String: String] = [
    "open": "Here's {item}.",
    "similar": "{reason}",
    "none": "I couldn't find that here. These might help:",
    "notHere": "{name} isn't here. These might help:",
    "start": "Where would you like to start?",
    "nudge": "{reason} Want a look?",
]

/// A place to go, with why.
public struct EntityChip: Sendable, Equatable {
    public let id: String
    public let label: String
    public let reason: Reason
    public let text: String
    public let url: String?
}

/// A question to ask the guide (`guide.ask(question)` when tapped).
public struct QuestionChip: Sendable, Equatable {
    public let label: String
    public let question: String
    public init(_ label: String, question: String? = nil) {
        self.label = label
        self.question = question ?? label
    }
}

/// A follow-up button: a place to go, or a question to ask the guide.
public enum Chip: Sendable, Equatable, Identifiable {
    case entity(EntityChip)
    case question(QuestionChip)

    public var label: String {
        switch self {
        case let .entity(c): return c.label
        case let .question(c): return c.label
        }
    }

    public var id: String {
        switch self {
        case let .entity(c): return c.id
        case let .question(c): return "question:" + c.question
        }
    }
}

/// Navigate to an entity: `url` is the route the guide's `route` gave it, if any.
public struct Action: Sendable, Equatable {
    public let type = "open"
    public let id: String
    public let url: String?
}

/// A reply: `kind` is "open", "similar", "none", "not-here" or "start". Show `text` and `chips`; perform `action`.
public struct Reply: Sendable {
    public let kind: String
    public let text: String
    public var chips: [Chip] = []
    public var action: Action? = nil
    public var match: Match? = nil
    public var similar: [EntityChip]? = nil
}

public struct NudgePolicy: Sendable, Equatable {
    public var delayMs: Double
    public var gapMs: Double
    public var minScore: Double
    public init(delayMs: Double = 9000, gapMs: Double = 60000, minScore: Double = 0.3) {
        self.delayMs = delayMs; self.gapMs = gapMs; self.minScore = minScore
    }
}

/// What a fallback is asked for: kind "start", "none", "not-here", "open" (with the entity) or "chips".
public struct FallbackContext {
    public let kind: String
    public let entity: Entity?
}

private func fill(_ text: String, _ values: [String: String]) -> String { collapse(replaceTokens(text) { values[$0] ?? "" }) }

/// The navigator: a typed question becomes a reply; steps are recorded; nudges come at the right moments.
/// Use one guide from one thread (the main thread, in an app): it holds the visitor's trail and nudge timing.
public final class Guide {
    public let pubba: Pubba
    public let trail: Trail
    public let nudgePolicy: NudgePolicy
    private let route: (Entity) -> String?
    private let limit: Int
    private let prefer: (Entity) -> Bool
    private let accept: ((Entity) -> Bool)?
    private let fallback: ((FallbackContext) -> [Chip]?)?
    private let line: ((Entity) -> String?)?
    private let t: [String: String]
    private let now: () -> Double
    private var lastStepAt = -Double.infinity
    private var lastStepSelf = false
    private var lastNudgeAt = -Double.infinity
    private var nudgedFrom = Set<String>()

    /// - Parameters:
    ///   - trail: the visitor's trail; give it a `TrailStorage` to keep it between launches.
    ///   - route: where an entity lives in this app (a route, a deep link, a url). Default: the entity's url.
    ///   - chips: how many chips a reply carries.
    ///   - prefer: which suggestions a nudge prefers. Default: those with a route.
    ///   - accept: which entities the guide may offer at all.
    ///   - fallback: chips for when nothing is suggested. Nil for the default starters.
    ///   - line: a short line about an entity, for the `{line}` token.
    ///   - templates: words; override any of `defaultGuideTemplates`, or add `open.<type>`, `nudge.<type>`, `similar.<type>`.
    ///   - now: the clock, in milliseconds.
    public init(
        _ pubba: Pubba,
        trail: Trail = Trail(),
        route: ((Entity) -> String?)? = nil,
        chips: Int = 3,
        nudge: NudgePolicy = NudgePolicy(),
        prefer: ((Entity) -> Bool)? = nil,
        accept: ((Entity) -> Bool)? = nil,
        fallback: ((FallbackContext) -> [Chip]?)? = nil,
        line: ((Entity) -> String?)? = nil,
        templates: [String: String] = [:],
        now: (() -> Double)? = nil
    ) {
        self.pubba = pubba
        self.trail = trail
        self.nudgePolicy = nudge
        let route = route ?? { $0.url }
        self.route = route
        self.limit = chips
        self.prefer = prefer ?? { route($0) != nil }
        self.accept = accept
        self.fallback = fallback
        self.line = line
        self.t = defaultGuideTemplates.merging(templates) { _, b in b }
        self.now = now ?? { Date().timeIntervalSince1970 * 1000 }
    }

    // MARK: - Helpers

    private func tpl(_ key: String, _ e: Entity? = nil) -> String {
        if let e = e, let specific = t["\(key).\(e.type)"] { return specific }
        return t[key]!
    }

    private func vars(_ e: Entity) -> [String: String] { ["item": e.shortLabel, "label": e.label, "line": line?(e) ?? ""] }

    private func chip(_ e: Entity, _ reason: Reason, _ text: String) -> EntityChip {
        EntityChip(id: e.id, label: e.shortLabel, reason: reason, text: text, url: route(e))
    }

    private func open(_ e: Entity) -> Action { Action(id: e.id, url: route(e)) }

    private func starters(_ n: Int) -> [Chip] {
        let g = pubba.graph
        let reason = Reason(kind: "section")
        return g.entityOrder
            .filter { g.isDestination($0) && (accept?($0) ?? true) }
            .stableSorted { g.degree($0.id) > g.degree($1.id) }
            .prefix(n)
            .map { .entity(chip($0, reason, pubba.explain(reason, $0))) }
    }

    private func chipsFor(_ n: Int, _ extra: [String], _ context: FallbackContext) -> [Chip] {
        let out = pubba.next(trail.get() + extra, limit: n, accept: accept).map { Chip.entity(chip($0.entity, $0.reason, $0.text)) }
        if !out.isEmpty { return out }
        if let fb = fallback?(context) { return Array(fb.prefix(n)) }
        return starters(n)
    }

    // MARK: - The guide

    /// Answer a typed question. Doesn't move the visitor: perform the action, then call `follow`.
    public func ask(_ question: String) -> Reply {
        if jsTrim(question).isEmpty {
            return Reply(kind: "start", text: fill(tpl("start"), [:]), chips: chipsFor(limit, [], FallbackContext(kind: "start", entity: nil)))
        }
        let m = pubba.match(question)
        if m.intent == "none" {
            if let name = m.notHere {
                return Reply(kind: "not-here", text: fill(tpl("notHere"), ["name": name]), chips: chipsFor(limit, [], FallbackContext(kind: "not-here", entity: nil)))
            }
            return Reply(kind: "none", text: fill(tpl("none"), [:]), chips: chipsFor(limit, [], FallbackContext(kind: "none", entity: nil)))
        }
        let entity = m.entity!
        let similar = m.similar.filter { accept?($0.entity) ?? true }
        if m.intent == "similar", let first = similar.first {
            let listed = similar.map { r in r.entity.label + ((r.reason.via?.isEmpty ?? true) ? "" : " (" + r.reason.via!.prefix(2).joined(separator: ", ") + ")") }.joined(separator: ", ")
            return Reply(
                kind: "similar",
                text: fill(tpl("similar", entity), vars(first.entity).merging(["reason": first.text, "of": entity.label, "list": listed]) { _, b in b }),
                chips: similar.dropFirst().prefix(limit).map { .entity(chip($0.entity, $0.reason, $0.text)) },
                action: open(first.entity),
                match: m.match,
                similar: similar.map { chip($0.entity, $0.reason, $0.text) }
            )
        }
        let context = FallbackContext(kind: "open", entity: entity)
        let chips: [Chip]
        if pubba.graph.entities[entity.id] != nil {
            chips = chipsFor(limit, [entity.id], context).filter { if case let .entity(c) = $0 { return c.id != entity.id }; return true }
        } else {
            chips = chipsFor(limit, [], context)
        }
        return Reply(kind: "open", text: fill(tpl("open", entity), vars(entity)), chips: chips, action: open(entity), match: m.match)
    }

    /// Follow-ups for where the visitor is now.
    public func chips(limit: Int? = nil) -> [Chip] { chipsFor(limit ?? self.limit, [], FallbackContext(kind: "chips", entity: nil)) }

    /// The visitor went somewhere on their own.
    public func visited(_ id: String) {
        if pubba.graph.find(id) == nil && !id.hasPrefix("section:") { return }
        trail.record(id)
        lastStepAt = now()
        lastStepSelf = true
    }

    /// The visitor went somewhere because the guide sent them (`via`: one of `guideVias`).
    public func follow(_ id: String, via: String) {
        if pubba.graph.find(id) == nil { return }
        trail.record(id)
        lastStepAt = now()
        lastStepSelf = false
        pubba.track.guidedTo(id, via: via)
    }

    /// A suggestion to show unprompted now, or nil. Call it `nudgePolicy.delayMs` after a step.
    public func nudge() -> Reply? {
        let steps = trail.get()
        let at = now()
        guard let last = steps.last, !last.isEmpty, lastStepSelf, !last.hasPrefix("section:"), !nudgedFrom.contains(last) else { return nil }
        if at - lastStepAt < nudgePolicy.delayMs || at - lastNudgeAt < nudgePolicy.gapMs { return nil }
        let options = pubba.next(steps, limit: 5, accept: accept).filter { $0.reason.kind != "section" && $0.score >= nudgePolicy.minScore }
        guard let top = options.first(where: { prefer($0.entity) }) ?? options.first else { return nil }
        lastNudgeAt = at
        nudgedFrom.insert(last)
        return Reply(
            kind: "open",
            text: fill(tpl("nudge", top.entity), vars(top.entity).merging(["reason": top.text]) { _, b in b }),
            chips: [.entity(chip(top.entity, top.reason, top.text))],
            action: open(top.entity)
        )
    }

    public func opened() { pubba.track.guideOpened() }

    public func reached(_ goal: String) { pubba.track.reached(goal) }
}
