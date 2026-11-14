import 'dart:convert';

import 'text.dart';

/// The bundle format this runtime reads.
const int bundleFormat = 1;

/// One thing on the site or in the app: a project, a skill, a product, a page.
class Entity {
  final String id;
  final String type;
  final String label;
  final String? short;
  final List<String> aliases;
  final String? url;
  final String? text;
  final Json? data;

  const Entity({required this.id, required this.type, required this.label, this.short, this.aliases = const [], this.url, this.text, this.data});

  /// How it reads inside a sentence.
  String get shortLabel => short ?? label;

  @override
  String toString() => 'Entity($id)';
}

/// A typed, weighted link between two entities.
class Link {
  final String from;
  final String kind;
  final String to;
  final double weight;
  final List<String>? via;
  final String? rule;

  const Link(this.from, this.kind, this.to, this.weight, {this.via, this.rule});

  String otherEnd(String id) => from == id ? to : from;
}

/// Why something was suggested or matched, as data. [Pubba.explain] turns it into a sentence.
class Reason {
  final String kind;
  final String? to;
  final String? direction;
  final List<String>? via;
  final String? seed;
  final String? by;
  final String? name;

  const Reason(this.kind, {this.to, this.direction, this.via, this.seed, this.by, this.name});

  /// The reason as JSON, absent fields left out.
  Json toJson() => {
        'kind': kind,
        if (to != null) 'to': to,
        if (direction != null) 'direction': direction,
        if (via != null) 'via': via,
        if (seed != null) 'seed': seed,
        if (by != null) 'by': by,
        if (name != null) 'name': name,
      };

  factory Reason.fromJson(Json m) => Reason(m['kind'] as String,
      to: str(m['to']), direction: str(m['direction']), via: strings(m['via']), seed: str(m['seed']), by: str(m['by']), name: str(m['name']));

  @override
  String toString() => 'Reason(${jsonEncode(toJson())})';
}

class Suggestion {
  final Entity entity;
  final double score;
  final Reason reason;
  final String text;
  const Suggestion(this.entity, this.score, this.reason, this.text);
}

class Related {
  final Entity entity;
  final double weight;
  final Link link;
  final Reason reason;
  final String text;
  const Related(this.entity, this.weight, this.link, this.reason, this.text);
}

class Match {
  final Entity entity;
  final double score;
  final int tier;
  final Reason reason;
  final String text;
  const Match(this.entity, this.score, this.tier, this.reason, this.text);
}

/// What a query means: [intent] is "entity", "similar" or "none".
class MatchResult {
  final String query;
  final String intent;
  final Entity? entity;
  final Match? match;
  final List<Related> similar;
  final String? notHere;
  const MatchResult(this.query, this.intent, {this.entity, this.match, this.similar = const [], this.notHere});
}

/// A sentence template written in code, for wording a bundle's string templates can't express.
typedef TemplateFn = String Function(Reason reason, Entity item, Entity? other);

/// The graph inside a bundle: linked entities, unlinked ones (matchable, never suggested), links and config.
class Graph {
  final Map<String, Entity> entities;
  final Map<String, Entity> unlinked;
  final List<Link> links;
  final Map<String, List<Link>> adjacent;
  final Json config;
  final Set<String> distinctWords;

  Graph._(this.entities, this.unlinked, this.links, this.adjacent, this.config, this.distinctWords);

  /// The graph inside a bundle (JSON text, or already decoded), after checking it is one this runtime can read.
  factory Graph.fromBundle(Object bundle) {
    final b = bundle is String ? jsonDecode(bundle) : bundle;
    if (b is! Map || b['format'] is! num || b['entities'] is! List || b['links'] is! List) throw const FormatException('pubba: not a pubba bundle');
    final format = b['format'] as num;
    if (format.floor() > bundleFormat) {
      throw FormatException('pubba: bundle format $format is newer than this runtime reads ($bundleFormat); upgrade pubba');
    }
    final links = [
      for (final l in (b['links'] as List).cast<Map>())
        Link(l['from'] as String, l['kind'] as String, l['to'] as String, (l['weight'] as num).toDouble(), via: strings(l['via']), rule: str(l['rule'])),
    ];
    final adjacent = <String, List<Link>>{};
    for (final l in links) {
      adjacent.putIfAbsent(l.from, () => []).add(l);
      adjacent.putIfAbsent(l.to, () => []).add(l);
    }
    final linked = <String, Entity>{};
    final unlinked = <String, Entity>{};
    for (final raw in [...b['entities'] as List, ...(b['unlinked'] is List ? b['unlinked'] as List : const [])]) {
      if (raw is! Map) continue;
      final e = Entity(
        id: raw['id'] as String,
        type: raw['type'] as String,
        label: raw['label'] as String,
        short: str(raw['short']),
        aliases: strings(raw['aliases']) ?? const [],
        url: str(raw['url']),
        text: str(raw['text']),
        data: raw['data'] is Map ? (raw['data'] as Map).cast<String, dynamic>() : null,
      );
      (adjacent.containsKey(e.id) ? linked : unlinked)[e.id] = e;
    }
    return Graph._(linked, unlinked, links, adjacent, obj(b['config']), (strings(obj(b['index'])['distinctWords']) ?? const []).toSet());
  }

  List<Entity> get allEntities => [...entities.values, ...unlinked.values];

  Entity? find(String id) => entities[id] ?? unlinked[id];

  int degree(String id) => adjacent[id]?.length ?? 0;

  Json typeConfig(String type) => obj(obj(config['types'])[type]);

  bool isDestination(Entity e) => typeConfig(e.type)['destination'] != false;

  double pull(String kind) => numOr(obj(obj(config['kinds'])[kind])['pull'], 0.5);

  String kindLabel(String kind) => str(obj(obj(config['kinds'])[kind])['label']) ?? kind.replaceAll('-', ' ');
}
