#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { documentDataset, fromDocument, type PubbaDocument } from "./document.ts";
import { evaluate, formatLint, formatReport, generateCases, lint, pct, regressions, type Baseline, type QueryCase, type TrailCase } from "./eval/index.ts";
import { toJsonLd, toLlmsTxt, validateJsonLd } from "./exports/index.ts";

const HELP = `pubba: a knowledge graph for showroom sites

Usage:
  pubba inspect  <pubba.json>                    counts of entities and links, by type and kind
  pubba preview  <pubba.json>                    the mapping as Markdown tables, for review before writing
  pubba match    <pubba.json> "<query>"          what a typed query means
  pubba related  <pubba.json> <id>               related items, with reasons
  pubba next     <pubba.json> <id> [<id>...]     what next after a trail
  pubba eval     <pubba.json> [--queries <file>] [--trails <file>] [--generated] [--baseline <file>] [--update-baseline] [--json]
                 --generated adds cases derived from the content itself, so the set grows with it
  pubba generate <pubba.json> [--out-dir <dir>]  write the generated cases, to read or to keep
  pubba lint     <pubba.json>                    content problems that cost accuracy; exits 1 on errors
  pubba jsonld   <pubba.json> [--base-url <url>] [--out <file>]
  pubba llms     <pubba.json> [--base-url <url>] [--out <file>]

A pubba.json holds { preset, presetOptions, portfolio | entities + links, config }.
"portfolio" may be a path to a JSON file, relative to the pubba.json.`;

const readJson = <T,>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

function readDocument(path: string): PubbaDocument {
  const doc = readJson<PubbaDocument & { portfolio?: unknown }>(path);
  if (typeof doc.portfolio === "string") doc.portfolio = readJson(resolve(dirname(path), doc.portfolio));
  return doc as PubbaDocument;
}

const load = (path: string) => fromDocument(readDocument(path));
const documentDatasetFor = (path: string) => documentDataset(readDocument(path));

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function write(text: string, out?: string) {
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
}

function main(argv: string[]): number {
  const [command, file, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || !file) {
    console.log(HELP);
    return command && command !== "help" && command !== "--help" ? 1 : 0;
  }
  const pubba = load(file);
  switch (command) {
    case "inspect": {
      const byType: Record<string, number> = {};
      const byKind: Record<string, number> = {};
      for (const e of pubba.graph.entities.values()) byType[e.type] = (byType[e.type] ?? 0) + 1;
      for (const l of pubba.graph.links) byKind[`${l.kind}${l.rule ? " (derived)" : ""}`] = (byKind[`${l.kind}${l.rule ? " (derived)" : ""}`] ?? 0) + 1;
      console.log(JSON.stringify({ entities: pubba.graph.entities.size, links: pubba.graph.links.length, byType, byKind }, null, 2));
      return 0;
    }
    case "preview": {
      const g = pubba.graph;
      const cell = (x: string) => x.replace(/\|/g, "\\|");
      const lines = ["## Entities", "", "| id | type | label | aliases | weight |", "| --- | --- | --- | --- | --- |"];
      for (const e of g.entities.values()) lines.push(`| ${cell(e.id)} | ${e.type} | ${cell(e.label)} | ${cell((e.aliases ?? []).join(", "))} | ${e.weight ?? ""} |`);
      lines.push("", "## Links", "", "| from | kind | to | weight | via | source |", "| --- | --- | --- | --- | --- | --- |");
      for (const l of g.links) lines.push(`| ${cell(l.from)} | ${l.kind} | ${cell(l.to)} | ${l.weight.toFixed(2)} | ${cell(l.via?.join(", ") ?? "")} | ${l.rule ? `rule ${l.rule}` : "content"} |`);
      const kept = new Set(g.entities.keys());
      const dropped = documentDatasetFor(file).entities.filter((e) => !kept.has(e.id));
      if (dropped.length) lines.push("", `No links, so never suggested (queries still find them): ${dropped.map((e) => e.id).join(", ")}`);
      console.log(lines.join("\n"));
      return 0;
    }
    case "match": {
      const m = pubba.match(rest.join(" "));
      console.log(JSON.stringify({ intent: m.intent, entity: m.entity?.id ?? null, score: m.match?.score, reason: m.match?.reason, similar: m.similar.map((s) => ({ id: s.entity.id, reason: s.reason, text: s.text })) }, null, 2));
      return 0;
    }
    case "related": {
      const id = rest[0] ?? "";
      if (!pubba.get(id)) return fail(`no entity ${id}`);
      console.log(JSON.stringify(pubba.related(id).map((r) => ({ id: r.entity.id, weight: Number(r.weight.toFixed(3)), reason: r.reason, text: r.text })), null, 2));
      return 0;
    }
    case "next": {
      const trail = rest.filter((a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--"));
      console.log(JSON.stringify(pubba.next(trail, { limit: Number(flag(rest, "--limit") ?? 3) }).map((s) => ({ id: s.entity.id, score: Number(s.score.toFixed(3)), reason: s.reason, text: s.text })), null, 2));
      return 0;
    }
    case "eval": {
      const qPath = flag(rest, "--queries");
      const tPath = flag(rest, "--trails");
      const bPath = flag(rest, "--baseline");
      const generated = rest.includes("--generated") ? generateCases(pubba) : { queries: [], trails: [] };
      const report = evaluate(pubba, {
        queries: [...(qPath ? readJson<QueryCase[]>(qPath) : []), ...generated.queries],
        trails: [...(tPath ? readJson<TrailCase[]>(tPath) : []), ...generated.trails],
      });
      if (generated.queries.length) console.error(`(+ ${generated.queries.length} generated queries and ${generated.trails.length} generated trails)`);
      if (rest.includes("--json")) console.log(JSON.stringify(report, null, 2));
      else console.log(formatReport(report));
      if (!bPath) return 0;
      if (rest.includes("--update-baseline")) {
        const next: Baseline = { matching: Number(report.matching.score.toFixed(3)), suggestions: Number(report.suggestions.score.toFixed(3)) };
        writeFileSync(bPath, `${JSON.stringify(next, null, 2)}\n`);
        console.log(`\nBaseline updated: matching ${pct(next.matching)}, suggestions ${pct(next.suggestions)}.`);
        return 0;
      }
      const drops = regressions(report, readJson<Baseline>(bPath));
      if (drops.length) {
        console.error(`\nScore dropped:\n  ${drops.join("\n  ")}`);
        return 1;
      }
      console.log("\nAt or above the baseline.");
      return 0;
    }
    case "generate": {
      const { queries, trails } = generateCases(pubba);
      const dir = flag(rest, "--out-dir");
      if (!dir) {
        console.log(JSON.stringify({ queries, trails }, null, 2));
        return 0;
      }
      writeFileSync(resolve(dir, "queries.generated.json"), `${JSON.stringify(queries, null, 2)}\n`);
      writeFileSync(resolve(dir, "trails.generated.json"), `${JSON.stringify(trails, null, 2)}\n`);
      console.log(`${queries.length} queries and ${trails.length} trails written to ${dir}.`);
      return 0;
    }
    case "lint": {
      const issues = lint(pubba, documentDatasetFor(file));
      console.log(formatLint(issues));
      return issues.some((i) => i.level === "error") ? 1 : 0;
    }
    case "jsonld": {
      const baseUrl = flag(rest, "--base-url");
      const doc = toJsonLd(pubba.graph, baseUrl ? { baseUrl } : {});
      const problems = validateJsonLd(doc);
      write(`${JSON.stringify(doc, null, 2)}\n`, flag(rest, "--out"));
      if (problems.length) return fail(`JSON-LD problems:\n  ${problems.join("\n  ")}`);
      return 0;
    }
    case "llms": {
      const baseUrl = flag(rest, "--base-url");
      write(toLlmsTxt(pubba.graph, baseUrl ? { baseUrl } : {}), flag(rest, "--out"));
      return 0;
    }
    default:
      console.log(HELP);
      return 1;
  }
}

function fail(message: string): number {
  console.error(message);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
