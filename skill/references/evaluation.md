# The evaluation harness

## Files

`eval/queries.json`:

```json
[
  { "query": "flutr", "expect": "tech:Flutter", "tags": ["typo", "one-word"] },
  { "query": "anything like Kiri Wallet?", "expect": "project:kiri-wallet", "intent": "similar", "tags": ["similar"] },
  { "query": "what's the weather in Paris", "expect": null, "intent": "none", "tags": ["off-topic"] }
]
```

A query passes when it resolves to `expect` (or to nothing for `null`) and, when
`intent` is given, reads as that intent. Matching score = share passed.

`eval/trails.json`:

```json
[{ "name": "after a payments app, its sibling", "trail": ["project:kiri-wallet"], "expect": ["project:kiri-merchant"], "top": 3 }]
```

A trail scores the share of `expect` found in the top `top` (default 3)
suggestions. Use `expectAny` when any one of several items is a fair next step
(a role → any of its projects); the group counts as one part. Suggestion score =
the average.

`eval/baseline.json`: `{ "matching": 0.95, "suggestions": 0.9 }`. `eval` exits 1
when a score falls below it.

## Generated cases: a test set that grows with the content

`--generated` adds cases derived from the graph on every run: for every entity a
visitor can be sent to, its name, a typo of it (two neighbouring letters
swapped in its longest word), each alias, and "anything like it?" where it has
similar items; and a trail from it that must reach one of its three closest
siblings (or relations). A new project gets its cases on the next build. Names
shared by two entities are skipped, not faked: `lint` reports them instead.

Hand-written cases still matter for what generation can't know: off-topic
questions, commands the site handles itself ("how do I hire him"), phrasing
visitors really use, and trails a person would expect.

`pubba generate pubba.json --out-dir eval/` writes the generated set to read.

## Lint

`pubba lint pubba.json` lists content problems that cost accuracy, and exits 1
on errors:

| Code | Level | Meaning |
| --- | --- | --- |
| `duplicate-name` | error | Two entities share a name or alias; a query can only find one |
| `shared-first-word` | warning | Typed alone, a shared first word ("Odoo") finds only the first |
| `short-name-typos` | warning | With typos on 4-letter words, everyday words reach short names |
| `heavy-core` | warning | Most of what a `shared` rule compares counts as core, so unrelated items look alike |
| `dead-end` | warning | Nothing is suggested after this item |
| `dropped` | info | Entities with no links: never suggested, though queries still find them |
| `no-url` | info | No url where others of its type have one |

## Diagnosing failures

| Symptom | Look with | Usual fix |
| --- | --- | --- |
| Query resolves to the wrong entity | `pubba.sh match pubba.json "<query>"` (shows `by` and `score`) | Add an alias to the right entity; if a weak `first-word` hit in an earlier tier steals it, add a fuller alias so the right one scores as `name`/`alias` in its own tier, or move tiers |
| A common word matches an alias ("notes" → alias "node") | `match` shows `by: alias` | Give the intended entity an alias for the phrase, or drop the short alias, or put that type in `phrase` mode |
| Off-topic query matches | `match` | The near-miss rule (one edit, two for 7+ letters) caught a word; rename the alias, or add the word to `match.stopWords` if it's a name word |
| Nothing matches a real name | `match` | Add an alias; check `minLength` and `skip` for the type; check `match.ignore` doesn't contain part of the name |
| "anything like X" reads as plain `entity` | `related` with the type's `similar` kinds | No links of those kinds: lower the `shared` rule's `min`, or add the kinds to `similar` |
| Trail misses an obvious next item | `pubba.sh related pubba.json <id>` then `next` | Missing link (add content or a rule); kind `pull` too low; a common tool's `weight` too high, so it floods; a hub type should be `destination: false` |
| Trail is all one type | `next` | The mixer caps one type at `limit - 1`; if it's still flooded, lower that kind's `pull` |
| A distinctive later word finds nothing ("ragnarok", "red dead") | `match` | Turn on `match.distinctWords` and `match.partialWords`, or add an alias |
| A short word near-misses a short name ("hire" → Hive) | `match` shows `by: phrase` on a 4-letter name | `match.typoMinLength: 5` |
| A typo or shorter name steals the match ("Swift" → SwiftUI, "Saga II" → Saga) | `match` | `match.precise: true` |
| A name the site doesn't have resolves to one inside it ("react native" → React) | `match` | `match.notHere: ["React Native"]` |
| Two editions of one thing don't lead to each other | `related` shows a weak `mentions` link or none | `extraRules: [{ "type": "label-prefix", "kind": "same-series", "among": "project", "stems": true, "before": "mentions" }]` |
| Sentence reads badly | `related` | Override the template for that kind, or `<kind>.<type>` |

Change one thing at a time and rerun; a fix for one query can break another.
Write expectations from what a visitor would want, not from current output.

## CI

```yaml
# .github/workflows/pubba.yml
name: pubba eval
on: [push, pull_request]
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx pubba lint pubba.json
      - run: npx pubba eval pubba.json --queries eval/queries.json --trails eval/trails.json --generated --baseline eval/baseline.json
```

Raise the baseline (`--update-baseline`) only when scores went up on purpose.
