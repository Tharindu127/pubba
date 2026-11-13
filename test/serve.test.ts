import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { answer, connection, handleMcp, serve } from "../src/serve.ts";
import { examplePubba } from "./fixtures.ts";

const pubba = examplePubba();

test("connection: the shortest path between two items, each link as a sentence", () => {
  const path = connection(pubba, "project:kiri-wallet", "project:kiri-merchant")!;
  assert.equal(path.length, 1);
  assert.equal(path[0]!.kind, "same-stack");
  const far = connection(pubba, "project:synthpad", "market:KE")!;
  assert.ok(far.length >= 2 && far.length <= 4);
  assert.equal(far[0]!.from, "project:synthpad");
  assert.equal(far[far.length - 1]!.to, "market:KE");
  assert.ok(far.every((s) => s.text.endsWith(".")));
  assert.equal(connection(pubba, "project:kiri-wallet", "nope"), null);
  assert.deepEqual(connection(pubba, "project:sira-none", "project:kiri-wallet"), null);
});

test("HTTP: read-only JSON endpoints, stateless, and unknown endpoints refused", async () => {
  const server = serve(pubba, { port: 0, cors: "*" });
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (path: string) => {
    const r = await fetch(base + path);
    return { status: r.status, cors: r.headers.get("access-control-allow-origin"), body: (await r.json()) as any };
  };
  try {
    const health = await get("/health");
    assert.equal(health.body.ok, true);
    assert.equal(health.cors, "*");
    assert.equal((await get("/match?query=flutr")).body.entity.id, "tech:Flutter");
    assert.equal((await get("/match?query=anything%20like%20kiri%20walet")).body.similar[0].id, "project:kiri-merchant");
    assert.equal((await get("/next?trail=project:kiri-wallet&limit=2")).body.length, 2);
    assert.equal((await get("/related?id=project:kiri-wallet&kinds=same-stack")).body[0].id, "project:kiri-merchant");
    assert.equal((await get("/ask?query=best%20pizza")).body.kind, "none");
    assert.equal((await get("/explain?from=project:kiri-wallet&to=project:kiri-merchant")).body.connected, true);
    assert.equal((await get("/nope")).status, 404);
    assert.equal((await fetch(base + "/match", { method: "POST" })).status, 405);
  } finally {
    server.close();
  }
});

test("MCP: initialize, list tools, call them; notifications get no reply; errors are JSON-RPC errors", () => {
  const init = handleMcp(pubba, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) as any;
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.serverInfo.name, "pubba");
  assert.equal(handleMcp(pubba, { jsonrpc: "2.0", method: "notifications/initialized" }), null);
  const tools = (handleMcp(pubba, { jsonrpc: "2.0", id: 2, method: "tools/list" }) as any).result.tools;
  assert.deepEqual(tools.map((t: any) => t.name), ["search", "match", "related", "next", "explain"]);
  assert.ok(tools.every((t: any) => t.inputSchema.type === "object" && t.annotations.readOnlyHint));
  const call = handleMcp(pubba, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search", arguments: { query: "kiri", limit: 2 } } }) as any;
  assert.equal(call.result.structuredContent.result[0].id, "project:kiri-wallet");
  assert.equal(JSON.parse(call.result.content[0].text)[0].id, "project:kiri-wallet");
  assert.equal((handleMcp(pubba, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "drop_tables" } }) as any).error.code, -32602);
  assert.equal((handleMcp(pubba, { jsonrpc: "2.0", id: 5, method: "resources/list" }) as any).error.code, -32601);
  assert.deepEqual(answer(pubba, "next", { trail: ["project:kiri-wallet"], limit: 1 }), answer(pubba, "next", { trail: "project:kiri-wallet", limit: "1" }));
});

test("MCP over stdio: the CLI answers line by line", async () => {
  const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/cli.ts", "mcp", "examples/portfolio/pubba.json"], { cwd: new URL("..", import.meta.url) });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\nnot json\n${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "match", arguments: { query: "sri lankan" } } })}\n`);
  for (let i = 0; i < 100 && out.split("\n").filter(Boolean).length < 3; i++) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  const lines = out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines[0].result.serverInfo.name, "pubba");
  assert.equal(lines[1].error.code, -32700);
  assert.equal(lines[2].result.structuredContent.result.entity.id, "market:LK");
});
