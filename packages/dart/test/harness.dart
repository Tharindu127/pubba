// The conformance harness for Dart: runs a case and returns its answer as JSON (see conformance/README.md).
import 'package:pubba/pubba.dart';

Map<String, dynamic> _chip(GuideChip c) => switch (c) {
      QuestionChip q => {'label': q.label, 'question': q.question},
      EntityChip e => {'id': e.id, 'label': e.label, if (e.url != null) 'url': e.url, 'reason': e.reason.toJson(), 'text': e.text},
    };

Map<String, dynamic>? _reply(Reply? r) {
  if (r == null) return null;
  return {
    'kind': r.kind,
    'text': r.text,
    if (r.action != null) 'action': {'type': r.action!.type, 'id': r.action!.id, if (r.action!.url != null) 'url': r.action!.url},
    'chips': r.chips.map(_chip).toList(),
    if (r.match != null)
      'match': {'id': r.match!.entity.id, 'score': r.match!.score, 'tier': r.match!.tier, 'by': r.match!.reason.by, 'name': r.match!.reason.name},
    if (r.similar != null) 'similar': r.similar!.map(_chip).toList(),
  };
}

Map<String, dynamic> _weighted(Related x) => {'id': x.entity.id, 'weight': x.weight, 'reason': x.reason.toJson(), 'text': x.text};
Map<String, dynamic> _scored(Suggestion x) => {'id': x.entity.id, 'score': x.score, 'reason': x.reason.toJson(), 'text': x.text};

List<String>? _strs(dynamic v) => v is List ? v.cast<String>() : null;

Map<String, dynamic> _runGuide(Pubba base, List steps, Map? o) {
  var clock = 0.0;
  final events = createEvents(goals: ['contact']);
  final emitted = <Map<String, Object?>>[];
  events.on(emitted.add);
  bool Function(Entity)? accept;
  final hide = o?['hide'];
  if (hide is List) {
    accept = (e) {
      final label = e.label.toLowerCase();
      return !hide.any((r) {
        final types = _strs(r['types']) ?? [], ids = _strs(r['ids']) ?? [];
        final inc = _strs(r['labelIncludes']) ?? [], ends = _strs(r['labelEndsWith']) ?? [];
        return (types.isEmpty || types.contains(e.type)) &&
            (ids.isEmpty || ids.contains(e.id)) &&
            (inc.isEmpty || inc.any(label.contains)) &&
            (ends.isEmpty || ends.any(label.endsWith));
      });
    };
  }
  List<GuideChip>? Function(FallbackContext)? fallback;
  final fb = o?['fallback'];
  if (fb is Map) {
    fallback = (ctx) {
      final v = ctx.kind == 'open' && ctx.entity != null ? (fb['open.${ctx.entity!.type}'] ?? fb['open']) : fb[ctx.kind];
      return v is List ? [for (final s in v) QuestionChip(s as String)] : null;
    };
  }
  final lines = o?['lines'];
  final avoid = _strs(o?['nudgeAvoids']);
  final guide = createGuide(
    base.withEvents(events),
    chips: o?['chips'] is num ? (o!['chips'] as num).toInt() : 3,
    accept: accept,
    fallback: fallback,
    line: lines is Map ? (e) => lines[e.id] as String? : null,
    templates: o?['templates'] is Map ? (o!['templates'] as Map).cast<String, String>() : const {},
    prefer: avoid == null ? null : (e) => !avoid.contains(e.type),
    now: () => clock,
  );
  final answers = <dynamic>[];
  for (final s in steps.cast<Map>()) {
    switch (s['op']) {
      case 'visited':
        guide.visited(s['id']);
        answers.add(null);
      case 'follow':
        guide.follow(s['id'], s['via']);
        answers.add(null);
      case 'ask':
        answers.add(_reply(guide.ask(s['question'])));
      case 'nudge':
        answers.add(_reply(guide.nudge()));
      case 'chips':
        answers.add(guide.chips(s['limit'] is num ? (s['limit'] as num).toInt() : null).map(_chip).toList());
      case 'tick':
        clock += (s['ms'] as num).toDouble();
        answers.add(null);
      case 'opened':
        guide.opened();
        answers.add(null);
      case 'reached':
        guide.reached(s['goal']);
        answers.add(null);
    }
  }
  return {'answers': answers, 'trail': guide.trail.get(), 'events': emitted};
}

dynamic run(Pubba pubba, Map c) {
  switch (c['op']) {
    case 'match':
      final m = pubba.match(c['query']);
      return {
        'intent': m.intent,
        'entity': m.entity?.id,
        if (m.match != null) ...{'score': m.match!.score, 'tier': m.match!.tier, 'by': m.match!.reason.by, 'name': m.match!.reason.name, 'text': m.match!.text},
        'similar': m.similar.map(_weighted).toList(),
        if (m.notHere != null) 'notHere': m.notHere,
      };
    case 'search':
      return [
        for (final m in pubba.search(c['query'], limit: (c['limit'] as num).toInt()))
          {'id': m.entity.id, 'score': m.score, 'tier': m.tier, 'by': m.reason.by, 'name': m.reason.name},
      ];
    case 'next':
      return pubba.next(_strs(c['trail'])!, limit: (c['limit'] as num).toInt(), exclude: _strs(c['exclude']) ?? const []).map(_scored).toList();
    case 'related':
      return pubba.related(c['id'], kinds: _strs(c['kinds']), limit: c['limit'] is num ? (c['limit'] as num).toInt() : null).map(_weighted).toList();
    case 'autocomplete':
      return [
        for (final s in pubba.autocomplete(c['typed'], trail: _strs(c['trail'])!, limit: (c['limit'] as num).toInt()))
          {'id': s.entity.id, 'score': s.score, 'by': s.reason.by},
      ];
    case 'explain':
      return pubba.explain(Reason.fromJson((c['reason'] as Map).cast<String, dynamic>()), c['item'] as String);
    case 'guide':
      return _runGuide(pubba, c['steps'] as List, c['options'] as Map?);
  }
  throw ArgumentError('unknown op ${c['op']}');
}

/// Equal as JSON, numbers to 1e-9. The path of the first difference, or null.
String? diff(dynamic a, dynamic b, [String path = r'$']) {
  if (a is num && b is num) return (a - b).abs() <= 1e-9 ? null : '$path: $a != $b';
  if (a is List || b is List) {
    if (a is! List || b is! List) return '$path: list vs not';
    if (a.length != b.length) return '$path: length ${a.length} != ${b.length}';
    for (var i = 0; i < a.length; i++) {
      final d = diff(a[i], b[i], '$path[$i]');
      if (d != null) return d;
    }
    return null;
  }
  if (a is Map && b is Map) {
    final ka = a.keys.map((k) => '$k').toList()..sort();
    final kb = b.keys.map((k) => '$k').toList()..sort();
    if (ka.join('\u0000') != kb.join('\u0000')) return '$path: keys $ka != $kb';
    for (final k in ka) {
      final d = diff(a[k], b[k], '$path.$k');
      if (d != null) return d;
    }
    return null;
  }
  return a == b ? null : '$path: $a != $b';
}
