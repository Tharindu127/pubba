import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { ANSWER_SCHEMA, aiHandler, aiSystemPrompt, claude, createAI, gemini, memoryCounter, openai, remoteAI, type AICounter, type AIOutcome, type AIProvider, type AIRequest } from "../src/ai.ts";
import { createGuide } from "../src/guide.ts";
import { serve } from "../src/serve.ts";
import { examplePubba } from "./fixtures.ts";

const pubba = examplePubba();
const UNANSWERED = "is she open to remote work";

/** A model that answers with whatever `reply` gives, and remembers what it was asked. */
function fake(reply: (r: AIRequest) => string | null | Promise<string | null>): AIProvider & { calls: AIRequest[] } {
  const calls: AIRequest[] = [];
  return {
    name: "fake",
    calls,
    async complete(r) {
      calls.push(r);
      return reply(r);
    },
  };
}
const says = (answer: string, ids: string[] = [], answerable = true) => JSON.stringify({ answerable, answer, ids });

/** A fetch that records the request and answers with `body`. */
function fakeFetch(body: unknown, status = 200) {
  const seen: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, seen, body: (i = 0) => JSON.parse(String(seen[i]!.init.body)) as Record<string, any>, headers: (i = 0) => seen[i]!.init.headers as Record<string, string> };
}

test("the guide asks its AI only when it has no answer of its own", async () => {
  const model = fake(() => says("Yes, she works remotely with teams in Kenya and Ghana.", ["market:KE", "project:kiri-wallet", "nope"]));
  const guide = createGuide(pubba, { ai: createAI(pubba, { provider: model }) });

  const own = await guide.askAsync("kiri walet");
  assert.equal(own.kind, "open");
  assert.equal((await guide.askAsync("react native")).kind, "open");
  assert.equal(model.calls.length, 0, "matched questions never reach the model");

  const r = await guide.askAsync(UNANSWERED);
  assert.equal(r.kind, "ai");
  assert.equal(r.text, "Yes, she works remotely with teams in Kenya and Ghana.");
  assert.equal(r.action?.id, "market:KE");
  assert.equal(r.chips[0] && "id" in r.chips[0] ? r.chips[0].id : undefined, "project:kiri-wallet", "the other named entities come first");
  assert.ok(r.chips.length <= 3);
  assert.ok(r.chips.every((c) => !("id" in c) || c.id !== "market:KE"), "the action isn't repeated as a chip");
  assert.equal(model.calls.length, 1);
  assert.equal(guide.ask(UNANSWERED).kind, "none", "ask stays synchronous and local");
});

test("every AI failure leaves the guide's own reply", async () => {
  const local = createGuide(pubba).ask(UNANSWERED);
  const cases: [string, AIProvider][] = [
    ["declined", fake(() => null)],
    ["unanswerable", fake(() => says("", [], false))],
    ["empty", fake(() => says("   "))],
    ["invalid", fake(() => "not json")],
    ["error", fake(() => Promise.reject(new Error("boom")))],
  ];
  for (const [name, provider] of cases) {
    const r = await createGuide(pubba, { ai: createAI(pubba, { provider }) }).askAsync(UNANSWERED);
    assert.deepEqual(r, local, name);
  }
  const throwing = { answer: () => Promise.reject(new Error("down")) };
  assert.deepEqual(await createGuide(pubba, { ai: throwing }).askAsync(UNANSWERED), local, "a GuideAI that rejects");
  assert.deepEqual(await createGuide(pubba).askAsync(UNANSWERED), local, "no AI at all");
});

test("not-here questions never reach the AI", async () => {
  const p = examplePubba(undefined, undefined);
  p.graph.config.match = { ...p.graph.config.match, notHere: ["Kubernetes"] };
  const model = fake(() => says("Something."));
  const r = await createGuide(p, { ai: createAI(p, { provider: model }) }).askAsync("do you know kubernetes?");
  assert.equal(r.kind, "not-here");
  assert.equal(model.calls.length, 0);
});

test("what the model is asked: rules, the site's words and knowledge in the system prompt; the trail and question in the turn", async () => {
  const model = fake(() => says("Yes."));
  const ai = createAI(pubba, { provider: model, instructions: "Speak as Nimali's assistant.", maxQuestionLength: 20 });
  await ai.answer({ question: "a question that is far too long to keep", trail: ["project:kiri-wallet", "nope", "role:0"] });
  const [r] = model.calls;
  assert.match(r!.system, /website of Nimali Perera/);
  assert.match(r!.system, /Answer only from the knowledge/);
  assert.match(r!.system, /Speak as Nimali's assistant\./);
  assert.match(r!.system, /<knowledge>\n\{"v":3,/);
  assert.equal(r!.prompt, `Recently viewed: Kiri Wallet (project:kiri-wallet), ${pubba.get("role:0")!.label} (role:0).\nQuestion: a question that is f`);
  assert.deepEqual(r!.schema, ANSWER_SCHEMA);
  await ai.answer({ question: "again", trail: [] });
  assert.equal(model.calls[1]!.system, r!.system, "the same system prompt every time, so it caches");
  assert.equal(model.calls[1]!.prompt, "Question: again");
  assert.equal(aiSystemPrompt({ v: 3 }).split("\n")[0], "You answer visitors' questions on the website of this site, using only the site knowledge below.");
});

test("ids the model makes up are dropped, and at most three are kept", async () => {
  const ai = createAI(pubba, { provider: fake(() => says("Yes.", ["made:up", "project:kiri-wallet", "role:0", "role:1", "role:2"])) });
  assert.deepEqual(await ai.answer({ question: "q", trail: [] }), { text: "Yes.", ids: ["project:kiri-wallet", "role:0", "role:1"] });
});

test("the kill switch, read on every question", async () => {
  let on = true;
  const outcomes: AIOutcome[] = [];
  const model = fake(() => says("Yes."));
  const ai = createAI(pubba, { provider: model, enabled: () => on, onOutcome: (o) => outcomes.push(o) });
  assert.ok(await ai.answer({ question: "q", trail: [] }));
  on = false;
  assert.equal(await ai.answer({ question: "q", trail: [] }), null);
  on = true;
  assert.ok(await ai.answer({ question: "q", trail: [] }));
  assert.equal(model.calls.length, 2);
  assert.deepEqual(outcomes.map((o) => o.outcome), ["answered", "disabled", "answered"]);
  assert.equal(await createAI(pubba, { provider: null }).answer({ question: "q", trail: [] }), null, "no provider is off");
  assert.equal(await createAI(pubba, { provider: model, enabled: false }).answer({ question: "q", trail: [] }), null);
});

test("limits: per visitor in a sliding window, and per UTC day across visitors", async () => {
  let clock = Date.UTC(2026, 10, 16, 23, 0);
  const outcomes: string[] = [];
  const model = fake(() => says("Yes."));
  const ai = createAI(pubba, { provider: model, perVisitor: { max: 2, windowMs: 60_000 }, perDay: 3, now: () => clock, onOutcome: (o) => outcomes.push(o.outcome) });
  const ask = (visitor?: string) => ai.answer({ question: "q", trail: [], ...(visitor ? { visitor } : {}) });
  assert.ok(await ask("a"));
  assert.ok(await ask("a"));
  assert.equal(await ask("a"), null, "a third in the window");
  clock += 61_000;
  assert.ok(await ask("a"), "the window moved on");
  assert.equal(ai.usedToday(), 3);
  assert.equal(await ask("b"), null, "the day's allowance is spent, for everyone");
  assert.equal(await ask(), null);
  clock = Date.UTC(2026, 10, 17, 0, 1);
  assert.equal(ai.usedToday(), 0);
  assert.ok(await ask("b"), "a new day");
  assert.equal(model.calls.length, 4);
  assert.deepEqual(outcomes, ["answered", "answered", "limit-visitor", "answered", "limit-day", "limit-day", "answered"]);
});

test("a slow model times out and the answer is dropped", async () => {
  const outcomes: AIOutcome[] = [];
  let aborted = false;
  const slow: AIProvider = {
    name: "slow",
    complete: ({ signal }) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => (aborted = true));
        setTimeout(() => resolve(says("Too late.")), 200);
      }),
  };
  const started = Date.now();
  assert.equal(await createAI(pubba, { provider: slow, timeoutMs: 20, onOutcome: (o) => outcomes.push(o) }).answer({ question: "q", trail: [] }), null);
  assert.ok(Date.now() - started < 150, "doesn't wait for the model");
  assert.ok(aborted, "the request is cancelled");
  assert.equal(outcomes[0]!.outcome, "timeout");
});

test("outcomes say what happened without the question or the answer", async () => {
  const outcomes: AIOutcome[] = [];
  const ai = createAI(pubba, { provider: fake(() => Promise.reject(new Error("claude: HTTP 529"))), onOutcome: (o) => outcomes.push(o) });
  await ai.answer({ question: "my secret question", trail: [] });
  assert.equal(outcomes[0]!.outcome, "error");
  assert.equal(outcomes[0]!.detail, "claude: HTTP 529");
  assert.ok(!JSON.stringify(outcomes).includes("secret"));
  const throwing = createAI(pubba, { provider: fake(() => says("Yes.")), onOutcome: () => { throw new Error("log down"); } });
  assert.ok(await throwing.answer({ question: "q", trail: [] }), "a failing hook doesn't break the answer");
});

test("Claude: the Messages API with a cached system prompt, a JSON schema, and fallbacks where the model takes them", async () => {
  const http = fakeFetch({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: says("Yes.") }] });
  const provider = claude({ apiKey: "k", fetch: http.f });
  const out = await provider.complete({ system: "S", prompt: "P", schema: ANSWER_SCHEMA, signal: new AbortController().signal });
  assert.equal(out, says("Yes."));
  assert.equal(http.seen[0]!.url, "https://api.anthropic.com/v1/messages");
  assert.deepEqual(http.headers(), { "content-type": "application/json", "x-api-key": "k", "anthropic-version": "2026-10-21", "anthropic-beta": "server-side-fallback-2026-07-01" });
  const body = http.body();
  assert.equal(body.model, "claude-opus-5-5");
  assert.deepEqual(body.system, [{ type: "text", text: "S", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(body.messages, [{ role: "user", content: "P" }]);
  assert.deepEqual(body.output_config, { effort: "low", format: { type: "json_schema", schema: ANSWER_SCHEMA } });
  assert.equal(body.fallbacks, "default");
  assert.ok(!("temperature" in body) && !("thinking" in body));

  const haiku = fakeFetch({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] });
  await claude({ apiKey: "k", model: "claude-haiku-5-5", effort: "medium", fetch: haiku.f }).complete({ system: "S", prompt: "P", schema: ANSWER_SCHEMA, signal: new AbortController().signal });
  assert.ok(!("fallbacks" in haiku.body()) && !("anthropic-beta" in haiku.headers()), "no fallbacks for a model without them");
  assert.equal(haiku.body().output_config.effort, "medium");

  const refused = fakeFetch({ stop_reason: "refusal", content: [] });
  assert.equal(await claude({ apiKey: "k", fetch: refused.f }).complete({ system: "S", prompt: "P", schema: ANSWER_SCHEMA, signal: new AbortController().signal }), null);
  const down = fakeFetch({ error: {} }, 529);
  await assert.rejects(claude({ apiKey: "k", fetch: down.f }).complete({ system: "S", prompt: "P", schema: ANSWER_SCHEMA, signal: new AbortController().signal }), /claude: HTTP 529/);
});

test("OpenAI: Chat Completions with a strict JSON schema", async () => {
  const http = fakeFetch({ choices: [{ message: { content: says("Yes.") } }] });
  const out = await openai({ apiKey: "k", model: "m", baseUrl: "https://proxy.example", fetch: http.f }).complete({ system: "S", prompt: "P", schema: ANSWER_SCHEMA, signal: new AbortController().signal });
  assert.equal(out, says("Yes."));
  assert.equal(http.seen[0]!.url, "https://proxy.example/v1/chat/completions");
  assert.equal(http.headers().authorization, "Bearer k");
  assert.deepEqual(http.body(), {
    model: "m",
    messages: [
      { role: "system", content: "S" },
      { role: "user", content: "P" },
    ],
    response_format: { type: "json_schema", json_schema: { name: "pubba_answer", strict: true, schema: ANSWER_SCHEMA } },
  });
  const refused = fakeFetch({ choices: [{ message: { content: null, refusal: "No." } }] });
  assert.equal(await openai({ apiKey: "k", model: "m", fetch: refused.f }).complete({ system: "S", prompt: "P", schema: ANSWER_SCHEMA, signal: new AbortController().signal }), null);
});

test("Gemini: generateContent with a response schema in its own dialect", async () => {
  const http = fakeFetch({ candidates: [{ content: { parts: [{ text: '{"answerable":true,' }, { text: '"answer":"Yes.","ids":[]}' }] }, finishReason: "STOP" }] });
  const out = await gemini({ apiKey: "k", model: "gem-x", fetch: http.f }).complete({ system: "S", prompt: "P", schema: ANSWER_SCHEMA, signal: new AbortController().signal });
  assert.equal(out, says("Yes."));
  assert.equal(http.seen[0]!.url, "https://generativelanguage.googleapis.com/v1beta/models/gem-x:generateContent");
  assert.equal(http.headers()["x-goog-api-key"], "k");
  const body = http.body();
  assert.deepEqual(body.systemInstruction, { parts: [{ text: "S" }] });
  assert.deepEqual(body.contents, [{ role: "user", parts: [{ text: "P" }] }]);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.generationConfig.responseSchema.type, "OBJECT");
  assert.equal(body.generationConfig.responseSchema.properties.ids.items.type, "STRING");
  assert.ok(!("additionalProperties" in body.generationConfig.responseSchema));
  const blocked = fakeFetch({ candidates: [{ finishReason: "SAFETY" }] });
  assert.equal(await gemini({ apiKey: "k", model: "g", fetch: blocked.f }).complete({ system: "S", prompt: "P", schema: ANSWER_SCHEMA, signal: new AbortController().signal }), null);
});

test("pubba serve: /ask falls through to the AI, /ai answers alone, and the visitor is the caller's address", async () => {
  const visitors: (string | undefined)[] = [];
  const ai = {
    async answer({ question, visitor }: { question: string; visitor?: string }) {
      visitors.push(visitor);
      return question.includes("remote") ? { text: "Yes, remote.", ids: ["project:kiri-wallet"] } : null;
    },
  };
  const server = serve(pubba, { port: 0, ai, trustProxy: true });
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const ask = (await (await fetch(`${base}/ask?query=${encodeURIComponent(UNANSWERED)}&trail=role:0`, { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } })).json()) as Record<string, any>;
    assert.equal(ask.kind, "ai");
    assert.equal(ask.text, "Yes, remote.");
    assert.equal(ask.action.id, "project:kiri-wallet");
    assert.equal(((await (await fetch(`${base}/ask?query=kiri%20walet`)).json()) as Record<string, any>).kind, "open");
    assert.deepEqual(await (await fetch(`${base}/ai?query=${encodeURIComponent(UNANSWERED)}`)).json(), { text: "Yes, remote.", ids: ["project:kiri-wallet"] });
    assert.deepEqual(await (await fetch(`${base}/ai?query=nothing`)).json(), { text: null });
    assert.equal(visitors[0], "203.0.113.7");
    assert.match(String(visitors[1]), /127\.0\.0\.1/, "without the header, the socket's address");

    const answer = await remoteAI({ url: `${base}/ai` }).answer({ question: UNANSWERED, trail: ["role:0"] });
    assert.deepEqual(answer, { text: "Yes, remote.", ids: ["project:kiri-wallet"] });
    assert.equal(await remoteAI({ url: `${base}/ai` }).answer({ question: "nothing", trail: [] }), null);
    assert.equal(await remoteAI({ url: `${base}/nope` }).answer({ question: "q", trail: [] }), null, "a 404 is no answer");
    assert.equal(await remoteAI({ url: "http://127.0.0.1:1/ai", timeoutMs: 500 }).answer({ question: "q", trail: [] }), null, "an unreachable server is no answer");

    const browserGuide = createGuide(pubba, { ai: remoteAI({ url: `${base}/ai` }) });
    assert.equal((await browserGuide.askAsync(UNANSWERED)).kind, "ai");
  } finally {
    server.close();
  }
  const plain = serve(pubba, { port: 0 });
  await once(plain, "listening");
  try {
    const port = (plain.address() as AddressInfo).port;
    assert.equal(((await (await fetch(`http://127.0.0.1:${port}/ask?query=${encodeURIComponent(UNANSWERED)}`)).json()) as Record<string, any>).kind, "none", "no AI: unchanged");
    assert.equal((await fetch(`http://127.0.0.1:${port}/ai?query=q`)).status, 404);
  } finally {
    plain.close();
  }
});

test("1.3: a shared counter holds the limits across instances, as serverless hosts run them", async () => {
  let clock = Date.UTC(2026, 10, 20, 10, 0);
  const shared = memoryCounter(() => clock);
  const model = fake(() => says("Yes."));
  const instance = () => createAI(pubba, { provider: model, counter: shared, perVisitor: { max: 2, windowMs: 60_000 }, perDay: 3, now: () => clock });
  const [a, b, c] = [instance(), instance(), instance()];
  const ask = (ai: ReturnType<typeof createAI>, visitor?: string) => ai.answer({ question: "q", trail: [], ...(visitor ? { visitor } : {}) });
  assert.ok(await ask(a, "v1"));
  assert.ok(await ask(b, "v1"), "another instance, the same visitor");
  assert.equal(await ask(c, "v1"), null, "a third instance still sees two");
  assert.ok(await ask(c, "v2"));
  assert.equal(await ask(a, "v3"), null, "the day's three are spent across all instances");
  assert.equal(model.calls.length, 3);
  assert.equal(a.usedToday() + b.usedToday() + c.usedToday(), 3, "each instance counts only its own");
  clock = Date.UTC(2026, 10, 21, 0, 1);
  assert.ok(await ask(b, "v1"), "a new day and a new window");
});

test("1.3: a visitor over their limit doesn't use up the day's allowance", async () => {
  const counter = memoryCounter(() => 0);
  const ai = createAI(pubba, { provider: fake(() => says("Yes.")), counter, perVisitor: { max: 1, windowMs: 60_000 }, perDay: 2, now: () => 0 });
  assert.ok(await ai.answer({ question: "q", trail: [], visitor: "a" }));
  for (let i = 0; i < 5; i++) assert.equal(await ai.answer({ question: "q", trail: [], visitor: "a" }), null);
  assert.ok(await ai.answer({ question: "q", trail: [], visitor: "b" }), "the day still has room");
});

test("1.3: the shared store gets hashed visitor keys with windows that expire, never the address", async () => {
  const seen: [string, number][] = [];
  const counter: AICounter = { async increment(key, ttl) { seen.push([key, ttl]); return 1; } };
  const at = Date.UTC(2026, 10, 20, 10, 0, 30);
  const ai = createAI(pubba, { provider: fake(() => says("Yes.")), counter, counterPrefix: "site:", perVisitor: { max: 5, windowMs: 60_000 }, now: () => at });
  await ai.answer({ question: "q", trail: [], visitor: "203.0.113.7" });
  await ai.answer({ question: "q", trail: [], visitor: "203.0.113.7" });
  const [visitorKey, visitorTtl] = seen[0]!;
  const [dayKey, dayTtl] = seen[1]!;
  assert.match(visitorKey!, /^site:v:[0-9a-f]{24}:\d+$/);
  assert.ok(!seen.some(([k]) => k.includes("203.0.113.7")), "no address in any key");
  assert.equal(seen[2]![0], visitorKey, "the same visitor, the same key");
  assert.equal(visitorTtl, 30_000, "until the window ends");
  assert.equal(dayKey, "site:d:2026-11-20");
  assert.equal(dayTtl, Date.UTC(2026, 10, 21) - at + 3_600_000, "until an hour past midnight UTC");
});

test("1.3: a counter that fails turns the AI off for that question, not the limits", async () => {
  const outcomes: AIOutcome[] = [];
  const model = fake(() => says("Yes."));
  const broken: AICounter = { increment: () => Promise.reject(new Error("store down")) };
  const ai = createAI(pubba, { provider: model, counter: broken, onOutcome: (o) => outcomes.push(o) });
  assert.equal(await ai.answer({ question: "q", trail: [], visitor: "v" }), null);
  assert.equal(model.calls.length, 0, "the model is never asked");
  assert.deepEqual(outcomes, [{ outcome: "error", provider: "fake", detail: "counter: store down" }]);
  const r = await createGuide(pubba, { ai }).askAsync(UNANSWERED);
  assert.equal(r.kind, "none", "the guide keeps its own reply");
});

test("1.3: aiHandler answers web requests for remoteAI, GET or POST", async () => {
  const asked: { question: string; trail: string[]; visitor?: string }[] = [];
  const ai = {
    async answer(input: { question: string; trail: string[]; visitor?: string }) {
      asked.push(input);
      return input.question.includes("remote") ? { text: "Yes, remote.", ids: ["project:kiri-wallet"] } : null;
    },
  };
  const handle = aiHandler(ai);
  const get = await handle(new Request(`https://site.example/api/ai?query=${encodeURIComponent("open to remote?")}&trail=role:0,%20project:kiri-wallet`, { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }));
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("cache-control"), "no-store");
  assert.deepEqual(await get.json(), { text: "Yes, remote.", ids: ["project:kiri-wallet"] });
  assert.deepEqual(asked[0], { question: "open to remote?", trail: ["role:0", "project:kiri-wallet"], visitor: "203.0.113.7" });

  const post = await handle(new Request("https://site.example/api/ai", { method: "POST", body: JSON.stringify({ query: "nothing here", trail: ["role:0"] }), headers: { "x-real-ip": "198.51.100.2" } }));
  assert.deepEqual(await post.json(), { text: null });
  assert.equal(asked[1]!.visitor, "198.51.100.2");

  assert.deepEqual(await (await handle(new Request("https://site.example/api/ai?query=%20%20"))).json(), { text: null });
  assert.equal(asked.length, 2, "an empty question never reaches the AI");
  assert.equal((await handle(new Request("https://site.example/api/ai", { method: "POST", body: "not json" }))).status, 400);
  const put = await handle(new Request("https://site.example/api/ai", { method: "PUT" }));
  assert.equal(put.status, 405);
  assert.equal(put.headers.get("allow"), "GET, POST, OPTIONS");
  assert.equal((await handle(new Request("https://site.example/api/ai?query=" + "x".repeat(400)))).status, 200);
  assert.equal(asked[2]!.question.length, 300, "cut to 300 characters");
  assert.equal(asked[2]!.visitor, undefined, "no address header, no visitor");
});

test("1.3: aiHandler options: CORS for another origin, the site's own visitor id, and an AI that throws", async () => {
  const visitors: (string | undefined)[] = [];
  const handle = aiHandler(
    { async answer({ visitor }) { visitors.push(visitor); throw new Error("down"); } },
    { cors: "https://www.example.com", visitor: (r) => r.headers.get("x-session") ?? undefined }
  );
  const pre = await handle(new Request("https://api.example.com/ai", { method: "OPTIONS" }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://www.example.com");
  assert.equal(pre.headers.get("access-control-allow-methods"), "GET, POST");
  const r = await handle(new Request("https://api.example.com/ai?query=q", { headers: { "x-session": "s-1", "x-forwarded-for": "203.0.113.7" } }));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://www.example.com");
  assert.deepEqual(await r.json(), { text: null }, "a failing AI is no answer, not an error");
  assert.deepEqual(visitors, ["s-1"]);
  assert.equal((await aiHandler({ answer: async () => null })(new Request("https://x.example/ai", { method: "OPTIONS" }))).headers.get("access-control-allow-origin"), null, "no CORS unless asked");
});

test("1.3: the browser guide, remoteAI and aiHandler end to end, with a shared counter", async () => {
  const counter = memoryCounter();
  const server = createAI(pubba, { provider: fake(() => says("Yes, she works remotely.", ["project:kiri-wallet"])), counter, perVisitor: { max: 1, windowMs: 60_000 } });
  const handle = aiHandler(server);
  const fetchToHandler = (async (url: string | URL | Request, init?: RequestInit) => handle(new Request(String(url), { ...init, headers: { "x-forwarded-for": "203.0.113.9" } }))) as typeof fetch;
  const guide = createGuide(pubba, { ai: remoteAI({ url: "https://site.example/api/ai", fetch: fetchToHandler }) });
  const first = await guide.askAsync(UNANSWERED);
  assert.equal(first.kind, "ai");
  assert.equal(first.action?.id, "project:kiri-wallet");
  assert.equal((await guide.askAsync(UNANSWERED)).kind, "none", "over the visitor's limit: the guide's own reply");
});
