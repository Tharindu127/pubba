import { otherEnd } from "./graph.ts";
import type { Entity, Graph, GraphLink, IntentConfig } from "./types.ts";

/*
 * Intent profiles: a guess at why this visit is happening, from the trail
 * alone. Each step says something about each intent (its own signals, and half
 * of its strongest neighbour's); a fixed "browsing" share keeps short or mixed
 * trails from counting. Once one intent is likely, it leans suggestions
 * towards what it boosts, within 0.5–2x, so it reorders but never hides.
 * Nothing is stored or sent: it is worked out again from the trail each time.
 */

export interface IntentEvidence {
  /** A trail step that pointed to the intent. */
  step: string;
  /** The neighbour it pointed through, when that counted more than the step itself. */
  via?: string;
  weight: number;
}

export interface IntentReading {
  /** The likely intent, or null: still browsing, too few steps, or nothing configured. */
  likely: string | null;
  /** The top intent's share. */
  confidence: number;
  /** Each intent's share, then `browsing`'s; they add up to 1. */
  scores: Record<string, number>;
  /** The steps behind the top intent, most recent first. */
  evidence: IntentEvidence[];
}

/** An option for `next` and `related`: work it out from the trail, name one, or none. */
export type IntentOption = "auto" | string | null;

const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
const own = <T>(o: Record<string, T> | undefined, k: string): T | undefined => (o && Object.hasOwn(o, k) ? o[k] : undefined);

/** The configured intents, in order ("browsing" is reserved). */
export function intentsOf(g: Graph): [string, IntentConfig][] {
  const all = g.config.intents;
  if (!all || typeof all !== "object") return [];
  return Object.entries(all).filter(([id, c]) => id !== "browsing" && c && typeof c === "object");
}

/** Why this visit is likely happening, from the trail alone. */
export function readIntent(g: Graph, trail: string[]): IntentReading {
  const intents = intentsOf(g);
  const settings = g.config.intent ?? {};
  const minConfidence = num(settings.minConfidence, 0.5);
  const minSteps = num(settings.minSteps, 2);
  const share = num(settings.neighbours, 0.5);
  const recency = num(g.config.next?.recency, 0.6);
  const sections = g.config.next?.sections ?? {};

  // The same seeds as spread: most recent first, a repeated step counted once.
  const seeds = new Map<string, number>();
  for (const id of [...trail].reverse()) if (!seeds.has(id)) seeds.set(id, recency ** seeds.size);
  let steps = 0;
  for (const id of seeds.keys()) if (!id.startsWith("section:") && (g.entities.has(id) || g.unlinked.has(id))) steps++;

  const raw: number[] = [];
  const evidence: IntentEvidence[][] = [];
  for (const [, intent] of intents) {
    const E = intent.signals?.entities;
    const T = intent.signals?.types;
    const K = intent.signals?.kinds;
    let sum = 0;
    const ev: IntentEvidence[] = [];
    for (const [step, w] of seeds) {
      let part: number;
      let via: string | undefined;
      if (step.startsWith("section:")) {
        const type = own(sections, step.slice(8));
        if (typeof type !== "string" || !type) continue;
        part = w * num(own(T, type), 0);
      } else {
        const e = g.entities.get(step) ?? g.unlinked.get(step);
        if (!e) continue;
        const self = num(own(E, e.id), 0) + num(own(T, e.type), 0);
        let best = 0;
        let bestVia: string | undefined;
        for (const l of g.adjacent.get(step) ?? []) {
          const n = otherEnd(l, step);
          const v = l.weight * (num(own(E, n), 0) + num(own(K, l.kind), 0));
          if (v > best) {
            best = v;
            bestVia = n;
          }
        }
        const near = share * best;
        if (near > self) via = bestVia;
        part = w * (self + near);
      }
      sum += part;
      if (part > 0) ev.push({ step, ...(via !== undefined ? { via } : {}), weight: part });
    }
    raw.push(Math.max(0, sum));
    evidence.push(ev);
  }

  const total = 1 + raw.reduce((a, b) => a + b, 0);
  const scores: Record<string, number> = {};
  let top = -1;
  intents.forEach(([id], i) => {
    scores[id] = raw[i]! / total;
    if (top < 0 || raw[i]! > raw[top]!) top = i;
  });
  scores.browsing = 1 / total;
  const confidence = top < 0 ? 0 : raw[top]! / total;
  const likely = top >= 0 && raw[top]! > 0 && confidence >= minConfidence && steps >= minSteps ? intents[top]![0] : null;
  return { likely, confidence, scores, evidence: top < 0 ? [] : evidence[top]! };
}

/** The intent to apply: worked out from the trail ("auto", the default), a named one, or none. */
export function resolveIntent(g: Graph, trail: string[], option: IntentOption | undefined): string | null {
  if (option === null) return null;
  const intents = intentsOf(g);
  if (!intents.length) return null;
  if (option === undefined || option === "auto") return readIntent(g, trail).likely;
  return intents.some(([id]) => id === option) ? option : null;
}

/** How much an intent leans towards an entity reached by a link: clamped to 0.5–2. */
export function intentBoost(g: Graph, intent: string, e: Entity, link?: GraphLink): number {
  const b = intentsOf(g).find(([id]) => id === intent)?.[1].boost;
  const v = num(own(b?.types, e.type), 1) * num(own(b?.entities, e.id), 1) * (link ? num(own(b?.kinds, link.kind), 1) : 1);
  return Math.min(2, Math.max(0.5, v));
}

/** An intent's label, for the `{intent}` token. */
export function intentLabel(g: Graph, intent: string): string {
  const c = intentsOf(g).find(([id]) => id === intent)?.[1];
  return typeof c?.label === "string" ? c.label : intent;
}
