#!/bin/bash
# 看门狗：演示渲染服务器（:8899）挂掉即自动拉起（scene 壁纸实时渲染依赖它）
cd "$(dirname "$0")" || exit 1
while true; do
  if ! curl -s -o /dev/null --max-time 2 "http://127.0.0.1:8899/" ; then
    echo "[watchdog $(date +%H:%M:%S)] 服务器不可达，拉起…"
    node server/we-scene-demo-server.mjs >> /tmp/demo-server.log 2>&1 &
    sleep 2
  fi
  sleep 10
done
