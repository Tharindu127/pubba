# pubba v2 design: intent, measurement, exports

Status: **agreed 10 Nov 2026**, events first (see §6).
Scope: the three v2 items of LIBRARY_PLAN.md. v3 (AI adapter, MCP server) is out
of scope, but nothing here should block it.

Everything stays true to v1's rules: zero runtime dependencies, deterministic,
explainable (every effect has a machine-readable reason and a sentence),
measurable (the eval harness covers it), and the portfolio preset is the
reference example.

---

## 1. Intent profiles

### The problem

`next(trail)` treats every visitor alike. A recruiter hiring for mobile who
opens two iOS apps and the current role should be led to the other shipped
mobile apps and the contact section. A web client who opens SIRA and
Adventurers should be led to the web work. Today both get whatever is most
connected to their last few steps.

### Defining intents

Per site, in config. Small and readable, like the rest of the config:

```jsonc
"intents": {
  "mobile-hiring": {
    "label": "Hiring for mobile",
    // What the visitor touches when they have this intent: entity ids, types, link kinds.
    "signals": { "entities": { "area:ios": 1, "area:android": 1, "tech:SwiftUI": 0.8, "tech:Flutter": 0.8 },
                 "types": { "role": 0.6 }, "kinds": { "shipped-in": 0.4 } },
    // What to lean towards once it's likely.
    "boost":   { "types": { "project": 1.3, "role": 1.2 }, "entities": { "area:ios": 1.2, "area:android": 1.2 }, "kinds": { "made-at": 1.2 } }
  },
  "web-client": { "label": "Looking for a web build", "signals": { … }, "boost": { … } }
}
```

- **signals:** how much each kind of step says about the intent. An entity's own
  weight, plus its type, plus the kinds of link it was reached by.
- **boost:** multipliers applied to suggestion scores while the intent is
  likely. Neutral is 1; nothing below 0.5 or above 2 (clamped), so an intent can
  reorder but never hide the rest of the site.

### Inferring the intent

From the trail only, in the browser, with the same recency weighting `spread`
already uses (0.6 per step back):

1. For each intent, sum the trail's signals, recency-weighted. A step also counts
   at half strength through its one-step neighbours, so opening "Batelco by
   Beyon" says "iOS" even though the visitor never opened the iOS area.
2. Normalise to a distribution over intents plus an implicit **"browsing"**
   intent (a fixed prior of 1), so a short or mixed trail stays mostly "browsing"
   and nothing is boosted.
3. **Likely** = the top intent's share is at least `minConfidence` (default 0.5)
   and the trail has at least `minSteps` real steps (default 2). Otherwise no
   boost at all.

```ts
pubba.intent(trail)
// { likely: "mobile-hiring" | null, confidence: 0.64,
//   scores: { "mobile-hiring": 0.64, "web-client": 0.09, browsing: 0.27 },
//   evidence: [{ step: "project:batelco-by-beyon", via: "area:ios", weight: 0.48 }, …] }
```

### Using it

- `next(trail, { intent: "auto" | "<id>" | null })`, default `"auto"` when
  intents are configured. The boost multiplies each candidate's spread score
  before ranking and mixing. The per-type mix rule stays, so a "mobile hiring"
  visitor still sees variety.
- `related(id, { intent })` the same way; `autocomplete` unchanged (typing beats
  guessing).
- **Explainable:** a suggestion whose rank changed because of the intent gets
  `reason.intent = { id, boost }`, and templates can say so:
  `"intent.mobile-hiring": "{item} is another mobile app {they} shipped."`
  When the intent didn't change the order, the reason is unchanged.

### Measuring it (eval)

Trail cases gain an optional `intent`:

```json
{ "trail": ["project:batelco-by-beyon", "role:0"], "intent": "mobile-hiring", "expectAny": ["project:myooredoo-algeria", "project:odoo-merchant"] }
```

The report adds an **intent accuracy** (is `pubba.intent(trail).likely` the
expected one, including `null` for browsing trails) and shows suggestion
scores with and without intents, so a site can see whether intents actually
help. Lint warns on an intent whose signals name ids that don't exist, and on
two intents whose signals overlap so much they can't be told apart.

### Privacy

The intent is computed in the browser from the trail and never stored or sent
by pubba. It's a guess about the visit, not about the person, and it disappears
with the trail (session storage). If the site forwards anything, see §2.

---

## 2. Measurement events

### What it fills

PORTFOLIO_TECH_FACTS.md's visitor funnel has two rows marked "not tracked":
"visits where Pubba was used" and "visits where Pubba led to a project being
opened". The site already has its own anonymous visit log, which honours Do Not
Track, Global Privacy Control and `?notrack`.

### Design

pubba **emits** events and stores nothing. No network calls, no ids, no
cookies. The site subscribes and decides where events go: its visit log, any
analytics tool, or nowhere.

```ts
const events = createEvents({ goals: ["contact", "resume"] }); // a tiny typed emitter
events.on((e) => visitLog.push(e));                            // the site's choice
const pubba = createPubba(data, config, { events });
```

The guide's moments are owned by the site (pubba doesn't know when a chat
opens), so the site reports them through checked calls, and pubba fills in what
it knows (built in 0.2.0: ids must exist in the graph, vias and goals must be
declared, anything else is dropped):

```ts
pubba.track.guideOpened();
pubba.track.guidedTo("project:sira", "suggestion");
pubba.track.reached("contact");
```

| Event | Fields | Emitted by |
| --- | --- | --- |
| `guide-opened` | — | site |
| `suggested` | `ids`, `reasonKinds`, `intent?` | pubba (`next`, `related`) |
| `matched` | `intent` ("entity" / "similar" / "none"), `type?`, `by?` | pubba (`match`) |
| `guided-to` | `to`, `via` ("suggestion", "chip", "typed", "match") | site, when a visitor follows one |
| `reached` | `goal` ("contact", "resume", or a site-defined key) | site |

**Never in an event:** the text of a query or an answer, anything typed, the
trail itself, a visitor or session id, a timestamp finer than the site already
records. `matched` says that a query resolved and to what type, not what was
asked. The types enforce it: there is no field a string from the visitor could
go in.

A helper derives the two funnel rows from a visit's events:
`summarise(events) → { usedGuide: boolean, guidedToItem: boolean, reachedGoals: string[] }`.

### Measuring it (eval)

None needed for correctness beyond unit tests. The value is the funnel: after a
few weeks the portfolio can answer "does Pubba lead people to projects and to
contact?" for the first time.

---

## 3. Exports

v1 already generates JSON-LD (Person, SoftwareApplication, CreativeWork) and an
llms.txt, and the portfolio uses both. v2 rounds them out:

1. **`toKnowledge(graph)`**: the graph as one JSON file for an AI to read:
   entities, links with weights, and reason sentences. It replaces the site's
   hand-built `pubba-knowledge.json` (`pubbaKnowledge.ts`) and is what v3's AI
   adapter and MCP server will read, so v3 starts from a stable format.
   Versioned (`v: 3`), with the site's extra sections passed through.
2. **`toLlmsTxt(graph, { full: true })`**: an `llms-full.txt` with each item's
   full description, per the llms.txt convention.
3. **JSON-LD:** `ItemList` for the projects page and `BreadcrumbList` for
   project pages; `hasOccupation` for roles alongside `worksFor`. Small, each
   behind an option, validated like today.
4. **Sitemap hints:** `toSitemapEntries(graph)` (url and last-modified from
   `data.date`) for sites that build their sitemap from content.

---

## 4. API summary (additive; no breaking change)

| New | Shape |
| --- | --- |
| `config.intents` | `Record<id, { label, signals, boost }>` + `config.intent: { minConfidence, minSteps }` |
| `pubba.intent(trail)` | `{ likely, confidence, scores, evidence }` |
| `next / related` option | `intent?: "auto" \| string \| null` |
| `Reason.intent` | `{ id, boost }` when the intent changed the rank |
| `createEvents()`, `createPubba(…, { events })` | typed emitter; events as in §2 |
| `summarise(events)` | the funnel rows for one visit |
| `pubba/exports` | `toKnowledge`, `toLlmsTxt({ full })`, `toJsonLd` list/breadcrumb options, `toSitemapEntries` |
| `pubba/portfolio` | optional `PORTFOLIO_INTENTS` (see question 1) |
| eval | trail `intent`, intent accuracy, with/without-intent scores, two lint checks |

Without `intents` configured and with no `events`, v2 behaves exactly as 0.1.x:
the parity and eval baselines must not move. That's a test.

## 5. Releases

| Version | Content | Done when |
| --- | --- | --- |
| 0.2.0 | Measurement events + `summarise` | Portfolio visit log fills both "not tracked" funnel rows |
| 0.3.0 | Intent profiles + eval support | Portfolio eval: intent accuracy ≥ 90% on 15+ hand-written intent trails; suggestions with intents ≥ without, measured against the 0.2 baseline |
| 0.4.0 | Exports: knowledge file, llms-full, list/breadcrumb JSON-LD, sitemap entries | The site's `pubbaKnowledge.ts` is replaced; Rich Results / Schema.org validators clean |
| 1.0.0 | Stable API, after the portfolio has run on 0.4 for a few weeks | No API change needed by real use |

Each is a separate release, so the portfolio can adopt them one at a time.

## 6. Decisions (10 Nov 2026)

Agreed with the suggestions below: events first (0.2.0), then intents (0.3.0);
portfolio default intents ship as an example, off unless passed; the intent is
never put into words unless a site opts in with a template; the portfolio
forwards events into its existing anonymous visit log.

The questions as asked:

1. **Portfolio default intents.** Ship `PORTFOLIO_INTENTS` (mobile hiring, web
   client, collaborator) with the preset, or start empty and define yours in the
   site's config? My suggestion: ship them, off unless passed, as a worked example.
2. **Showing the intent.** Should Pubba ever say it ("Looks like you're hiring
   for mobile: here's more of that")? It's friendly but can feel watched. My
   suggestion: no wording by default; the site can opt in with a template.
3. **Events and the visit log.** Forward pubba's events into the existing
   anonymous visit log (same Do Not Track / GPC rules), or keep them separate?
   My suggestion: into the visit log, which already has the right privacy rules.
4. **Order.** Intent first (0.2) or events first (0.3)? Events first would
   measure the guide *before* intents change it, giving a baseline. My
   suggestion: events first, then intents, so we can see whether intents help.
