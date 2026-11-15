// Intent profiles (SPEC 5.7, 5.8): a guess at why this visit is happening, from
// the trail alone. Once one intent is likely, it leans suggestions towards what
// it boosts, within 0.5-2x, so it reorders but never hides. Nothing is stored.
import 'dart:math' as math;

import 'model.dart';
import 'text.dart';

/// A trail step that pointed to an intent; [via] is the neighbour it pointed through, when that counted more.
class IntentEvidence {
  final String step;
  final String? via;
  final double weight;
  const IntentEvidence(this.step, this.via, this.weight);

  Json toJson() => {'step': step, if (via != null) 'via': via, 'weight': weight};
}

/// Why a visit is likely happening: [likely] is null while browsing, with too few steps, or with no intents.
class IntentReading {
  final String? likely;
  final double confidence;

  /// Each intent's share, then `browsing`'s.
  final Map<String, double> scores;

  /// The steps behind the top intent.
  final List<IntentEvidence> evidence;
  const IntentReading(this.likely, this.confidence, this.scores, this.evidence);

  Json toJson() => {'likely': likely, 'confidence': confidence, 'scores': scores, 'evidence': [for (final e in evidence) e.toJson()]};
}

/// The configured intents, in order ("browsing" is reserved).
List<(String, Json)> intentsOf(Graph g) => [
      for (final MapEntry(:key, :value) in obj(g.config['intents']).entries)
        if (key != 'browsing' && value is Map) (key, value.cast<String, dynamic>()),
    ];

Json? _find(Graph g, String intent) {
  for (final (id, c) in intentsOf(g)) {
    if (id == intent) return c;
  }
  return null;
}

/// Why this visit is likely happening, from the trail alone.
IntentReading readIntent(Graph g, List<String> trail) {
  final intents = intentsOf(g);
  final settings = obj(g.config['intent']);
  final minConfidence = numOr(settings['minConfidence'], 0.5);
  final minSteps = numOr(settings['minSteps'], 2);
  final share = numOr(settings['neighbours'], 0.5);
  final next = obj(g.config['next']);
  final recency = numOr(next['recency'], 0.6);
  final sections = obj(next['sections']);

  final seeds = <String, double>{};
  for (final id in trail.reversed) {
    if (!seeds.containsKey(id)) seeds[id] = math.pow(recency, seeds.length).toDouble();
  }
  var steps = 0;
  for (final id in seeds.keys) {
    if (!id.startsWith('section:') && g.find(id) != null) steps++;
  }

  final raw = <double>[];
  final evidence = <List<IntentEvidence>>[];
  for (final (_, intent) in intents) {
    final signals = obj(intent['signals']);
    final e = obj(signals['entities']), t = obj(signals['types']), k = obj(signals['kinds']);
    var sum = 0.0;
    final ev = <IntentEvidence>[];
    for (final MapEntry(key: step, value: w) in seeds.entries) {
      double part;
      String? via;
      if (step.startsWith('section:')) {
        final type = str(sections[step.substring(8)]);
        if (type == null || type.isEmpty) continue;
        part = w * numOr(t[type], 0);
      } else {
        final entity = g.find(step);
        if (entity == null) continue;
        final self = numOr(e[entity.id], 0) + numOr(t[entity.type], 0);
        var best = 0.0;
        String? bestVia;
        for (final l in g.adjacent[step] ?? const <Link>[]) {
          final n = l.otherEnd(step);
          final v = l.weight * (numOr(e[n], 0) + numOr(k[l.kind], 0));
          if (v > best) {
            best = v;
            bestVia = n;
          }
        }
        final near = share * best;
        if (near > self) via = bestVia;
        part = w * (self + near);
      }
      sum += part;
      if (part > 0) ev.add(IntentEvidence(step, via, part));
    }
    raw.add(math.max(0.0, sum));
    evidence.add(ev);
  }

  var sumRaw = 0.0;
  for (final r in raw) {
    sumRaw += r;
  }
  final total = 1 + sumRaw;
  final scores = <String, double>{};
  var top = -1;
  for (var i = 0; i < intents.length; i++) {
    scores[intents[i].$1] = raw[i] / total;
    if (top < 0 || raw[i] > raw[top]) top = i;
  }
  scores['browsing'] = 1 / total;
  final confidence = top < 0 ? 0.0 : raw[top] / total;
  final likely = top >= 0 && raw[top] > 0 && confidence >= minConfidence && steps >= minSteps ? intents[top].$1 : null;
  return IntentReading(likely, confidence, scores, top < 0 ? const [] : evidence[top]);
}

/// The intent to apply: "auto" works it out from the trail, an id names one, null is none.
String? resolveIntent(Graph g, List<String> trail, String? option) {
  if (option == null || intentsOf(g).isEmpty) return null;
  if (option == 'auto') return readIntent(g, trail).likely;
  return _find(g, option) != null ? option : null;
}

/// How much an intent leans towards an entity reached by a link: clamped to 0.5-2.
double intentBoost(Graph g, String intent, Entity e, Link? link) {
  final b = obj(_find(g, intent)?['boost']);
  final v = numOr(obj(b['types'])[e.type], 1) * numOr(obj(b['entities'])[e.id], 1) * (link != null ? numOr(obj(b['kinds'])[link.kind], 1) : 1);
  return math.min(2.0, math.max(0.5, v));
}

/// An intent's label, for the `{intent}` token.
String intentLabel(Graph g, String intent) => str(_find(g, intent)?['label']) ?? intent;
