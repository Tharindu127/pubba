# Conformance suite

Every pubba runtime, in any language, must give exactly these answers. The
TypeScript package passes it in `test/conformance.test.ts`; a new runtime is
done when it passes 100%.

```
sources/   five sample sites as pubba.json (two portfolios, a catalogue, a course list, a docs site)
bundles/   each one compiled (`pubba compile`): what a runtime loads
cases/     one JSON object per line: the call, and the expected answer in "expect"
```

Regenerate after a behaviour change with `npm run conformance` and review the
diff; CI runs `npm run conformance:check`, which fails when the files are out
of date. Behaviour is specified in `spec/SPEC.md`.

## Comparing answers

Answers are JSON. Compare them structurally: the same keys, the same array
order, equal strings and booleans, numbers equal to within 1e-9. A key that is
absent must be absent (no nulls in its place).

## Cases

`cases/text.jsonl`, the text helpers (SPEC section 3):

| op | input | expect |
| --- | --- | --- |
| `normalize` | `input` | the normalised string |
| `distance` | `a`, `b` (already normalised) | edit distance |
| `closeTo` | `token`, `word`, `typoMinLength` | boolean |

`cases/<bundle>.jsonl`, against `bundles/<bundle>.json`:

| op | input | expect |
| --- | --- | --- |
| `match` | `query` | `{ intent, entity (id or null), score, tier, by, name, text, similar: [{ id, weight, reason, text }], notHere }`; `score` to `text` only when matched, `notHere` only when set |
| `search` | `query`, `limit` | `[{ id, score, tier, by, name }]` |
| `next` | `trail`, `limit`, optional `exclude` | `[{ id, score, reason, text }]` |
| `related` | `id`, optional `limit`, `kinds` | `[{ id, weight, reason, text }]` |
| `autocomplete` | `typed`, `trail`, `limit` | `[{ id, score, by }]` (score is the rank) |
| `explain` | `reason`, `item` (an id) | the sentence |
| `guide` | `steps` | `{ answers, trail, events }` |

A `reason` is `{ kind, to?, direction?, via?, seed?, by?, name? }`, keys present
only when set.

### Guide scripts

Run each script on a fresh guide over the bundle, with: a clock starting at 0
that only `tick` moves; an events sink with goals `["contact"]`; default chip
count (3), nudge policy (9000 ms, 60000 ms, 0.3), routes (each entity's `url`)
and templates.

| step | does | answer |
| --- | --- | --- |
| `{ op: "visited", id }` | `guide.visited(id)` | null |
| `{ op: "follow", id, via }` | `guide.follow(id, via)` | null |
| `{ op: "ask", question }` | `guide.ask(question)` | a reply |
| `{ op: "nudge" }` | `guide.nudge()` | a reply or null |
| `{ op: "chips", limit? }` | `guide.chips(limit)` | chips |
| `{ op: "tick", ms }` | clock += ms | null |
| `{ op: "opened" }` | `guide.opened()` | null |
| `{ op: "reached", goal }` | `guide.reached(goal)` | null |

A reply is `{ kind, text, action?: { type, id, url? }, chips, match?: { id, score, tier, by, name }, similar? }`;
a chip is `{ id, label, url?, reason, text }`, or `{ label, question }` for a
question chip.

Some scripts carry `options`, the guide options as data:

| Key | Becomes |
| --- | --- |
| `chips` | the chip count |
| `hide` | `accept`: an entity is hidden when it fits every given field of any one rule (`types`, `ids`, `labelIncludes`, `labelEndsWith`; labels lowercased) |
| `fallback` | `fallback(context)`: the list for `"open.<type>"` (then `"open"`) when the context is `open` with an entity, else for the context's kind; missing means none |
| `lines` | `line(entity)`: by id |
| `templates` | the templates |
| `nudgeAvoids` | `nudge.prefer`: an entity whose type isn't listed | `trail` is the trail after the
script; `events` every event emitted, in order (SPEC section 8), including the
`suggested` and `matched` events the guide's own calls caused.
