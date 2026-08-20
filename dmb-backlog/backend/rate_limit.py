"""Shared production and bounded development rate limiting."""
import asyncio
import hashlib
import time
from dataclasses import dataclass
from typing import Callable

from config import settings


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    retry_after: int = 0


class MemoryRateLimiter:
    """Bounded process-local fallback intended only for development."""

    def __init__(self, clock: Callable[[], float] = time.monotonic, max_keys: int = 5000):
        self._clock = clock
        self._max_keys = max_keys
        self._entries = {}
        self._strikes = {}
        self._lock = asyncio.Lock()

    async def check(self, key: str, max_requests: int, window_seconds: int) -> RateLimitDecision:
        async with self._lock:
            now = self._clock()
            self._cleanup(now)
            entry = self._entries.get(key)
            if not entry or entry["expires_at"] <= now:
                entry = {"count": 0, "expires_at": now + window_seconds, "blocked_until": 0.0}
                self._entries[key] = entry
            if entry["blocked_until"] > now:
                return RateLimitDecision(False, max(1, int(entry["blocked_until"] - now)))

            entry["count"] += 1
            if entry["count"] <= max_requests:
                return RateLimitDecision(True)

            strike = self._strikes.get(key)
            if not strike or strike["expires_at"] <= now:
                strike = {"count": 0, "expires_at": now + 3600}
                self._strikes[key] = strike
            strike["count"] += 1
            retry_after = min(window_seconds * (2 ** (strike["count"] - 1)), 15 * 60)
            entry["blocked_until"] = now + retry_after
            entry["expires_at"] = max(entry["expires_at"], entry["blocked_until"])
            return RateLimitDecision(False, retry_after)

    def _cleanup(self, now: float) -> None:
        expired = [key for key, value in self._entries.items() if value["expires_at"] <= now]
        for key in expired:
            self._entries.pop(key, None)
        expired_strikes = [key for key, value in self._strikes.items() if value["expires_at"] <= now]
        for key in expired_strikes:
            self._strikes.pop(key, None)
        if len(self._entries) >= self._max_keys:
            oldest = min(self._entries, key=lambda key: self._entries[key]["expires_at"])
            self._entries.pop(oldest, None)


class RedisRateLimiter:
    def __init__(self, redis_url: str):
        from redis.asyncio import Redis
        self._redis = Redis.from_url(redis_url, decode_responses=True)

    async def check(self, key: str, max_requests: int, window_seconds: int) -> RateLimitDecision:
        counter_key = f"dmb:rate:count:{key}"
        block_key = f"dmb:rate:block:{key}"
        strike_key = f"dmb:rate:strikes:{key}"
        blocked_for = await self._redis.ttl(block_key)
        if blocked_for and blocked_for > 0:
            return RateLimitDecision(False, blocked_for)

        count = await self._redis.incr(counter_key)
        if count == 1:
            await self._redis.expire(counter_key, window_seconds)
        if count <= max_requests:
            return RateLimitDecision(True)

        strikes = await self._redis.incr(strike_key)
        if strikes == 1:
            await self._redis.expire(strike_key, 3600)
        retry_after = min(window_seconds * (2 ** (strikes - 1)), 15 * 60)
        await self._redis.set(block_key, "1", ex=retry_after)
        return RateLimitDecision(False, retry_after)


def rate_limit_key(*parts: str) -> str:
    normalized = "|".join((part or "unknown").strip().casefold() for part in parts)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


_limiter = None


def get_rate_limiter():
    global _limiter
    if _limiter is None:
        _limiter = RedisRateLimiter(settings.REDIS_URL) if settings.REDIS_URL else MemoryRateLimiter()
    return _limiter
