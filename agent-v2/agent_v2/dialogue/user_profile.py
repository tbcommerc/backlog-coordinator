"""User profile detector - infers user expertise and preferred style.

Analyzes user messages to determine:
- Expertise level: novice | medium | expert
- Preferred style: business | technical

This information is used to adapt dialogue mode and question phrasing.
"""
import re
from dataclasses import dataclass

from .state import DialogueState


@dataclass
class UserProfile:
    expertise: str = "medium"  # novice | medium | expert
    style: str = "business"  # business | technical
    confidence: float = 0.5


# Technical terms that suggest expert/high-technical user
TECHNICAL_TERMS = [
    "api", "json", "xml", "endpoint", "method", "payload",
    "settlement", "post-trade", "pre-trade", "clearing", "margining",
    "front office", "back office", "middle office",
    "ba", "po", "business analyst", "product owner",
    "acceptance criteria", "user story", "use case",
    "stakeholder", "dependency", "integration",
    "бэк-офис", "фронт-офис", "мидл-офис",
    "аналитик", "владелец продукта", "стейкхолдер",
    "критерии приёмки", "пользовательская история",
]

# Simple/incomplete language that suggests novice
NOVICE_INDICATORS = [
    "не знаю", "не понимаю", "что это", "как это",
    "помогите", "подскажите", "объясните",
    "впервые", "новичок", "не разбираюсь",
]

# Expert indicators
EXPERT_INDICATORS = [
    "as-is", "to-be", "as is", "to be",
    "бизнес-требование", "бизнес-правило",
    "acceptance criteria", "definition of done",
    "модуль", "интеграция", "архитектура",
    "согласовано", "утверждено", "в production",
]


class UserProfileDetector:
    """Detects user profile from dialogue patterns."""

    def __init__(self):
        self.message_count = 0
        self.tech_term_count = 0
        self.novice_indicator_count = 0
        self.expert_indicator_count = 0

    def analyze_message(self, message: str) -> dict:
        """Analyze a single message for expertise indicators."""
        low = message.lower()
        
        tech_count = sum(1 for term in TECHNICAL_TERMS if term in low)
        novice_count = sum(1 for indicator in NOVICE_INDICATORS if indicator in low)
        expert_count = sum(1 for indicator in EXPERT_INDICATORS if indicator in low)
        
        self.message_count += 1
        self.tech_term_count += tech_count
        self.novice_indicator_count += novice_count
        self.expert_indicator_count += expert_count
        
        return {
            "tech_terms": tech_count,
            "novice_indicators": novice_count,
            "expert_indicators": expert_count,
        }

    def update_state(self, state: DialogueState, message: str) -> UserProfile:
        """Update profile counters owned by one dialogue session."""
        low = message.lower()
        state.profile_message_count += 1
        state.profile_tech_term_count += sum(1 for term in TECHNICAL_TERMS if term in low)
        state.profile_novice_indicator_count += sum(
            1 for indicator in NOVICE_INDICATORS if indicator in low
        )
        state.profile_expert_indicator_count += sum(
            1 for indicator in EXPERT_INDICATORS if indicator in low
        )
        profile = self.infer_profile(state)
        state.user_expertise = profile.expertise
        state.user_preferred_style = profile.style
        return profile

    def infer_profile(self, state: DialogueState) -> UserProfile:
        """Infer user profile from accumulated dialogue data."""
        expertise = "medium"
        style = "business"
        confidence = 0.5
        
        # Analyze expertise level
        if state.profile_message_count:
            expert_count = state.profile_expert_indicator_count
            tech_count = state.profile_tech_term_count
            novice_count = state.profile_novice_indicator_count
        else:  # backwards-compatible direct use in isolated tests/tools
            expert_count = self.expert_indicator_count
            tech_count = self.tech_term_count
            novice_count = self.novice_indicator_count

        if expert_count >= 3 or tech_count >= 5:
            expertise = "expert"
            confidence = 0.8
        elif novice_count >= 2:
            expertise = "novice"
            confidence = 0.7
        elif tech_count >= 2:
            expertise = "medium"
            confidence = 0.6
        
        # Analyze preferred style
        if tech_count > novice_count * 2:
            style = "technical"
            confidence = min(0.5 + tech_count * 0.1, 0.9)
        else:
            style = "business"
            confidence = min(0.5 + novice_count * 0.1, 0.8)
        
        # Check user context if available
        if state.user_expertise != "medium":
            expertise = state.user_expertise
            confidence = 0.9
        
        return UserProfile(expertise=expertise, style=style, confidence=confidence)

    def reset(self):
        """Reset counters for new session."""
        self.message_count = 0
        self.tech_term_count = 0
        self.novice_indicator_count = 0
        self.expert_indicator_count = 0


profile_detector = UserProfileDetector()
