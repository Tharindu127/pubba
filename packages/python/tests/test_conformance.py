"""The Python runtime against the shared conformance suite (../../conformance)."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from harness import diff, run  # noqa: E402

from pubba import close_to, edit_distance, load_bundle, normalize  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "conformance")


def lines(name):
    with open(os.path.join(ROOT, "cases", name), encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


class Conformance(unittest.TestCase):
    def test_text_helpers(self):
        for c in lines("text.jsonl"):
            if c["op"] == "normalize":
                got = normalize(c["input"])
            elif c["op"] == "distance":
                got = edit_distance(c["a"], c["b"])
            else:
                tm = c["typoMinLength"]
                got = close_to(c["token"], c["word"], float("inf") if tm is None else tm)
            self.assertEqual(got, c["expect"], c)

    def test_bundles(self):
        names = sorted(f[:-5] for f in os.listdir(os.path.join(ROOT, "bundles")) if f.endswith(".json"))
        self.assertTrue(names)
        for name in names:
            with self.subTest(bundle=name):
                with open(os.path.join(ROOT, "bundles", name + ".json"), encoding="utf-8") as f:
                    pubba = load_bundle(f.read())
                cases = lines(name + ".jsonl")
                failures = []
                for c in cases:
                    expect = c.pop("expect")
                    d = diff(run(pubba, c), expect)
                    if d:
                        failures.append(json.dumps(c)[:140] + "\n    " + d)
                self.assertEqual(failures, [], f"{len(failures)} of {len(cases)} cases differ:\n  " + "\n  ".join(failures[:5]))


if __name__ == "__main__":
    unittest.main()
