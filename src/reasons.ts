import type { Entity, Graph, GraphLink, Reason, ReasonContext, Template, TemplateCase } from "./types.ts";

/** How an entity reads inside a sentence. */
export const shortLabel = (e: Entity): string => e.short ?? e.label;

/** The reason a link gives for the entity at one of its ends. */
export function reasonFromLink(link: GraphLink, itemId: string, seed?: string): Reason {
  const r: Reason = { kind: link.kind, to: link.from === itemId ? link.to : link.from, direction: link.from === itemId ? "out" : "in" };
  if (link.via?.length) r.via = [...link.via];
  if (seed && seed !== r.to) r.seed = seed;
  return r;
}

/** Sentences that work for any site; presets and sites override them. */
export const DEFAULT_TEMPLATES: Record<string, Template> = {
  section: "{item} is worth a look.",
  typed: "{item} matches what you typed.",
  match: "{item} matches “{name}”.",
};

const kindLabel = (g: Graph, kind: string) => g.config.kinds?.[kind]?.label ?? kind.replace(/-/g, " ");

function fill(text: string, vars: Record<string, string>): string {
  const sub = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
  // A [...] part goes when any token in it is empty.
  const kept = text.replace(/\[([^\]]*)\]/g, (_, inner: string) => {
    const tokens = [...inner.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
    return tokens.every((t) => vars[t]) ? inner : "";
  });
  return sub(kept);
}

function pick(t: Template, ctx: ReasonContext): string | undefined {
  if (typeof t === "string") return t;
  if (typeof t === "function") return t(ctx);
  const fits = (c: TemplateCase) =>
    (!c.item || c.item === ctx.item.type) && (!c.other || c.other === ctx.other?.type) && (!c.direction || c.direction === ctx.reason.direction);
  const hit = t.cases?.find(fits);
  if (hit) return hit.text;
  if (ctx.reason.direction === "out" && t.out) return t.out;
  if (ctx.reason.direction === "in" && t.in) return t.in;
  return t.default ?? t.out ?? t.in;
}

/**
 * A reason as one sentence. Templates are looked up by reason kind, then
 * `kind.<type>` for a type-specific sentence (`section.game`); without one,
 * a plain sentence from the kind's label.
 */
export function renderReason(g: Graph, reason: Reason, item: Entity, templates: Record<string, Template> = {}): string {
  const all = { ...DEFAULT_TEMPLATES, ...g.config.templates, ...templates };
  const other = reason.to ? g.entities.get(reason.to) : undefined;
  const ctx: ReasonContext = {
    reason,
    item,
    ...(other ? { other } : {}),
    itemLabel: shortLabel(item),
    otherLabel: other ? shortLabel(other) : "",
    via: reason.via?.slice(0, 3).join(", ") ?? "",
  };
  const t = all[`${reason.kind}.${item.type}`] ?? all[reason.kind];
  const label = kindLabel(g, reason.kind);
  const text =
    (t && pick(t, ctx)) ??
    (other ? (reason.direction === "in" ? "{other}: {kind} {item}[ ({via})]." : "{item}: {kind} {other}[ ({via})].") : "{item} is worth a look.");
  if (typeof t === "function") return text;
  return fill(text, {
    item: ctx.itemLabel,
    other: ctx.otherLabel,
    otherLower: ctx.otherLabel.toLowerCase(),
    via: ctx.via,
    kind: label,
    name: reason.name ?? "",
  });
}
