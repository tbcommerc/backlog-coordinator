import asyncio

from rate_limit import MemoryRateLimiter, rate_limit_key


def test_memory_limiter_blocks_and_returns_retry_after():
    now = [100.0]
    limiter = MemoryRateLimiter(clock=lambda: now[0])

    async def scenario():
        for _ in range(5):
            assert (await limiter.check("login", 5, 60)).allowed
        blocked = await limiter.check("login", 5, 60)
        assert not blocked.allowed
        assert blocked.retry_after == 60

    asyncio.run(scenario())


def test_repeated_limit_excess_increases_block_time():
    now = [100.0]
    limiter = MemoryRateLimiter(clock=lambda: now[0])

    async def scenario():
        for _ in range(6):
            first = await limiter.check("login", 5, 60)
        assert first.retry_after == 60
        now[0] = 161.0
        for _ in range(6):
            second = await limiter.check("login", 5, 60)
        assert second.retry_after == 120

    asyncio.run(scenario())


def test_memory_limiter_expires_old_keys():
    now = [100.0]
    limiter = MemoryRateLimiter(clock=lambda: now[0], max_keys=2)

    async def scenario():
        assert (await limiter.check("a", 1, 10)).allowed
        now[0] = 111.0
        assert (await limiter.check("b", 1, 10)).allowed
        assert "a" not in limiter._entries

    asyncio.run(scenario())


def test_rate_limit_keys_do_not_expose_email_or_ip():
    key = rate_limit_key("login", "user@example.com", "192.0.2.1")
    assert "user@example.com" not in key
    assert "192.0.2.1" not in key
    assert len(key) == 64
