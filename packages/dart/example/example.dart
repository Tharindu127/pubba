import 'dart:io';

import 'package:pubba/pubba.dart';

/// Run with a bundle compiled by `npx pubba compile pubba.json --out pubba.bundle.json`:
///   dart run example/example.dart pubba.bundle.json
void main(List<String> args) {
  final pubba = loadBundle(File(args.isEmpty ? 'pubba.bundle.json' : args.first).readAsStringSync());

  final m = pubba.match('flutr');
  print('${m.intent}: ${m.entity?.label}');

  for (final s in pubba.next([if (m.entity != null) m.entity!.id])) {
    print('next: ${s.entity.label} because ${s.text}');
  }

  final guide = createGuide(pubba, route: (e) => '/item/${e.id}');
  final reply = guide.ask('anything like ${m.entity?.label ?? 'it'}?');
  print('${reply.kind}: ${reply.text}');
}
