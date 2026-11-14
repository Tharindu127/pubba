import Foundation

// Text helpers behind matching (SPEC section 3). Lengths and positions are in
// UTF-16 code units, as in the JavaScript reference.

/// JavaScript's \s: Unicode white space plus the byte order mark.
private let jsSpace: Set<UInt16> = [0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF]

private func isLower(_ u: UInt16) -> Bool { u >= 0x61 && u <= 0x7A }

/// Trim like JavaScript's String.prototype.trim.
func jsTrim(_ s: String) -> String {
    let u = Array(s.utf16)
    var a = 0, b = u.count
    while a < b, jsSpace.contains(u[a]) { a += 1 }
    while b > a, jsSpace.contains(u[b - 1]) { b -= 1 }
    return String(decoding: u[a..<b], as: UTF16.self)
}

/// Runs of white space become one space, then trimmed.
func collapse(_ s: String) -> String {
    var out: [UInt16] = []
    var inSpace = false
    for u in s.utf16 {
        if jsSpace.contains(u) {
            if !inSpace { out.append(0x20) }
            inSpace = true
        } else {
            out.append(u)
            inSpace = false
        }
    }
    return jsTrim(String(decoding: out, as: UTF16.self))
}

/// Lowercase, accents off, punctuation to spaces (keeping + # . for C#, C++, Next.js).
public func normalize(_ s: String) -> String {
    var out: [UInt16] = []
    for u in s.lowercased().decomposedStringWithCompatibilityMapping.utf16 {
        if u >= 0x300 && u <= 0x36F { continue }
        if isLower(u) || (u >= 0x30 && u <= 0x39) || u == 0x2B || u == 0x23 || u == 0x2E || jsSpace.contains(u) { out.append(u) } else { out.append(0x20) }
    }
    return collapse(String(decoding: out, as: UTF16.self))
}

private func distance(_ a: [UInt16], _ b: [UInt16]) -> Int {
    if a.isEmpty { return b.count }
    if b.isEmpty { return a.count }
    var d = Array(repeating: Array(repeating: 0, count: b.count + 1), count: a.count + 1)
    for i in 0...a.count { d[i][0] = i }
    for j in 0...b.count { d[0][j] = j }
    for i in 1...a.count {
        for j in 1...b.count {
            let cost = a[i - 1] == b[j - 1] ? 0 : 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if i > 1, j > 1, a[i - 1] == b[j - 2], a[i - 2] == b[j - 1] { d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1) }
        }
    }
    return d[a.count][b.count]
}

/// Optimal string alignment: a swap of two neighbouring characters counts once.
public func editDistance(_ a: String, _ b: String) -> Int { distance(Array(a.utf16), Array(b.utf16)) }

/// Does a typed word mean this word? Exact, plural, prefix, or a near miss.
public func closeTo(_ token: String?, _ word: String, typoMinLength: Double = 4) -> Bool {
    guard let token = token, !token.isEmpty else { return false }
    let t = Array(token.utf16), w = Array(word.utf16)
    if t == w || t == w + Array("s".utf16) { return true }
    // Short words and names with symbols (go, js, c#, next.js) must match exactly.
    if w.count < 4 || w.contains(where: { !isLower($0) }) { return false }
    if t.starts(with: w) { return true }
    if t.count < 3 || Double(w.count) < typoMinLength { return false }
    let most = w.count >= 7 ? 2 : 1
    return distance(t, w) <= most || (t.count > w.count && distance(Array(t[0..<w.count]), w) <= most)
}

func words(_ s: String) -> [String] { s.split(separator: " ", omittingEmptySubsequences: false).map(String.init) }

/// Does a normalised query contain this phrase, word by word, typos allowed?
public func hasPhrase(_ query: String, _ phrase: String, typoMinLength: Double = 4) -> Bool {
    let tokens = words(query), ws = words(phrase)
    if tokens.count < ws.count { return false }
    for i in 0...(tokens.count - ws.count) where ws.indices.allSatisfy({ closeTo(tokens[i + $0], ws[$0], typoMinLength: typoMinLength) }) {
        return true
    }
    return false
}

/// Does a normalised query contain this normalised name as whole words?
public func containsName(_ query: String, _ name: String) -> Bool {
    Array((" " + query + " ").utf16).containsRun(Array((" " + name + " ").utf16))
}

extension Array where Element == UInt16 {
    func containsRun(_ run: [UInt16]) -> Bool {
        if run.isEmpty { return true }
        if run.count > count { return false }
        for i in 0...(count - run.count) where self[i] == run[0] && Array(self[i..<i + run.count]) == run { return true }
        return false
    }
}

extension String {
    var jsLength: Int { utf16.count }
    func jsHasPrefix(_ p: String) -> Bool { Array(utf16).starts(with: Array(p.utf16)) }
    func jsContains(_ p: String) -> Bool { Array(utf16).containsRun(Array(p.utf16)) }
}

extension Sequence {
    /// A stable sort: equal elements keep their order, as in JavaScript.
    func stableSorted(by less: (Element, Element) -> Bool) -> [Element] {
        enumerated().sorted { a, b in less(a.element, b.element) ? true : (less(b.element, a.element) ? false : a.offset < b.offset) }.map(\.element)
    }
}
