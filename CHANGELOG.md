# Changelog

## 0.7.0 (14 Nov 2026)

- **Dart runtime** (`packages/dart`, pub.dev `pubba`): loads a bundle and answers
  like the other runtimes (match, search, next, related, autocomplete,
  sentences, trail, events, the guide). Pure Dart with no dependencies, Dart
  3.2+, so it runs in Flutter on every target and on the server. Passes the
  conformance suite exactly (4,698 cases), and a mutation check confirms the
  suite catches changes.
- Dart has no Unicode normalization, so matching folds characters (accents,
  ligatures, full-width forms) from a table generated from the JavaScript
  reference (`packages/dart/tool/fold_table.ts`, 1,582 characters). Checked
  against the reference on 20,000 random mixed strings: no differences.
- In Dart the guide's chip type is `GuideChip` (with `EntityChip` and
  `QuestionChip`), since `Chip` is Flutter's Material widget.
- **Flutter sample** (`examples/flutter`): the example portfolio with a
  chat-bubble guide, chips, nudges and the trail in shared_preferences. CI
  analyzes it; the Dart package is analyzed, tested and dry-run published.
- **The skill** covers Flutter.
- The npm, PyPI, Maven and Swift packages are unchanged.

## 0.6.0 (14 Nov 2026)

- **Swift runtime** (`packages/swift`, Swift Package `Pubba` from this
  repository's URL): loads a bundle and answers like the other runtimes
  (match, search, next, related, autocomplete, sentences, trail, events, the
  guide). No dependencies beyond Foundation; iOS 13+, macOS 10.15+, tvOS,
  watchOS, visionOS. Passes the conformance suite exactly (4,698 cases), and a
  mutation check confirms the suite catches changes. `Sendable` values, and it
  builds cleanly in Swift 6 language mode. `UserDefaultsTrailStorage` keeps the
  trail on the device. CI runs it.
- `Package.swift` sits at the repository root, since Swift Package Manager
  installs from a Git URL; versions are the repository's git tags.
- **iOS sample** (`examples/ios`): a SwiftUI app over the example portfolio with
  a chat-bubble guide: typed questions, chips, the trail in UserDefaults, and
  nudges, with VoiceOver announcements. It uses the package from this
  repository. CI builds it.
- **The skill** covers iOS and SwiftUI.
- The npm, PyPI and Maven packages are unchanged (0.4.0, 0.4.0, 0.5.0).

## 0.5.0 (14 Nov 2026)

- **Kotlin runtime** (`packages/kotlin`, Maven `com.tharinduathapaththu:pubba`):
  loads a bundle and answers like the TypeScript and Python runtimes (match,
  search, next, related, autocomplete, sentences, trail, events, the guide).
  Its only dependency is the Kotlin standard library; Java 8 bytecode, so it
  runs on Android and any JVM. Passes the conformance suite exactly (4,698
  cases), and a mutation check confirms the suite catches changes. Usable
  from Java (`Pubba.load(json)`, `new Guide(pubba, options)`), with a test of
  the API as Java sees it. CI runs it.
- **Android sample** (`examples/android`): a Jetpack Compose app over the
  example portfolio with a chat-bubble guide: typed questions, chips, a trail
  kept in SharedPreferences, and nudges. It uses the library from source. CI
  builds it.
- **The skill** covers Android: where the bundle goes, wiring the guide into
  Compose navigation, nudges with `LaunchedEffect`, and accessibility.
- The npm and PyPI packages are unchanged at 0.4.0.

## 0.4.0 (12 Nov 2026)

- **Python runtime** (`packages/python`, `pip install pubba`): loads a bundle and
  answers like the TypeScript runtime (match, search, next, related,
  autocomplete, sentences, trail, events, the guide). No dependencies, Python
  3.9+. Passes the conformance suite exactly on 3.9 and 3.13, and gives the
  same answers as TypeScript on the portfolio's live content (880 cases, no
  differences). CI runs it.
- **`pubba serve`**: a read-only, stateless JSON API over HTTP (match, search,
  next, related, autocomplete, the guide's reply, how two items connect).
- **`pubba mcp`**: an MCP server over stdio with read-only tools `search`,
  `match`, `related`, `next` and `explain`, for AI assistants.
- `pubba/serve` exports `serve`, `serveMcp`, `handleMcp`, `answer` and
  `connection` (the shortest path of links between two items, each as a sentence).

## 0.3.2 (11 Nov 2026)

- **`types.<type>.similar: false`**: a type that never answers "anything like
  X?". The query reads as naming X (`intent: "entity"`), so the guide opens it.
  A portfolio sets it on everything but projects to keep "anything like" about
  projects. Kept in bundles; generated eval cases expect it; the conformance
  catalogue and course list use it.

## 0.3.1 (11 Nov 2026)

What the portfolio's guide needed to move onto `createGuide` without a visible
change (all off by default; answers without them are unchanged):

- **`accept(entity)`**: things a chip can't lead to are never suggested (chips,
  nudges, similar items, starters).
- **`fallback({ kind, entity })`**: chips by context when the trail suggests
  nothing. Strings become **question chips** `{ label, question }`; `Chip` is
  now `EntityChip | QuestionChip`.
- **Per-type wording**: `open.<type>`, `similar.<type>`, `nudge.<type>`
  templates, with `{label}` and `{line}` (from `line(entity)`), and `{of}` and
  `{list}` for similar replies. Similar replies also carry every similar item
  (`similar`).
- **`nudge.prefer(entity)`**: which prediction a nudge favours, separate from
  `route`.
- Conformance: 25 more guide scripts with these options, as data
  (4,682 cases); spec updated.

## 0.3.0 (11 Nov 2026)

The foundation for pubba on every platform (docs/multiplatform-design.md).

- **Bundles.** `pubba compile` (and `compileBundle`) writes the finished graph
  as one versioned JSON file; `loadBundle` answers from it exactly as the full
  build does. Templates written as functions are refused (they can't cross
  languages). Every CLI command except `compile` also accepts a bundle.
- **`createGuide`**: the headless navigator. `ask` turns a question into a
  reply (open, similar, none, not-here, start) with an action and chips;
  `visited` and `follow` record the trail (follow is measured); `nudge`
  applies Pubba's rules (own step, 9 s delay, once per item, 60 s apart,
  score 0.3 or more); words come from overridable templates.
- **spec/SPEC.md**: the runtime behaviour every language implements.
- **conformance/**: 4,657 cases over five sample sites (two portfolios, a
  catalogue, a course list, a docs site), generated from the reference; the
  TypeScript runtime passes all of them, and CI fails when the files are out
  of date.
- `assembleGraph`, `pubbaFor` and `VERSION` are exported.

## 0.2.0 (10 Nov 2026)

First v2 release: privacy-safe measurement events (design: docs/v2-design.md).

- **`createEvents({ goals })`** and **`createPubba(data, config, { events })`.**
  pubba emits `suggested` (from `next` and `related`) and `matched` (what kind of
  thing a query resolved to, never the query). Nothing is stored or sent.
- **`pubba.track`**: `guideOpened()`, `guidedTo(id, via)` and `reached(goal)` for
  the moments only the site sees. Unknown ids, vias and undeclared goals are
  dropped, so nothing a visitor typed can reach an event.
- **`summarise(events)`**: one visit's funnel: was the guide used, where did it
  lead, which goals were reached, and was a goal reached after the guide led
  somewhere.
- Listeners that throw are ignored; events are frozen. Without `events`, nothing
  changes.

## 0.1.6 (10 Nov 2026)

- `package.json`: the `bin` path as npm writes it (no publish warning).
- README: the matching, rule and JSON-LD options added in 0.1.1 to 0.1.5.

## 0.1.5 (10 Nov 2026)

Found by Google's Rich Results Test on the live portfolio, which marked every
project invalid ("two or more of offers, aggregateRating, applicationCategory,
operatingSystem"):

- **`applicationCategory` on every app.** `fromPortfolio` gives each project one
  of Google's app types from its topics (fintech → FinanceApplication,
  education → EducationalApplication, telecom → CommunicationApplication…,
  else UtilitiesApplication; the table is `APP_CATEGORY`). A project's own
  `applicationCategory` wins.
- **`operatingSystem` from platforms only.** It comes from the project's
  category (iOS, Android, Web…); tags ("Founded by me") and words like
  "Backend" no longer leak in. JSON-LD reads `data.operatingSystem` first.
- The preset's Telecom topic also recognises prepaid, recharge, data bundles and
  mobile plans.

## 0.1.4 (10 Nov 2026)

- **The person is always in the exports.** A person with no links of their own
  (no roles or ventures yet) was moved to `graph.unlinked` and left out of the
  JSON-LD and llms.txt. `toJsonLd` and `toLlmsTxt` now find them there too.

## 0.1.3 (10 Nov 2026)

Export options found by generating the portfolio site's JSON-LD from the graph:

- **`toJsonLd({ knowsAbout })`**: a curated `knowsAbout` (free text or skill
  labels) instead of every skill.
- **`toJsonLd({ include })`**: only these entities besides the person, for one
  project's page.
- **`headline` and a full description.** Nodes read `data.headline`, and
  `data.longDescription` before `data.description`. `fromPortfolio` fills them
  from a project's subtitle and full description; llms.txt keeps the short line.
- **Ids stay on the site.** An item hosted elsewhere (a Medium article) keeps its
  own `url`, but its `@id` is now under the site's url, not the other site's.

## 0.1.2 (10 Nov 2026)

- **`match.notDistinct`**: words that never count as distinctive on their own,
  though they still count inside a whole name. The portfolio preset lists the
  words it puts in page labels (page, channel, article, piece): an own page
  labelled "TikTok channel" no longer answers "his youtube channel" just because
  it is the only label with "channel" in it.

## 0.1.1 (10 Nov 2026)

Fixes found by switching the portfolio site to pubba, on its live content:

- **Unlinked entities are matched.** Entities with no links (a skill no project
  lists, a market nothing shipped to) are no longer unreachable: they move to
  `graph.unlinked`, where `match` and `search` still find them, while `next`,
  `related` and `autocomplete` never suggest them. "Visual Studio Code" no
  longer matches Xcode, nor "what did he build in Qatar" an article.
- **Distinct words must be spelled right.** With `match.distinctWords`, a lone
  word now needs its exact spelling (plurals and longer forms allowed): "change"
  no longer matches "channel", nor "build" the word "Built" in a title.
- **Generated trails from hubs accept ties.** A trail generated from a widely
  used, low-weight item (Figma) expects any relation tied with its third
  strongest, instead of an arbitrary three.

## 0.1.0 (9 Nov 2026)

First release: schema, graph builder with derived-link rules, related items,
what-next from a trail, search, autocomplete and matching, with
machine-readable reasons and sentence templates; the portfolio preset; the
evaluation harness with generated cases and lint; JSON-LD and llms.txt helpers;
the CLI and the Claude skill.
