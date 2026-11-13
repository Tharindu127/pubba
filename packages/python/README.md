# pubba for Python

The [pubba](https://github.com/Tharindu127/pubba) runtime in Python: load a
bundle compiled by `pubba compile` and answer related items with reasons, what
a visitor is likely to want next, typo-tolerant matching, a headless guide and
privacy-safe measurement events. No dependencies; Python 3.9+.

It gives the same answers as every other pubba runtime: it passes the shared
conformance suite (4,698 cases) exactly.

```bash
pip install pubba
```

```python
from pubba import load_bundle, create_guide, create_trail

pubba = load_bundle(open("pubba.bundle.json").read())

pubba.match("flutr").entity.id            # "tech:Flutter"
[s.text for s in pubba.next(["project:kiri-wallet"])]
# ["Kiri Merchant is built on the same stack as Kiri Wallet (Flutter, Dart).", ...]

guide = create_guide(pubba, trail=create_trail())
reply = guide.ask("anything like kiri walet?")
reply.kind, reply.text, reply.action      # "similar", "Kiri Merchant is built on ...", {"type": "open", ...}
```

The bundle comes from the content, compiled once with the npm package:

```bash
npx pubba compile pubba.json --out pubba.bundle.json
```

## API

| | |
| --- | --- |
| `load_bundle(json, events=None)` | A `Pubba` from a bundle (a JSON string, bytes or dict) |
| `pubba.match(query)` | `MatchResult(intent, entity, match, similar, not_here)`; intent is `entity`, `similar` or `none` |
| `pubba.search(query, limit=10, types=None)` | Every entity a query could mean, best first |
| `pubba.next(trail, limit=3, exclude=(), accept=None)` | Predictions: `Suggestion(entity, score, reason, text)` |
| `pubba.related(id, kinds=None, limit=None)` | Neighbours, strongest first: `Related(entity, weight, link, reason, text)` |
| `pubba.autocomplete(typed, trail=(), limit=3)` | Type-ahead |
| `pubba.explain(reason, item)` | A reason as a sentence |
| `pubba.track.guide_opened() / guided_to(id, via) / reached(goal)` | Measurement moments, checked so no visitor text gets in |
| `create_guide(pubba, trail=, route=, chips=, nudge=NudgePolicy(), prefer=, accept=, fallback=, line=, templates=, now=)` | The headless navigator: `ask`, `chips`, `visited`, `follow`, `nudge`, `opened`, `reached` |
| `create_trail(max=24, storage=None, key=...)` | The visitor's trail; `storage` has `get_item` / `set_item` |
| `create_events(goals=None)`, `summarise(events)` | Events (dicts with the spec's field names), and one visit's funnel |

Reasons are dicts (`{"kind": "same-stack", "to": "project:kiri-wallet", "direction": "in", "via": ["Flutter", "Dart"]}`),
the same shape in every runtime. Behaviour is specified in the repository's
`spec/SPEC.md`.

## Tests

```bash
python -m unittest discover -s tests
```

runs the shared conformance suite from the repository's `conformance/` folder.

MIT © Tharindu Athapaththu
