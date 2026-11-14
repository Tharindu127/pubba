// Privacy-safe measurement events (SPEC section 8). pubba only emits: no
// storage, no network, no visitor ids, no timestamps. Event fields hold entity
// ids, types, kinds and declared goals; never a query.
import 'model.dart';
import 'text.dart';

/// How a visitor can be guided somewhere, for `guided-to` events.
const List<String> guideVias = ['suggestion', 'chip', 'typed', 'match', 'related'];

/// One measurement event, with the spec's field names.
typedef PubbaEvent = Map<String, Object?>;

class Events {
  final List<String> goals;
  final _listeners = <void Function(PubbaEvent)>[];

  Events({this.goals = const ['contact', 'resume']});

  /// Listen to every event; returns an unsubscribe function. A listener that throws is ignored.
  void Function() on(void Function(PubbaEvent event) listener) {
    _listeners.add(listener);
    return () => _listeners.remove(listener);
  }

  void emit(PubbaEvent event) {
    for (final l in List.of(_listeners)) {
      try {
        l(Map.of(event));
      } catch (_) {
        // Measurement must never break the guide.
      }
    }
  }
}

Events createEvents({List<String> goals = const ['contact', 'resume']}) => Events(goals: goals);

/// One visit's funnel.
class Summary {
  final bool usedGuide;
  final List<String> guidedTo;
  final List<String> guidedToTypes;
  final List<String> reached;
  final bool guidedBeforeGoal;
  const Summary(this.usedGuide, this.guidedTo, this.guidedToTypes, this.reached, this.guidedBeforeGoal);

  Json toJson() => {'usedGuide': usedGuide, 'guidedTo': guidedTo, 'guidedToTypes': guidedToTypes, 'reached': reached, 'guidedBeforeGoal': guidedBeforeGoal};
}

/// Was the guide used, where did it lead, which goals were reached.
Summary summarise(Iterable<PubbaEvent> events) {
  final guidedTo = <String>[], types = <String>[], reached = <String>[];
  var used = false, beforeGoal = false;
  for (final e in events) {
    switch (e['type']) {
      case 'guide-opened':
      case 'matched':
        used = true;
      case 'guided-to':
        used = true;
        final to = e['to'], t = e['entityType'];
        if (to is String && !guidedTo.contains(to)) guidedTo.add(to);
        if (t is String && !types.contains(t)) types.add(t);
      case 'reached':
        final g = e['goal'];
        if (g is String && !reached.contains(g)) reached.add(g);
        if (guidedTo.isNotEmpty) beforeGoal = true;
    }
  }
  return Summary(used, guidedTo, types, reached, beforeGoal);
}

/// The moments a site reports to its measurement, checked so no visitor text gets in.
class Track {
  final Graph _graph;
  final Events? _events;
  Track(this._graph, this._events);

  void guideOpened() => _events?.emit({'type': 'guide-opened'});

  bool guidedTo(String id, String via) {
    final e = _graph.find(id);
    if (_events == null || e == null || !guideVias.contains(via)) return false;
    _events.emit({'type': 'guided-to', 'to': e.id, 'entityType': e.type, 'via': via});
    return true;
  }

  bool reached(String goal) {
    if (_events == null || !_events.goals.contains(goal)) return false;
    _events.emit({'type': 'reached', 'goal': goal});
    return true;
  }
}
