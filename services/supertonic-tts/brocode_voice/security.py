"""The shared-secret guard.

This service is called by the deployment's own serverless proxy, never by a browser. The proxy holds
the secret; the browser holds nothing. An unset secret refuses every request instead of serving open
synthesis, and comparison is constant-time.
"""
from __future__ import annotations

import hmac

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

BEARER = HTTPBearer(auto_error=False)


def authorize_factory(secret: str):
    def authorize(credentials: HTTPAuthorizationCredentials | None = Depends(BEARER)) -> None:
        if not secret:
            raise HTTPException(status_code=503, detail="Voice service is not configured.")
        if credentials is None or not hmac.compare_digest(credentials.credentials, secret):
            raise HTTPException(status_code=401, detail="Unauthorized.")

    return authorize
