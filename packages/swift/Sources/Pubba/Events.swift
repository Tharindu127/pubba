import Foundation

// Privacy-safe measurement events (SPEC section 8). pubba only emits: no
// storage, no network, no visitor ids, no timestamps. Event fields hold entity
// ids, types, kinds and declared goals; never a query.

/// How a visitor can be guided somewhere, for `guided-to` events.
public let guideVias = ["suggestion", "chip", "typed", "match", "related"]

/// One measurement event, with the spec's field names.
public typealias PubbaEvent = JSONObject

public final class Events: @unchecked Sendable {
    public let goals: [String]
    private var listeners: [(id: Int, fn: (PubbaEvent) -> Void)] = []
    private var nextId = 0
    private let lock = NSLock()

    public init(goals: [String] = ["contact", "resume"]) { self.goals = goals }

    /// Listen to every event; returns an unsubscribe function.
    @discardableResult
    public func on(_ listener: @escaping (PubbaEvent) -> Void) -> () -> Void {
        lock.lock(); defer { lock.unlock() }
        let id = nextId
        nextId += 1
        listeners.append((id, listener))
        return { [weak self] in
            guard let self = self else { return }
            self.lock.lock(); defer { self.lock.unlock() }
            self.listeners.removeAll { $0.id == id }
        }
    }

    public func emit(_ event: PubbaEvent) {
        lock.lock()
        let current = listeners
        lock.unlock()
        for l in current { l.fn(event) }
    }
}

/// One visit's funnel.
public struct Summary: Sendable, Equatable {
    public let usedGuide: Bool
    public let guidedTo: [String]
    public let guidedToTypes: [String]
    public let reached: [String]
    public let guidedBeforeGoal: Bool
}

/// Was the guide used, where did it lead, which goals were reached.
public func summarise(_ events: [PubbaEvent]) -> Summary {
    var guidedTo: [String] = [], types: [String] = [], reached: [String] = []
    var used = false, beforeGoal = false
    for e in events {
        switch e["type"].str {
        case "guide-opened", "matched": used = true
        case "guided-to":
            used = true
            if let to = e["to"].str, !guidedTo.contains(to) { guidedTo.append(to) }
            if let t = e["entityType"].str, !types.contains(t) { types.append(t) }
        case "reached":
            if let g = e["goal"].str, !reached.contains(g) { reached.append(g) }
            if !guidedTo.isEmpty { beforeGoal = true }
        default: break
        }
    }
    return Summary(usedGuide: used, guidedTo: guidedTo, guidedToTypes: types, reached: reached, guidedBeforeGoal: beforeGoal)
}

/// The moments a site reports to its measurement, checked so no visitor text gets in.
public struct Track: Sendable {
    let graph: Graph
    let events: Events?

    public func guideOpened() {
        events?.emit(JSONObject([("type", .string("guide-opened"))]))
    }

    @discardableResult
    public func guidedTo(_ id: String, via: String) -> Bool {
        guard let events = events, let e = graph.find(id), guideVias.contains(via) else { return false }
        events.emit(JSONObject([("type", .string("guided-to")), ("to", .string(e.id)), ("entityType", .string(e.type)), ("via", .string(via))]))
        return true
    }

    @discardableResult
    public func reached(_ goal: String) -> Bool {
        guard let events = events, events.goals.contains(goal) else { return false }
        events.emit(JSONObject([("type", .string("reached")), ("goal", .string(goal))]))
        return true
    }
}
