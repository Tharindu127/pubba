# The pubba.json format

```jsonc
{
  "preset": "portfolio",            // or "none"
  "presetOptions": { "pronoun": "she", "owner": "Nimali" },
  "portfolio": "./portfolio.json",  // portfolio preset only: a path or the object itself
  "entities": [],                   // extra entities, on top of the preset's
  "links": [],                      // extra links
  "config": {}                      // layered over the preset's config
}
```

## Entity

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique and stable, conventionally `type:key` |
| `type` | yes | A key of `config.types` |
| `label` | yes | Full name |
| `short` | | How it reads inside a sentence ("Software Engineer II") |
| `aliases` | | Other names people type: short forms, abbreviations, old names |
| `text` | | Its own words. The `topics` and `named-in` rules read this; include the title if it should count |
| `url` | | Its page |
| `weight` | | 0 to 1: how much a link to it says. Common tools 0.4, core skills 1 |
| `mentionAs` | | Names that count when another text mentions it. Default: the label. `false` for never |
| `data` | | Anything else. Exports read `description`, `image`, `date`, `jobTitle`, `company`, `end`, `sameAs`, `email` |

## Link

`{ "from": "project:a", "kind": "built-with", "to": "tech:Flutter", "weight": 0.9, "via": ["…"] }`

Weight, when missing: the kind's `weightFrom` end entity's `weight`, else the
kind's `weight`, else 1. A pair of entities keeps only its **first** link:
content links come first, then rules in order, so put the most specific first.
Entities with no links are dropped.

## Config

```jsonc
{
  "types": {
    "project": {
      "label": "Project", "plural": "Projects",
      "destination": true,              // worth suggesting; false for platforms and topics
      "match": { "tier": 1, "mode": "title", "firstWord": true, "minLength": 0, "minWordsLength": 0, "skip": false },
      "similar": ["same-stack"]         // kinds that answer "anything like X?"
    }
  },
  "kinds": {
    "built-with": { "label": "built with", "pull": 0.9, "weight": 0.7, "weightFrom": "to" }
  },
  "rules": [ /* see below, applied in order */ ],
  "next": { "recency": 0.6, "secondStep": 0.4, "hubDamping": 3, "sectionBoost": 0.08, "sections": { "projects": "project" } },
  "match": { "stopWords": ["the", "app"], "ignore": ["Nimali"], "similarPattern": "\\b(like|similar)\\b" },
  "templates": { "built-with": { "out": "{item} is built with {other}.", "in": "{item} is part of {other}'s stack." } }
}
```

### Matching

Tiers are tried lowest first; the first tier with any hit wins, and inside a
tier the highest score wins.

- `title` mode: the whole name or alias in the query (score 100 + length), or
  every significant word of it, typos allowed (50 + words), or with `firstWord`
  the first significant word alone (20).
- `phrase` mode: the name as a fuzzy phrase, longest first. Use it for skills and
  tags, where "react native" must beat "react".
- Typos: plurals, prefixes and one edit (two for words of 7+ letters) count.
  Words under 4 letters and names with symbols (`c#`, `next.js`) must be exact.

### Rules

| `type` | Fields | Makes |
| --- | --- | --- |
| `shared` | `kind, among, through[], minWeight?, min? (2), base? (0.5)` | Links two `among` items that share `min`+ targets through `through` kinds. Weight `base + (1-base)·shared/union`; `via` = shared labels |
| `co-occur` | `kind, among, through[], minWeight?, min? (2), saturate? (4)` | Links two targets used together by `min`+ items. Weight `min(n/saturate, 1)`; `via` = the items |
| `label-prefix` | `kind, among, weight?` | "Dune" → "Dune Messiah" |
| `named-in` | `kind, named[], in?[], direction?, weight?, weightFrom?, minNameLength?` | An entity's `text` names another (`mentionAs` or label), as a whole word |
| `topics` | `kind, topics[{key,label,pattern}], topicType? ("topic"), in?[], weight?` | `topic:<key>` entities from regex matches on `text` |

### Templates

Keyed by reason kind (a link kind, `section`, `typed`, `match`), or
`<kind>.<type>` for one type (`section.game`). A template is:

- a string with `{item}`, `{other}`, `{otherLower}`, `{via}` (first three),
  `{kind}`, `{name}`; a `[...]` part is dropped when a token in it is empty;
- `{ "cases": [{ "item": "role", "other": "market", "direction": "in", "text": "…" }], "out": "…", "in": "…", "default": "…" }`;
- in code only, a function `(ctx) => string`.

`direction` is `out` when the suggested item is the link's `from`.

## Reasons

Every result has `reason` and `text`:

```json
{ "kind": "same-stack", "to": "project:kiri-wallet", "direction": "in", "via": ["Flutter", "Dart"] }
```

`to` is the entity at the other end of the link that produced it; `seed` is the
trail step it came from when that took two steps. `section` reasons come from a
`section:<name>` trail step alone; `typed` from autocomplete (`by`: prefix,
word-prefix, contains); `match` from search (`by`: name, alias, words,
first-word, phrase; `name`: what matched).

## The portfolio preset's input

```jsonc
{
  "person": { "name": "", "short": "", "url": "", "jobTitle": "", "email": "", "sameAs": [], "description": "" },
  "roles": [{ "title": "Software Engineer II — Mobile", "company": "", "location": "", "start": "", "end": "Present", "points": [""], "aliases": [] }],
  "projects": [{ "slug": "", "title": "", "subtitle": "", "description": "", "fullDescription": "", "category": "Mobile, Web", "tags": ["founded"], "technologies": [""], "url": "", "image": "", "date": "", "aliases": [] }],
  "skills": [{ "name": "", "category": "Languages | Frameworks | Platforms | Design | Tools", "aliases": [] }],
  "markets": [{ "code": "LK", "name": "Sri Lanka", "aliases": [] }],
  "games": [{ "id": "", "title": "", "platform": "PS5", "genre": "", "note": "", "aliases": [] }],
  "creative": [{ "id": "", "title": "", "platform": "YouTube", "kind": "channel | page | writing | art", "description": "", "aliases": [] }],
  "areaLabels": { "ps5": "PS5" }
}
```

A project ships in a market when its category, subtitle or descriptions name
the market or an alias. A project is `made-at` a role when the role's title or
points name the project's first distinctive word ("Kiri" for "Kiri Wallet").
Roles get their company and short title as aliases.
