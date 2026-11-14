# pubba for Swift

The [pubba](https://github.com/Tharindu127/pubba) runtime for Apple platforms:
load a bundle compiled by `pubba compile` and answer related items with
reasons, what a visitor is likely to want next, typo-tolerant matching, a
headless guide and privacy-safe measurement events. iOS 13+, macOS 10.15+,
tvOS, watchOS and visionOS. No dependencies beyond Foundation.

It gives the same answers as every other pubba runtime: it passes the shared
conformance suite (4,698 cases) exactly.

In Xcode: **File → Add Package Dependencies…** and enter
`https://github.com/Tharindu127/pubba`. Or in `Package.swift`:

```swift
.package(url: "https://github.com/Tharindu127/pubba", from: "0.6.0")
// and in the target: .product(name: "Pubba", package: "pubba")
```

```swift
import Pubba

let pubba = try Pubba.load(Data(contentsOf: Bundle.main.url(forResource: "pubba.bundle", withExtension: "json")!))

pubba.match("flutr").entity?.id                     // "tech:Flutter"
pubba.next(["project:kiri-wallet"]).map(\.text)
// ["Kiri Merchant is built on the same stack as Kiri Wallet (Flutter, Dart).", ...]

let guide = Guide(
    pubba,
    trail: Trail(storage: UserDefaultsTrailStorage()),  // keeps the trail between launches, on the device
    route: { "item/\($0.id)" }                          // where an entity lives in your app
)
let reply = guide.ask("anything like kiri walet?")
reply.kind; reply.text; reply.action?.url            // "similar", "Kiri Merchant is built on ...", "item/project:kiri-merchant"
```

The bundle comes from the content, compiled once with the npm package (in a
build phase, or by the backend that serves your content):

```bash
npx pubba compile pubba.json --out MyApp/pubba.bundle.json
```

## API

| | |
| --- | --- |
| `Pubba.load(json \| data, events:)` | A `Pubba` from a bundle (throws on a bundle it can't read) |
| `pubba.match(_:)` | `MatchResult(intent, entity, match, similar, notHere)`; intent is `entity`, `similar` or `none` |
| `pubba.search(_:limit:types:)` | Every entity a query could mean, best first |
| `pubba.next(_:limit:exclude:accept:)` | Predictions: `Suggestion(entity, score, reason, text)` |
| `pubba.related(_:kinds:limit:)` | Neighbours, strongest first: `Related(entity, weight, link, reason, text)` |
| `pubba.autocomplete(_:trail:limit:)` | Type-ahead |
| `pubba.explain(_:_:)` | A reason as a sentence |
| `pubba.track.guideOpened() / guidedTo(_:via:) / reached(_:)` | Measurement moments, checked so no visitor text gets in |
| `Guide(pubba, trail:route:chips:nudge:prefer:accept:fallback:line:templates:now:)` | The headless navigator: `ask`, `chips`, `visited`, `follow(_:via:)`, `nudge`, `opened`, `reached` |
| `Trail(max:storage:key:)` | The visitor's trail; `TrailStorage` has `getItem` / `setItem`; `UserDefaultsTrailStorage` is ready to use |
| `Events(goals:)`, `summarise(_:)` | Events (JSON objects with the spec's field names), and one visit's funnel |

`Reply.chips` holds `.entity(EntityChip)` (a place to go) and
`.question(QuestionChip)` (a question to ask the guide). `Reason` has the same
fields as in every runtime; `reason.json` gives the JSON shape. `Pubba` and its
values are `Sendable`. Use one `Guide` from one thread (the main actor, in an
app): it holds the visitor's trail and nudge timing. Behaviour is specified in
the repository's `spec/SPEC.md`.

The guide is headless: it returns replies, actions, chips and nudges as data,
and your app draws them in its own design. A SwiftUI sample (a chat bubble with
nudges) is in the repository's `examples/ios`.

Tested on Apple platforms. It uses only Foundation, so it may build for Swift on
Linux, but that isn't tested yet.

## Tests

From the repository root:

```bash
swift test
```

runs the shared conformance suite from `conformance/`.

MIT © Tharindu Athapaththu
