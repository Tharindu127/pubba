import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { closeTo, editDistance, loadBundle, normalize } from "../src/index.ts";
import { diff, run, type Case } from "../conformance/harness.ts";

// The TypeScript runtime against the conformance suite: every bundle loaded as
// any runtime would load it, every case answered exactly as the reference did.
const dir = new URL("../conformance/", import.meta.url);
const lines = (file: string) => readFileSync(new URL(`cases/${file}`, dir), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

for (const file of readdirSync(new URL("bundles/", dir)).sort()) {
  const name = file.replace(/\.json$/, "");
  test(`conformance: ${name}`, () => {
    const runtime = loadBundle(JSON.parse(readFileSync(new URL(`bundles/${file}`, dir), "utf8")));
    const cases = lines(`${name}.jsonl`);
    assert.ok(cases.length > 300, `${cases.length} cases`);
    let failed = 0;
    const firsts: string[] = [];
    for (const { expect, ...c } of cases) {
      const d = diff(run(runtime, c as unknown as Case), expect);
      if (d) {
        failed++;
        if (firsts.length < 5) firsts.push(`${JSON.stringify(c).slice(0, 120)}\n    ${d}`);
      }
    }
    assert.equal(failed, 0, `${failed} of ${cases.length} cases differ:\n  ${firsts.join("\n  ")}`);
  });
}

test("conformance: text helpers", () => {
  for (const c of lines("text.jsonl")) {
    const got = c.op === "normalize" ? normalize(c.input as string) : c.op === "distance" ? editDistance(c.a as string, c.b as string) : closeTo(c.token as string, c.word as string, c.typoMinLength as number);
    assert.deepEqual(got, c.expect, JSON.stringify(c));
  }
});
