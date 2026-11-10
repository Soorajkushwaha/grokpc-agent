"""HTTP reverse-proxy for noVNC static files under /novnc.

Websockify (the VNC websocket) is also bridged when possible. If the bridge
fails, set a dedicated VNC tunnel URL in the app Settings (named tunnel
hostname or a second quick tunnel).
"""
from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

from auth import token_from_request, token_from_ws, tokens_match
from config import NOVNC_UPSTREAM

logger = logging.getLogger("grokpc.novnc")
router = APIRouter()

HOP_BY_HOP = {"content-encoding", "transfer-encoding", "connection", "keep-alive", "proxy-authenticate", "te", "trailers", "upgrade"}


def _http_url(path: str, query: str) -> str:
    base = NOVNC_UPSTREAM.rstrip("/")
    url = f"{base}/{path.lstrip('/')}"
    if query:
        url = f"{url}?{query}"
    return url


def _ws_url(path: str) -> str:
    base = NOVNC_UPSTREAM.rstrip("/")
    if base.startswith("https://"):
        base = "wss://" + base[len("https://"):]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://"):]
    else:
        base = "ws://" + base
    return f"{base}/{path.lstrip('/')}"


@router.api_route("/novnc", methods=["GET", "HEAD"], include_in_schema=False)
async def novnc_root(request: Request):
    return await novnc_http(request, "vnc.html")


@router.api_route("/novnc/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def novnc_http(request: Request, path: str):
    if not tokens_match(token_from_request(request)):
        return Response("Unauthorized", status_code=401)
    if path.rstrip("/").endswith("websockify"):
        return Response("Use WebSocket", status_code=426)
    url = _http_url(path, str(request.query_params))
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            r = await client.get(url)
        headers = {k: v for k, v in r.headers.items() if k.lower() not in HOP_BY_HOP}
        return Response(content=r.content, status_code=r.status_code, headers=headers, media_type=r.headers.get("content-type"))
    except Exception as exc:
        logger.warning("noVNC HTTP proxy error: %s", exc)
        return Response(
            "noVNC is not running on 127.0.0.1:6080. Start the desktop service or set a VNC URL in Settings.",
            status_code=502,
        )


@router.websocket("/novnc/websockify")
async def novnc_ws(websocket: WebSocket):
    if not tokens_match(token_from_ws(websocket)):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        import websockets
    except ImportError:
        await websocket.close(code=1011)
        return
    up_url = _ws_url("websockify")
    try:
        async with websockets.connect(up_url, open_timeout=10, max_size=2**23) as upstream:
            async def client_to_up():
                try:
                    while True:
                        msg = await websocket.receive()
                        if msg.get("type") == "websocket.disconnect":
                            break
                        data = msg.get("bytes")
                        if data is None and msg.get("text") is not None:
                            await upstream.send(msg["text"])
                        elif data is not None:
                            await upstream.send(data)
                except (WebSocketDisconnect, Exception):
                    pass

            async def up_to_client():
                try:
                    async for data in upstream:
                        if isinstance(data, bytes):
                            await websocket.send_bytes(data)
                        else:
                            await websocket.send_text(data)
                except Exception:
                    pass

            import asyncio
            await asyncio.gather(client_to_up(), up_to_client())
    except Exception as exc:
        logger.warning("noVNC WS bridge failed: %s", exc)
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
