"""Metrics tracker - collects and reports dialogue quality metrics.

Tracks:
- Completion rate: % of dialogues that reach draft
- Drop-off rate: where users abandon dialogue
- Time to draft: average time from start to draft
- Slot extraction accuracy: how often slots are filled correctly
- Clarification rate: how often agent needs to ask again
- Escalation rate: % of dialogues escalated to human
- Question count per draft: efficiency metric

Metrics are stored per session and can be aggregated for reporting.
"""
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .state import DialogueState, MANDATORY_HARD, MANDATORY_SOFT


@dataclass
class SessionMetrics:
    """Metrics for a single dialogue session."""
    session_id: str = ""
    user_id: int = 0
    
    # Timing
    started_at: float = 0.0
    first_slot_filled_at: float = 0.0
    draft_created_at: float = 0.0
    ended_at: float = 0.0
    
    # Completion
    completed: bool = False  # Reached draft
    draft_created: bool = False
    sent_to_review: bool = False
    
    # Drop-off
    drop_off_phase: str = ""
    drop_off_slot: str = ""
    
    # Efficiency
    total_user_messages: int = 0
    total_agent_messages: int = 0
    questions_asked: int = 0
    clarifications_needed: int = 0
    
    # Quality
    slots_filled: int = 0
    slots_skipped: int = 0
    slots_with_low_confidence: int = 0
    repairs_made: int = 0
    
    # User experience
    user_expertise: str = "medium"
    fatigue_level: str = "normal"
    escalated: bool = False
    escalation_reason: str = ""

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "completed": self.completed,
            "draft_created": self.draft_created,
            "sent_to_review": self.sent_to_review,
            "drop_off_phase": self.drop_off_phase,
            "total_user_messages": self.total_user_messages,
            "total_agent_messages": self.total_agent_messages,
            "questions_asked": self.questions_asked,
            "slots_filled": self.slots_filled,
            "slots_skipped": self.slots_skipped,
            "user_expertise": self.user_expertise,
            "fatigue_level": self.fatigue_level,
            "escalated": self.escalated,
        }


@dataclass
class AggregateMetrics:
    """Aggregated metrics across multiple sessions."""
    total_sessions: int = 0
    completed_sessions: int = 0
    drafts_created: int = 0
    sent_to_review: int = 0
    escalated: int = 0
    
    avg_time_to_draft: float = 0.0
    avg_questions_per_draft: float = 0.0
    avg_slots_filled: float = 0.0
    
    completion_rate: float = 0.0
    escalation_rate: float = 0.0


class MetricsTracker:
    """Tracks and aggregates dialogue metrics."""

    def __init__(self):
        self.sessions: Dict[str, SessionMetrics] = {}

    def start_session(self, state: DialogueState):
        """Record session start."""
        metrics = SessionMetrics(
            session_id=state.session_id,
            user_id=state.user_id,
            started_at=state.session_started_at or time.time(),
        )
        self.sessions[metrics.session_id] = metrics

    def update_from_state(self, state: DialogueState):
        """Update metrics from current dialogue state."""
        metrics = self.sessions.get(state.session_id)
        if not metrics:
            self.start_session(state)
            metrics = self.sessions[state.session_id]
        
        # Update counts
        metrics.total_user_messages = state.total_user_messages
        metrics.total_agent_messages = state.total_agent_messages
        metrics.questions_asked = state.question_count
        
        # Update slot stats
        filled = sum(1 for s in state.slots.values() if s.status == "filled")
        skipped = sum(1 for s in state.slots.values() if s.status == "skipped")
        low_conf = len(state.get_low_confidence_slots(0.6))
        
        metrics.slots_filled = filled
        metrics.slots_skipped = skipped
        metrics.slots_with_low_confidence = low_conf
        
        # Update user profile
        metrics.user_expertise = state.user_expertise
        metrics.fatigue_level = state.fatigue_level
        
        # Update completion status
        if state.draft:
            metrics.draft_created = True
            metrics.completed = True
            if not metrics.draft_created_at:
                metrics.draft_created_at = state.draft_created_at or time.time()
        
        if state.review_status == "needs_review":
            metrics.sent_to_review = True
        
        # Update escalation
        if state.escalation:
            metrics.escalated = True
            metrics.escalation_reason = state.escalation_reason
        
        # Update repairs
        total_repairs = sum(len(h) for h in state.slot_history.values())
        metrics.repairs_made = total_repairs

    def end_session(self, state: DialogueState):
        """Record session end."""
        metrics = self.sessions.get(state.session_id)
        if metrics:
            metrics.ended_at = time.time()
            if not metrics.completed:
                from .machine import compute_phase
                metrics.drop_off_phase = compute_phase(state)
                metrics.drop_off_slot = state.last_asked_slot or ""

    def get_session_metrics(self, session_id: str) -> Optional[SessionMetrics]:
        """Get metrics for a specific session."""
        return self.sessions.get(session_id)

    def get_aggregate_metrics(self) -> AggregateMetrics:
        """Calculate aggregate metrics across all sessions."""
        if not self.sessions:
            return AggregateMetrics()
        
        total = len(self.sessions)
        completed = sum(1 for m in self.sessions.values() if m.completed)
        drafts = sum(1 for m in self.sessions.values() if m.draft_created)
        review = sum(1 for m in self.sessions.values() if m.sent_to_review)
        escalated = sum(1 for m in self.sessions.values() if m.escalated)
        
        # Calculate averages for completed sessions
        completed_metrics = [m for m in self.sessions.values() if m.draft_created]
        avg_time = 0.0
        avg_questions = 0.0
        avg_slots = 0.0
        
        if completed_metrics:
            times = [m.draft_created_at - m.started_at for m in completed_metrics 
                     if m.draft_created_at and m.started_at]
            if times:
                avg_time = sum(times) / len(times)
            
            avg_questions = sum(m.questions_asked for m in completed_metrics) / len(completed_metrics)
            avg_slots = sum(m.slots_filled for m in completed_metrics) / len(completed_metrics)
        
        return AggregateMetrics(
            total_sessions=total,
            completed_sessions=completed,
            drafts_created=drafts,
            sent_to_review=review,
            escalated=escalated,
            avg_time_to_draft=avg_time,
            avg_questions_per_draft=avg_questions,
            avg_slots_filled=avg_slots,
            completion_rate=completed / total if total > 0 else 0.0,
            escalation_rate=escalated / total if total > 0 else 0.0,
        )

    def get_report(self) -> str:
        """Generate human-readable metrics report."""
        agg = self.get_aggregate_metrics()
        
        lines = [
            "=== Dialogue Metrics Report ===",
            f"Total sessions: {agg.total_sessions}",
            f"Completed (draft created): {agg.drafts_created} ({agg.completion_rate:.1%})",
            f"Sent to review: {agg.sent_to_review}",
            f"Escalated: {agg.escalated} ({agg.escalation_rate:.1%})",
            "",
            "Averages (for completed sessions):",
            f"  Time to draft: {agg.avg_time_to_draft:.1f}s",
            f"  Questions per draft: {agg.avg_questions_per_draft:.1f}",
            f"  Slots filled: {agg.avg_slots_filled:.1f}",
        ]
        
        return "\n".join(lines)


metrics_tracker = MetricsTracker()
