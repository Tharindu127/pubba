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
| `createEvents({ goals? })`, `createPubba(data, config, { events })` | Privacy-safe measurement events; `pubba.track.guideOpened / guidedTo / reached` |
| `summarise(events)` | One visit's funnel: `usedGuide`, `guidedTo`, `reached`, `guidedBeforeGoal` |
| `createGuide(pubba, { trail?, route?, chips?, nudge?, templates?, now? })` | The headless navigator: `ask`, `chips`, `visited`, `follow`, `nudge`, `opened`, `reached` |
| `compileBundle(graph, { withData? })`, `loadBundle(json, { events? })` | The finished graph as portable JSON, and a runtime from it |
| `buildGraph`, `predictNext`, `related`, `search`, `match`, `autocomplete`, `renderReason`, `mergeConfig` | The same, as functions over a `Graph` |
| `normalize`, `editDistance`, `closeTo`, `hasPhrase`, `mentions` | The text helpers behind matching |
| `pubba.graph.unlinked` | Entities with no links: never suggested, but `match` and `search` still find them |
| `pubba/portfolio` | `portfolioConfig`, `portfolioTemplates`, `fromPortfolio`, `PORTFOLIO_TOPICS`, `APP_CATEGORY`, `skillWeight`, `callName` |
| `pubba/eval` | `evaluate`, `evaluateQueries`, `evaluateTrails`, `regressions`, `formatReport`, `generateCases`, `lint`, `formatLint` |
| `pubba/exports` | `toJsonLd`, `validateJsonLd`, `toLlmsTxt` |

### Matching options (`config.match`)

| Option | Effect |
| --- | --- |
| `typoMinLength` | Words shorter than this must be spelled right ("hire" isn't the skill Hive). Preset: 5 |
| `distinctWords` | A word found in only one name, spelled right, is enough on its own ("ragnarok"). Preset: on |
| `partialWords` | A name of 3+ words matches with all but one ("red dead"). Preset: on |
| `precise` | Spelled right beats a typo of a longer name; ties go to the name covering more of the query. Preset: on |
| `notDistinct` | Words never distinctive alone. Preset: page, channel, article, piece |
| `notHere` | Names the site doesn't have ("React Native" next to React): the query matches nothing, with `notHere` set |
| `ignore`, `stopWords`, `similarPattern` | The owner's name, words too common to count, and what "anything like X?" looks like |

`portfolioConfig({ legacyMatching: true })` turns the first five off, matching
the original site exactly.

### Rules beyond the preset

`extraRules` add to a preset's rules instead of replacing them, and
`"before": "<rule id>"` runs one earlier so it wins the pair. `label-prefix`
with `stems: true` links editions: "Student rePo (Android)" ↔ "(Web)".

### JSON-LD options (`toJsonLd(graph, options)`)

| Option | Effect |
| --- | --- |
| `baseUrl` | Makes urls absolute; ids stay under it, even for items hosted elsewhere |
| `knowsAbout` | A curated list for the Person, instead of every skill |
| `include` | Only these entity ids besides the person: one project's page |
| `includeEmail` | Publish the person's email. Default off |
| `types` | schema.org type per entity type (projects are SoftwareApplication, creative pieces CreativeWork) |

Software apps get `applicationCategory` (from `data.applicationCategory`; the
portfolio preset picks one of Google's app types from the project's topics) and
`operatingSystem` (from `data.operatingSystem`: the project's platforms), the two
properties Google's Software App rich result needs without a price or rating.

## The guide: `createGuide`

The navigator without any UI or personality. What it looks like (a search bar,
a chat bubble, a bot, a character) is entirely yours; the guide decides what
to say, where to go and when to nudge.

```ts
import { createGuide } from "pubba";

const guide = createGuide(pubba, { trail, route: (e) => e.url });

guide.ask("anything like kiri walet?");
// { kind: "similar", text: "Kiri Merchant is built on the same stack as Kiri Wallet (Flutter, Dart).",
//   action: { type: "open", id: "project:kiri-merchant", url: "https://nimali.example.com/projects/kiri-merchant" }, chips: [] }
guide.ask("best pizza near me"); // { kind: "none", text: "I couldn't find that here. These might help:", chips: [...] }

guide.visited("project:sira");          // the visitor went there on their own
guide.follow("project:adventurers", "chip"); // the guide sent them (measured)
guide.chips();                          // follow-ups for where they are now
guide.nudge();                          // a suggestion to show unprompted, or null
```

- **Replies** are `{ kind, text, action?, chips }` with `kind` one of `open`,
  `similar`, `none` (nothing here answers: show the chips, or ask your AI),
  `not-here` (a name the site doesn't have) and `start` (an empty question).
- **Nudges** follow Pubba's rules: only after a step the visitor took
  themselves, 9 s later, once per item, at least 60 s apart, and only with a
  real link and a score of 0.3 or more. Call `nudge()` after
  `guide.nudgePolicy.delayMs`; it enforces the rest. All three numbers are options.
- **Words** come from templates (`open`, `similar`, `none`, `notHere`, `start`,
  `nudge`), so the guide speaks in the site's voice and language. Add
  `open.<type>` (and `similar.<type>`, `nudge.<type>`) for wording per kind of
  thing, with `{label}`, `{line}` (from your `line(entity)`), and for similar
  replies `{of}` and `{list}` ("Parcelo Courier (TypeScript, Node.js), …").
- **"Anything like X?"** answers with X's similar items. To keep it to some
  types, set `types.<type>.similar: false` on the others in the config: those
  read as naming X, and the guide opens it.
- **Site options:** `accept(entity)` keeps things a chip can't lead to out of
  every suggestion; `fallback({ kind, entity })` gives chips when the trail
  suggests nothing (strings become question chips, `{ label, question }`);
  `nudge.prefer(entity)` picks which prediction a nudge favours.

## Bundles: one brain, any platform

`pubba compile pubba.json --out pubba.bundle.json` writes the finished graph
as one versioned JSON file: entities, links with their final weights, runtime
settings and sentence templates. All the rule work happens there, once.
`loadBundle(json)` answers from it exactly as the full build does (checked on
the portfolio's live content: 1,251 answers compared, no differences). The
portfolio's bundle is 6.4 KB gzipped.

This is how pubba reaches other languages: a small runtime per language loads
the same bundle, implements [spec/SPEC.md](spec/SPEC.md), and must pass the
[conformance suite](conformance/README.md) (4,698 cases over five sample sites)
to count as done. The TypeScript, Python, Kotlin and Swift runtimes all pass 100%. Next: Dart,
C# and PHP ([docs/multiplatform-design.md](docs/multiplatform-design.md)).

### Python

```bash
pip install pubba
```

```python
from pubba import load_bundle, create_guide

pubba = load_bundle(open("pubba.bundle.json").read())
pubba.match("flutr").entity.id   # "tech:Flutter"
create_guide(pubba).ask("anything like kiri walet?").text
```

No dependencies, Python 3.9+, the same answers as TypeScript (the conformance
suite, and 880 cases on the portfolio's live content, with no differences).
See [packages/python](packages/python/README.md).

### Kotlin and Java (Android, JVM)

```kotlin
implementation("com.tharinduathapaththu:pubba:0.5.0")
```

```kotlin
val pubba = Pubba.load(bundleJson)
pubba.match("flutr").entity?.id   // "tech:Flutter"
createGuide(pubba) { route = { "item/${it.id}" } }.ask("anything like kiri walet?").text
```

Only the Kotlin standard library, Java 8 bytecode, usable from Java too. A
Jetpack Compose sample app with a guide is in [examples/android](examples/android).
See [packages/kotlin](packages/kotlin/README.md).

### Swift (iOS, macOS, every Apple platform)

Xcode: **File → Add Package Dependencies…** → `https://github.com/Tharindu127/pubba`.

```swift
let pubba = try Pubba.load(bundleData)
pubba.match("flutr").entity?.id   // "tech:Flutter"
Guide(pubba, route: { "item/\($0.id)" }).ask("anything like kiri walet?").text
```

No dependencies beyond Foundation; `Sendable`, and clean in Swift 6 mode. A
SwiftUI sample app with a guide is in [examples/ios](examples/ios). See
[packages/swift](packages/swift/README.md).

### HTTP and MCP: `pubba serve`, `pubba mcp`

For a platform without a runtime yet, or for AI assistants:

```bash
npx pubba serve pubba.bundle.json --port 8787 --cors https://example.com
```

```bash
npx pubba mcp pubba.bundle.json
```

- `serve`: read-only JSON over HTTP: `GET /match?query=`, `/search?query=`,
  `/next?trail=a,b`, `/related?id=`, `/autocomplete?query=`, `/ask?query=&trail=`
  (the guide's reply), `/explain?from=&to=` (how two items connect) and
  `/health`. Stateless: the trail comes with each request and nothing is kept
  or logged. It listens on 127.0.0.1 unless you pass `--host`.
- `mcp`: an MCP server over stdio with read-only tools `search`, `match`,
  `related`, `next` and `explain`, so an AI assistant can look a site up
  directly. Add it to an MCP client as the command `npx pubba mcp <bundle>`.
- In code: `serve`, `serveMcp`, `handleMcp`, `answer` and `connection` from `pubba/serve`.

## Measurement events

pubba can tell a site how its guide is used, without tracking anyone. It only
emits events: no storage, no network calls, no visitor or session ids, no
timestamps, and never the text of a question or answer. The site decides where
events go.

```ts
import { createEvents, createPubba, summarise, type PubbaEvent } from "pubba";

const events = createEvents({ goals: ["contact", "resume"] });
const visit: PubbaEvent[] = [];
events.on((e) => visit.push(e)); // or forward to the site's own anonymous log

const pubba = createPubba(data, config, { events });
pubba.next(trail);                        // emits { type: "suggested", source: "next", ids, reasonKinds }
pubba.match("anything like Kiri Wallet?"); // emits { type: "matched", intent: "similar", entityType: "project", by: "name" }
pubba.track.guideOpened();
pubba.track.guidedTo("project:kiri-wallet", "chip"); // unknown ids are dropped
pubba.track.reached("contact");                     // undeclared goals are dropped

summarise(visit); // { usedGuide, guidedTo, guidedToTypes, reached, guidedBeforeGoal }
```

`summarise` gives the funnel rows a guide is judged by: did the visitor use the
guide, did it lead them to a project, and did they reach contact after it did.

## The evaluation harness

Accuracy should stay near 100% as the content grows, so the test set grows with
it. Three parts:

- **Generated cases** (`--generated`), derived from the graph on every run: for
  every item a visitor can be sent to, its name, a typo of it, each alias and
  "anything like it?", plus a trail from it that must reach one of its closest
  siblings. Add a project and its cases appear on the next build.
- **Hand-written cases** for what generation can't know: off-topic questions
  that must match nothing, commands the site handles itself, real visitor
  phrasing, and the trails a person would expect.
- **Lint** (`pubba lint`): content problems that cost accuracy, caught before a
  visitor does. Two items sharing a name fail the build; heavy "core" weights,
  shared first words and dead ends are warnings.

```bash
npx pubba lint pubba.json
npx pubba eval pubba.json --queries eval/queries.json --trails eval/trails.json --generated --baseline eval/baseline.json
```

A drop below the baseline exits 1, so CI fails.

**On real data.** Run against the live content of the portfolio it was extracted
from (160 entities, 327 links):

| | Matching | Suggestions |
| --- | --- | --- |
| Site's original matching (`legacyMatching: true`), 49 hand-written queries, 16 trails | 87.8% | 93.8% |
| The same, with the 243 generated queries and 114 generated trails added | 96.2% | 98.5% |
| Preset defaults + an editions rule + `notHere: ["React Native"]`, hand-written + 243 generated queries, 114 generated trails | **100%** (292/292) | **100%** (130/130) |

Each failure along the way pointed at a fix that is now a matching option
(`typoMinLength`, `distinctWords`, `partialWords`, `precise`, `notHere`) or a rule
option (`stems`, `before`), all covered by tests. Generated cases found four
matcher weaknesses that the hand-written set never hit: "Swift" landing on
SwiftUI, "Saga II" on "Saga", a typo'd whole name losing to a shorter exact one,
and "Odoo REST API" losing to a project's first word.

`npm run eval` runs it on the fictional example (38 hand-written + 83 generated
queries, 12 + 35 trails, all passing), and CI runs it with lint on every push.

## CLI

```
pubba compile  <pubba.json> --out <file> [--with-data]  the bundle every runtime loads
pubba serve    <pubba.json|bundle> [--port 8787] [--host 127.0.0.1] [--cors <origin>]
pubba mcp      <pubba.json|bundle> [--name <server name>]
pubba inspect  <pubba.json>
pubba preview  <pubba.json>                  the mapping as Markdown tables
pubba match    <pubba.json> "<query>"
pubba related  <pubba.json> <id>
pubba next     <pubba.json> <id> [<id>…]
pubba lint     <pubba.json>                  name collisions, heavy weights, dead ends; exits 1 on errors
pubba eval     <pubba.json> [--queries <f>] [--trails <f>] [--generated] [--baseline <f>] [--update-baseline] [--json]
pubba generate <pubba.json> [--out-dir <dir>]  the generated cases, to read
pubba jsonld   <pubba.json> [--base-url <url>] [--out <f>]
pubba llms     <pubba.json> [--base-url <url>] [--out <f>]
```

Every command except `compile` also takes a compiled bundle in place of the
`pubba.json`, answering exactly as a runtime would. A `pubba.json` holds a
preset, content and config:
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
- **Matching is stricter and wider than the site's by default.** The portfolio
  preset turns on `typoMinLength: 5`, `distinctWords`, `partialWords` and
  `precise`, which took real-data matching from 87.8% to 98%+.
  `portfolioConfig({ legacyMatching: true })` matches exactly as the site did.
- Matching names use whole words (`"oman"` no longer matches inside `"woman"`);
  the site's matcher used substrings.
- A query naming something the graph doesn't have but that contains a name it
  does ("react native" with only React) resolves to that name, unless the site
  lists it in `match.notHere`.

## Roadmap

**v1 (0.1.x, released):** the schema, the graph builder with derived-link rules,
related items, what-next from a trail, search, autocomplete and the matcher;
machine-readable reasons with overridable sentence templates; the evaluation
harness with generated cases and lint; the portfolio preset; JSON-LD and
llms.txt helpers; the CLI and the Claude skill. Hardened by switching the
portfolio site to it: see [CHANGELOG.md](CHANGELOG.md).

**Every platform** (design: [docs/multiplatform-design.md](docs/multiplatform-design.md)).
0.3.0 laid the foundation: bundles, the spec, the conformance suite and the
headless guide. 0.4.0 added the Python runtime and `pubba serve` / `pubba mcp`;
0.5.0 the Kotlin runtime and an Android sample; 0.6.0 the Swift runtime and an
iOS sample. Next, Dart (0.7), then C# and PHP (0.8).

**v2: knowing the visitor, measuring, exporting** (design: [docs/v2-design.md](docs/v2-design.md)). Measurement events shipped in 0.2.0; intent profiles and the remaining exports follow the runtimes, so they reach every platform at once.

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
npm test          # unit, parity, conformance and eval tests (node:test, no build needed)
npm run conformance        # regenerate conformance/ after a behaviour change (review the diff)
npm run conformance:check  # fails when conformance/ is out of date (CI runs it)
cd packages/python && python3 -m unittest discover -s tests   # the Python runtime against the same suite
cd packages/kotlin && gradle test                             # the Kotlin runtime against the same suite
swift test                                                    # the Swift runtime against the same suite
npm run eval      # the harness on the example; fails below eval/baseline.json
npm run example
npm run typecheck
npm run build     # dist/ with type declarations
```

## License

[MIT](LICENSE) © Tharindu Athapaththu
