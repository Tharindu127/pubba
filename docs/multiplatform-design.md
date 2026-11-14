# pubba on every platform: design

Status: **agreed 11 Nov 2026** (decisions in section 10). **0.3.0 built**: bundles, spec/SPEC.md, conformance/ and `createGuide`. **0.4.0 built**: the Python runtime (passes the suite 100%), `pubba serve` (HTTP) and `pubba mcp`. **0.5.0 built**: the Kotlin runtime (passes the suite 100%, usable from Java) and a Jetpack Compose sample app. **0.6.0 built**: the Swift runtime (passes the suite 100%, Swift 6 clean) and a SwiftUI sample app.

Goal: any site or app, in any popular language or framework, can use the same
pubba brain (related items with reasons, what-next from a trail, typo-tolerant
matching, measurement events) and a ready-made guide, with **identical
behaviour everywhere** and **nothing to host**.

This replaces the plan's next step: the foundation below becomes 0.3.0, and
intent profiles move after it (docs/v2-design.md), since they'll then reach every
platform at once.

---

## 1. Decision

**Compile once, run everywhere locally; an optional server for the rest.**

```
pubba.json + content ──► pubba compile (TypeScript, build time) ──► pubba bundle (one JSON file)
                                                                      │
        ┌──────────────┬──────────────┬──────────────┬──────────────┬─┴────────────┬──────────────┐
        ▼              ▼              ▼              ▼              ▼              ▼              ▼
   TypeScript       Python         Kotlin         Swift          Dart           C#             PHP
   runtime          runtime        runtime        runtime        runtime        runtime        runtime
   (exists)                                                                                         
        │
        └──► pubba serve (optional HTTP + MCP), for any other platform and for AI assistants
```

- **Build time, TypeScript only:** reading content, link rules, topics,
  weights, lint, evaluation, JSON-LD and llms.txt. Rule-heavy and changes
  most often, so it lives in exactly one place.
- **Run time, one small runtime per language:** load a bundle, then `match`,
  `search`, `next`, `related`, `autocomplete`, reason sentences, the trail,
  events and the guide. About 500 lines each.
- **Optional server:** the TypeScript runtime behind HTTP, and as the v3 MCP
  server. Each site hosts its own if it wants one; nothing depends on a central
  service.

Why not an API as the main route: answers in under 1 ms instead of 50 to 300 ms,
offline, the visitor's trail never leaves the device, nothing to run or pay
for. Why not one core in Rust compiled everywhere: it would rewrite tested code
and ship native binaries per processor (hundreds of KB) where today it's about
9 KB of JavaScript. Revisit only if a runtime hits a speed limit; today a query
takes about 0.5 ms.

## 2. The bundle

One versioned JSON file per site or app, written by `pubba compile pubba.json --out pubba.bundle.json`.

```jsonc
{
  "format": 1,                       // bundle format; runtimes refuse a newer major
  "compiler": "pubba@0.3.0",
  "config": {                        // runtime settings only (no rules)
    "types":  { "project": { "destination": true, "match": { "tier": 1, "firstWord": true }, "similar": ["same-stack"] } },
    "kinds":  { "same-stack": { "pull": 1, "label": "same stack as" } },
    "next":   { "recency": 0.6, "secondStep": 0.4, "hubDamping": 3, "sections": { "projects": "project" } },
    "match":  { "typoMinLength": 5, "distinctWords": true, "partialWords": true, "precise": true, "stopWords": [], "ignore": [], "notDistinct": [], "notHere": [] },
    "templates": { "same-stack": "{item} is built on the same stack as {other}[ ({via})]." }
  },
  "entities": [ { "id": "project:sira", "type": "project", "label": "SIRA", "short": "…", "aliases": [], "url": "/projects/sira" } ],
  "unlinked": [ /* matchable, never suggested */ ],
  "links":    [ { "from": "…", "kind": "built-with", "to": "…", "weight": 1, "via": [] } ],
  "index":    { "distinctWords": ["ragnarok", "…"] }
}
```

- **Order is part of the format.** Entities and links keep the order the
  compiler produced; runtimes must keep it (it decides ties).
- **Precomputed so runtimes stay simple:** final link weights, the "via" lists,
  unlinked items, distinct words. Topic and mention patterns never ship.
- **Templates must be text.** A template written as a JavaScript function can't
  cross languages: `compile` fails and names it. Text templates with cases
  cover every sentence in use today.
- **Optional `data`** per entity (description, image…) only when asked
  (`--with-data`), so app bundles stay small.
- **Size:** this portfolio's graph is 48 KB raw, 5.8 KB gzipped.

## 3. One behaviour, written down: the spec

`spec/SPEC.md`: every rule a runtime implements, in plain words plus formulas
(most of it already exists in LIBRARY_FACTS.md and the README). It pins down
the things languages do differently:

| Risk | Rule |
| --- | --- |
| Text normalisation | Unicode NFKD, drop combining marks, lowercase with the invariant locale, map anything outside `a-z 0-9 + # .` and space to a space, collapse spaces |
| Regular expressions | Runtimes need none except `similarPattern`, which is limited to word lists in `\b(a\|b\|c d)\b` form; runtimes may match it as a word list |
| Edit distance | Damerau "optimal string alignment" (a swap of neighbours is one edit), on code units after normalisation |
| Sorting | Stable sorts only, with the exact comparator chains listed in the spec; ties keep bundle order |
| Maps | Iteration in insertion order (Kotlin LinkedHashMap, Swift ordered arrays, C# lists, not Dictionary order) |
| Numbers | 64-bit floats, operations in the order the spec gives; tests compare scores to 1e-9 |
| Strings in sentences | Templates filled by plain replacement; `[...]` parts dropped when a token inside is empty |

## 4. The conformance suite

`conformance/`, generated by the TypeScript reference and run by every runtime's CI:

```
conformance/
  bundles/                 portfolio-fiction, portfolio-edge-cases, catalogue, courses, docs
  cases/<bundle>/
    match.jsonl            {query} -> {intent, entity, score, by, name, similar[]}
    search.jsonl           {query, limit, types} -> [{id, score, tier}]
    next.jsonl             {trail, limit, exclude} -> [{id, score, reason, text}]
    related.jsonl          {id, kinds, limit} -> [{id, weight, reason, text}]
    autocomplete.jsonl     {typed, trail} -> [{id, by}]
    explain.jsonl          {reason, item} -> text
    normalize.jsonl, distance.jsonl
    events.jsonl           {calls} -> [events]
    guide.jsonl            {conversation} -> [replies]
```

- Thousands of cases, mostly generated from the bundles (every name, typos,
  every single-step trail, random multi-step trails), plus hand-written edge
  cases. Today's 73 tests and the parity test become the seed.
- A runtime is **done** when it passes 100%. A behaviour change lands in the spec
  and the cases first; every runtime's CI then shows exactly what to catch up on.
- The TypeScript runtime must pass it too, so the reference can't drift from
  its own spec.

## 5. The guide: `createGuide`

The navigator part of Pubba, without any UI or personality, so any design can
sit on top (a character, chat bubble, command palette, sidebar, voice).

```ts
const guide = createGuide(pubba, {
  trail,                              // the visitor's trail
  routes: { project: (e) => `/projects/${e.id.slice(8)}` },   // where an entity lives in this app
  ai: null,                           // optional, v3: an adapter with timeout and fallback
  events,                             // optional
});

guide.ask("anything like kiri walet?")
// { text: "Kiri Merchant is built on the same stack as Kiri Wallet (Flutter, Dart).",
//   action: { type: "open", id: "project:kiri-merchant", url: "/projects/kiri-merchant" },
//   chips: [{ label: "Flutter", id: "tech:Flutter" }, …],
//   intent: "similar" }
guide.visited("project:sira");        // record a step, emit events
guide.nudge()                         // a suggestion to show now, or null (the timing policy)
guide.chips()                         // follow-ups for the current trail
```

- **Answering order:** the guide's own answer from `match` first; the AI only
  when nothing matched and an adapter is configured (v3); a silent fallback
  ("here's where to start", with chips) when neither has an answer. Never an error.
- **Nudge policy** (from Pubba): only after a step the visitor took themselves,
  after `nudgeDelayMs` (default 9000), once per item, at least `nudgeGapMs`
  (default 60000) apart, only with a real link and a score of at least 0.3.
  The UI asks; the guide decides.
- **Words** come from templates (reply, nudge, fallback lines), overridable and
  translatable, so a site gives its guide its own voice.
- Part of every runtime and of the conformance suite (`guide.jsonl`).

## 6. Platforms and packages

All names checked free on 11 Nov 2026.

| Order | Runtime | Package | Reaches |
| --- | --- | --- | --- |
| done | TypeScript | npm `pubba` | Web (React, Next, Vue, Svelte, Angular, Astro), Node, Deno, Bun, edge functions, Electron; React Native and Expo with an async storage adapter |
| 1 | Python | PyPI `pubba` | AI agents and backends (FastAPI, Django), MCP servers, data teams |
| 2 | Kotlin (JVM, Java-friendly) | Maven `com.tharinduathapaththu:pubba` | Android in Kotlin and Java, Java servers; Kotlin Multiplatform later |
| 3 | Swift | Swift Package (`Pubba`), optionally CocoaPods `Pubba` | iOS, iPadOS, macOS, watchOS, visionOS |
| 4 | Dart | pub.dev `pubba` | Flutter on every target |
| 5 | C# | NuGet `Pubba` | .NET MAUI, Blazor, ASP.NET, Unity |
| 6 | PHP | Packagist `tharindu127/pubba` | WordPress, WooCommerce, Laravel |
| any | HTTP / MCP | `pubba serve` (npm) | Go, Ruby, Rust, Elixir, low-code tools, AI assistants |

One repository (this one) holds every runtime under `packages/<language>/`,
plus `spec/` and `conformance/`, so a change and its effect on every runtime are
one pull request. Each package publishes to its own registry from CI.

## 7. The skill on any platform

1. **Detect** the project's language and framework (package.json, pubspec.yaml,
   build.gradle, Package.swift, *.csproj, composer.json…).
2. **Map content** as today: from files, a CMS export, or (for apps) sample API
   responses, into `pubba.json`. Show the mapping before writing it.
3. **Compile** in the build: add `pubba compile` to the project's build, or to
   the backend that serves content (apps whose content comes from an API get
   the bundle from their backend, refreshed when content changes).
4. **Add the runtime** package for the language and load the bundle.
5. **Build the guide UI** in the platform's own components and the site's own
   design: React/Vue/Svelte, SwiftUI, Jetpack Compose, Flutter widgets, MAUI, a
   WordPress block. Keyboard and screen reader friendly. Ask which form (a
   character, chat bubble, palette, sidebar) before building.
6. **Verify:** lint and evaluation on the content (one score holds for every
   runtime), a run of the app, and the runtime's own conformance check.

## 8. Releases

| Version | Content | Done when |
| --- | --- | --- |
| 0.3.0 | Bundle format and `pubba compile`; spec; conformance suite; `createGuide` in TypeScript; the TypeScript runtime loads bundles | TypeScript passes 100% of conformance; this portfolio runs from a bundle with no visible change |
| 0.4.0 | Python runtime; `pubba serve` (HTTP + MCP) | Both pass conformance; an MCP client can search and explain the portfolio |
| 0.5.0 | Kotlin runtime + Compose guide in the skill | Conformance 100%; a sample Android app with a guide |
| 0.6.0 | Swift runtime + SwiftUI guide | Same, on iOS |
| 0.7.0 | Dart runtime + Flutter guide | Same, on Flutter |
| 0.8.0 | C# and PHP runtimes + MAUI and WordPress guides | Same |
| then | Intent profiles (all runtimes at once), the rest of the exports, AI adapters (v3) | |
| 1.0.0 | After real use on at least three platforms | No format or API change needed |

Each runtime ships with a small sample app and a skill test on a project that
isn't this portfolio.

## 9. Cost

- **Running:** nothing. Every runtime works on the device; the optional server
  is the site's own and costs little (an answer is about 0.5 ms of compute).
- **Building:** about one to two focused sessions per runtime, plus its guide
  builder in the skill. The conformance suite is a one-time investment that
  makes each runtime's correctness measurable.
- **Maintaining:** a behaviour change is made in TypeScript, the spec and the
  cases, then in each runtime; CI shows every runtime that hasn't caught up.
  Keeping changes rare (the build-time half changes most, and it's TypeScript
  only) is what keeps this affordable.
- **AI**, when a site adds it (v3): the model provider's per-question price; the
  local guide answers first, so most questions cost nothing.

## 10. Decisions (11 Nov 2026)

- **Runtimes:** Python first after the 0.3.0 foundation, then Kotlin, Swift, Dart, C#, PHP.
- **One repository** for the spec, the conformance suite and every runtime.
- **Guide designs:** no fixed menu. The site or app owner defines the form (a
  search bar, a chat bubble, a bot, a character, anything), and the skill builds
  that. So `createGuide` stays fully headless and adaptable: replies, actions,
  chips and nudges as data, with nothing about how they look, and accuracy held
  by the conformance suite and the evaluation.
- **Hosted "pubba cloud":** out of scope.
- **Maven namespace:** `com.tharinduathapaththu` (the owner's domain, verified
  once with a DNS TXT record; keep the domain renewed, since the namespace
  follows it).

The questions as asked:

1. **Order of runtimes.** Python first (AI agents, MCP) as above, or Kotlin and
   Swift first because they're what you build day to day?
2. **One repo or one per language?** One repo (suggested) keeps the spec, cases
   and every runtime in step; separate repos look tidier per registry but drift.
3. **Guide designs the skill offers first:** character (like Pubba), chat
   bubble, command palette, sidebar. All four, or start with two?
4. **Maven namespace:** `io.github.tharindu127` (free, tied to your GitHub) or a
   domain you own (for example `com.tharinduathapaththu`)?
5. **A hosted "pubba cloud"** (a business, not a technical need): out of scope
   for now?
