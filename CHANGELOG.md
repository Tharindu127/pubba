# Changelog

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
