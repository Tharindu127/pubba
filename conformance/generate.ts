import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeTo, compileBundle, editDistance, normalize, type Pubba } from "../src/index.ts";
import { fromDocument, type PubbaDocument } from "../src/document.ts";
import { generateCases } from "../src/eval/index.ts";
import { run, type Case, type GuideStep } from "./harness.ts";

/*
 * Writes the conformance suite from the sources: for each one, its compiled
 * bundle and the reference answers to every case. `--check` regenerates in
 * memory and fails if the committed files differ (a behaviour change must be
 * regenerated on purpose, and its diff reviewed).
 */

const here = dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes("--check");
let stale = 0;

function write(path: string, text: string) {
  if (check) {
    let old = "";
    try {
      old = readFileSync(path, "utf8");
    } catch {
      // A missing file is stale.
    }
    if (old !== text) {
      stale++;
      console.error(`stale: ${path.slice(here.length + 1)}`);
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A small seeded generator, so the suite is the same on every run. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

const OFF_TOPIC = ["", "   ", "?!", "what's the weather in paris", "tell me a joke", "best pizza near me", "how do i reset my password", "recipe for banana bread", "who won the world cup", "translate hello to french", "2+2", "CAFÉ CRÈME", "naïve façade"];

function cases(pubba: Pubba, name: string): Case[] {
  const g = pubba.graph;
  const rand = lcg([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const out: Case[] = [];
  const all = [...g.entities.values(), ...g.unlinked.values()];
  const destinations = [...g.entities.values()].filter((e) => g.config.types?.[e.type]?.destination !== false);

  // Matching: generated names, typos, aliases and "anything like"; each label's words; edits; off-topic.
  const queries = new Set<string>(generateCases(pubba).queries.map((q) => q.query));
  for (const e of all) {
    const words = normalize(e.label).split(" ");
    queries.add(e.label.toUpperCase());
    for (const w of words) if (w.length > 2) queries.add(w);
    const w = words.reduce((a, b) => (b.length > a.length ? b : a), "");
    if (w.length >= 4) {
      queries.add(w.slice(1)); // a missing first letter
      queries.add(`${w}${w[w.length - 1]}`); // a doubled last letter
      queries.add(`${w.slice(0, 2)}x${w.slice(3)}`); // one letter wrong
      queries.add(`tell me about ${w}s`);
    }
    queries.add(`something like ${e.label}`);
  }
  for (const n of g.config.match?.notHere ?? []) queries.add(`do you have ${n}?`);
  for (const q of OFF_TOPIC) queries.add(q);
  for (const query of queries) out.push({ op: "match", query });
  for (const query of [...queries].filter((_, i) => i % 3 === 0)) out.push({ op: "search", query, limit: 5 });

  // What next: every single step, every section, and seeded longer trails.
  for (const e of destinations) out.push({ op: "next", trail: [e.id], limit: 3 });
  for (const s of Object.keys(g.config.next?.sections ?? {})) out.push({ op: "next", trail: [`section:${s}`], limit: 3 });
  const ids = destinations.map((e) => e.id);
  for (let i = 0; i < 40; i++) {
    const trail = Array.from({ length: 2 + Math.floor(rand() * 4) }, () => (rand() < 0.1 ? "unknown:id" : pick(ids)));
    out.push({ op: "next", trail, limit: 1 + Math.floor(rand() * 5), ...(i % 5 === 0 ? { exclude: [pick(ids)] } : {}) });
  }

  // Related: every entity, plus a kind filter and a limit.
  for (const e of all) out.push({ op: "related", id: e.id });
  const kinds = [...new Set(g.links.map((l) => l.kind))];
  for (let i = 0; i < 10; i++) out.push({ op: "related", id: pick(ids), kinds: [pick(kinds)], limit: 2 });

  // Type-ahead.
  for (const e of destinations) {
    const n = normalize(e.label);
    out.push({ op: "autocomplete", typed: n.slice(0, 2), trail: [], limit: 3 });
    if (n.length > 4) out.push({ op: "autocomplete", typed: n.slice(1, 4), trail: [pick(ids)], limit: 3 });
  }
  out.push({ op: "autocomplete", typed: "x", trail: [], limit: 3 });

  // Sentences for reasons no link produces.
  for (const e of destinations.slice(0, 12)) {
    out.push({ op: "explain", reason: { kind: "section" }, item: e.id });
    out.push({ op: "explain", reason: { kind: "typed", by: "prefix" }, item: e.id });
    out.push({ op: "explain", reason: { kind: "match", by: "alias", name: "test" }, item: e.id });
  }

  // Guided visits.
  const scripts: GuideStep[][] = [
    [{ op: "opened" }, { op: "ask", question: "" }, { op: "ask", question: pick(destinations).label }, { op: "ask", question: "best pizza near me" }],
    [{ op: "visited", id: ids[0]! }, { op: "nudge" }, { op: "tick", ms: 9000 }, { op: "nudge" }, { op: "nudge" }, { op: "tick", ms: 70000 }, { op: "visited", id: ids[1]! }, { op: "tick", ms: 9000 }, { op: "nudge" }],
    [{ op: "visited", id: pick(ids) }, { op: "chips" }, { op: "follow", id: pick(ids), via: "chip" }, { op: "tick", ms: 100000 }, { op: "nudge" }, { op: "chips", limit: 5 }, { op: "reached", goal: "contact" }, { op: "reached", goal: "nope" }],
    [{ op: "ask", question: `something like ${pick(destinations).label}` }, { op: "follow", id: "unknown:id", via: "match" }, { op: "visited", id: "section:anything" }, { op: "tick", ms: 100000 }, { op: "nudge" }],
  ];
  for (const steps of scripts) out.push({ op: "guide", steps });

  // The same visits with a site's options: hidden items, fallbacks, lines, per-type wording, nudge preference.
  const types = [...new Set(destinations.map((e) => e.type))];
  const options = {
    chips: 2,
    hide: [{ types: [types[types.length - 1]!], labelEndsWith: ["page", "channel"] }, { ids: [pick(ids)] }],
    fallback: { none: ["Show me everything", "How do I get in touch?"], start: ["Where do I begin?"], [`open.${types[0]}`]: ["More like this"], open: ["Something else"], chips: ["Surprise me"] },
    lines: Object.fromEntries(destinations.filter((_, i) => i % 3 === 0).map((e) => [e.id, `A line about ${e.label}.`])),
    templates: { [`open.${types[0]}`]: "{label}: {line} Opening it.", open: "{item}, {line}", similar: "Like {of}: {list}.", [`nudge.${types[0]}`]: "{reason} Have a look?" },
    nudgeAvoids: [types[1] ?? types[0]!],
  };
  for (const steps of scripts) out.push({ op: "guide", steps, options });
  out.push({ op: "guide", options, steps: destinations.slice(0, 6).flatMap((e): GuideStep[] => [{ op: "visited", id: e.id }, { op: "tick", ms: 70000 }, { op: "nudge" }, { op: "ask", question: e.label }, { op: "chips" }]) });
  return out;
}

const sources = readdirSync(join(here, "sources")).filter((f) => f.endsWith(".json")).sort();
let total = 0;
for (const file of sources) {
  const name = basename(file, ".json");
  const doc = JSON.parse(readFileSync(join(here, "sources", file), "utf8")) as PubbaDocument;
  const reference = fromDocument(doc);
  const bundle = compileBundle(reference.graph);
  write(join(here, "bundles", `${name}.json`), `${JSON.stringify(bundle, null, 1)}\n`);
  const lines = cases(reference, name).map((c) => JSON.stringify({ ...c, expect: run(reference, c) }));
  write(join(here, "cases", `${name}.jsonl`), `${lines.join("\n")}\n`);
  total += lines.length;
}

// Text helpers every runtime shares: normalising, edit distance, near misses.
const words = ["flutter", "flutr", "fluttre", "Café", "naïve", "C#", "Next.js", "C++", "ÉCOLE", "  spaced   out  ", "hire", "hive", "notes", "node", "weather", "whether", "lankan", "lanka", "apps", "app", "swiftui", "swfitui", "kenia", "kenya", "ragnarök", "ragnarok", "react-native", "e-mail", "ß", "ﬁle"];
const text: string[] = [];
for (const w of words) text.push(JSON.stringify({ op: "normalize", input: w, expect: normalize(w) }));
for (const a of words) for (const b of words.slice(0, 16)) {
  const na = normalize(a);
  const nb = normalize(b);
  text.push(JSON.stringify({ op: "distance", a: na, b: nb, expect: editDistance(na, nb) }));
  for (const t of [4, 5]) text.push(JSON.stringify({ op: "closeTo", token: na, word: nb, typoMinLength: t, expect: closeTo(na, nb, t) }));
}
write(join(here, "cases", "text.jsonl"), `${text.join("\n")}\n`);
total += text.length;

if (check) {
  if (stale) {
    console.error(`${stale} conformance file(s) are out of date: run npm run conformance to regenerate, and review the diff.`);
    process.exit(1);
  }
  console.log(`Conformance files are current (${total} cases).`);
} else {
  console.log(`${sources.length} bundles and ${total} cases written.`);
}
