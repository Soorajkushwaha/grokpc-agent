"""Bearer token auth for REST and WebSocket."""
from __future__ import annotations

import secrets
from typing import Optional

from fastapi import HTTPException, Request, WebSocket, status

from config import AGENT_TOKEN, FRONTEND_ORIGINS, require_token


def extract_bearer(header_value: Optional[str]) -> Optional[str]:
    if not header_value:
        return None
    parts = header_value.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return header_value.strip() or None


def token_from_request(request: Request) -> Optional[str]:
    token = extract_bearer(request.headers.get("authorization"))
    if token:
        return token
    # noVNC iframe and some proxies can only pass a query param
    return request.query_params.get("token")


def token_from_ws(websocket: WebSocket) -> Optional[str]:
    token = extract_bearer(websocket.headers.get("authorization"))
    if token:
        return token
    proto = websocket.headers.get("sec-websocket-protocol")
    if proto:
        # allow "bearer, <token>" or just the token
        bits = [p.strip() for p in proto.split(",")]
        if len(bits) >= 2 and bits[0].lower() == "bearer":
            return bits[1]
    return websocket.query_params.get("token")


def tokens_match(provided: Optional[str]) -> bool:
    expected = require_token()
    if not provided:
        return False
    return secrets.compare_digest(provided, expected)


async def require_auth(request: Request) -> str:
    if request.method == "OPTIONS":
        return ""
    # CORS preflight is handled by middleware; still protect everything else.
    if not tokens_match(token_from_request(request)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return AGENT_TOKEN


def cors_origins() -> list[str]:
    return list(FRONTEND_ORIGINS)
