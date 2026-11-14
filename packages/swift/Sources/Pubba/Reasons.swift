import Foundation

/// Sentences (SPEC section 6).
public let defaultTemplates: [String: Template] = [
    "section": "{item} is worth a look.",
    "typed": "{item} matches what you typed.",
    "match": "{item} matches “{name}”.",
]

private func isWordUnit(_ u: UInt16) -> Bool {
    (u >= 0x30 && u <= 0x39) || (u >= 0x41 && u <= 0x5A) || (u >= 0x61 && u <= 0x7A) || u == 0x5F
}

/// Each `{token}` (word characters only) through `replace`; anything else kept as is.
func replaceTokens(_ text: String, _ replace: (String) -> String) -> String {
    let u = Array(text.utf16)
    var out: [UInt16] = []
    var i = 0
    while i < u.count {
        if u[i] == 0x7B {
            var j = i + 1
            while j < u.count, isWordUnit(u[j]) { j += 1 }
            if j > i + 1, j < u.count, u[j] == 0x7D {
                out += Array(replace(String(decoding: u[(i + 1)..<j], as: UTF16.self)).utf16)
                i = j + 1
                continue
            }
        }
        out.append(u[i])
        i += 1
    }
    return String(decoding: out, as: UTF16.self)
}

private func tokens(_ text: String) -> [String] {
    var found: [String] = []
    _ = replaceTokens(text) { found.append($0); return "" }
    return found
}

/// Each `[optional part]` kept only when every token in it has a value.
private func fill(_ text: String, _ values: [String: String]) -> String {
    let u = Array(text.utf16)
    var out: [UInt16] = []
    var i = 0
    while i < u.count {
        if u[i] == 0x5B, let close = u[(i + 1)...].firstIndex(of: 0x5D) {
            let inner = String(decoding: u[(i + 1)..<close], as: UTF16.self)
            if tokens(inner).allSatisfy({ !(values[$0] ?? "").isEmpty }) { out += Array(inner.utf16) }
            i = close + 1
            continue
        }
        out.append(u[i])
        i += 1
    }
    return replaceTokens(String(decoding: out, as: UTF16.self)) { values[$0] ?? "" }
}

/// The reason a link gives for the entity at one of its ends.
public func reasonFromLink(_ link: Link, itemId: String, seed: String? = nil) -> Reason {
    let to = link.otherEnd(itemId)
    return Reason(
        kind: link.kind,
        to: to,
        direction: link.from == itemId ? "out" : "in",
        via: (link.via?.isEmpty ?? true) ? nil : link.via,
        seed: (seed?.isEmpty ?? true) || seed == to ? nil : seed
    )
}

private func pick(_ t: Template, _ reason: Reason, _ item: Entity, _ other: Entity?) -> String? {
    switch t {
    case let .text(s): return s
    case let .function(f): return f(reason, item, other)
    case let .json(v):
        guard let m = v.object else { return nil }
        for c in m["cases"]?.array ?? [] {
            guard let c = c.object else { continue }
            let ci = c["item"].str ?? "", co = c["other"].str ?? "", cd = c["direction"].str ?? ""
            if (ci.isEmpty || ci == item.type) && (co.isEmpty || (other != nil && co == other!.type)) && (cd.isEmpty || cd == reason.direction) {
                return c["text"].str
            }
        }
        if reason.direction == "out", let s = m["out"].str, !s.isEmpty { return s }
        if reason.direction == "in", let s = m["in"].str, !s.isEmpty { return s }
        for k in ["default", "out", "in"] { if let s = m[k].str { return s } }
        return nil
    }
}

/// A reason as one sentence.
public func renderReason(_ g: Graph, _ reason: Reason, _ item: Entity, templates: [String: Template]? = nil) -> String {
    var every = defaultTemplates
    for (k, v) in g.config["templates"].obj.pairs { every[k] = Template(v) }
    for (k, v) in templates ?? [:] { every[k] = v }
    let other = (reason.to?.isEmpty ?? true) ? nil : g.entities[reason.to!]
    let t = every["\(reason.kind).\(item.type)"] ?? every[reason.kind]
    var text: String? = nil
    if let t = t, t.truthy { text = pick(t, reason, item, other) }
    if text == nil {
        if other != nil {
            text = reason.direction == "in" ? "{other}: {kind} {item}[ ({via})]." : "{item}: {kind} {other}[ ({via})]."
        } else {
            text = "{item} is worth a look."
        }
    }
    if case .function = t { return text! }
    let otherLabel = other?.shortLabel ?? ""
    return fill(text!, [
        "item": item.shortLabel,
        "other": otherLabel,
        "otherLower": otherLabel.lowercased(),
        "via": (reason.via ?? []).prefix(3).joined(separator: ", "),
        "kind": g.kindLabel(reason.kind),
        "name": reason.name ?? "",
    ])
}
