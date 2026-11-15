"""Intent profiles (SPEC 5.7, 5.8): a guess at why this visit is happening, from
the trail alone. Once one intent is likely, it leans suggestions towards what it
boosts, within 0.5-2x, so it reorders but never hides. Nothing is stored."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Sequence, Tuple

if TYPE_CHECKING:
    from .core import Entity, Graph, Link


def _num(v: Any, fallback: float) -> float:
    # JSON numbers only (a bool is not one, as in JavaScript).
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else fallback


def _obj(v: Any) -> Dict[str, Any]:
    return v if isinstance(v, dict) else {}


@dataclass(frozen=True)
class IntentEvidence:
    """A trail step that pointed to an intent; `via` is the neighbour it pointed through, when that counted more."""

    step: str
    via: Optional[str]
    weight: float

    def to_json(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"step": self.step}
        if self.via is not None:
            out["via"] = self.via
        out["weight"] = self.weight
        return out


@dataclass(frozen=True)
class IntentReading:
    """Why a visit is likely happening: `likely` is None while browsing, with too few steps, or with no intents."""

    likely: Optional[str]
    confidence: float
    scores: Dict[str, float]
    evidence: List[IntentEvidence]

    def to_json(self) -> Dict[str, Any]:
        return {"likely": self.likely, "confidence": self.confidence, "scores": dict(self.scores), "evidence": [e.to_json() for e in self.evidence]}


def intents_of(g: "Graph") -> List[Tuple[str, Dict[str, Any]]]:
    """The configured intents, in order ("browsing" is reserved)."""
    return [(k, v) for k, v in _obj(g.config.get("intents")).items() if k != "browsing" and isinstance(v, dict)]


def _find(g: "Graph", intent: str) -> Optional[Dict[str, Any]]:
    for id, c in intents_of(g):
        if id == intent:
            return c
    return None


def read_intent(g: "Graph", trail: Sequence[str]) -> IntentReading:
    """Why this visit is likely happening, from the trail alone."""
    intents = intents_of(g)
    settings = _obj(g.config.get("intent"))
    min_confidence = _num(settings.get("minConfidence"), 0.5)
    min_steps = _num(settings.get("minSteps"), 2)
    share = _num(settings.get("neighbours"), 0.5)
    nxt = _obj(g.config.get("next"))
    recency = _num(nxt.get("recency"), 0.6)
    sections = _obj(nxt.get("sections"))

    seeds: Dict[str, float] = {}
    for id in reversed(list(trail)):
        if id not in seeds:
            seeds[id] = recency ** len(seeds)
    steps = sum(1 for id in seeds if not id.startswith("section:") and g.find(id) is not None)

    raw: List[float] = []
    evidence: List[List[IntentEvidence]] = []
    for _, intent in intents:
        signals = _obj(intent.get("signals"))
        E, T, K = _obj(signals.get("entities")), _obj(signals.get("types")), _obj(signals.get("kinds"))
        total_part = 0.0
        ev: List[IntentEvidence] = []
        for step, w in seeds.items():
            via: Optional[str] = None
            if step.startswith("section:"):
                type = sections.get(step[8:])
                if not isinstance(type, str) or not type:
                    continue
                part = w * _num(T.get(type), 0)
            else:
                e = g.find(step)
                if e is None:
                    continue
                own = _num(E.get(e.id), 0) + _num(T.get(e.type), 0)
                best = 0.0
                best_via: Optional[str] = None
                for l in g.adjacent.get(step, []):
                    n = l.other_end(step)
                    v = l.weight * (_num(E.get(n), 0) + _num(K.get(l.kind), 0))
                    if v > best:
                        best, best_via = v, n
                near = share * best
                if near > own:
                    via = best_via
                part = w * (own + near)
            total_part += part
            if part > 0:
                ev.append(IntentEvidence(step, via, part))
        raw.append(max(0.0, total_part))
        evidence.append(ev)

    sum_raw = 0.0
    for r in raw:
        sum_raw += r
    total = 1 + sum_raw
    scores: Dict[str, float] = {}
    top = -1
    for i, (id, _) in enumerate(intents):
        scores[id] = raw[i] / total
        if top < 0 or raw[i] > raw[top]:
            top = i
    scores["browsing"] = 1 / total
    confidence = 0.0 if top < 0 else raw[top] / total
    likely = intents[top][0] if top >= 0 and raw[top] > 0 and confidence >= min_confidence and steps >= min_steps else None
    return IntentReading(likely, confidence, scores, [] if top < 0 else evidence[top])


def resolve_intent(g: "Graph", trail: Sequence[str], option: Optional[str]) -> Optional[str]:
    """The intent to apply: "auto" works it out from the trail, an id names one, None is none."""
    if option is None or not intents_of(g):
        return None
    if option == "auto":
        return read_intent(g, trail).likely
    return option if _find(g, option) is not None else None


def intent_boost(g: "Graph", intent: str, e: "Entity", link: Optional["Link"]) -> float:
    """How much an intent leans towards an entity reached by a link: clamped to 0.5-2."""
    b = _obj((_find(g, intent) or {}).get("boost"))
    v = _num(_obj(b.get("types")).get(e.type), 1) * _num(_obj(b.get("entities")).get(e.id), 1) * (_num(_obj(b.get("kinds")).get(link.kind), 1) if link is not None else 1)
    return min(2.0, max(0.5, v))


def intent_label(g: "Graph", intent: str) -> str:
    """An intent's label, for the {intent} token."""
    label = (_find(g, intent) or {}).get("label")
    return label if isinstance(label, str) else intent
