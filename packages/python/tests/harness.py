"""The conformance harness for Python: runs a case and returns its answer as plain JSON (see conformance/README.md)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pubba import EntityChip, NudgePolicy, Pubba, QuestionChip, Reply, create_events, create_guide


def _reason(r: Dict[str, Any]) -> Dict[str, Any]:
    return {k: (list(v) if isinstance(v, (list, tuple)) else v) for k, v in r.items() if v is not None}


def _chip(c: Any) -> Dict[str, Any]:
    if isinstance(c, QuestionChip):
        return {"label": c.label, "question": c.question}
    out: Dict[str, Any] = {"id": c.id, "label": c.label}
    if c.url is not None:
        out["url"] = c.url
    out["reason"] = _reason(c.reason)
    out["text"] = c.text
    return out


def _reply(r: Optional[Reply]) -> Optional[Dict[str, Any]]:
    if r is None:
        return None
    out: Dict[str, Any] = {"kind": r.kind, "text": r.text}
    if r.action:
        out["action"] = dict(r.action)
    out["chips"] = [_chip(c) for c in r.chips]
    if r.match:
        out["match"] = {"id": r.match.entity.id, "score": r.match.score, "tier": r.match.tier, "by": r.match.reason.get("by"), "name": r.match.reason.get("name")}
    if r.similar is not None:
        out["similar"] = [_chip(c) for c in r.similar]
    return out


def _weighted(x: Any) -> Dict[str, Any]:
    return {"id": x.entity.id, "weight": x.weight, "reason": _reason(x.reason), "text": x.text}


def _scored(x: Any) -> Dict[str, Any]:
    return {"id": x.entity.id, "score": x.score, "reason": _reason(x.reason), "text": x.text}


def _guide_options(o: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    o = o or {}
    out: Dict[str, Any] = {}
    if "chips" in o:
        out["chips"] = o["chips"]
    if "hide" in o:
        def hidden(e: Any) -> bool:
            label = e.label.lower()
            return any(
                (not r.get("types") or e.type in r["types"])
                and (not r.get("ids") or e.id in r["ids"])
                and (not r.get("labelIncludes") or any(s in label for s in r["labelIncludes"]))
                and (not r.get("labelEndsWith") or any(label.endswith(s) for s in r["labelEndsWith"]))
                for r in o["hide"]
            )

        out["accept"] = lambda e: not hidden(e)
    if "fallback" in o:
        fb = o["fallback"]

        def fallback(ctx: Dict[str, Any]) -> Any:
            if ctx["kind"] == "open" and ctx.get("entity") is not None:
                return fb.get("open." + ctx["entity"].type, fb.get("open"))
            return fb.get(ctx["kind"])

        out["fallback"] = fallback
    if "lines" in o:
        out["line"] = lambda e: o["lines"].get(e.id)
    if "templates" in o:
        out["templates"] = o["templates"]
    if "nudgeAvoids" in o:
        out["prefer"] = lambda e: e.type not in o["nudgeAvoids"]
    return out


def _run_guide(base: Pubba, steps: List[Dict[str, Any]], options: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    clock = [0.0]
    events = create_events(["contact"])
    emitted: List[Dict[str, Any]] = []
    events.on(emitted.append)
    guide = create_guide(base.with_events(events), now=lambda: clock[0], nudge=NudgePolicy(), **_guide_options(options))
    answers: List[Any] = []
    for s in steps:
        op = s["op"]
        if op == "visited":
            guide.visited(s["id"]); answers.append(None)
        elif op == "follow":
            guide.follow(s["id"], s["via"]); answers.append(None)
        elif op == "ask":
            answers.append(_reply(guide.ask(s["question"])))
        elif op == "nudge":
            answers.append(_reply(guide.nudge()))
        elif op == "chips":
            answers.append([_chip(c) for c in guide.chips(s.get("limit"))])
        elif op == "tick":
            clock[0] += s["ms"]; answers.append(None)
        elif op == "opened":
            guide.opened(); answers.append(None)
        elif op == "reached":
            guide.reached(s["goal"]); answers.append(None)
    return {"answers": answers, "trail": guide.trail.get(), "events": emitted}


def run(pubba: Pubba, c: Dict[str, Any]) -> Any:
    op = c["op"]
    if op == "match":
        m = pubba.match(c["query"])
        out: Dict[str, Any] = {"intent": m.intent, "entity": m.entity.id if m.entity else None}
        if m.match:
            out.update({"score": m.match.score, "tier": m.match.tier, "by": m.match.reason.get("by"), "name": m.match.reason.get("name"), "text": m.match.text})
        out["similar"] = [_weighted(x) for x in m.similar]
        if m.not_here:
            out["notHere"] = m.not_here
        return out
    if op == "search":
        return [{"id": m.entity.id, "score": m.score, "tier": m.tier, "by": m.reason.get("by"), "name": m.reason.get("name")} for m in pubba.search(c["query"], limit=c["limit"])]
    if op == "next":
        return [_scored(x) for x in pubba.next(c["trail"], limit=c["limit"], exclude=c.get("exclude", ()))]
    if op == "related":
        return [_weighted(x) for x in pubba.related(c["id"], kinds=c.get("kinds"), limit=c.get("limit"))]
    if op == "autocomplete":
        return [{"id": s.entity.id, "score": s.score, "by": s.reason.get("by")} for s in pubba.autocomplete(c["typed"], c["trail"], limit=c["limit"])]
    if op == "explain":
        return pubba.explain(c["reason"], c["item"])
    if op == "guide":
        return _run_guide(pubba, c["steps"], c.get("options"))
    raise ValueError(op)


def diff(a: Any, b: Any, path: str = "$") -> Optional[str]:
    """Equal as JSON, numbers to 1e-9. The path of the first difference, or None."""
    num = (int, float)
    if isinstance(a, num) and not isinstance(a, bool) and isinstance(b, num) and not isinstance(b, bool):
        return None if abs(a - b) <= 1e-9 else f"{path}: {a} != {b}"
    if isinstance(a, list) or isinstance(b, list):
        if not isinstance(a, list) or not isinstance(b, list):
            return f"{path}: list vs not"
        if len(a) != len(b):
            return f"{path}: length {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = diff(x, y, f"{path}[{i}]")
            if d:
                return d
        return None
    if isinstance(a, dict) and isinstance(b, dict):
        ka = sorted(a)
        kb = sorted(b)
        if ka != kb:
            return f"{path}: keys {ka} != {kb}"
        for k in ka:
            d = diff(a.get(k), b.get(k), f"{path}.{k}")
            if d:
                return d
        return None
    return None if a == b else f"{path}: {a!r} != {b!r}"
