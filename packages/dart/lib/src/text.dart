// Text helpers behind matching (SPEC section 3). Strings are UTF-16 code units,
// as in the JavaScript reference.
import 'fold_table.dart';

/// JavaScript's \s: Unicode white space plus the byte order mark.
const Set<int> _jsSpace = {
  0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, //
  0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
};

bool _isSpace(int u) => _jsSpace.contains(u);
bool _isLower(int u) => u >= 0x61 && u <= 0x7A;
bool _isKept(int u) => _isLower(u) || (u >= 0x30 && u <= 0x39) || u == 0x2B || u == 0x23 || u == 0x2E;

/// Trim like JavaScript's String.prototype.trim.
String jsTrim(String s) {
  var a = 0, b = s.length;
  while (a < b && _isSpace(s.codeUnitAt(a))) {
    a++;
  }
  while (b > a && _isSpace(s.codeUnitAt(b - 1))) {
    b--;
  }
  return s.substring(a, b);
}

/// Runs of white space become one space, then trimmed.
String collapse(String s) {
  final out = StringBuffer();
  var inSpace = false;
  for (final u in s.codeUnits) {
    if (_isSpace(u)) {
      if (!inSpace) out.write(' ');
      inSpace = true;
    } else {
      out.writeCharCode(u);
      inSpace = false;
    }
  }
  return jsTrim(out.toString());
}

/// Lowercase, accents off, punctuation to spaces (keeping + # . for C#, C++, Next.js).
String normalize(String s) {
  final out = StringBuffer();
  for (final r in s.runes) {
    if (r < 0x80) {
      if (r >= 0x41 && r <= 0x5A) {
        out.writeCharCode(r + 32);
      } else if (_isKept(r) || _isSpace(r)) {
        out.writeCharCode(r);
      } else {
        out.write(' ');
      }
    } else {
      out.write(foldTable[r] ?? ' ');
    }
  }
  return collapse(out.toString());
}

int _distance(List<int> a, List<int> b) {
  final d = List.generate(a.length + 1, (_) => List<int>.filled(b.length + 1, 0));
  for (var i = 0; i <= a.length; i++) {
    d[i][0] = i;
  }
  for (var j = 0; j <= b.length; j++) {
    d[0][j] = j;
  }
  for (var i = 1; i <= a.length; i++) {
    for (var j = 1; j <= b.length; j++) {
      final cost = a[i - 1] == b[j - 1] ? 0 : 1;
      var v = d[i - 1][j] + 1;
      if (d[i][j - 1] + 1 < v) v = d[i][j - 1] + 1;
      if (d[i - 1][j - 1] + cost < v) v = d[i - 1][j - 1] + cost;
      if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] && d[i - 2][j - 2] + 1 < v) v = d[i - 2][j - 2] + 1;
      d[i][j] = v;
    }
  }
  return d[a.length][b.length];
}

/// Optimal string alignment: a swap of two neighbouring characters counts once.
int editDistance(String a, String b) => _distance(a.codeUnits, b.codeUnits);

/// Does a typed word mean this word? Exact, plural, prefix, or a near miss.
bool closeTo(String? token, String word, {double typoMinLength = 4}) {
  if (token == null || token.isEmpty) return false;
  if (token == word || token == '${word}s') return true;
  // Short words and names with symbols (go, js, c#, next.js) must match exactly.
  if (word.length < 4 || word.codeUnits.any((u) => !_isLower(u))) return false;
  if (token.startsWith(word)) return true;
  if (token.length < 3 || word.length < typoMinLength) return false;
  final most = word.length >= 7 ? 2 : 1;
  return editDistance(token, word) <= most || (token.length > word.length && editDistance(token.substring(0, word.length), word) <= most);
}

/// Does a normalised query contain this phrase, word by word, typos allowed?
bool hasPhrase(String query, String phrase, {double typoMinLength = 4}) {
  final tokens = query.split(' ');
  final words = phrase.split(' ');
  for (var i = 0; i <= tokens.length - words.length; i++) {
    var all = true;
    for (var j = 0; j < words.length; j++) {
      if (!closeTo(tokens[i + j], words[j], typoMinLength: typoMinLength)) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

/// Does a normalised query contain this normalised name as whole words?
bool containsName(String query, String name) => ' $query '.contains(' $name ');

/// A stable sort: equal elements keep their order, as in JavaScript.
List<T> stableSorted<T>(Iterable<T> items, int Function(T a, T b) compare) {
  final list = items.toList();
  final order = List<int>.generate(list.length, (i) => i);
  order.sort((a, b) {
    final c = compare(list[a], list[b]);
    return c != 0 ? c : a - b;
  });
  return [for (final i in order) list[i]];
}

// JSON-shaped config, read the way JavaScript reads it.
typedef Json = Map<String, dynamic>;

Json obj(dynamic v) => v is Map ? v.cast<String, dynamic>() : const <String, dynamic>{};
double numOr(dynamic v, double fallback) => v is num ? v.toDouble() : fallback;
String? str(dynamic v) => v is String ? v : null;
List<String>? strings(dynamic v) => v is List ? v.whereType<String>().toList() : null;
bool truthy(dynamic v) {
  if (v == null) return false;
  if (v is bool) return v;
  if (v is num) return v != 0 && !v.isNaN;
  if (v is String) return v.isNotEmpty;
  return true;
}
