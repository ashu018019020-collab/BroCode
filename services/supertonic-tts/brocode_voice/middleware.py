"""Production edges the model does not provide: CORS, a body-size cap and a rate limit.

These are ASGI middlewares rather than dependencies because they must run before the body is parsed:
an oversized payload should be refused without being read into memory, and a rate-limited caller
should not get as far as validation.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class BodySizeLimit:
    """Refuse a request whose declared body exceeds the cap, before it is buffered."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    break
                if declared > self.max_bytes:
                    response = JSONResponse({"detail": "Request body too large."}, status_code=413)
                    await response(scope, receive, send)
                    return
                break
        await self.app(scope, receive, send)


class RateLimit:
    """A sliding window per caller.

    Identity is the bearer token's holder, which the proxy derives from the signed-in learner, so one
    account cannot exhaust another's budget. Falling back to the client address keeps the endpoint
    bounded even if a caller reaches it directly.
    """

    def __init__(self, app: ASGIApp, limit: int, window_seconds: int) -> None:
        self.app = app
        self.limit = limit
        self.window = window_seconds
        self.seen: dict[str, deque[float]] = defaultdict(deque)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") != "POST" or not scope.get("path", "").startswith("/v1/"):
            await self.app(scope, receive, send)
            return
        identity = self._identity(scope)
        now = time.time()
        hits = self.seen[identity]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            retry_after = max(1, int(self.window - (now - hits[0])))
            response = JSONResponse(
                {"detail": "Too many speech requests. Try again shortly."},
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )
            await response(scope, receive, send)
            return
        hits.append(now)
        await self.app(scope, receive, send)

    @staticmethod
    def _identity(scope: Scope) -> str:
        headers = dict(scope.get("headers", []))
        token = headers.get(b"authorization", b"")[7:].strip()
        if token:
            # Never store the secret itself; a short digest is enough to count per caller.
            return f"token:{hash(token) & 0xFFFFFFFF}"
        client = scope.get("client")
        return f"ip:{client[0]}" if client else "ip:unknown"


def install(app: FastAPI, *, allowed_origins: tuple[str, ...], max_body_bytes: int, limit: int, window_seconds: int) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(allowed_origins),
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )
    app.add_middleware(BodySizeLimit, max_bytes=max_body_bytes)
    app.add_middleware(RateLimit, limit=limit, window_seconds=window_seconds)
