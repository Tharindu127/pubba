# Changelog

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
