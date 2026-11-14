import 'model.dart';
import 'text.dart';

/// Sentences (SPEC section 6). Template values: a String, a JSON-shaped map (cases, out, in, default) or a [TemplateFn].
const Map<String, Object> defaultTemplates = {
  'section': '{item} is worth a look.',
  'typed': '{item} matches what you typed.',
  'match': '{item} matches “{name}”.',
};

final _token = RegExp(r'\{(\w+)\}');
final _optional = RegExp(r'\[([^\]]*)\]');

/// The reason a link gives for the entity at one of its ends.
Reason reasonFromLink(Link link, String itemId, [String? seed]) {
  final to = link.otherEnd(itemId);
  return Reason(
    link.kind,
    to: to,
    direction: link.from == itemId ? 'out' : 'in',
    via: (link.via?.isEmpty ?? true) ? null : link.via,
    seed: (seed == null || seed.isEmpty || seed == to) ? null : seed,
  );
}

String _fill(String text, Map<String, String> values) {
  final kept = text.replaceAllMapped(_optional, (m) {
    final inner = m[1]!;
    return _token.allMatches(inner).every((t) => (values[t[1]!] ?? '').isNotEmpty) ? inner : '';
  });
  return kept.replaceAllMapped(_token, (m) => values[m[1]!] ?? '');
}

String? _pick(Object t, Reason reason, Entity item, Entity? other) {
  if (t is String) return t;
  if (t is TemplateFn) return t(reason, item, other);
  if (t is! Map) return null;
  final m = t.cast<String, dynamic>();
  for (final c in (m['cases'] is List ? m['cases'] as List : const [])) {
    if (c is! Map) continue;
    final ci = str(c['item']) ?? '', co = str(c['other']) ?? '', cd = str(c['direction']) ?? '';
    if ((ci.isEmpty || ci == item.type) && (co.isEmpty || (other != null && co == other.type)) && (cd.isEmpty || cd == reason.direction)) {
      return str(c['text']);
    }
  }
  if (reason.direction == 'out' && (str(m['out']) ?? '').isNotEmpty) return m['out'] as String;
  if (reason.direction == 'in' && (str(m['in']) ?? '').isNotEmpty) return m['in'] as String;
  for (final k in const ['default', 'out', 'in']) {
    final s = str(m[k]);
    if (s != null) return s;
  }
  return null;
}

/// A reason as one sentence.
String renderReason(Graph g, Reason reason, Entity item, [Map<String, Object>? templates]) {
  final every = <String, Object?>{...defaultTemplates, ...obj(g.config['templates']), ...?templates};
  final other = (reason.to == null || reason.to!.isEmpty) ? null : g.entities[reason.to!];
  final t = every['${reason.kind}.${item.type}'] ?? every[reason.kind];
  var text = (t != null && truthy(t)) ? _pick(t, reason, item, other) : null;
  text ??= other != null
      ? (reason.direction == 'in' ? '{other}: {kind} {item}[ ({via})].' : '{item}: {kind} {other}[ ({via})].')
      : '{item} is worth a look.';
  if (t is TemplateFn) return text;
  final otherLabel = other?.shortLabel ?? '';
  return _fill(text, {
    'item': item.shortLabel,
    'other': otherLabel,
    'otherLower': otherLabel.toLowerCase(),
    'via': (reason.via ?? const []).take(3).join(', '),
    'kind': g.kindLabel(reason.kind),
    'name': reason.name ?? '',
  });
}
