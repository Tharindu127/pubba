"""The headless guide (SPEC section 9): replies, chips, the trail and nudges, with no UI."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence, Set, Union

from .core import Entity, Match, Pubba, Reason
from .text import collapse, js_trim
from .trail import Trail

DEFAULT_GUIDE_TEMPLATES: Dict[str, str] = {
    "open": "Here's {item}.",
    "similar": "{reason}",
    "none": "I couldn't find that here. These might help:",
    "notHere": "{name} isn't here. These might help:",
    "start": "Where would you like to start?",
    "nudge": "{reason} Want a look?",
}

_TOKEN = re.compile(r"\{(\w+)\}")


@dataclass
class EntityChip:
    """A follow-up button: a place to go, with why."""

    id: str
    label: str
    reason: Reason
    text: str
    url: Optional[str] = None


@dataclass
class QuestionChip:
    """A follow-up button that asks the guide a question."""

    label: str
    question: str


Chip = Union[EntityChip, QuestionChip]


@dataclass
class Reply:
    kind: str
    text: str
    chips: List[Chip] = field(default_factory=list)
    action: Optional[Dict[str, str]] = None
    match: Optional[Match] = None
    similar: Optional[List[EntityChip]] = None


@dataclass
class NudgePolicy:
    delay_ms: float = 9000
    gap_ms: float = 60000
    min_score: float = 0.3


def _fill(text: str, values: Dict[str, str]) -> str:
    return collapse(_TOKEN.sub(lambda m: values.get(m.group(1)) or "", text))


class Guide:
    """The navigator: a typed question becomes a reply; steps are recorded; nudges come at the right moments."""

    def __init__(
        self,
        pubba: Pubba,
        trail: Optional[Trail] = None,
        route: Optional[Callable[[Entity], Optional[str]]] = None,
        chips: int = 3,
        nudge: Optional[NudgePolicy] = None,
        prefer: Optional[Callable[[Entity], bool]] = None,
        accept: Optional[Callable[[Entity], bool]] = None,
        fallback: Optional[Callable[[Dict[str, Any]], Optional[Sequence[Union[str, Chip]]]]] = None,
        line: Optional[Callable[[Entity], Optional[str]]] = None,
        templates: Optional[Dict[str, str]] = None,
        now: Optional[Callable[[], float]] = None,
    ) -> None:
        self.pubba = pubba
        self.trail = trail or Trail()
        self._route = route or (lambda e: e.url)
        self._limit = chips
        self.nudge_policy = nudge or NudgePolicy()
        self._prefer = prefer or (lambda e: self._route(e) is not None)
        self._accept = accept
        self._fallback = fallback
        self._line = line
        self._t = {**DEFAULT_GUIDE_TEMPLATES, **(templates or {})}
        self._now = now or (lambda: time.time() * 1000)
        self._last_step_at = float("-inf")
        self._last_step_self = False
        self._last_nudge_at = float("-inf")
        self._nudged_from: Set[str] = set()

    # --- helpers

    def _tpl(self, key: str, e: Optional[Entity] = None) -> str:
        if e is not None and f"{key}.{e.type}" in self._t:
            return self._t[f"{key}.{e.type}"]
        return self._t[key]

    def _vars(self, e: Entity) -> Dict[str, str]:
        line = self._line(e) if self._line else None
        return {"item": e.short_label, "label": e.label, "line": line or ""}

    def _chip(self, entity: Entity, reason: Reason, text: str) -> EntityChip:
        return EntityChip(entity.id, entity.short_label, reason, text, self._route(entity))

    def _open(self, e: Entity) -> Dict[str, str]:
        action = {"type": "open", "id": e.id}
        url = self._route(e)
        if url is not None:
            action["url"] = url
        return action

    def _starters(self, n: int) -> List[Chip]:
        g = self.pubba.graph
        es = [e for e in g.entities.values() if g.is_destination(e) and (self._accept is None or self._accept(e))]
        es = sorted(enumerate(es), key=lambda x: (-g.degree(x[1].id), x[0]))[:n]
        reason: Reason = {"kind": "section"}
        return [self._chip(e, dict(reason), self.pubba.explain(reason, e)) for _, e in es]

    def _chips(self, n: int, extra: Sequence[str], context: Dict[str, Any]) -> List[Chip]:
        out: List[Chip] = [self._chip(s.entity, s.reason, s.text) for s in self.pubba.next(self.trail.get() + list(extra), limit=n, accept=self._accept)]
        if out:
            return out
        fallback = self._fallback(context) if self._fallback else None
        if fallback is not None:
            return [QuestionChip(c, c) if isinstance(c, str) else c for c in list(fallback)[:n]]
        return self._starters(n)

    # --- the guide

    def ask(self, question: str) -> Reply:
        """Answer a typed question. Doesn't move the visitor: follow the action, then call follow()."""
        if not js_trim(question):
            return Reply("start", _fill(self._tpl("start"), {}), self._chips(self._limit, [], {"kind": "start"}))
        m = self.pubba.match(question)
        if m.intent == "none":
            if m.not_here:
                return Reply("not-here", _fill(self._tpl("notHere"), {"name": m.not_here}), self._chips(self._limit, [], {"kind": "not-here"}))
            return Reply("none", _fill(self._tpl("none"), {}), self._chips(self._limit, [], {"kind": "none"}))
        entity = m.entity
        assert entity is not None
        similar = [r for r in m.similar if self._accept is None or self._accept(r.entity)]
        if m.intent == "similar" and similar:
            first = similar[0]
            listed = ", ".join(r.entity.label + (" (" + ", ".join(r.reason["via"][:2]) + ")" if r.reason.get("via") else "") for r in similar)
            return Reply(
                "similar",
                _fill(self._tpl("similar", entity), {**self._vars(first.entity), "reason": first.text, "of": entity.label, "list": listed}),
                [self._chip(r.entity, r.reason, r.text) for r in similar[1:][: self._limit]],
                self._open(first.entity),
                m.match,
                [self._chip(r.entity, r.reason, r.text) for r in similar],
            )
        context = {"kind": "open", "entity": entity}
        if entity.id in self.pubba.graph.entities:
            chips = [c for c in self._chips(self._limit, [entity.id], context) if not isinstance(c, EntityChip) or c.id != entity.id]
        else:
            chips = self._chips(self._limit, [], context)
        return Reply("open", _fill(self._tpl("open", entity), self._vars(entity)), chips, self._open(entity), m.match)

    def chips(self, limit: Optional[int] = None) -> List[Chip]:
        """Follow-ups for where the visitor is now."""
        return self._chips(self._limit if limit is None else limit, [], {"kind": "chips"})

    def visited(self, id: str) -> None:
        """The visitor went somewhere on their own."""
        if self.pubba.graph.find(id) is None and not id.startswith("section:"):
            return
        self.trail.record(id)
        self._last_step_at = self._now()
        self._last_step_self = True

    def follow(self, id: str, via: str) -> None:
        """The visitor went somewhere because the guide sent them."""
        if self.pubba.graph.find(id) is None:
            return
        self.trail.record(id)
        self._last_step_at = self._now()
        self._last_step_self = False
        self.pubba.track.guided_to(id, via)

    def nudge(self) -> Optional[Reply]:
        """A suggestion to show unprompted now, or None. Call it after nudge_policy.delay_ms."""
        steps = self.trail.get()
        last = steps[-1] if steps else None
        at = self._now()
        if not last or not self._last_step_self or last.startswith("section:") or last in self._nudged_from:
            return None
        p = self.nudge_policy
        if at - self._last_step_at < p.delay_ms or at - self._last_nudge_at < p.gap_ms:
            return None
        options = [s for s in self.pubba.next(steps, limit=5, accept=self._accept) if s.reason["kind"] != "section" and s.score >= p.min_score]
        top = next((s for s in options if self._prefer(s.entity)), options[0] if options else None)
        if top is None:
            return None
        self._last_nudge_at = at
        self._nudged_from.add(last)
        return Reply(
            "open",
            _fill(self._tpl("nudge", top.entity), {**self._vars(top.entity), "reason": top.text}),
            [self._chip(top.entity, top.reason, top.text)],
            self._open(top.entity),
        )

    def opened(self) -> None:
        self.pubba.track.guide_opened()

    def reached(self, goal: str) -> None:
        self.pubba.track.reached(goal)


def create_guide(pubba: Pubba, **options: Any) -> Guide:
    return Guide(pubba, **options)
