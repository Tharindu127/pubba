import 'dart:convert';
import 'dart:io';

import 'package:pubba/pubba.dart';
import 'package:test/test.dart' hide closeTo;

import 'harness.dart';

// The Dart runtime against the shared conformance suite (../../conformance).
final root = Directory('../../conformance');

List<Map<String, dynamic>> lines(String name) => File('${root.path}/cases/$name')
    .readAsLinesSync()
    .where((l) => l.trim().isNotEmpty)
    .map((l) => (jsonDecode(l) as Map).cast<String, dynamic>())
    .toList();

void main() {
  test('text helpers', () {
    for (final c in lines('text.jsonl')) {
      final dynamic got = switch (c['op']) {
        'normalize' => normalize(c['input']),
        'distance' => editDistance(c['a'], c['b']),
        _ => closeTo(c['token'], c['word'], typoMinLength: c['typoMinLength'] == null ? double.infinity : (c['typoMinLength'] as num).toDouble()),
      };
      expect(diff(got, c['expect']), isNull, reason: jsonEncode(c));
    }
  });

  final names = root.listSync().isEmpty
      ? <String>[]
      : (Directory('${root.path}/bundles').listSync().map((f) => f.uri.pathSegments.last).where((n) => n.endsWith('.json')).map((n) => n.substring(0, n.length - 5)).toList()..sort());

  test('there are bundles', () => expect(names, isNotEmpty));

  for (final name in names) {
    test('bundle $name', () {
      final pubba = loadBundle(File('${root.path}/bundles/$name.json').readAsStringSync());
      final failures = <String>[];
      final cases = lines('$name.jsonl');
      for (final c in cases) {
        final expect = c.remove('expect');
        String? d;
        try {
          d = diff(run(pubba, c), expect);
        } catch (e) {
          d = 'threw $e';
        }
        if (d != null) failures.add('${jsonEncode(c).substring(0, jsonEncode(c).length.clamp(0, 140))}\n    $d');
      }
      expect(failures, isEmpty, reason: '${failures.length} of ${cases.length} cases differ:\n  ${failures.take(5).join('\n  ')}');
      print('$name: ${cases.length} cases, all equal');
    });
  }

  test('the Dart API reads naturally', () {
    final pubba = loadBundle(File('${root.path}/bundles/portfolio-fiction.json').readAsStringSync());
    expect(pubba.match('synthpd').entity?.id, 'project:synthpad');
    final guide = createGuide(pubba, route: (e) => 'app://items/${e.id}');
    final reply = guide.ask('anything like kiri wallet');
    expect(reply.kind, 'similar');
    expect(reply.action?.url, 'app://items/project:kiri-merchant');
    final seen = <PubbaEvent>[];
    final tracked = createGuide(pubba.withEvents(createEvents()..on(seen.add)));
    tracked.follow('project:kiri-merchant', 'typed');
    expect(tracked.trail.get(), ['project:kiri-merchant']);
    expect(summarise(seen).usedGuide, isTrue);
  });
}
