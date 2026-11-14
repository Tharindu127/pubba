import 'dart:math' as math;

import 'events.dart';
import 'model.dart';
import 'reasons.dart';
import 'text.dart';

const _defaultStopWords = ['the', 'app', 'and', 'for', 'web', 'application', 'mobile', 'portal', 'site', 'website'];
const _defaultSimilar = r'\b(like|similar|alike|same stack|related to|anything else)\b';
const _strong = 50.0;

/// Compares numbers as JavaScript's `a - b` does (so -0 and 0 tie).
int _cmp(double a, double b) => a < b ? -1 : (a > b ? 1 : 0);

class _Settings {
  final Set<String> stop;
  final double typo;
  final bool partial;
  final bool precise;
  final Set<String>? distinct;
  _Settings(this.stop, this.typo, this.partial, this.precise, this.distinct);
}

class _Scored {
  final double score;
  final String by;
  final String name;
  _Scored(this.score, this.by, this.name);
}

List<String> _significant(String name, Set<String> stop) => name.split(' ').where((w) => w.length > 2 && !stop.contains(w)).toList();

double _coverage(String q, String name, double typo) {
  final nameTokens = name.split(' '), queryTokens = q.split(' ');
  final inQuery = nameTokens.where((w) => hasPhrase(q, w, typoMinLength: typo)).length / nameTokens.length;
  final explained = queryTokens.where((t) => nameTokens.any((w) => t == w || hasPhrase(t, w, typoMinLength: typo))).length / queryTokens.length;
  return 0.5 * inQuery + 0.4 * explained;
}

_Scored? _scoreName(String q, String name, bool isAlias, Json m, _Settings s) {
  if (name.isEmpty || name.length < numOr(m['minLength'], 0)) return null;
  bool has(String w) => hasPhrase(q, w, typoMinLength: s.typo);
  if ((str(m['mode']) ?? 'title') == 'phrase') {
    if (name.length < 2 || !has(name)) return null;
    final exact = !s.precise || containsName(q, name);
    return _Scored((exact ? 100 : 95) + name.length.toDouble(), isAlias ? 'alias' : 'phrase', name);
  }
  if (containsName(q, name)) return _Scored(100 + name.length.toDouble(), isAlias ? 'alias' : 'name', name);
  if (s.precise && name.contains(' ') && has(name)) return _Scored(95 + name.length.toDouble(), isAlias ? 'alias' : 'name', name);
  final words = _significant(name, s.stop);
  final hits = words.where(has).length;
  if (hits > 0 && hits == words.length && words.join().length > numOr(m['minWordsLength'], 0)) {
    return _Scored(50 + hits + (s.precise ? _coverage(q, name, s.typo) : 0), 'words', name);
  }
  if (s.partial && words.length >= 3 && hits >= 2 && hits == words.length - 1) return _Scored(40.0 + hits, 'words', name);
  if (s.distinct != null) {
    for (final w in words) {
      if (w.length >= 5 && s.distinct!.contains(w) && hasPhrase(q, w, typoMinLength: double.infinity)) return _Scored(25, 'distinct-word', w);
    }
  }
  final first = words.isEmpty ? null : words.first;
  if (truthy(m['firstWord']) && first != null && first.length > 3 && has(first)) return _Scored(20, 'first-word', first);
  return null;
}

/// Why an entity lights up for a trail: the strongest single contribution.
class Why {
  final Link link;
  final String from;
  final String seed;
  final double part;
  const Why(this.link, this.from, this.seed, this.part);
}

/// How brightly each entity lights up for a trail (maps keep the order entities lit up).
class Spread {
  final Map<String, double> score;
  final Map<String, Why> why;
  final Map<String, double> seeds;
  final Set<String> sectionOnly;
  const Spread(this.score, this.why, this.seeds, this.sectionOnly);
}

/// Answers from one graph: related items, what next, matching, sentences, measurement.
class Pubba {
  final Graph graph;
  final Events? _events;
  final Track track;
  late final RegExp _similarRe = RegExp(str(obj(graph.config['match'])['similarPattern']) ?? _defaultSimilar);

  Pubba(this.graph, [this._events]) : track = Track(graph, _events);

  Entity? get(String id) => graph.entities[id];

  /// The same graph, reporting to these events.
  Pubba withEvents(Events? events) => Pubba(graph, events);

  void _suggested(String source, List<String> ids, List<String> kinds) {
    if (_events == null || ids.isEmpty) return;
    _events.emit({'type': 'suggested', 'source': source, 'ids': ids, 'reasonKinds': kinds.toSet().toList()});
  }

  // --- matching

  /// Every entity a query could mean, best first.
  List<Match> search(String query, {int limit = 10, List<String>? types, Map<String, Object>? templates}) {
    final q = normalize(query);
    if (q.isEmpty) return [];
    final mc = obj(graph.config['match']);
    final s = _Settings(
      (strings(mc['stopWords']) ?? _defaultStopWords).toSet(),
      numOr(mc['typoMinLength'], 4),
      truthy(mc['partialWords']),
      truthy(mc['precise']),
      truthy(mc['distinctWords']) ? graph.distinctWords : null,
    );
    final ignore = (strings(mc['ignore']) ?? const []).map(normalize).where((w) => w.isNotEmpty).toList();
    final out = <Match>[];
    for (final entity in graph.allEntities) {
      if (types != null && !types.contains(entity.type)) continue;
      final m = obj(graph.typeConfig(entity.type)['match']);
      if (truthy(m['skip'])) continue;
      _Scored? best;
      for (final (raw, isAlias) in [(entity.label, false), for (final a in entity.aliases) (a, true)]) {
        final name = normalize(raw);
        if (ignore.any(name.contains)) continue;
        final sc = _scoreName(q, name, isAlias, m, s);
        if (sc != null && (best == null || sc.score > best.score)) best = sc;
      }
      if (best == null) continue;
      final reason = Reason('match', by: best.by, name: best.name);
      out.add(Match(entity, best.score, numOr(m['tier'], 1).toInt(), reason, renderReason(graph, reason, entity, templates)));
    }
    int weak(Match x) => s.precise && x.score < _strong ? 1 : 0;
    return stableSorted(out, (Match a, Match b) {
      if (weak(a) != weak(b)) return weak(a) - weak(b);
      if (a.tier != b.tier) return a.tier - b.tier;
      return _cmp(b.score, a.score);
    }).take(limit).toList();
  }

  /// What a query means: one entity, things like one, or nothing here.
  MatchResult match(String query, {int similarLimit = 3, Map<String, Object>? templates}) {
    final result = _matchQuietly(query, similarLimit, templates);
    if (_events != null) {
      final by = result.match?.reason.by;
      _events.emit({
        'type': 'matched',
        'intent': result.intent,
        if (result.entity != null) 'entityType': result.entity!.type,
        if (by != null && by.isNotEmpty) 'by': by,
      });
    }
    return result;
  }

  MatchResult _matchQuietly(String query, int similarLimit, Map<String, Object>? templates) {
    final found = search(query, limit: 1, templates: templates);
    final best = found.isEmpty ? null : found.first;
    final q = normalize(query);
    final mc = obj(graph.config['match']);
    final typo = numOr(mc['typoMinLength'], 4);
    (String, String)? missing;
    for (final raw in strings(mc['notHere']) ?? const <String>[]) {
      final name = normalize(raw);
      if (name.isNotEmpty && hasPhrase(q, name, typoMinLength: typo) && (missing == null || name.length > missing.$2.length)) missing = (raw, name);
    }
    if (missing != null) {
      final bestName = best == null ? null : ((best.reason.name ?? '').isEmpty ? normalize(best.entity.label) : best.reason.name!);
      if (bestName == null || missing.$2.length > bestName.length) return MatchResult(query, 'none', notHere: missing.$1);
    }
    if (best == null) return MatchResult(query, 'none');
    final kinds = graph.typeConfig(best.entity.type)['similar'];
    if (kinds != false && _similarRe.hasMatch(q)) {
      final similar = _neighbours(best.entity.id, strings(kinds)).where((p) => graph.isDestination(p.$1)).take(similarLimit).map((p) {
        final r = reasonFromLink(p.$2, p.$1.id);
        return Related(p.$1, p.$2.weight, p.$2, r, renderReason(graph, r, p.$1, templates));
      }).toList();
      if (similar.isNotEmpty) return MatchResult(query, 'similar', entity: best.entity, match: best, similar: similar);
    }
    return MatchResult(query, 'entity', entity: best.entity, match: best);
  }

  // --- related and next

  List<(Entity, Link)> _neighbours(String id, List<String>? kinds) {
    final out = <(Entity, Link)>[];
    for (final l in graph.adjacent[id] ?? const <Link>[]) {
      if (kinds != null && !kinds.contains(l.kind)) continue;
      final e = graph.entities[l.otherEnd(id)];
      if (e != null) out.add((e, l));
    }
    return stableSorted(out, ((Entity, Link) a, (Entity, Link) b) => _cmp(b.$2.weight, a.$2.weight));
  }

  /// What is related to one entity, strongest link first, each with why.
  List<Related> related(String id,
      {List<String>? kinds, int? limit, bool destinationsOnly = true, bool Function(Entity)? accept, Map<String, Object>? templates}) {
    var pairs = stableSorted(_neighbours(id, kinds), ((Entity, Link) a, (Entity, Link) b) {
      final w = _cmp(b.$2.weight, a.$2.weight);
      return w != 0 ? w : _cmp(graph.pull(b.$2.kind), graph.pull(a.$2.kind));
    }).where((p) => (!destinationsOnly || graph.isDestination(p.$1)) && (accept == null || accept(p.$1))).toList();
    if (limit != null) pairs = pairs.take(limit).toList();
    final out = pairs.map((p) {
      final r = reasonFromLink(p.$2, p.$1.id);
      return Related(p.$1, p.$2.weight, p.$2, r, renderReason(graph, r, p.$1, templates));
    }).toList();
    _suggested('related', [for (final x in out) x.entity.id], [for (final x in out) x.reason.kind]);
    return out;
  }

  /// How brightly each entity lights up for this trail, with the strongest reason for each.
  Spread spread(List<String> trail) {
    final cfg = obj(graph.config['next']);
    final recency = numOr(cfg['recency'], 0.6);
    final second = numOr(cfg['secondStep'], 0.4);
    final hub = numOr(cfg['hubDamping'], 3);
    final boost = numOr(cfg['sectionBoost'], 0.08);
    final sections = obj(cfg['sections']);
    final score = <String, double>{};
    final why = <String, Why>{};
    final sectionOnly = <String>{};

    void give(String id, double part, Link link, String src, String seed) {
      score[id] = (score[id] ?? 0) + part;
      if (part > (why[id]?.part ?? 0)) why[id] = Why(link, src, seed, part);
    }

    final seeds = <String, double>{};
    for (final id in trail.reversed) {
      if (!seeds.containsKey(id)) seeds[id] = math.pow(recency, seeds.length).toDouble();
    }
    for (final MapEntry(key: seed, value: w) in seeds.entries) {
      if (seed.startsWith('section:')) {
        final type = str(sections[seed.substring(8)]);
        if (type == null || type.isEmpty) continue;
        for (final e in graph.entities.values) {
          if (e.type != type) continue;
          score[e.id] = (score[e.id] ?? 0) + w * boost * math.min(1, graph.degree(e.id) / 8);
          sectionOnly.add(e.id);
        }
        continue;
      }
      for (final l1 in graph.adjacent[seed] ?? const <Link>[]) {
        final mid = l1.otherEnd(seed);
        final a = w * l1.weight * graph.pull(l1.kind);
        give(mid, a, l1, seed, seed);
        final carry = (a * second) / math.sqrt(1 + graph.degree(mid) / hub);
        for (final l2 in graph.adjacent[mid] ?? const <Link>[]) {
          final far = l2.otherEnd(mid);
          if (far == seed) continue;
          give(far, carry * l2.weight * graph.pull(l2.kind), l2, mid, seed);
        }
      }
    }
    return Spread(score, why, seeds, sectionOnly);
  }

  /// The next things to suggest after this trail: unseen, worth going to, and mixed.
  List<Suggestion> next(List<String> trail,
      {int limit = 3, List<String> exclude = const [], bool Function(Entity)? accept, Map<String, Object>? templates}) {
    final sp = spread(trail);
    final skip = {...sp.seeds.keys, ...exclude};
    final ranked = <(Entity, double, Why?)>[];
    for (final MapEntry(key: id, value: s) in sp.score.entries) {
      final e = graph.entities[id];
      if (e == null) continue;
      if (!(sp.why.containsKey(id) || sp.sectionOnly.contains(id)) || !graph.isDestination(e) || skip.contains(id) || (accept != null && !accept(e))) continue;
      ranked.add((e, s, sp.why[id]));
    }
    final byScore = stableSorted(ranked, ((Entity, double, Why?) a, (Entity, double, Why?) b) => _cmp(b.$2, a.$2));
    final cap = math.max(1, limit - 1);
    final taken = <int>[];
    final perType = <String, int>{};
    for (var i = 0; i < byScore.length; i++) {
      if (taken.length == limit) break;
      final t = byScore[i].$1.type;
      if ((perType[t] ?? 0) >= cap) continue;
      perType[t] = (perType[t] ?? 0) + 1;
      taken.add(i);
    }
    for (var i = 0; i < byScore.length; i++) {
      if (taken.length < limit && !taken.contains(i)) taken.add(i);
    }
    final chosen = stableSorted([for (final i in taken) byScore[i]], ((Entity, double, Why?) a, (Entity, double, Why?) b) => _cmp(b.$2, a.$2));
    final out = [
      for (final (e, s, w) in chosen)
        () {
          final reason = w != null ? reasonFromLink(w.link, e.id, w.seed) : const Reason('section');
          return Suggestion(e, s, reason, renderReason(graph, reason, e, templates));
        }(),
    ];
    _suggested('next', [for (final x in out) x.entity.id], [for (final x in out) x.reason.kind]);
    return out;
  }

  /// Type-ahead: names that start with (or contain) what's typed, nearest the trail first.
  List<Suggestion> autocomplete(String typed,
      {List<String> trail = const [], int limit = 3, bool Function(Entity)? accept, Map<String, Object>? templates}) {
    final q = normalize(typed);
    if (q.length < 2) return [];
    final near = spread(trail).score;
    final hits = <(Entity, String, double)>[];
    for (final e in graph.entities.values) {
      if (!graph.isDestination(e) || (accept != null && !accept(e))) continue;
      final name = normalize(e.label);
      final kind = name.startsWith(q)
          ? 3
          : name.split(' ').any((w) => w.startsWith(q))
              ? 2
              : (q.length >= 3 && name.contains(q))
                  ? 1
                  : 0;
      if (kind == 0) continue;
      final by = kind == 3 ? 'prefix' : (kind == 2 ? 'word-prefix' : 'contains');
      hits.add((e, by, kind * 10 + (near[e.id] ?? 0) * 5 + math.min(graph.degree(e.id), 20) / 20));
    }
    return stableSorted(hits, ((Entity, String, double) a, (Entity, String, double) b) => _cmp(b.$3, a.$3)).take(limit).map((h) {
      final reason = Reason('typed', by: h.$2);
      return Suggestion(h.$1, h.$3, reason, renderReason(graph, reason, h.$1, templates));
    }).toList();
  }

  /// A reason as a sentence, for an [Entity] or an entity id.
  String explain(Reason reason, Object item, {Map<String, Object>? templates}) {
    final e = item is Entity ? item : graph.entities[item as String];
    if (e == null) throw ArgumentError('pubba: no entity $item');
    return renderReason(graph, reason, e, templates);
  }
}

/// Answers from a compiled bundle (`pubba compile`): JSON text or decoded JSON.
Pubba loadBundle(Object bundle, {Events? events}) => Pubba(Graph.fromBundle(bundle), events);
