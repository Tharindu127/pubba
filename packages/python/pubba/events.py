"""Privacy-safe measurement events (SPEC section 8).

pubba only emits: no storage, no network, no visitor ids, no timestamps.
Event fields hold entity ids, types, kinds and declared goals; never a query.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, List, Optional

GUIDE_VIAS = ("suggestion", "chip", "typed", "match", "related")

Event = Dict[str, Any]


class Events:
    def __init__(self, goals: Optional[Iterable[str]] = None) -> None:
        self.goals = tuple(goals if goals is not None else ("contact", "resume"))
        self._listeners: List[Callable[[Event], None]] = []

    def on(self, listener: Callable[[Event], None]) -> Callable[[], None]:
        """Listen to every event; returns an unsubscribe function. A listener that raises is ignored."""
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener) if listener in self._listeners else None

    def emit(self, event: Event) -> None:
        for listener in list(self._listeners):
            try:
                listener(dict(event))
            except Exception:
                # Measurement must never break the guide.
                pass


def create_events(goals: Optional[Iterable[str]] = None) -> Events:
    return Events(goals)


def summarise(events: Iterable[Event]) -> Dict[str, Any]:
    """One visit's funnel: was the guide used, where did it lead, which goals were reached."""
    guided_to: List[str] = []
    guided_types: List[str] = []
    reached: List[str] = []
    used = False
    before_goal = False
    for e in events:
        t = e.get("type")
        if t in ("guide-opened", "matched"):
            used = True
        if t == "guided-to":
            used = True
            if e["to"] not in guided_to:
                guided_to.append(e["to"])
            if e["entityType"] not in guided_types:
                guided_types.append(e["entityType"])
        if t == "reached":
            if e["goal"] not in reached:
                reached.append(e["goal"])
            if guided_to:
                before_goal = True
    return {"usedGuide": used, "guidedTo": guided_to, "guidedToTypes": guided_types, "reached": reached, "guidedBeforeGoal": before_goal}
