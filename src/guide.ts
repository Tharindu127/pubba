import { degree, isDestination } from "./graph.ts";
import { createTrail, type Trail } from "./trail.ts";
import type { Pubba } from "./index.ts";
import type { GuideVia } from "./events.ts";
import type { Entity, Match, Reason } from "./types.ts";

/*
 * The navigator, without any UI or personality: a typed question becomes a
 * reply (words, where to go, follow-up chips), steps are recorded, and nudges
 * are offered at the right moments. What it looks like (a search bar, a chat
 * bubble, a bot, a character) is entirely the site's; so is what to do when
 * nothing here answers (show the reply's chips, or ask an AI).
 */

/** A follow-up button: a place to go, with why. */
export interface EntityChip {
  id: string;
  /** How it reads on a button. */
  label: string;
  url?: string;
  /** Why it's suggested, as data and as a sentence. */
  reason: Reason;
  text: string;
}

/** A follow-up button that asks the guide a question ("Show me his projects"). */
export interface QuestionChip {
  label: string;
  question: string;
}

export type Chip = EntityChip | QuestionChip;

export type ReplyKind = "open" | "similar" | "none" | "not-here" | "start";

export interface Reply {
  /** `open`: the question named one thing. `similar`: things like one. `none`: nothing here answers (a site may ask its AI). `not-here`: it names something the site doesn't have. `start`: an empty question. */
  kind: ReplyKind;
  text: string;
  /** Where to take the visitor, when the reply names one place. */
  action?: { type: "open"; id: string; url?: string };
  chips: Chip[];
  match?: Match;
  /** For `similar`: every similar item, as chips (the action is the first). */
  similar?: EntityChip[];
}

export interface GuideTemplates {
  open: string;
  similar: string;
  none: string;
  notHere: string;
  start: string;
  nudge: string;
}

/**
 * The guide's own lines. Tokens: `{item}` an entity's short label, `{label}`
 * its full label, `{line}` the site's line for it (`GuideOptions.line`),
 * `{reason}` a reason sentence, `{name}` what was asked about; for `similar`
 * also `{of}` (the thing asked about) and `{list}` (each similar item with
 * what it shares). `open.<type>`, `similar.<type>` and `nudge.<type>` override
 * per entity type.
 */
export const DEFAULT_GUIDE_TEMPLATES: GuideTemplates = {
  open: "Here's {item}.",
  similar: "{reason}",
  none: "I couldn't find that here. These might help:",
  notHere: "{name} isn't here. These might help:",
  start: "Where would you like to start?",
  nudge: "{reason} Want a look?",
};

export interface NudgePolicy {
  /** How long after the visitor's own step before a nudge may show. Default 9000 ms. */
  delayMs: number;
  /** The least time between two nudges. Default 60000 ms. */
  gapMs: number;
  /** The weakest prediction worth a nudge. Default 0.3. */
  minScore: number;
}

/** Where chips are wanted: the reply's kind, and the entity it's about when there is one. */
export interface ChipContext {
  kind: ReplyKind | "chips" | "nudge";
  entity?: Entity;
}

export interface GuideOptions {
  /** The visitor's trail. Default: a new in-memory one. */
  trail?: Trail;
  /** Where an entity lives in this site or app. Default: the entity's own `url`. */
  route?: (entity: Entity) => string | undefined;
  /** Chips per reply. Default 3. */
  chips?: number;
  nudge?: Partial<NudgePolicy> & {
    /** Which predictions a nudge prefers. Default: those `route` gives a url. */
    prefer?: (entity: Entity) => boolean;
  };
  /** Only these may be suggested (chips, nudges, similar items, starters): leave out what a chip can't lead to. */
  accept?: (entity: Entity) => boolean;
  /** Chips when the trail suggests nothing, by context. Strings become question chips. Default: the best-connected places. */
  fallback?: (context: ChipContext) => (string | Chip)[] | undefined;
  /** A line about an entity for `{line}` in templates (a subtitle, a skill level, what shipped where). */
  line?: (entity: Entity) => string | undefined;
  /** Over the defaults; also `open.<type>`, `similar.<type>`, `nudge.<type>`. */
  templates?: Partial<GuideTemplates> & Record<string, string>;
  /** The clock, in ms. Default `Date.now`; tests and other runtimes pass their own. */
  now?: () => number;
}

export interface Guide {
  readonly trail: Trail;
  readonly nudgePolicy: Readonly<NudgePolicy>;
  /** Answer a typed question. Doesn't move the visitor: follow the action, then call `follow`. */
  ask(question: string): Reply;
  /** Follow-ups for where the visitor is now. */
  chips(limit?: number): Chip[];
  /** The visitor went somewhere on their own. */
  visited(id: string): void;
  /** The visitor went somewhere because the guide sent them. */
  follow(id: string, via: GuideVia): void;
  /** A suggestion to show unprompted now, or null. Call it after `nudgePolicy.delayMs`; it enforces the rest. */
  nudge(): Reply | null;
  /** The guide was opened (for measurement). */
  opened(): void;
  /** The visitor reached a goal (for measurement). */
  reached(goal: string): void;
}

const asChip = (c: string | Chip): Chip => (typeof c === "string" ? { label: c, question: c } : c);
const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "").replace(/\s+/g, " ").trim();
const labelOf = (e: Entity) => e.short ?? e.label;

export function createGuide(pubba: Pubba, o: GuideOptions = {}): Guide {
  const g = pubba.graph;
  const trail = o.trail ?? createTrail();
  const route = o.route ?? ((e: Entity) => e.url);
  const t: Record<string, string> = { ...DEFAULT_GUIDE_TEMPLATES, ...o.templates };
  const { prefer: preferOption, ...nudgeNumbers } = o.nudge ?? {};
  const policy: NudgePolicy = { delayMs: 9000, gapMs: 60000, minScore: 0.3, ...nudgeNumbers };
  const prefer = preferOption ?? ((e: Entity) => route(e) !== undefined);
  const accept = o.accept;
  const now = o.now ?? (() => Date.now());
  const limit = o.chips ?? 3;
  const find = (id: string) => g.entities.get(id) ?? g.unlinked.get(id);

  // Nudge state: when the last step happened and who took it.
  let lastStepAt = -Infinity;
  let lastStepSelf = false;
  let lastNudgeAt = -Infinity;
  const nudgedFrom = new Set<string>();

  /** A template for a key, its per-type version first. */
  const tpl = (key: keyof GuideTemplates, e?: Entity) => (e ? t[`${key}.${e.type}`] : undefined) ?? t[key]!;
  const vars = (e: Entity) => ({ item: labelOf(e), label: e.label, line: o.line?.(e) ?? "" });

  const chipFor = (s: { entity: Entity; reason: Reason; text: string }): EntityChip => {
    const url = route(s.entity);
    return { id: s.entity.id, label: labelOf(s.entity), ...(url !== undefined ? { url } : {}), reason: s.reason, text: s.text };
  };

  /** Where to start when the trail suggests nothing: the best-connected places. */
  const starters = (n: number): Chip[] =>
    [...g.entities.values()]
      .filter((e) => isDestination(g, e) && (!accept || accept(e)))
      .map((e, i) => ({ e, i, d: degree(g, e.id) }))
      .sort((a, b) => b.d - a.d || a.i - b.i)
      .slice(0, n)
      .map(({ e }) => {
        const reason: Reason = { kind: "section" };
        return chipFor({ entity: e, reason, text: pubba.explain(reason, e) });
      });

  const chips = (n: number, extra: string[], context: ChipContext): Chip[] => {
    const out = pubba.next([...trail.get(), ...extra], { limit: n, ...(accept ? { accept } : {}) }).map(chipFor);
    if (out.length) return out;
    const fallback = o.fallback?.(context);
    return fallback ? fallback.slice(0, n).map(asChip) : starters(n);
  };

  const open = (e: Entity) => {
    const url = route(e);
    return { type: "open" as const, id: e.id, ...(url !== undefined ? { url } : {}) };
  };

  return {
    trail,
    nudgePolicy: policy,
    ask(question) {
      if (!question.trim()) return { kind: "start", text: fill(tpl("start"), {}), chips: chips(limit, [], { kind: "start" }) };
      const m = pubba.match(question);
      if (m.intent === "none") {
        if (m.notHere) return { kind: "not-here", text: fill(tpl("notHere"), { name: m.notHere }), chips: chips(limit, [], { kind: "not-here" }) };
        return { kind: "none", text: fill(tpl("none"), {}), chips: chips(limit, [], { kind: "none" }) };
      }
      const entity = m.entity!;
      const similar = m.similar.filter((r) => !accept || accept(r.entity));
      if (m.intent === "similar" && similar.length) {
        const [first, ...rest] = similar;
        const list = similar.map((r) => `${r.entity.label}${r.reason.via?.length ? ` (${r.reason.via.slice(0, 2).join(", ")})` : ""}`).join(", ");
        return {
          kind: "similar",
          text: fill(tpl("similar", entity), { ...vars(first!.entity), reason: first!.text, of: entity.label, list }),
          action: open(first!.entity),
          chips: rest.slice(0, limit).map(chipFor),
          ...(m.match ? { match: m.match } : {}),
          similar: similar.map(chipFor),
        };
      }
      return {
        kind: "open",
        text: fill(tpl("open", entity), vars(entity)),
        action: open(entity),
        // What comes after it, as if the visitor were already there.
        chips: g.entities.has(entity.id)
          ? chips(limit, [entity.id], { kind: "open", entity }).filter((c) => !("id" in c) || c.id !== entity.id)
          : chips(limit, [], { kind: "open", entity }),
        ...(m.match ? { match: m.match } : {}),
      };
    },
    chips: (n) => chips(n ?? limit, [], { kind: "chips" }),
    visited(id) {
      if (!find(id) && !id.startsWith("section:")) return;
      trail.record(id);
      lastStepAt = now();
      lastStepSelf = true;
    },
    follow(id, via) {
      if (!find(id)) return;
      trail.record(id);
      lastStepAt = now();
      lastStepSelf = false;
      pubba.track.guidedTo(id, via);
    },
    nudge() {
      const steps = trail.get();
      const last = steps[steps.length - 1];
      const at = now();
      if (!last || !lastStepSelf || last.startsWith("section:") || nudgedFrom.has(last)) return null;
      if (at - lastStepAt < policy.delayMs || at - lastNudgeAt < policy.gapMs) return null;
      const options = pubba.next(steps, { limit: 5, ...(accept ? { accept } : {}) }).filter((s) => s.reason.kind !== "section" && s.score >= policy.minScore);
      // Something with a place of its own beats a line in a list (or whatever the site prefers).
      const top = options.find((s) => prefer(s.entity)) ?? options[0];
      if (!top) return null;
      lastNudgeAt = at;
      nudgedFrom.add(last);
      return { kind: "open", text: fill(tpl("nudge", top.entity), { ...vars(top.entity), reason: top.text }), action: open(top.entity), chips: [chipFor(top)] };
    },
    opened: () => pubba.track.guideOpened(),
    reached: (goal) => void pubba.track.reached(goal),
  };
}
