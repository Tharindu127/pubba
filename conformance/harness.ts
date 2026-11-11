import { createEvents, createGuide, pubbaFor, type Chip, type Pubba, type PubbaEvent, type Reason, type Reply } from "../src/index.ts";
import type { GuideVia } from "../src/events.ts";
import type { Entity, GuideOptions } from "../src/index.ts";

/*
 * What a conformance case asks, and the exact shape of its answer. The
 * generator runs these against the reference (the full TypeScript build) and
 * writes the answers; every runtime, TypeScript included, runs them against a
 * loaded bundle and must give the same answers (scores to 1e-9).
 */

export type GuideStep =
  | { op: "visited"; id: string }
  | { op: "follow"; id: string; via: GuideVia }
  | { op: "ask"; question: string }
  | { op: "nudge" }
  | { op: "chips"; limit?: number }
  | { op: "tick"; ms: number }
  | { op: "opened" }
  | { op: "reached"; goal: string };

export type Case =
  | { op: "match"; query: string }
  | { op: "search"; query: string; limit: number }
  | { op: "next"; trail: string[]; limit: number; exclude?: string[] }
  | { op: "related"; id: string; limit?: number; kinds?: string[] }
  | { op: "autocomplete"; typed: string; trail: string[]; limit: number }
  | { op: "explain"; reason: Reason; item: string }
  | { op: "guide"; steps: GuideStep[]; options?: GuideCaseOptions };

/**
 * Guide options as data, so every runtime can rebuild them: what a chip may not
 * lead to, fallback chips by context, lines, templates, and types a nudge avoids.
 */
export interface GuideCaseOptions {
  chips?: number;
  /** An entity is hidden when it fits every field of any one rule. Labels compared lowercased. */
  hide?: { types?: string[]; ids?: string[]; labelIncludes?: string[]; labelEndsWith?: string[] }[];
  /** Keyed by reply kind ("none", "not-here", "start", "chips", "open"), or "open.<type>" before "open". */
  fallback?: Record<string, string[]>;
  /** id to line, for {line}. */
  lines?: Record<string, string>;
  templates?: Record<string, string>;
  /** Types a nudge prefers not to pick. */
  nudgeAvoids?: string[];
}

function guideOptions(o: GuideCaseOptions = {}): GuideOptions {
  const hidden = (e: Entity) =>
    (o.hide ?? []).some(
      (r) =>
        (!r.types || r.types.includes(e.type)) &&
        (!r.ids || r.ids.includes(e.id)) &&
        (!r.labelIncludes || r.labelIncludes.some((s) => e.label.toLowerCase().includes(s))) &&
        (!r.labelEndsWith || r.labelEndsWith.some((s) => e.label.toLowerCase().endsWith(s)))
    );
  return {
    ...(o.chips !== undefined ? { chips: o.chips } : {}),
    ...(o.hide ? { accept: (e: Entity) => !hidden(e) } : {}),
    ...(o.fallback ? { fallback: (c) => (c.kind === "open" && c.entity ? (o.fallback![`open.${c.entity.type}`] ?? o.fallback!.open) : o.fallback![c.kind]) } : {}),
    ...(o.lines ? { line: (e: Entity) => o.lines![e.id] } : {}),
    ...(o.templates ? { templates: o.templates } : {}),
    ...(o.nudgeAvoids ? { nudge: { prefer: (e: Entity) => !o.nudgeAvoids!.includes(e.type) } } : {}),
  };
}

const reason = (r: Reason) => JSON.parse(JSON.stringify(r)) as Reason;
const scored = (x: { entity: { id: string }; reason: Reason; text: string; score: number }) => ({ id: x.entity.id, score: x.score, reason: reason(x.reason), text: x.text });
const weighted = (x: { entity: { id: string }; reason: Reason; text: string; weight: number }) => ({ id: x.entity.id, weight: x.weight, reason: reason(x.reason), text: x.text });
const chip = (c: Chip) =>
  "question" in c ? { label: c.label, question: c.question } : { id: c.id, label: c.label, ...(c.url !== undefined ? { url: c.url } : {}), reason: reason(c.reason), text: c.text };
const reply = (r: Reply | null) =>
  r && {
    kind: r.kind,
    text: r.text,
    ...(r.action ? { action: { ...r.action } } : {}),
    chips: r.chips.map(chip),
    ...(r.match ? { match: { id: r.match.entity.id, score: r.match.score, tier: r.match.tier, by: r.match.reason.by, name: r.match.reason.name } } : {}),
    ...(r.similar ? { similar: r.similar.map(chip) } : {}),
  };

/** The answer to one case, as plain JSON. */
export function run(pubba: Pubba, c: Case): unknown {
  switch (c.op) {
    case "match": {
      const m = pubba.match(c.query);
      return {
        intent: m.intent,
        entity: m.entity?.id ?? null,
        ...(m.match ? { score: m.match.score, tier: m.match.tier, by: m.match.reason.by, name: m.match.reason.name, text: m.match.text } : {}),
        similar: m.similar.map(weighted),
        ...(m.notHere ? { notHere: m.notHere } : {}),
      };
    }
    case "search":
      return pubba.search(c.query, { limit: c.limit }).map((m) => ({ id: m.entity.id, score: m.score, tier: m.tier, by: m.reason.by, name: m.reason.name }));
    case "next":
      return pubba.next(c.trail, { limit: c.limit, ...(c.exclude ? { exclude: c.exclude } : {}) }).map(scored);
    case "related":
      return pubba.related(c.id, { ...(c.limit !== undefined ? { limit: c.limit } : {}), ...(c.kinds ? { kinds: c.kinds } : {}) }).map(weighted);
    case "autocomplete":
      return pubba.autocomplete(c.typed, c.trail, { limit: c.limit }).map((s) => ({ id: s.entity.id, score: s.score, by: s.reason.by }));
    case "explain":
      return pubba.explain(c.reason, c.item);
    case "guide":
      return runGuide(pubba, c.steps, c.options);
  }
}

/** A scripted visit: each step's answer, and every event the visit emitted. */
function runGuide(base: Pubba, steps: GuideStep[], options?: GuideCaseOptions) {
  let clock = 0;
  const events = createEvents({ goals: ["contact"] });
  const emitted: PubbaEvent[] = [];
  events.on((e) => emitted.push(e));
  const pubba = pubbaFor(base.graph, { events });
  const guide = createGuide(pubba, { ...guideOptions(options), now: () => clock });
  const answers = steps.map((s) => {
    switch (s.op) {
      case "visited":
        return guide.visited(s.id), null;
      case "follow":
        return guide.follow(s.id, s.via), null;
      case "ask":
        return reply(guide.ask(s.question));
      case "nudge":
        return reply(guide.nudge());
      case "chips":
        return guide.chips(s.limit).map(chip);
      case "tick":
        return (clock += s.ms), null;
      case "opened":
        return guide.opened(), null;
      case "reached":
        return guide.reached(s.goal), null;
    }
  });
  return { answers, trail: guide.trail.get(), events: JSON.parse(JSON.stringify(emitted)) as unknown };
}

/** Equal as JSON, with numbers equal to 1e-9. Returns the path of the first difference, or null. */
export function diff(a: unknown, b: unknown, path = "$"): string | null {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 ? null : `${path}: ${a} != ${b}`;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: array vs not`;
    if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) return `${path}: keys ${ka.join()} != ${kb.join()}`;
    for (const k of ka) {
      const d = diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
}
