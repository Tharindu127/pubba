# Changelog

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
