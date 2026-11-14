# pubba for Kotlin and Java

The [pubba](https://github.com/Tharindu127/pubba) runtime for the JVM: load a
bundle compiled by `pubba compile` and answer related items with reasons, what
a visitor is likely to want next, typo-tolerant matching, a headless guide and
privacy-safe measurement events. Made for Android (Kotlin or Java, minSdk 21+)
and JVM servers. Its only dependency is the Kotlin standard library, and it
targets Java 8 bytecode.

It gives the same answers as every other pubba runtime: it passes the shared
conformance suite (4,698 cases) exactly.

```kotlin
dependencies {
    implementation("com.tharinduathapaththu:pubba:0.5.0")
}
```

```kotlin
import com.tharinduathapaththu.pubba.*

val pubba = Pubba.load(assets.open("pubba.bundle.json").bufferedReader().use { it.readText() })

pubba.match("flutr").entity?.id                    // "tech:Flutter"
pubba.next(listOf("project:kiri-wallet")).map { it.text }
// ["Kiri Merchant is built on the same stack as Kiri Wallet (Flutter, Dart).", ...]

val guide = createGuide(pubba) {
    trail = Trail(storage = myPrefsStorage)        // keeps the trail between launches, on the device
    route = { "item/${it.id}" }                    // where an entity lives in your app
}
val reply = guide.ask("anything like kiri walet?")
reply.kind; reply.text; reply.action?.url          // "similar", "Kiri Merchant is built on ...", "item/project:kiri-merchant"
```

From Java:

```java
Pubba pubba = Pubba.load(json);
GuideOptions options = new GuideOptions();
options.setRoute(e -> "item/" + e.getId());
Reply reply = new Guide(pubba, options).ask("anything like kiri walet?");
```

The bundle comes from the content, compiled once with the npm package (in your
build, or by the backend that serves your content):

```bash
npx pubba compile pubba.json --out app/src/main/assets/pubba.bundle.json
```

## API

| | |
| --- | --- |
| `Pubba.load(json, events?)`, `loadBundle(json \| map, events?)` | A `Pubba` from a bundle |
| `pubba.match(query)` | `MatchResult(intent, entity, match, similar, notHere)`; intent is `entity`, `similar` or `none` |
| `pubba.search(query, limit = 10, types = null)` | Every entity a query could mean, best first |
| `pubba.next(trail, limit = 3, exclude, accept)` | Predictions: `Suggestion(entity, score, reason, text)` |
| `pubba.related(id, kinds, limit)` | Neighbours, strongest first: `Related(entity, weight, link, reason, text)` |
| `pubba.autocomplete(typed, trail, limit = 3)` | Type-ahead |
| `pubba.explain(reason, item)` | A reason as a sentence |
| `pubba.track.guideOpened() / guidedTo(id, via) / reached(goal)` | Measurement moments, checked so no visitor text gets in |
| `createGuide(pubba) { trail; route; chips; nudge; prefer; accept; fallback; line; templates; now }` | The headless navigator: `ask`, `chips`, `visited`, `follow`, `nudge`, `opened`, `reached` |
| `Trail(max = 24, storage, key)` | The visitor's trail; `TrailStorage` has `getItem` / `setItem` (SharedPreferences, DataStore, a file) |
| `Events(goals)`, `summarise(events)` | Events (maps with the spec's field names), and one visit's funnel |

`Reply.chips` holds `EntityChip` (a place to go) and `QuestionChip` (a question
to ask the guide). `Reason` is a data class with the same fields as in every
runtime; `reason.toMap()` gives the JSON shape. From Java, the top-level
functions live in `PubbaRuntime`, `PubbaText`, `PubbaEvents` and `PubbaGuide`.
Behaviour is specified in the repository's `spec/SPEC.md`.

The guide is headless: it returns replies, actions, chips and nudges as data,
and your app draws them in its own design. A Jetpack Compose sample (a chat
bubble with nudges) is in the repository's `examples/android`.

Methods are not thread-safe for one `Guide` (it holds the visitor's trail and
nudge timing); call it from the main thread, as a UI would. `Pubba` itself only
reads its graph and can be shared.

## Tests

```bash
gradle test
```

runs the shared conformance suite from the repository's `conformance/` folder,
plus a test of the API as Java sees it.

MIT © Tharindu Athapaththu
