import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createGuide } from "./guide.ts";
import { createTrail } from "./trail.ts";
import { reasonFromLink, renderReason } from "./reasons.ts";
import { VERSION } from "./version.ts";
import type { Pubba } from "./index.ts";
import type { Reason } from "./types.ts";

/*
 * pubba over HTTP and as an MCP server, for platforms without a runtime yet
 * and for AI assistants. Read-only and stateless: a visitor's trail comes in
 * with each request and is never kept, and queries are never logged.
 */

export interface ConnectionStep {
  from: string;
  kind: string;
  to: string;
  /** The link as a sentence, read from the step's far end. */
  text: string;
  reason: Reason;
}

/** How two entities connect: the shortest path of links between them (up to `maxSteps`), or null. */
export function connection(pubba: Pubba, from: string, to: string, maxSteps = 4): ConnectionStep[] | null {
  const g = pubba.graph;
  if (!g.entities.has(from) || !g.entities.has(to)) return null;
  if (from === to) return [];
  const came = new Map<string, { prev: string; link: (typeof g.links)[number] }>();
  let frontier = [from];
  const seen = new Set([from]);
  for (let depth = 0; depth < maxSteps && frontier.length; depth++) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      for (const link of g.adjacent.get(id) ?? []) {
        const other = link.from === id ? link.to : link.from;
        if (seen.has(other)) continue;
        seen.add(other);
        came.set(other, { prev: id, link });
        if (other === to) {
          const steps: ConnectionStep[] = [];
          for (let at = to; at !== from; at = came.get(at)!.prev) {
            const { prev, link: l } = came.get(at)!;
            const reason = reasonFromLink(l, at);
            steps.unshift({ from: prev, kind: l.kind, to: at, text: renderReason(g, reason, g.entities.get(at)!), reason });
          }
          return steps;
        }
        nextFrontier.push(other);
      }
    }
    frontier = nextFrontier;
  }
  return null;
}

const entityOut = (pubba: Pubba, id: string) => {
  const e = pubba.graph.entities.get(id) ?? pubba.graph.unlinked.get(id);
  return e ? { id: e.id, type: e.type, label: e.label, ...(e.url ? { url: e.url } : {}) } : { id };
};
const list = (s: string | null | undefined) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
const num = (s: string | null | undefined, fallback: number) => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : fallback;
};

export const OPERATIONS = ["match", "search", "next", "related", "autocomplete", "ask", "explain"];

/** The answers every transport shares, by operation name. Unknown operations throw. */
export function answer(pubba: Pubba, op: string, p: Record<string, unknown>): unknown {
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const arr = (k: string) => (Array.isArray(p[k]) ? (p[k] as unknown[]).filter((x): x is string => typeof x === "string") : list(str(k)));
  const lim = (fallback: number) => num(p.limit === undefined ? undefined : String(p.limit), fallback);
  switch (op) {
    case "match": {
      const m = pubba.match(str("query").slice(0, 300));
      return {
        intent: m.intent,
        entity: m.entity ? entityOut(pubba, m.entity.id) : null,
        ...(m.match ? { by: m.match.reason.by, text: m.match.text } : {}),
        similar: m.similar.map((s) => ({ ...entityOut(pubba, s.entity.id), reason: s.reason, text: s.text })),
        ...(m.notHere ? { notHere: m.notHere } : {}),
      };
    }
    case "search":
      return pubba.search(str("query").slice(0, 300), { limit: lim(10), ...(arr("types").length ? { types: arr("types") } : {}) }).map((m) => ({ ...entityOut(pubba, m.entity.id), score: m.score, by: m.reason.by, text: m.text }));
    case "next":
      return pubba.next(arr("trail").slice(-24), { limit: lim(3) }).map((s) => ({ ...entityOut(pubba, s.entity.id), score: s.score, reason: s.reason, text: s.text }));
    case "related":
      return pubba.related(str("id"), { limit: lim(10), ...(arr("kinds").length ? { kinds: arr("kinds") } : {}) }).map((r) => ({ ...entityOut(pubba, r.entity.id), weight: r.weight, reason: r.reason, text: r.text }));
    case "autocomplete":
      return pubba.autocomplete(str("query").slice(0, 100), arr("trail").slice(-24), { limit: lim(3) }).map((s) => ({ ...entityOut(pubba, s.entity.id), by: s.reason.by }));
    case "ask": {
      const trail = createTrail();
      for (const id of arr("trail").slice(-24)) trail.record(id);
      const r = createGuide(pubba, { trail }).ask(str("query").slice(0, 300));
      return { kind: r.kind, text: r.text, ...(r.action ? { action: r.action } : {}), chips: r.chips };
    }
    case "explain": {
      const steps = connection(pubba, str("from"), str("to"));
      return steps === null ? { connected: false } : { connected: true, steps };
    }
    default:
      throw new Error(`unknown operation ${op}`);
  }
}

export interface ServeOptions {
  port?: number;
  host?: string;
  /** Allow this origin to call from a browser (`*` for any). Default: none. */
  cors?: string;
}

/**
 * GET /match?query=… /search?query=…&limit=&types= /next?trail=a,b&limit= /related?id=…&kinds=&limit=
 * /autocomplete?query=…&trail= /ask?query=…&trail= /explain?from=…&to= /health
 */
export function serve(pubba: Pubba, { port = 8787, host = "127.0.0.1", cors }: ServeOptions = {}): Server {
  const reply = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(cors ? { "access-control-allow-origin": cors } : {}),
    });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "OPTIONS" && cors) {
      res.writeHead(204, { "access-control-allow-origin": cors, "access-control-allow-methods": "GET", "access-control-max-age": "86400" });
      return res.end();
    }
    if (req.method !== "GET") return reply(res, 405, { error: "GET only" });
    const url = new URL(req.url ?? "/", "http://pubba.local");
    const op = url.pathname.replace(/^\/+|\/+$/g, "");
    if (op === "health" || op === "") return reply(res, 200, { ok: true, pubba: VERSION, entities: pubba.graph.entities.size + pubba.graph.unlinked.size, links: pubba.graph.links.length });
    if (!OPERATIONS.includes(op)) return reply(res, 404, { error: `unknown endpoint /${op}` });
    try {
      return reply(res, 200, answer(pubba, op, Object.fromEntries(url.searchParams)));
    } catch {
      return reply(res, 500, { error: "could not answer" });
    }
  });
  server.listen(port, host);
  return server;
}

const TOOLS = [
  { name: "search", description: "Find things on this site by name, typo-tolerant. Returns matches, best first.", properties: { query: { type: "string", description: "What to look for" }, limit: { type: "number" } }, required: ["query"] },
  { name: "match", description: "What a question means here: one item, things like one (\"anything like X?\"), or nothing on this site.", properties: { query: { type: "string" } }, required: ["query"] },
  { name: "related", description: "What is related to one item, strongest first, each with the reason as a sentence.", properties: { id: { type: "string", description: "An item id from search or match" }, limit: { type: "number" } }, required: ["id"] },
  { name: "next", description: "What a visitor is likely to want next after these items, each with why.", properties: { trail: { type: "array", items: { type: "string" }, description: "Item ids visited, most recent last" }, limit: { type: "number" } }, required: ["trail"] },
  { name: "explain", description: "How two items connect, as the shortest path of links with a sentence for each.", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
] as const;

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** One MCP (JSON-RPC 2.0) message in, the response out (null for notifications). Read-only tools over the graph. */
export function handleMcp(pubba: Pubba, msg: Rpc, name = "pubba"): Record<string, unknown> | null {
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined || msg.id === null) return null;
  switch (msg.method) {
    case "initialize":
      return ok({
        protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name, version: VERSION },
        instructions: "Read-only tools over this site's knowledge graph. Start with search or match to find an item's id; related, next and explain take ids.",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: { type: "object", properties: t.properties, required: t.required }, annotations: { readOnlyHint: true } })) });
    case "tools/call": {
      const tool = String(msg.params?.name ?? "");
      if (!TOOLS.some((t) => t.name === tool)) return err(-32602, `unknown tool ${tool}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const result = answer(pubba, tool, args);
      return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: { result } });
    }
    default:
      return err(-32601, `method not found: ${msg.method}`);
  }
}

/** An MCP server over stdio: one JSON-RPC message per line in, one per line out. */
export function serveMcp(pubba: Pubba, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout, name?: string): void {
  let buffer = "";
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    buffer += chunk;
    let at: number;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      let msg: Rpc;
      try {
        msg = JSON.parse(line) as Rpc;
      } catch {
        output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`);
        continue;
      }
      const res = handleMcp(pubba, msg, name);
      if (res) output.write(`${JSON.stringify(res)}\n`);
    }
  });
}
