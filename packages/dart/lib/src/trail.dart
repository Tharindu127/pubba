import 'dart:convert';

/// Where a trail is kept between launches. Synchronous: with shared_preferences,
/// load the instance once at startup and wrap it (see the README).
abstract class TrailStorage {
  String? getItem(String key);
  void setItem(String key, String value);
}

/// A visitor's trail through the site or app, in entity ids, most recent last. Never sent anywhere.
class Trail {
  final int max;
  final TrailStorage? storage;
  final String key;
  List<String> _steps = [];
  bool _loaded = false;
  final _listeners = <void Function()>[];

  Trail({this.max = 24, this.storage, this.key = 'pubba-trail'});

  void _load() {
    if (_loaded) return;
    _loaded = true;
    try {
      final saved = jsonDecode(storage?.getItem(key) ?? '[]');
      if (saved is List) {
        final all = saved.whereType<String>().toList();
        _steps = all.length > max ? all.sublist(all.length - max) : all;
      }
    } catch (_) {
      // A broken or missing save starts a fresh trail.
    }
  }

  void _save() {
    try {
      storage?.setItem(key, jsonEncode(_steps));
    } catch (_) {
      // Storage full or blocked: the trail lives on in memory.
    }
    for (final l in List.of(_listeners)) {
      l();
    }
  }

  /// One step; the same step twice in a row counts once.
  void record(String? id) {
    if (id == null || id.isEmpty) return;
    _load();
    if (_steps.isNotEmpty && _steps.last == id) return;
    final next = [..._steps, id];
    _steps = next.length > max ? next.sublist(next.length - max) : next;
    _save();
  }

  List<String> get() {
    _load();
    return List.of(_steps);
  }

  void clear() {
    _loaded = true;
    _steps = [];
    _save();
  }

  /// Called after every change; returns an unsubscribe function.
  void Function() subscribe(void Function() listener) {
    _listeners.add(listener);
    return () => _listeners.remove(listener);
  }
}

Trail createTrail({int max = 24, TrailStorage? storage, String key = 'pubba-trail'}) => Trail(max: max, storage: storage, key: key);

/// A trail step for opening a section, which lights every entity of its type a little.
String sectionStep(String section) => 'section:$section';
