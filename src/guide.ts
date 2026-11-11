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

export interface Chip {
  id: string;
  /** How it reads on a button. */
  label: string;
  url?: string;
  /** Why it's suggested, as data and as a sentence. */
  reason: Reason;
  text: string;
}

export type ReplyKind = "open" | "similar" | "none" | "not-here" | "start";

export interface Reply {
  /** `open`: the question named one thing. `similar`: things like one. `none`: nothing here answers (a site may ask its AI). `not-here`: it names something the site doesn't have. `start`: an empty question. */
  kind: ReplyKind;
  text: string;
  /** Where to take the visitor, when the reply names one place. */
  action?: { type: "open"; id: string; url?: string };
  chips: Chip[];
  match?: Match;
}

export interface GuideTemplates {
  open: string;
  similar: string;
  none: string;
  notHere: string;
  start: string;
  nudge: string;
}

/** The guide's own lines. `{item}` the entity, `{reason}` a reason sentence, `{name}` what was asked about. */
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

export interface GuideOptions {
  /** The visitor's trail. Default: a new in-memory one. */
  trail?: Trail;
  /** Where an entity lives in this site or app. Default: the entity's own `url`. */
  route?: (entity: Entity) => string | undefined;
  /** Chips per reply. Default 3. */
  chips?: number;
  nudge?: Partial<NudgePolicy>;
  templates?: Partial<GuideTemplates>;
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

const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "").replace(/\s+/g, " ").trim();
const labelOf = (e: Entity) => e.short ?? e.label;

export function createGuide(pubba: Pubba, o: GuideOptions = {}): Guide {
  const g = pubba.graph;
  const trail = o.trail ?? createTrail();
  const route = o.route ?? ((e: Entity) => e.url);
  const t: GuideTemplates = { ...DEFAULT_GUIDE_TEMPLATES, ...o.templates };
  const policy: NudgePolicy = { delayMs: 9000, gapMs: 60000, minScore: 0.3, ...o.nudge };
  const now = o.now ?? (() => Date.now());
  const limit = o.chips ?? 3;
  const find = (id: string) => g.entities.get(id) ?? g.unlinked.get(id);

  // Nudge state: when the last step happened and who took it.
  let lastStepAt = -Infinity;
  let lastStepSelf = false;
  let lastNudgeAt = -Infinity;
  const nudgedFrom = new Set<string>();

  const chipFor = (s: { entity: Entity; reason: Reason; text: string }): Chip => {
    const url = route(s.entity);
    return { id: s.entity.id, label: labelOf(s.entity), ...(url !== undefined ? { url } : {}), reason: s.reason, text: s.text };
  };

  /** Where to start when the trail suggests nothing: the best-connected places. */
  const starters = (n: number): Chip[] =>
    [...g.entities.values()]
      .filter((e) => isDestination(g, e))
      .map((e, i) => ({ e, i, d: degree(g, e.id) }))
      .sort((a, b) => b.d - a.d || a.i - b.i)
      .slice(0, n)
      .map(({ e }) => {
        const reason: Reason = { kind: "section" };
        return chipFor({ entity: e, reason, text: pubba.explain(reason, e) });
      });

  const chips = (n = limit, extra: string[] = []): Chip[] => {
    const out = pubba.next([...trail.get(), ...extra], { limit: n }).map(chipFor);
    return out.length ? out : starters(n);
  };

  const open = (e: Entity) => {
    const url = route(e);
    return { type: "open" as const, id: e.id, ...(url !== undefined ? { url } : {}) };
  };

  return {
    trail,
    nudgePolicy: policy,
    ask(question) {
      if (!question.trim()) return { kind: "start", text: fill(t.start, {}), chips: chips() };
      const m = pubba.match(question);
      if (m.intent === "none") {
        if (m.notHere) return { kind: "not-here", text: fill(t.notHere, { name: m.notHere }), chips: chips() };
        return { kind: "none", text: fill(t.none, {}), chips: chips() };
      }
      const entity = m.entity!;
      if (m.intent === "similar" && m.similar.length) {
        const [first, ...rest] = m.similar;
        return {
          kind: "similar",
          text: fill(t.similar, { reason: first!.text, item: labelOf(first!.entity) }),
          action: open(first!.entity),
          chips: rest.slice(0, limit).map(chipFor),
          ...(m.match ? { match: m.match } : {}),
        };
      }
      return {
        kind: "open",
        text: fill(t.open, { item: labelOf(entity) }),
        action: open(entity),
        // What comes after it, as if the visitor were already there.
        chips: g.entities.has(entity.id) ? chips(limit, [entity.id]).filter((c) => c.id !== entity.id) : chips(),
        ...(m.match ? { match: m.match } : {}),
      };
    },
    chips: (n) => chips(n),
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
      const options = pubba.next(steps, { limit: 5 }).filter((s) => s.reason.kind !== "section" && s.score >= policy.minScore);
      // Something with a place of its own beats a line in a list.
      const top = options.find((s) => route(s.entity) !== undefined) ?? options[0];
      if (!top) return null;
      lastNudgeAt = at;
      nudgedFrom.add(last);
      return { kind: "open", text: fill(t.nudge, { reason: top.text, item: labelOf(top.entity) }), action: open(top.entity), chips: [chipFor(top)] };
    },
    opened: () => pubba.track.guideOpened(),
    reached: (goal) => void pubba.track.reached(goal),
  };
}
