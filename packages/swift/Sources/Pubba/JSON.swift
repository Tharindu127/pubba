import Foundation

/// A JSON value. Objects keep their keys in order, like JavaScript.
public enum JSONValue: Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object(JSONObject)

    public var string: String? { if case let .string(s) = self { return s }; return nil }
    public var number: Double? { if case let .number(n) = self { return n }; return nil }
    public var bool: Bool? { if case let .bool(b) = self { return b }; return nil }
    public var array: [JSONValue]? { if case let .array(a) = self { return a }; return nil }
    public var object: JSONObject? { if case let .object(o) = self { return o }; return nil }

    /// Strings in an array, others skipped.
    public var strings: [String]? { array?.compactMap(\.string) }

    /// Truthy, as JavaScript reads a config value.
    var truthy: Bool {
        switch self {
        case .null: return false
        case let .bool(b): return b
        case let .number(n): return n != 0 && !n.isNaN
        case let .string(s): return !s.isEmpty
        default: return true
        }
    }

    public subscript(key: String) -> JSONValue? { object?[key] }
}

/// A JSON object with its keys in insertion order.
public struct JSONObject: Sendable, Equatable {
    public private(set) var keys: [String] = []
    private var values: [String: JSONValue] = [:]

    public init() {}

    public init(_ pairs: [(String, JSONValue)]) {
        for (k, v) in pairs { self[k] = v }
    }

    public subscript(key: String) -> JSONValue? {
        get { values[key] }
        set {
            if let v = newValue {
                if values[key] == nil { keys.append(key) }
                values[key] = v
            } else if values.removeValue(forKey: key) != nil {
                keys.removeAll { $0 == key }
            }
        }
    }

    public var pairs: [(String, JSONValue)] { keys.map { ($0, values[$0]!) } }

    public static func == (a: JSONObject, b: JSONObject) -> Bool { a.values == b.values }
}

extension Optional where Wrapped == JSONValue {
    var obj: JSONObject { self?.object ?? JSONObject() }
    func num(_ fallback: Double) -> Double { self?.number ?? fallback }
    var str: String? { self?.string }
    var truthy: Bool { self?.truthy ?? false }
}

public enum JSON {
    public struct ParseError: Error, CustomStringConvertible {
        public let description: String
    }

    /// Parse JSON text. Numbers read as Double; objects keep their key order.
    public static func parse(_ text: String) throws -> JSONValue {
        var p = Parser(Array(text.utf8))
        p.space()
        let v = try p.value()
        p.space()
        if p.at < p.s.count { throw p.fail("unexpected text") }
        return v
    }

    public static func stringify(_ v: JSONValue) -> String {
        var out = ""
        write(&out, v)
        return out
    }

    private static func write(_ out: inout String, _ v: JSONValue) {
        switch v {
        case .null: out += "null"
        case let .bool(b): out += b ? "true" : "false"
        case let .number(n):
            if n.isNaN || n.isInfinite { out += "null" }
            else if n == n.rounded() && abs(n) < 1e15 { out += String(Int64(n)) }
            else { out += String(n) }
        case let .string(s): quote(&out, s)
        case let .array(a):
            out += "["
            for (i, x) in a.enumerated() { if i > 0 { out += "," }; write(&out, x) }
            out += "]"
        case let .object(o):
            out += "{"
            for (i, (k, x)) in o.pairs.enumerated() { if i > 0 { out += "," }; quote(&out, k); out += ":"; write(&out, x) }
            out += "}"
        }
    }

    private static func quote(_ out: inout String, _ s: String) {
        out += "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if u.value < 0x20 { out += String(format: "\\u%04x", u.value) } else { out.unicodeScalars.append(u) }
            }
        }
        out += "\""
    }

    private struct Parser {
        let s: [UInt8]
        var at = 0
        init(_ s: [UInt8]) { self.s = s }

        func fail(_ msg: String) -> ParseError { ParseError(description: "pubba: bad JSON at \(at): \(msg)") }

        mutating func space() {
            while at < s.count, s[at] == 0x20 || s[at] == 0x0A || s[at] == 0x0D || s[at] == 0x09 { at += 1 }
        }

        mutating func value() throws -> JSONValue {
            guard at < s.count else { throw fail("unexpected end") }
            switch s[at] {
            case UInt8(ascii: "{"): return .object(try object())
            case UInt8(ascii: "["): return .array(try array())
            case UInt8(ascii: "\""): return .string(try string())
            case UInt8(ascii: "t"): return try word("true", .bool(true))
            case UInt8(ascii: "f"): return try word("false", .bool(false))
            case UInt8(ascii: "n"): return try word("null", .null)
            case UInt8(ascii: "-"), UInt8(ascii: "0")...UInt8(ascii: "9"): return .number(try number())
            default: throw fail("unexpected character")
            }
        }

        mutating func word(_ w: String, _ v: JSONValue) throws -> JSONValue {
            let bytes = Array(w.utf8)
            guard at + bytes.count <= s.count, Array(s[at..<at + bytes.count]) == bytes else { throw fail("expected \(w)") }
            at += bytes.count
            return v
        }

        mutating func object() throws -> JSONObject {
            var out = JSONObject()
            at += 1
            space()
            if at < s.count, s[at] == UInt8(ascii: "}") { at += 1; return out }
            while true {
                space()
                guard at < s.count, s[at] == UInt8(ascii: "\"") else { throw fail("expected a key") }
                let k = try string()
                space()
                guard at < s.count, s[at] == UInt8(ascii: ":") else { throw fail("expected ':'") }
                at += 1
                space()
                out[k] = try value()
                space()
                guard at < s.count else { throw fail("unexpected end") }
                let c = s[at]; at += 1
                if c == UInt8(ascii: ",") { continue }
                if c == UInt8(ascii: "}") { return out }
                throw fail("expected ',' or '}'")
            }
        }

        mutating func array() throws -> [JSONValue] {
            var out: [JSONValue] = []
            at += 1
            space()
            if at < s.count, s[at] == UInt8(ascii: "]") { at += 1; return out }
            while true {
                space()
                out.append(try value())
                space()
                guard at < s.count else { throw fail("unexpected end") }
                let c = s[at]; at += 1
                if c == UInt8(ascii: ",") { continue }
                if c == UInt8(ascii: "]") { return out }
                throw fail("expected ',' or ']'")
            }
        }

        mutating func hex4() throws -> UInt16 {
            guard at + 4 <= s.count, let v = UInt16(String(decoding: s[at..<at + 4], as: UTF8.self), radix: 16) else { throw fail("bad escape") }
            at += 4
            return v
        }

        mutating func string() throws -> String {
            at += 1
            var bytes: [UInt8] = []
            var units: [UInt16] = []
            func flushUnits() { if !units.isEmpty { bytes += Array(String(decoding: units, as: UTF16.self).utf8); units = [] } }
            while true {
                guard at < s.count else { throw fail("unterminated string") }
                let c = s[at]; at += 1
                if c == UInt8(ascii: "\"") { flushUnits(); return String(decoding: bytes, as: UTF8.self) }
                if c != UInt8(ascii: "\\") { flushUnits(); bytes.append(c); continue }
                guard at < s.count else { throw fail("unterminated string") }
                let e = s[at]; at += 1
                if e == UInt8(ascii: "u") { units.append(try hex4()); continue }
                flushUnits()
                switch e {
                case UInt8(ascii: "\""): bytes.append(0x22)
                case UInt8(ascii: "\\"): bytes.append(0x5C)
                case UInt8(ascii: "/"): bytes.append(0x2F)
                case UInt8(ascii: "b"): bytes.append(0x08)
                case UInt8(ascii: "f"): bytes.append(0x0C)
                case UInt8(ascii: "n"): bytes.append(0x0A)
                case UInt8(ascii: "r"): bytes.append(0x0D)
                case UInt8(ascii: "t"): bytes.append(0x09)
                default: throw fail("bad escape")
                }
            }
        }

        mutating func number() throws -> Double {
            let start = at
            if s[at] == UInt8(ascii: "-") { at += 1 }
            while at < s.count, (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(s[at]) || [UInt8(ascii: "."), UInt8(ascii: "e"), UInt8(ascii: "E"), UInt8(ascii: "+"), UInt8(ascii: "-")].contains(s[at]) { at += 1 }
            guard let d = Double(String(decoding: s[start..<at], as: UTF8.self)) else { throw fail("bad number") }
            return d
        }
    }
}
