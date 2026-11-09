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
      - run: npx pubba eval pubba.json --queries eval/queries.json --trails eval/trails.json --baseline eval/baseline.json
```

Raise the baseline (`--update-baseline`) only when scores went up on purpose.
