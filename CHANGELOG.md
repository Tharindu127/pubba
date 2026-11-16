# Changelog

## 1.2.0 (16 Nov 2026)

The site's AI (v3), for questions the guide can't answer from the graph.
TypeScript only, on the server: the runtimes and every answer stay as they
were (5,182 conformance cases).

- **`pubba/ai`:** `createAI(pubba, { provider, … })` answers from the site's
  knowledge file only. The guide asks it only when its own reply is `none`
  (never `not-here`), and every failure quietly gives back the guide's reply:
  switched off, over a limit, slower than `timeoutMs` (default 8 s), an error,
  a declined answer, or one the model marks as not answerable. Ids the model
  names that aren't in the graph are dropped.
- **Providers**, all plain `fetch` with no SDK to install: `claude()` (the
  Messages API, `claude-opus-5-5` at low effort by default, the system prompt
  cached between questions, and the API's fallback model when a safety
  classifier declines), `openai()` (Chat Completions with a strict JSON schema)
  and `gemini()` (generateContent with a response schema). Any other model
  implements `{ name, complete() }`.
- **Guard rails:** a kill switch read on every question (`enabled`), limits
  per visitor (default 20 an hour) and per UTC day (default 1000), questions
  cut to 300 characters, and `onOutcome` for logs and cost tracking that never
  carries the question or the answer.
- **The guide:** `createGuide(pubba, { ai })` and `guide.askAsync(question)`,
  which never rejects; a reply the AI gave has `kind: "ai"`. `remoteAI({ url })`
  asks the site's server from a browser or an app, so the key stays there.
- **`pubba serve --ai claude|openai|gemini`:** `/ask` falls through to the AI,
  and `/ai` answers for `remoteAI`. Keys come from the environment;
  `--ai-daily`, `--ai-per-visitor`, `--ai-knowledge`, `--trust-proxy`, and
  `--ai-off-file` (the AI is off while that file exists).
- **The skill** covers adding the AI, and checking that it falls back.
- Every package is 1.2.0: npm, PyPI, Maven Central, the Swift Package, pub.dev
  and Packagist.

## 1.1.0 (16 Nov 2026)

The rest of the planned exports, all built from the graph at build time. They
are TypeScript only, so the runtimes and every answer stay as they were
(5,182 conformance cases).

- **Knowledge file:** `toKnowledge(graph, options)` and `pubba knowledge` give
  the graph as one JSON file for an AI assistant to read: the site's title and
  summary, each type with its count, every entity with a short description
  and its strongest connections in sentences, and every link as
  `[from, kind, to, weight]` (plus what the two share) with a note on how to
  read them. Versioned (`v: 3`), and covered by STABILITY.md. `extra` adds the
  site's own sections without replacing pubba's; `fields` copies `data` fields;
  `types`, `related` and `maxDescription` trim it.
- **llms-full.txt:** `toLlmsTxt(graph, { full: true })` and `pubba llms --full`
  give every item its own heading, its full description and its connections.
- **JSON-LD:** `itemList` adds an `ItemList` of one type for a listing page,
  `breadcrumb` a `BreadcrumbList` for an item's page, and `occupations` the
  person's roles as `hasOccupation`. Each is off unless asked, and on the CLI
  as `--item-list`, `--breadcrumb` and `--occupations`. `validateJsonLd` checks
  list positions and urls.
- **Sitemap:** `toSitemapEntries(graph, { baseUrl })` lists each page on the
  site once, with `lastModified` from `data.updated` or `data.date` when it's
  a W3C date. `toSitemapXml` and `pubba sitemap` write the sitemap.xml.
- **The skill** covers all four.
- Every package is 1.1.0: npm, PyPI, Maven Central, the Swift Package, pub.dev
  and Packagist.

## 1.0.0 (15 Nov 2026)

The first stable release. No new features, and no answer changes: every
runtime gives exactly the answers 0.9.0 gave (5,182 conformance cases).

- **[STABILITY.md](STABILITY.md)** says what semantic versioning covers from
  now on: the bundle format, each runtime's public API, config, reasons,
  events, the CLI, `pubba serve` and `pubba mcp`, and the evaluation files.
  Patch releases never change an answer. Minor releases may change answers,
  and the changelog lists each such change under "Changed answers".
- **Bundle format 1 is frozen.** Later 1.x releases may only add optional
  fields. The spec now says a runtime ignores fields it doesn't know, which
  every runtime already did (checked in all six).
- **Python:** `Pubba.spread()` returns a `Spread` (`score`, `why`, `seeds`,
  `section_only`) with `Why` entries (`link`, `from_`, `seed`, `part`), like
  the other runtimes, instead of a bare tuple. Both are exported.
- **TypeScript:** the `Spread` type is exported, since `spread()` already was.
- **PHP:** helpers that are only there for the runtime itself (`Text::obj`,
  `Text::truthy`, `Text::stableSorted` and the like) are tagged `@internal`.
  They are not part of the stable API.
- **Fix:** `pubba eval --update-baseline` now records the intents score too.
  Before, an intent regression couldn't fail CI unless the baseline was
  edited by hand.
- The Swift README's install line asked for `from: "0.6.0"`, which SwiftPM
  caps below 1.0. It now asks for `from: "1.0.0"`.
- Every package is 1.0.0: npm, PyPI, Maven Central, the Swift Package, pub.dev
  and Packagist.

## 0.9.0 (15 Nov 2026)

- **Intent profiles, in every runtime at once** (TypeScript, Python, Kotlin,
  Swift, Dart, PHP). A site describes why people visit in `config.intents`
  (`signals` that point to each intent, `boost` for what to show more of), and
  `pubba.intent(trail)` reads the likely one from the trail alone:
  `{ likely, confidence, scores, evidence }`. A fixed "browsing" share keeps
  short or mixed trails from counting; an intent needs half the share and two
  real steps (`config.intent`).
- `next` leans towards the likely intent by default (`intent: "auto"`; `null`
  turns it off, or name one); `related` takes a named intent. Boosts are
  clamped to 0.5–2x and `next` still mixes types, so an intent reorders but
  never hides. A suggestion the intent moved carries `reason.intent = { id, boost }`;
  wording only changes when a site writes an `intent.<id>` template (with an
  `{intent}` token for the label). `suggested` events name the intent applied.
  Without `intents` configured, every answer is exactly as before.
- Bundles carry `intents` and `intent`; the format stays 1 (older runtimes
  ignore them and answer without intents).
- **The spec** defines intents exactly (SPEC 5.7, 5.8), and the conformance
  suite grows to 5,182 cases (intent readings, boosted `next` and `related`,
  intent sentences, guided visits that settle into an intent). Every runtime
  passes it; mutation checks confirm the suite catches changes to the new code.
- **Eval:** a trail case can say which intent it should read as (`null` for
  browsing); the report adds intent accuracy and the suggestion score with
  intents off. **Lint:** intents that can never be read, and intents too alike
  to tell apart.
- **Portfolio preset:** `PORTFOLIO_INTENTS` (hiring for mobile, a web build,
  the creative work) as a worked example, off unless `intents: true`.
- `pubba serve`: `/intent?trail=` and an `intent` parameter on `/next`.
- **The skill** covers defining and measuring intents.
- Every package is 0.9.0: npm, PyPI, Maven Central, the Swift Package, pub.dev
  and Packagist.

## 0.8.0 (15 Nov 2026)

- **PHP runtime** (`packages/php`, Packagist `tharindu127/pubba`): loads a
  bundle and answers like the other runtimes (match, search, next, related,
  autocomplete, sentences, trail, events, the guide). PHP 8.1+ with only the
  `json` and `mbstring` extensions; usable without Composer through its
  `autoload.php`. Passes the conformance suite exactly (4,698 cases), and a
  mutation check confirms the suite catches changes. CI runs it on PHP 8.1 and 8.4.
- `composer.json` sits at the repository root, since Packagist reads it there;
  versions are the repository's git tags.
- Matching folds characters from a table generated from the JavaScript
  reference (`packages/php/tool/fold_table.ts`), as in Dart.
- In PHP a match is `EntityMatch`, since `match` is a reserved word.
- `CookieTrailStorage` (a first-party, httpOnly cookie) and
  `SessionTrailStorage` keep the trail between requests.
- **WordPress sample** (`examples/wordpress`): a plugin with related items and
  their reasons under each page, a `[pubba_next]` shortcode, and an Ask guide
  (a REST route and plain JavaScript) with chips and nudges. Its logic is
  WordPress-free, and `demo/router.php` runs it on PHP's built-in server.
- **The skill** covers WordPress and PHP sites.
- C#, planned for this release, is deferred.
- The npm, PyPI, Maven, Swift and pub.dev packages are unchanged.

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
