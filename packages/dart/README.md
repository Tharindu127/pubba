# pubba for Dart and Flutter

The [pubba](https://github.com/Tharindu127/pubba) runtime for Dart: load a
bundle compiled by `pubba compile` and answer related items with reasons, what
a visitor is likely to want next, typo-tolerant matching, a headless guide and
privacy-safe measurement events. Pure Dart with no dependencies, so it runs in
Flutter on every target (iOS, Android, web, desktop) and on the server.

It gives the same answers as every other pubba runtime: it passes the shared
conformance suite (4,698 cases) exactly.

```bash
flutter pub add pubba
```

```dart
import 'package:pubba/pubba.dart';

final pubba = loadBundle(await rootBundle.loadString('assets/pubba.bundle.json'));

pubba.match('flutr').entity?.id;                    // "tech:Flutter"
pubba.next(['project:kiri-wallet']).map((s) => s.text);
// ("Kiri Merchant is built on the same stack as Kiri Wallet (Flutter, Dart).", ...)

final guide = createGuide(pubba, route: (e) => '/item/${e.id}');
final reply = guide.ask('anything like kiri walet?');
reply.kind; reply.text; reply.action?.url;          // "similar", "Kiri Merchant is built on ...", "/item/project:kiri-merchant"
```

The bundle comes from the content, compiled once with the npm package (in your
build, or by the backend that serves your content):

```bash
npx pubba compile pubba.json --out assets/pubba.bundle.json
```

## Keeping the trail between launches

`TrailStorage` is synchronous, so load `shared_preferences` once at startup and
wrap it. The trail stays on the device.

```dart
class PrefsStorage implements TrailStorage {
  PrefsStorage(this.prefs);
  final SharedPreferences prefs;
  @override
  String? getItem(String key) => prefs.getString(key);
  @override
  void setItem(String key, String value) => prefs.setString(key, value);
}

final prefs = await SharedPreferences.getInstance();
final guide = createGuide(pubba, trail: Trail(storage: PrefsStorage(prefs)));
```

## API

| | |
| --- | --- |
| `loadBundle(json, {events})` | A `Pubba` from a bundle (JSON text, or already decoded) |
| `pubba.match(query)` | `MatchResult(intent, entity, match, similar, notHere)`; intent is `entity`, `similar` or `none` |
| `pubba.search(query, {limit, types})` | Every entity a query could mean, best first |
| `pubba.next(trail, {limit, exclude, accept})` | Predictions: `Suggestion(entity, score, reason, text)` |
| `pubba.related(id, {kinds, limit})` | Neighbours, strongest first: `Related(entity, weight, link, reason, text)` |
| `pubba.autocomplete(typed, {trail, limit})` | Type-ahead |
| `pubba.explain(reason, item)` | A reason as a sentence |
| `pubba.track.guideOpened() / guidedTo(id, via) / reached(goal)` | Measurement moments, checked so no visitor text gets in |
| `createGuide(pubba, {trail, route, chips, nudge, prefer, accept, fallback, line, templates, now})` | The headless navigator: `ask`, `chips`, `visited`, `follow`, `nudge`, `opened`, `reached` |
| `Trail({max, storage, key})` | The visitor's trail; `TrailStorage` has `getItem` / `setItem` |
| `createEvents({goals})`, `summarise(events)` | Events (maps with the spec's field names), and one visit's funnel |

`Reply.chips` holds `EntityChip` (a place to go) and `QuestionChip` (a question
to ask the guide); `GuideChip` is sealed, so a `switch` covers both. `Reason` has the
same fields as in every runtime; `reason.toJson()` gives the JSON shape.
Behaviour is specified in the repository's `spec/SPEC.md`.

The guide is headless: it returns replies, actions, chips and nudges as data,
and your app draws them in its own widgets. A Flutter sample (a chat bubble
with nudges) is in the repository's `examples/flutter`.

If you use `package:test`, import it with `hide closeTo`: both define a
`closeTo`.

MIT © Tharindu Athapaththu
