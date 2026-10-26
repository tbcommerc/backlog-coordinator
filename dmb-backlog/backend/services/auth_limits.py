"""Authentication-specific atomic Redis limits. Never falls back to local memory."""
import hashlib
import hmac
from fastapi import HTTPException, Request
from config import settings

_client = None
_SCRIPT = """
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if ARGV[3] == 'hit' then
  count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
  if ARGV[4] == 'failures' and count == tonumber(ARGV[1]) then
    local strikes = redis.call('INCR', KEYS[2])
    redis.call('EXPIRE', KEYS[2], 3600)
    redis.call('EXPIRE', KEYS[1], math.min(900, tonumber(ARGV[2]) * 2 ^ math.min(strikes - 1, 4)))
  end
end
return {count, redis.call('TTL', KEYS[1])}
"""


async def limit(scope, identity, maximum, window, mode="hit"):
    global _client
    if not settings.REDIS_URL or not settings.AUTH_RATE_HMAC_KEY:
        raise HTTPException(503, 'AUTH_LIMITER_UNAVAILABLE')
    try:
        if _client is None:
            from redis.asyncio import Redis
            _client = Redis.from_url(settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
        key = hmac.new(settings.AUTH_RATE_HMAC_KEY.encode(), f'{scope}:{identity}'.encode(), hashlib.sha256).hexdigest()
        count, ttl = await _client.eval(_SCRIPT, 2, 'dmb:auth:'+key, 'dmb:auth:strikes:'+key, maximum, window, mode, 'failures' if scope in {'login-account','credential-failures'} else 'attempts')
    except Exception:
        raise HTTPException(503, 'AUTH_LIMITER_UNAVAILABLE') from None
    if count > maximum or (mode == "peek" and count >= maximum):
        raise HTTPException(429, 'RATE_LIMITED', headers={'Retry-After': str(max(1, ttl))})


async def sensitive_limit(request: Request):
    await limit('sensitive-ip', request.client.host if request.client else '', 120, 60)
    from auth import decode_token
    authorization = request.headers.get('authorization', '')
    payload = decode_token(authorization[7:]) if authorization.startswith('Bearer ') else None
    try:
        data = await request.json()
    except ValueError:
        raise HTTPException(422, 'INVALID_REQUEST') from None
    if not isinstance(data, dict):
        raise HTTPException(422, 'INVALID_REQUEST')
    if request.url.path.endswith('/password/setup'):
        from services.auth_challenges import digest
        key = digest(str(data.get('token', ''))[:128])
        await limit('setup-ip', request.client.host if request.client else '', settings.AUTH_SETUP_IP_LIMIT, 60)
    elif payload:
        key = payload['sub'] + ':' + payload['sid']
    else:
        key = request.client.host if request.client else ''
    await limit('credential-failures', key, settings.AUTH_FAILURE_LIMIT, settings.AUTH_FAILURE_WINDOW, 'peek')
    request.state.credential_failure_key = key
    if '/admin/users/' in request.url.path and request.url.path.endswith(('/invitation', '/password-reset')):
        target = request.path_params.get('user_id', request.url.path.split('/')[-2])
        await limit('issue-target', str(target), settings.AUTH_ISSUE_TARGET_LIMIT, 3600)
        if payload:
            await limit('issue-admin', payload['sub'], settings.AUTH_ISSUE_ADMIN_LIMIT, 3600)

