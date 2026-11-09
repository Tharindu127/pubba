# pubba

**A small brain for showroom sites.** Describe your content once as entities and
typed links. pubba gives back:

- **Related items, with reasons.** "Kiri Merchant is built on the same stack as Kiri Wallet (Flutter, Dart)."
- **What next, from a visitor's trail.** Spreading activation over the graph: what they are on and have been on lights up, the light spreads along the links, and the brightest things they haven't seen are the suggestions.
- **Typo-tolerant matching.** "flutr", "sri lankan", "UAE", "anything like Kiri Wallet?", and off-topic questions that should match nothing so your site can fall back.

Every result carries a **machine-readable reason** (`{ kind: "same-stack", to, via: ["Flutter", "Dart"] }`)
and a **sentence** rendered from it with templates you can override or translate.

Zero runtime dependencies. ESM. Strict TypeScript. MIT.

pubba is extracted from the guide robot (also called Pubba) on
[Tharindu Athapaththu's portfolio](https://www.tharinduathapaththu.com), where it has run in
production on about 160 entities and 350 links. A parity test runs the site's
original engine beside the library and checks they give the same links, scores
and sentences.

## Showroom sites

A portfolio is a showroom: a set of things, connected, that a visitor walks
through. So is a product catalogue, a course list or a docs site. The engine
doesn't know about any of them: **types, link kinds, weights and rules are
configuration**. Portfolios are the main example and ship as a preset.

| Showroom | Entities | Links |
| --- | --- | --- |
| Portfolio (preset) | person, project, skill, role, market, platform, game, creative work, topic | built-with, shipped-in, made-at, runs-on, same-stack, used-at, used-with, same-series, about, mentions, worked-as, founded |
| Catalogue | product, brand, category, material | made-by, made-of, goes-with |
| Courses | course, topic, instructor, level | about, taught-by, prerequisite, same-series |
| Docs | page, concept, API, version | explains, uses-api, see-also |

The site keeps its own design and UI. pubba is the data model and the brain.

## Install

```bash
npm install pubba
```

Node 22.6+ for the CLI. The library itself runs anywhere modern JavaScript runs,
including the browser.

## Quick start: a portfolio

```ts
import { createPubba, createTrail } from "pubba";
import { fromPortfolio, portfolioConfig } from "pubba/portfolio";

const pubba = createPubba(
  fromPortfolio({
    person: { name: "Nimali Perera", short: "Nimali" },
    roles: [{ title: "Senior Mobile Engineer", company: "Lumen Labs", points: ["Leads the Kiri Wallet team in Flutter and Dart."] }],
    projects: [
      { slug: "kiri-wallet", title: "Kiri Wallet", description: "A wallet for payments in Kenya.", category: "Mobile", technologies: ["Flutter", "Dart", "Firebase"] },
      { slug: "kiri-merchant", title: "Kiri Merchant", description: "QR payments for shops in Kenya.", category: "Mobile", technologies: ["Flutter", "Dart"] },
    ],
    skills: [
      { name: "Flutter", category: "Frameworks" },
      { name: "Dart", category: "Languages" },
      { name: "Firebase", category: "Platforms" },
    ],
    markets: [{ code: "KE", name: "Kenya" }],
  }),
  portfolioConfig({ pronoun: "she", owner: "Nimali" })
);

pubba.related("project:kiri-wallet");
// [{ entity: Kiri Merchant, weight: 1, reason: { kind: "same-stack", to: "project:kiri-wallet", direction: "in", via: ["Flutter", "Dart"] },
//    text: "Kiri Merchant is built on the same stack as Kiri Wallet (Flutter, Dart)." }, …]

const trail = createTrail({ storage: sessionStorage }); // kept for the visit, never sent anywhere
trail.record("project:kiri-wallet");
pubba.next(trail.get()); // top 3, never all of one type, each with a reason and a sentence

pubba.match("anything like kiri walet?"); // { intent: "similar", entity: Kiri Wallet, similar: [Kiri Merchant…] }
pubba.match("what's the weather?");       // { intent: "none" }: fall back to your own answer
pubba.autocomplete("ki", trail.get());    // type-ahead, nearest the trail first
```

Run the fuller example (a fictional portfolio with 8 projects, 15 skills, 3
roles, 5 markets, games and creative work):

```bash
npm run example
```

## Any other site

```ts
import { createPubba } from "pubba";

const shop = createPubba(
  {
    entities: [
      { id: "product:desk", type: "product", label: "Oak Desk", aliases: ["writing desk"] },
      { id: "product:chair", type: "product", label: "Oak Chair" },
      { id: "material:oak", type: "material", label: "Oak", weight: 1 },
      { id: "material:linen", type: "material", label: "Linen", weight: 1 },
      { id: "material:glue", type: "material", label: "Glue", weight: 0.2 },
    ],
    links: [
      { from: "product:desk", kind: "made-of", to: "material:oak" },
      { from: "product:desk", kind: "made-of", to: "material:linen" },
      { from: "product:chair", kind: "made-of", to: "material:oak" },
      { from: "product:chair", kind: "made-of", to: "material:linen" },
    ],
  },
  {
    types: { material: { destination: false }, product: { similar: ["goes-with"] } },
    kinds: { "made-of": { weightFrom: "to", pull: 0.6 }, "goes-with": { pull: 1 } },
    rules: [{ type: "shared", kind: "goes-with", among: "product", through: ["made-of"], minWeight: 1, min: 2 }],
    templates: { "goes-with": "{item} goes with {other}[ (both {via})]." },
  }
);

shop.related("product:desk")[0].text; // "Oak Chair goes with Oak Desk (both Oak, Linen)."
```

## The schema

**Entities:** `id`, `type`, `label`, and optionally `short` (how it reads in a
sentence), `aliases`, `text` (its own words, read by rules), `url`, `weight` (0
to 1: common tools weigh less so they never make two items look alike),
`mentionAs`, `data`.

**Links:** `from`, `kind`, `to`, optional `weight` and `via` (what the two ends share).
A pair keeps only its first link, so the most specific relation wins.

**Derived links** come from rules in the config, applied in order:

| Rule | Example |
| --- | --- |
| `shared` | Two projects sharing two or more core skills are `same-stack` |
| `co-occur` | Two skills used together in two or more projects are `used-with` |
| `label-prefix` | "Skyforge Saga" → "Skyforge Saga II" are `same-series` |
| `named-in` | A role whose story names a project: the project is `made-at` that role |
| `topics` | Any text matching /payment\|wallet/ is `about` Fintech |

Full reference: [skill/references/schema.md](skill/references/schema.md).

## Explainable results

```ts
interface Reason {
  kind: string;             // the link kind, or "section", "typed", "match"
  to?: string;              // the entity at the other end of that link
  direction?: "out" | "in"; // "out" when the suggested item is the link's `from`
  via?: string[];           // what the two share
  seed?: string;            // the trail step it came from, when two steps away
  by?: string;              // how text matched: name, alias, words, first-word, phrase, prefix…
  name?: string;            // what matched
}
```

The sentence is a rendering of the reason. Templates are keyed by kind, or
`kind.type` for one type, and can branch on direction and on the types at each end:

```ts
portfolioConfig({ pronoun: "they" }) // "As Senior Mobile Engineer, they built Kiri Wallet."

pubba.explain(reason, "project:kiri-wallet", {
  "built-with": { out: "{item} est construit avec {other}.", in: "{item} fait partie de la stack de {other}." },
});
```

Tokens: `{item}`, `{other}`, `{otherLower}`, `{via}`, `{kind}`, `{name}`. A
`[...]` part disappears when a token inside it is empty: `"{item} goes with {other}[, as in {via}]."`.

## API

| | |
| --- | --- |
| `createPubba(dataset, config?)` | Builds the graph once; returns the object below |
| `pubba.related(id, { kinds?, limit?, destinationsOnly?, accept? })` | Neighbours, strongest first, each `{ entity, weight, link, reason, text }` |
| `pubba.next(trail, { limit?, exclude?, accept? })` | Predictions `{ entity, score, reason, text }` |
| `pubba.autocomplete(typed, trail?, { limit?, accept? })` | Type-ahead suggestions |
| `pubba.search(query, { limit?, types? })` | Every entity a query could mean, best first |
| `pubba.match(query)` | `{ intent: "entity" \| "similar" \| "none", entity, match, similar }` |
| `pubba.explain(reason, item, templates?)` | A reason as a sentence |
| `createTrail({ max?, storage?, key? })` | `record`, `get`, `clear`, `subscribe` |
| `buildGraph`, `predictNext`, `related`, `search`, `match`, `autocomplete`, `renderReason`, `mergeConfig` | The same, as functions over a `Graph` |
| `normalize`, `editDistance`, `closeTo`, `hasPhrase`, `mentions` | The text helpers behind matching |
| `pubba/portfolio` | `portfolioConfig`, `portfolioTemplates`, `fromPortfolio`, `PORTFOLIO_TOPICS`, `skillWeight`, `callName` |
| `pubba/eval` | `evaluate`, `evaluateQueries`, `evaluateTrails`, `regressions`, `formatReport` |
| `pubba/exports` | `toJsonLd`, `validateJsonLd`, `toLlmsTxt` |

## The evaluation harness

A sample query set with expected results (typos, one-word input, "anything
like X", place and role questions, off-topic queries that must match nothing)
and sample trails with expected top-3 suggestions. The script scores both and
fails on a drop:

```bash
npx pubba eval pubba.json --queries eval/queries.json --trails eval/trails.json --baseline eval/baseline.json
```

```
Matching     100.0%  (38/38 queries)
  alias        4/4
  off-topic    8/8
  one-word     10/10
  place        7/7
  role         5/5
  similar      4/4
  typo         8/8
Suggestions  100.0%  (12/12 trails fully right, 100.0% with at least one)
```

**On real data.** Run against the live content of the portfolio it was extracted
from (160 entities, 327 links; 49 queries and 16 trails written from the content),
the preset alone scored 87.8% matching and 93.8% suggestions. The failures
pointed at three opt-in matching options (`typoMinLength`, `distinctWords`,
`partialWords`) and an `editions` rule for "Student rePo (Android)" ↔ "(Web)";
with them on, it scores 98.0% and 100%. The options are off by default so the
preset behaves exactly like the site; turn them on for new sites.

On the fictional example, the first run scored 97.4%, because "field
notes" (the start of an article's title) matched Node.js, whose alias "node" is
a near miss of "notes". An alias on the article fixed it, and the test suite
keeps a case proving the harness catches it.

`npm run eval` runs it on the example, and CI runs it on every push.

## CLI

```
pubba inspect  <pubba.json>
pubba preview  <pubba.json>                  the mapping as Markdown tables
pubba match    <pubba.json> "<query>"
pubba related  <pubba.json> <id>
pubba next     <pubba.json> <id> [<id>…]
pubba eval     <pubba.json> --queries <f> --trails <f> [--baseline <f>] [--update-baseline] [--json]
pubba jsonld   <pubba.json> [--base-url <url>] [--out <f>]
pubba llms     <pubba.json> [--base-url <url>] [--out <f>]
```

A `pubba.json` holds a preset, content and config:
[examples/portfolio/pubba.json](examples/portfolio/pubba.json).

## The Claude skill

[`skill/`](skill/SKILL.md) is a Claude skill that sets pubba up for a site and keeps it healthy:

1. Maps the site's existing content (JSON, Markdown, a CMS export, a database
   dump) to entities, types, aliases, link kinds, rules and weights, and shows
   the mapping for review before writing anything.
2. Generates schema.org JSON-LD (Person, SoftwareApplication, CreativeWork, with
   creator, knowsAbout and worksFor) and an `llms.txt` from the graph, and
   validates the JSON-LD.
3. Builds a sample query set from the site's own content, runs the harness, and
   suggests fixes to aliases, weights or rules.

Copy or link the folder into `~/.claude/skills/pubba` (or a project's
`.claude/skills/`).

## Behaviour notes

- **Parity with the portfolio.** `test/parity.test.ts` runs a line-for-line port
  of the portfolio's original graph and "what next" code beside the library on
  two datasets, over every single-step trail and many longer ones. Entities,
  links, weights, scores and sentences match.
- The preset's Telecom topic leaves out the portfolio site's own operator names
  (Ooredoo, Vodafone, Batelco, YOOZ); a site adds its own with a `topics` rule
  in its config.
- Matching names use whole words (`"oman"` no longer matches inside `"woman"`);
  the site's matcher used substrings.
- Known limit: a query naming something not in the graph that contains a name
  that is ("react native" when only React is listed) resolves to that name.

## Roadmap

**v1 (this release):** the schema, the graph builder with derived-link rules,
related items, what-next from a trail, search, autocomplete and the matcher;
machine-readable reasons with overridable sentence templates; the evaluation
harness; the portfolio preset; JSON-LD and llms.txt helpers; the Claude skill.

**v2: knowing the visitor, measuring, exporting**

- **Intent profiles.** Infer a visitor's likely intent from their trail ("mobile
  hiring" versus "web client") and weight related items and predictions by it.
  Defined per site as small sets of weighted entities and link kinds. Runs in the
  browser from the trail alone: no identity, nothing stored beyond the visit.
- **Measurement hooks.** Privacy-safe events (guide opened, guided to item,
  reached contact) that a site can forward to any analytics tool. Never the text
  of a question or answer; pubba only emits, the site decides where they go.
- **Exports.** Full schema.org JSON-LD and `llms.txt` generation from the graph,
  replacing hand-written JSON-LD, building on the v1 helpers.

**v3: any AI, and AI assistants as visitors**

- **A model-agnostic AI adapter.** Gemini, Claude, OpenAI or none, with a
  timeout, rate limits (per visitor and a daily cap), a kill switch and silent
  fallback to the local engine. The model sees the graph's knowledge file, the
  visitor's trail and the engine's predictions with their reasons. With "none",
  the guide still works fully from local matching and the graph.
- **An MCP server.** Read-only tools over the published graph: `search`
  (typo-tolerant), `related` (with structured reasons) and `explain` (how two
  items connect, as a path of links), so AI assistants can query a portfolio
  directly.

## Development

```bash
npm test          # unit, parity and eval tests (node:test, no build needed)
npm run eval      # the harness on the example; fails below eval/baseline.json
npm run example
npm run typecheck
npm run build     # dist/ with type declarations
```

## License

[MIT](LICENSE) © Tharindu Athapaththu
