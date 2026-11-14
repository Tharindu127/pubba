// The headless guide (SPEC section 9): replies, chips, the trail and nudges, with no UI.
import 'model.dart';
import 'pubba.dart';
import 'text.dart';
import 'trail.dart';

const Map<String, String> defaultGuideTemplates = {
  'open': "Here's {item}.",
  'similar': '{reason}',
  'none': "I couldn't find that here. These might help:",
  'notHere': "{name} isn't here. These might help:",
  'start': 'Where would you like to start?',
  'nudge': '{reason} Want a look?',
};

final _token = RegExp(r'\{(\w+)\}');

/// A follow-up button: a place to go ([EntityChip]) or a question to ask the guide ([QuestionChip]).
sealed class GuideChip {
  String get label;
}

/// A place to go, with why.
class EntityChip implements GuideChip {
  final String id;
  @override
  final String label;
  final Reason reason;
  final String text;
  final String? url;
  const EntityChip(this.id, this.label, this.reason, this.text, [this.url]);
}

/// A question to ask the guide (`guide.ask(question)` when tapped).
class QuestionChip implements GuideChip {
  @override
  final String label;
  final String question;
  const QuestionChip(this.label, [String? question]) : question = question ?? label;
}

/// Navigate to an entity: [url] is the route the guide's `route` gave it, if any.
class GuideAction {
  final String type = 'open';
  final String id;
  final String? url;
  const GuideAction(this.id, [this.url]);
}

/// A reply: [kind] is "open", "similar", "none", "not-here" or "start". Show [text] and [chips]; perform [action].
class Reply {
  final String kind;
  final String text;
  final List<GuideChip> chips;
  final GuideAction? action;
  final Match? match;
  final List<EntityChip>? similar;
  const Reply(this.kind, this.text, {this.chips = const [], this.action, this.match, this.similar});
}

class NudgePolicy {
  final double delayMs;
  final double gapMs;
  final double minScore;
  const NudgePolicy({this.delayMs = 9000, this.gapMs = 60000, this.minScore = 0.3});
}

/// What a fallback is asked for: kind "start", "none", "not-here", "open" (with the entity) or "chips".
class FallbackContext {
  final String kind;
  final Entity? entity;
  const FallbackContext(this.kind, [this.entity]);
}

String _fill(String text, Map<String, String> values) => collapse(text.replaceAllMapped(_token, (m) => values[m[1]!] ?? ''));

/// The navigator: a typed question becomes a reply; steps are recorded; nudges come at the right moments.
class Guide {
  final Pubba pubba;
  final Trail trail;
  final NudgePolicy nudgePolicy;
  final String? Function(Entity) _route;
  final int _limit;
  final bool Function(Entity) _prefer;
  final bool Function(Entity)? _accept;
  final List<GuideChip>? Function(FallbackContext)? _fallback;
  final String? Function(Entity)? _line;
  final Map<String, String> _t;
  final double Function() _now;
  double _lastStepAt = double.negativeInfinity;
  bool _lastStepSelf = false;
  double _lastNudgeAt = double.negativeInfinity;
  final _nudgedFrom = <String>{};

  /// [route]: where an entity lives in this app (a route, a deep link, a url); default its url.
  /// [prefer]: which suggestions a nudge prefers (default: those with a route). [accept]: which
  /// entities the guide may offer at all. [fallback]: chips when nothing is suggested. [line]: a
  /// short line for the `{line}` token. [templates]: words, including `open.<type>`, `nudge.<type>`.
  /// [now]: the clock in milliseconds.
  Guide(
    this.pubba, {
    Trail? trail,
    String? Function(Entity)? route,
    int chips = 3,
    this.nudgePolicy = const NudgePolicy(),
    bool Function(Entity)? prefer,
    bool Function(Entity)? accept,
    List<GuideChip>? Function(FallbackContext)? fallback,
    String? Function(Entity)? line,
    Map<String, String> templates = const {},
    double Function()? now,
  })  : trail = trail ?? Trail(),
        _route = route ?? ((e) => e.url),
        _limit = chips,
        _prefer = prefer ?? ((e) => (route ?? (x) => x.url)(e) != null),
        _accept = accept,
        _fallback = fallback,
        _line = line,
        _t = {...defaultGuideTemplates, ...templates},
        _now = now ?? (() => DateTime.now().millisecondsSinceEpoch.toDouble());

  // --- helpers

  String _tpl(String key, [Entity? e]) => (e != null ? _t['$key.${e.type}'] : null) ?? _t[key]!;

  Map<String, String> _vars(Entity e) => {'item': e.shortLabel, 'label': e.label, 'line': _line?.call(e) ?? ''};

  EntityChip _chip(Entity e, Reason reason, String text) => EntityChip(e.id, e.shortLabel, reason, text, _route(e));

  GuideAction _open(Entity e) => GuideAction(e.id, _route(e));

  List<GuideChip> _starters(int n) {
    final g = pubba.graph;
    const reason = Reason('section');
    final es = g.entities.values.where((e) => g.isDestination(e) && (_accept == null || _accept(e)));
    return stableSorted(es, (Entity a, Entity b) => g.degree(b.id) - g.degree(a.id)).take(n).map((e) => _chip(e, reason, pubba.explain(reason, e))).toList();
  }

  List<GuideChip> _chipsFor(int n, List<String> extra, FallbackContext context) {
    final out = [for (final s in pubba.next([...trail.get(), ...extra], limit: n, accept: _accept)) _chip(s.entity, s.reason, s.text)];
    if (out.isNotEmpty) return out;
    final fb = _fallback?.call(context);
    if (fb != null) return fb.take(n).toList();
    return _starters(n);
  }

  // --- the guide

  /// Answer a typed question. Doesn't move the visitor: perform the action, then call [follow].
  Reply ask(String question) {
    if (jsTrim(question).isEmpty) return Reply('start', _fill(_tpl('start'), const {}), chips: _chipsFor(_limit, const [], const FallbackContext('start')));
    final m = pubba.match(question);
    if (m.intent == 'none') {
      if (m.notHere != null) {
        return Reply('not-here', _fill(_tpl('notHere'), {'name': m.notHere!}), chips: _chipsFor(_limit, const [], const FallbackContext('not-here')));
      }
      return Reply('none', _fill(_tpl('none'), const {}), chips: _chipsFor(_limit, const [], const FallbackContext('none')));
    }
    final entity = m.entity!;
    final similar = m.similar.where((r) => _accept == null || _accept(r.entity)).toList();
    if (m.intent == 'similar' && similar.isNotEmpty) {
      final first = similar.first;
      final listed = similar.map((r) => r.entity.label + ((r.reason.via?.isNotEmpty ?? false) ? ' (${r.reason.via!.take(2).join(', ')})' : '')).join(', ');
      return Reply(
        'similar',
        _fill(_tpl('similar', entity), {..._vars(first.entity), 'reason': first.text, 'of': entity.label, 'list': listed}),
        chips: [for (final r in similar.skip(1).take(_limit)) _chip(r.entity, r.reason, r.text)],
        action: _open(first.entity),
        match: m.match,
        similar: [for (final r in similar) _chip(r.entity, r.reason, r.text)],
      );
    }
    final context = FallbackContext('open', entity);
    final chips = pubba.graph.entities.containsKey(entity.id)
        ? _chipsFor(_limit, [entity.id], context).where((c) => c is! EntityChip || c.id != entity.id).toList()
        : _chipsFor(_limit, const [], context);
    return Reply('open', _fill(_tpl('open', entity), _vars(entity)), chips: chips, action: _open(entity), match: m.match);
  }

  /// Follow-ups for where the visitor is now.
  List<GuideChip> chips([int? limit]) => _chipsFor(limit ?? _limit, const [], const FallbackContext('chips'));

  /// The visitor went somewhere on their own.
  void visited(String id) {
    if (pubba.graph.find(id) == null && !id.startsWith('section:')) return;
    trail.record(id);
    _lastStepAt = _now();
    _lastStepSelf = true;
  }

  /// The visitor went somewhere because the guide sent them ([via]: one of `guideVias`).
  void follow(String id, String via) {
    if (pubba.graph.find(id) == null) return;
    trail.record(id);
    _lastStepAt = _now();
    _lastStepSelf = false;
    pubba.track.guidedTo(id, via);
  }

  /// A suggestion to show unprompted now, or null. Call it [NudgePolicy.delayMs] after a step.
  Reply? nudge() {
    final steps = trail.get();
    final last = steps.isEmpty ? null : steps.last;
    final at = _now();
    if (last == null || last.isEmpty || !_lastStepSelf || last.startsWith('section:') || _nudgedFrom.contains(last)) return null;
    if (at - _lastStepAt < nudgePolicy.delayMs || at - _lastNudgeAt < nudgePolicy.gapMs) return null;
    final options = pubba.next(steps, limit: 5, accept: _accept).where((s) => s.reason.kind != 'section' && s.score >= nudgePolicy.minScore).toList();
    if (options.isEmpty) return null;
    final top = options.firstWhere((s) => _prefer(s.entity), orElse: () => options.first);
    _lastNudgeAt = at;
    _nudgedFrom.add(last);
    return Reply(
      'open',
      _fill(_tpl('nudge', top.entity), {..._vars(top.entity), 'reason': top.text}),
      chips: [_chip(top.entity, top.reason, top.text)],
      action: _open(top.entity),
    );
  }

  void opened() => pubba.track.guideOpened();

  void reached(String goal) => pubba.track.reached(goal);
}

Guide createGuide(
  Pubba pubba, {
  Trail? trail,
  String? Function(Entity)? route,
  int chips = 3,
  NudgePolicy nudge = const NudgePolicy(),
  bool Function(Entity)? prefer,
  bool Function(Entity)? accept,
  List<GuideChip>? Function(FallbackContext)? fallback,
  String? Function(Entity)? line,
  Map<String, String> templates = const {},
  double Function()? now,
}) =>
    Guide(pubba,
        trail: trail, route: route, chips: chips, nudgePolicy: nudge, prefer: prefer, accept: accept, fallback: fallback, line: line, templates: templates, now: now);
