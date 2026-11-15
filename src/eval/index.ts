import type { Pubba } from "../index.ts";
import type { MatchResult } from "../types.ts";

/*
 * The evaluation harness: sample queries with the entity each should resolve
 * to (or none), and sample trails with the items expected in the top
 * suggestions. Scores both, so a change to aliases, weights or rules can be
 * measured, and a drop can fail CI.
 */

export interface QueryCase {
  query: string;
  /** The entity id it should resolve to; null when nothing here should match. */
  expect: string | null;
  /** The intent it should read as. Checked only when given. */
  intent?: MatchResult["intent"];
  /** Groups for the report: "typo", "one-word", "similar", "place", "role", "off-topic"… */
  tags?: string[];
  note?: string;
}

export interface TrailCase {
  name?: string;
  trail: string[];
  /** Ids expected among the top suggestions, all of them. */
  expect?: string[];
  /** Ids of which any one among the top suggestions is enough. */
  expectAny?: string[];
  /** How many suggestions count. Default 3. */
  top?: number;
  /** The intent this trail should read as (null: still browsing). Checked only when given. */
  intent?: string | null;
}

export interface IntentOutcome {
  case: TrailCase;
  got: string | null;
  confidence: number;
  pass: boolean;
}

export interface QueryOutcome {
  case: QueryCase;
  got: string | null;
  intent: MatchResult["intent"];
  pass: boolean;
}

export interface TrailOutcome {
  case: TrailCase;
  got: string[];
  found: string[];
  missing: string[];
  /** Share of the expected ids found. */
  score: number;
}

export interface EvalReport {
  matching: { score: number; passed: number; total: number; byTag: Record<string, { passed: number; total: number }>; failures: QueryOutcome[] };
  suggestions: { score: number; hitRate: number; passed: number; total: number; failures: TrailOutcome[]; withoutIntents?: number };
  /** When trails say which intent they should read as: how many did. */
  intents?: { score: number; passed: number; total: number; failures: IntentOutcome[] };
}

export interface Baseline {
  matching: number;
  suggestions: number;
  intents?: number;
}

export function evaluateQueries(pubba: Pubba, cases: QueryCase[]): EvalReport["matching"] {
  const outcomes: QueryOutcome[] = cases.map((c) => {
    const m = pubba.match(c.query);
    const got = m.entity?.id ?? null;
    return { case: c, got, intent: m.intent, pass: got === c.expect && (!c.intent || c.intent === m.intent) };
  });
  const byTag: Record<string, { passed: number; total: number }> = {};
  for (const o of outcomes) {
    for (const t of o.case.tags ?? ["untagged"]) {
      const b = (byTag[t] ??= { passed: 0, total: 0 });
      b.total++;
      if (o.pass) b.passed++;
    }
  }
  const passed = outcomes.filter((o) => o.pass).length;
  return { score: cases.length ? passed / cases.length : 1, passed, total: cases.length, byTag, failures: outcomes.filter((o) => !o.pass) };
}

/** Suggestions against trail cases. `intent: null` scores them as if no intents were configured. */
export function evaluateTrails(pubba: Pubba, cases: TrailCase[], { intent }: { intent?: null } = {}): EvalReport["suggestions"] {
  const outcomes: TrailOutcome[] = cases.map((c) => {
    const got = pubba.next(c.trail, { limit: c.top ?? 3, ...(intent === null ? { intent: null } : {}) }).map((s) => s.entity.id);
    const all = c.expect ?? [];
    const any = c.expectAny ?? [];
    const found = [...all, ...any].filter((id) => got.includes(id));
    const anyHit = !any.length || any.some((id) => got.includes(id));
    // Each "all" id is one part; the "any" group is one more.
    const parts = all.length + (any.length ? 1 : 0);
    const hits = all.filter((id) => got.includes(id)).length + (any.length && anyHit ? 1 : 0);
    const missing = [...all.filter((id) => !got.includes(id)), ...(anyHit ? [] : [`any of ${any.join(" | ")}`])];
    return { case: c, got, found, missing, score: parts ? hits / parts : 1 };
  });
  const passed = outcomes.filter((o) => o.missing.length === 0).length;
  return {
    score: outcomes.length ? outcomes.reduce((a, o) => a + o.score, 0) / outcomes.length : 1,
    hitRate: outcomes.length ? outcomes.filter((o) => o.found.length > 0).length / outcomes.length : 1,
    passed,
    total: outcomes.length,
    failures: outcomes.filter((o) => o.missing.length > 0),
  };
}

/** Does each trail read as the intent it should (null: still browsing)? Only cases that say. */
export function evaluateIntents(pubba: Pubba, cases: TrailCase[]): NonNullable<EvalReport["intents"]> {
  const outcomes: IntentOutcome[] = cases
    .filter((c) => c.intent !== undefined)
    .map((c) => {
      const r = pubba.intent(c.trail);
      return { case: c, got: r.likely, confidence: r.confidence, pass: r.likely === (c.intent ?? null) };
    });
  const passed = outcomes.filter((o) => o.pass).length;
  return { score: outcomes.length ? passed / outcomes.length : 1, passed, total: outcomes.length, failures: outcomes.filter((o) => !o.pass) };
}

export function evaluate(pubba: Pubba, { queries = [], trails = [] }: { queries?: QueryCase[]; trails?: TrailCase[] }): EvalReport {
  const report: EvalReport = { matching: evaluateQueries(pubba, queries), suggestions: evaluateTrails(pubba, trails) };
  // With intents configured, show whether they help: the same trails scored without them.
  if (Object.keys(pubba.graph.config.intents ?? {}).length) report.suggestions.withoutIntents = evaluateTrails(pubba, trails, { intent: null }).score;
  if (trails.some((c) => c.intent !== undefined)) report.intents = evaluateIntents(pubba, trails);
  return report;
}

/** What dropped below the baseline (less a tolerance). Empty when nothing did. */
export function regressions(report: EvalReport, baseline: Baseline, tolerance = 0): string[] {
  const out: string[] = [];
  const round = (x: number) => Math.round(x * 1000) / 1000;
  if (round(report.matching.score) < round(baseline.matching - tolerance)) out.push(`matching ${pct(report.matching.score)} is below the baseline ${pct(baseline.matching)}`);
  if (round(report.suggestions.score) < round(baseline.suggestions - tolerance)) out.push(`suggestions ${pct(report.suggestions.score)} is below the baseline ${pct(baseline.suggestions)}`);
  if (baseline.intents !== undefined && report.intents && round(report.intents.score) < round(baseline.intents - tolerance)) out.push(`intents ${pct(report.intents.score)} is below the baseline ${pct(baseline.intents)}`);
  return out;
}

export const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** The report as plain text for a terminal or a CI log. */
export function formatReport(r: EvalReport): string {
  const lines: string[] = [];
  lines.push(`Matching     ${pct(r.matching.score)}  (${r.matching.passed}/${r.matching.total} queries)`);
  for (const [tag, b] of Object.entries(r.matching.byTag).sort()) lines.push(`  ${tag.padEnd(12)} ${b.passed}/${b.total}`);
  lines.push(`Suggestions  ${pct(r.suggestions.score)}  (${r.suggestions.passed}/${r.suggestions.total} trails fully right, ${pct(r.suggestions.hitRate)} with at least one)`);
  if (r.suggestions.withoutIntents !== undefined) lines.push(`  without intents ${pct(r.suggestions.withoutIntents)}`);
  if (r.intents) lines.push(`Intents      ${pct(r.intents.score)}  (${r.intents.passed}/${r.intents.total} trails read as expected)`);
  if (r.matching.failures.length) {
    lines.push("", "Query failures:");
    for (const f of r.matching.failures) lines.push(`  "${f.case.query}": expected ${f.case.expect ?? "none"}${f.case.intent ? ` (${f.case.intent})` : ""}, got ${f.got ?? "none"} (${f.intent})`);
  }
  if (r.suggestions.failures.length) {
    lines.push("", "Trail failures:");
    for (const f of r.suggestions.failures) lines.push(`  ${f.case.name ?? f.case.trail.join(" > ")}: missing ${f.missing.join(", ")}; top was ${f.got.join(", ") || "nothing"}`);
  }
  if (r.intents?.failures.length) {
    lines.push("", "Intent failures:");
    for (const f of r.intents.failures) lines.push(`  ${f.case.name ?? f.case.trail.join(" > ")}: expected ${f.case.intent ?? "browsing"}, read as ${f.got ?? "browsing"} (${pct(f.confidence)})`);
  }
  return lines.join("\n");
}

export { generateCases, nameOwners, type GenerateOptions } from "./generate.ts";
export { lint, formatLint, type LintIssue } from "./lint.ts";
