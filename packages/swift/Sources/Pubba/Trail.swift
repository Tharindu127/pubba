import Foundation

/// Where a trail is kept between launches: UserDefaults, a file.
public protocol TrailStorage {
    func getItem(_ key: String) -> String?
    func setItem(_ key: String, _ value: String)
}

/// A trail kept in UserDefaults, on the device.
public struct UserDefaultsTrailStorage: TrailStorage {
    private let defaults: UserDefaults
    public init(_ defaults: UserDefaults = .standard) { self.defaults = defaults }
    public func getItem(_ key: String) -> String? { defaults.string(forKey: key) }
    public func setItem(_ key: String, _ value: String) { defaults.set(value, forKey: key) }
}

/// A visitor's trail through the site or app, in entity ids, most recent last. Never sent anywhere.
public final class Trail {
    private let max: Int
    private let storage: TrailStorage?
    private let key: String
    private var steps: [String] = []
    private var loaded = false
    private var listeners: [(id: Int, fn: () -> Void)] = []
    private var nextId = 0

    public init(max: Int = 24, storage: TrailStorage? = nil, key: String = "pubba-trail") {
        self.max = max
        self.storage = storage
        self.key = key
    }

    private func load() {
        if loaded { return }
        loaded = true
        // A broken or missing save starts a fresh trail.
        if let saved = try? JSON.parse(storage?.getItem(key) ?? "[]"), let list = saved.array {
            steps = Array(list.compactMap(\.string).suffix(max))
        }
    }

    private func save() {
        storage?.setItem(key, JSON.stringify(.array(steps.map { .string($0) })))
        for l in listeners { l.fn() }
    }

    /// One step; the same step twice in a row counts once.
    public func record(_ id: String?) {
        guard let id = id, !id.isEmpty else { return }
        load()
        if steps.last == id { return }
        steps = Array((steps + [id]).suffix(max))
        save()
    }

    public func get() -> [String] {
        load()
        return steps
    }

    public func clear() {
        loaded = true
        steps = []
        save()
    }

    /// Called after every change; returns an unsubscribe function.
    @discardableResult
    public func subscribe(_ listener: @escaping () -> Void) -> () -> Void {
        let id = nextId
        nextId += 1
        listeners.append((id, listener))
        return { [weak self] in self?.listeners.removeAll { $0.id == id } }
    }
}

/// A trail step for opening a section, which lights every entity of its type a little.
public func sectionStep(_ section: String) -> String { "section:" + section }
