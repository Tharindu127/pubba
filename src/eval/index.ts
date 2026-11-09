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
  /** Ids expected among the top suggestions. */
  expect: string[];
  /** How many suggestions count. Default 3. */
  top?: number;
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
  suggestions: { score: number; hitRate: number; passed: number; total: number; failures: TrailOutcome[] };
}

export interface Baseline {
  matching: number;
  suggestions: number;
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

export function evaluateTrails(pubba: Pubba, cases: TrailCase[]): EvalReport["suggestions"] {
  const outcomes: TrailOutcome[] = cases.map((c) => {
    const got = pubba.next(c.trail, { limit: c.top ?? 3 }).map((s) => s.entity.id);
    const found = c.expect.filter((id) => got.includes(id));
    return { case: c, got, found, missing: c.expect.filter((id) => !got.includes(id)), score: c.expect.length ? found.length / c.expect.length : 1 };
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

export function evaluate(pubba: Pubba, { queries = [], trails = [] }: { queries?: QueryCase[]; trails?: TrailCase[] }): EvalReport {
  return { matching: evaluateQueries(pubba, queries), suggestions: evaluateTrails(pubba, trails) };
}

/** What dropped below the baseline (less a tolerance). Empty when nothing did. */
export function regressions(report: EvalReport, baseline: Baseline, tolerance = 0): string[] {
  const out: string[] = [];
  const round = (x: number) => Math.round(x * 1000) / 1000;
  if (round(report.matching.score) < round(baseline.matching - tolerance)) out.push(`matching ${pct(report.matching.score)} is below the baseline ${pct(baseline.matching)}`);
  if (round(report.suggestions.score) < round(baseline.suggestions - tolerance)) out.push(`suggestions ${pct(report.suggestions.score)} is below the baseline ${pct(baseline.suggestions)}`);
  return out;
}

export const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** The report as plain text for a terminal or a CI log. */
export function formatReport(r: EvalReport): string {
  const lines: string[] = [];
  lines.push(`Matching     ${pct(r.matching.score)}  (${r.matching.passed}/${r.matching.total} queries)`);
  for (const [tag, b] of Object.entries(r.matching.byTag).sort()) lines.push(`  ${tag.padEnd(12)} ${b.passed}/${b.total}`);
  lines.push(`Suggestions  ${pct(r.suggestions.score)}  (${r.suggestions.passed}/${r.suggestions.total} trails fully right, ${pct(r.suggestions.hitRate)} with at least one)`);
  if (r.matching.failures.length) {
    lines.push("", "Query failures:");
    for (const f of r.matching.failures) lines.push(`  "${f.case.query}": expected ${f.case.expect ?? "none"}${f.case.intent ? ` (${f.case.intent})` : ""}, got ${f.got ?? "none"} (${f.intent})`);
  }
  if (r.suggestions.failures.length) {
    lines.push("", "Trail failures:");
    for (const f of r.suggestions.failures) lines.push(`  ${f.case.name ?? f.case.trail.join(" > ")}: missing ${f.missing.join(", ")}; top was ${f.got.join(", ") || "nothing"}`);
  }
  return lines.join("\n");
}
