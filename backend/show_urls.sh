#!/usr/bin/env bash
# Print current tunnel URLs and the agent token.
D=/app/data; E=/app/agent/.env
echo "Backend URL : $(cat $D/tunnel_url.txt 2>/dev/null || echo 'not ready')"
v=$(cat $D/tunnel_vnc_url.txt 2>/dev/null); echo "noVNC URL   : ${v:+$v/vnc.html}"
echo "AGENT_TOKEN : $(grep -m1 '^AGENT_TOKEN=' $E 2>/dev/null | cut -d= -f2-)"
