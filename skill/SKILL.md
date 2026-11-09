---
name: pubba
description: Set up and maintain pubba, a knowledge-graph engine for portfolio and "showroom" sites (related items with reasons, what-next from a visitor's trail, typo-tolerant matching). Use when someone wants to add pubba to a site, map their content (JSON, Markdown, a CMS export, a database dump) to pubba's entities and links, generate schema.org JSON-LD or an llms.txt from it, or run and improve pubba's evaluation harness (aliases, weights, rules).
---

# pubba

pubba turns a site's content into **entities** and **typed links**, then answers
three things from that graph: what is related to an item and why, what a visitor
is likely to want next from their trail, and what a typed query means. Every
answer carries a machine-readable reason plus a sentence.

Portfolios are the main case and have a preset (`"preset": "portfolio"`). Any
other showroom (a catalogue, a course list, docs) uses `"preset": "none"` and its
own types, link kinds and rules.

Everything here runs through the CLI. Call it with `scripts/pubba.sh` (in this
skill folder): it uses the project's installed `pubba`, else a checkout named by
`PUBBA_HOME`, else `npx pubba`.

| Command | What it does |
| --- | --- |
| `pubba.sh preview <pubba.json>` | The mapping as Markdown tables: entities, links, which links rules derived, and what got dropped |
| `pubba.sh inspect <pubba.json>` | Counts by type and kind |
| `pubba.sh match <pubba.json> "<query>"` | What a query resolves to, and why |
| `pubba.sh related <pubba.json> <id>` | Related items with reasons |
| `pubba.sh next <pubba.json> <id> [<id>…]` | Predictions after a trail |
| `pubba.sh lint <pubba.json>` | Content problems that cost accuracy (name collisions, heavy weights, dead ends); exits 1 on errors |
| `pubba.sh eval <pubba.json> --queries q.json --trails t.json --generated --baseline b.json` | Scores matching and suggestions, with cases generated from the content added; exits 1 on a drop |
| `pubba.sh generate <pubba.json> --out-dir eval/` | Writes the generated cases, to read |
| `pubba.sh jsonld <pubba.json> --base-url <url> [--out file]` | schema.org JSON-LD, validated; exits 1 on problems |
| `pubba.sh llms <pubba.json> --base-url <url> [--out file]` | An llms.txt |

Read `references/schema.md` before writing a `pubba.json`; it has the full format.

## 1. Map the site's content to the schema

1. **Find the content.** Look for the data the site already renders: JSON or YAML
   files, Markdown with front matter, a CMS export, seed files, a database dump.
   Don't ask the user to retype anything the repo already has. Read
   `references/mapping.md` for how each kind of source maps.
2. **Choose the route.**
   - A portfolio (projects, skills, roles, places shipped to, games, creative
     work): write a `PortfolioInput` file and a `pubba.json` with
     `"preset": "portfolio"`. The preset brings the 12 link kinds, weights, rules
     and sentences, and derives same-stack, used-with, made-at, used-at, topics and
     mentions by itself.
   - Anything else: write entities and links directly, with the site's own types,
     kinds and rules in `config` (start from `templates/pubba.custom.json`).
3. **Propose before writing.** Draft the mapping in a scratch file, run
   `pubba.sh preview <draft>` and show the user, in this order:
   - the types and link kinds you chose, and why;
   - aliases you added (short forms, abbreviations, company names, old names);
   - weights: which skills or materials count as "core" (1) and which are common
     tools (0.4), since common ones must never make two items look alike;
   - the derived-link rules and what they produced (the `source` column);
   - anything dropped for having no links, and content you left out.

   Ask for changes. **Write `pubba.json` (and the content file) into the project
   only after the user agrees.**
4. Keep ids stable (`project:<slug>`, `tech:<name>`): trails saved in visitors'
   browsers and analytics refer to them.

## 2. Generate JSON-LD and llms.txt

1. Ask for the site's public base URL if it isn't in the content.
2. Run `pubba.sh jsonld pubba.json --base-url <url> --out public/pubba.jsonld`.
   It builds a `Person` (knowsAbout from skills, worksFor from current roles,
   sameAs), `SoftwareApplication` for projects and `CreativeWork` for creative
   pieces, each with `creator` pointing at the person. It validates as it writes
   and exits 1 on a problem (missing names, relative urls, dangling ids).
   - Email is left out unless the user asks; it's personal data.
   - If the site already has hand-written JSON-LD, diff the two and point out
     what the generated one adds or loses before replacing anything.
   - To use it in a page, embed it in a `<script type="application/ld+json">`.
     Suggest checking it with the Schema.org validator or Google's Rich Results
     Test; you can't reach those for the user unless a browser tool is available.
3. Run `pubba.sh llms pubba.json --base-url <url> --out public/llms.txt`. It is
   served from the site root as `/llms.txt`.
4. Show both outputs to the user before they ship.

## 3. Run the evaluation harness and suggest fixes

The goal is 100% on generated cases and close to it on hand-written ones, kept
there as the content grows.

1. **Lint first:** `pubba.sh lint pubba.json`. Fix errors (duplicate names) before
   anything else; explain each warning to the user and let them choose.
2. **Build the hand-written set from the site's own content**, starting from
   `templates/queries.example.json` and `templates/trails.example.json`. Cover
   every tag:
   - `typo`: real misspellings of the site's names ("flutr", "sri lankan")
   - `one-word`: a single name, abbreviation or short form
   - `similar`: "anything like X?" (`"intent": "similar"`)
   - `place` and `role`: "what did they build in X?", "what do they do at Y?"
   - `off-topic`: weather, jokes, recipes, passwords; these expect `null` and
     `"intent": "none"`
   - trails: 8 to 12 realistic visits with the 1 to 3 items a person would expect
     next. Write the expectations from what makes sense for a visitor, not from
     what pubba currently outputs.
   Generated cases (`--generated`) already cover every name, a typo of it,
   aliases, "anything like it" and each item's closest relation, so spend the
   hand-written set on what generation can't know: off-topic questions, commands
   the site handles itself, and real visitor phrasing.
3. Run `pubba.sh eval pubba.json --queries eval/queries.json --trails eval/trails.json --generated`.
4. For each failure, find the cause with `pubba.sh match` / `next` / `related`,
   then suggest the smallest fix. See `references/evaluation.md` for the
   catalogue. In short:
   - wrong entity for a query: add an alias, or add a stop word, or move a type to
     an earlier or later match tier;
   - an off-topic query matched something: the near-miss rule caught a common
     word; rename the alias or make the type `phrase` mode;
   - a trail misses an obvious next item: check the link exists (`related`), then
     the kind's `pull`, then whether a common tool's weight is too high and
     floods the results;
   - a sentence reads badly: override its template.
5. Show the fixes as a diff, apply them once the user agrees, and rerun.
6. When the scores are where the user wants them, write the baseline with
   `--baseline eval/baseline.json --update-baseline`, and add the eval command to
   CI with `lint`, so a drop or a name collision fails the build (example in
   `references/evaluation.md`). Every content publish then re-runs it, and the
   generated cases grow with the content.

## Rules

- Show the mapping and any change to aliases, weights or rules before writing it.
- Never put message text, visitor questions or anything identifying into the
  graph, the eval files or exports.
- Don't publish, push or deploy anything; generating files locally is the job.
