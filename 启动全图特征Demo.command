#!/bin/zsh
unsetopt BG_NICE
cd "${0:A:h}" || exit 1
PIXELMUSIC_PYTHON="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
if [[ ! -x "$PIXELMUSIC_PYTHON" ]]; then PIXELMUSIC_PYTHON="$(command -v python3)"; fi
if ! "$PIXELMUSIC_PYTHON" -c 'import numpy, PIL' 2>/dev/null; then
  print '需要可用的 Python、NumPy 与 Pillow。请查看 FEATURE_DEMO_DELIVERY.md。'
  read '?按回车结束'; exit 1
fi
if "$PIXELMUSIC_PYTHON" -c 'import json, urllib.request; assert json.load(urllib.request.urlopen("http://127.0.0.1:4176/api/health", timeout=1))["engine"]=="pixelmusic-reference-v2"' 2>/dev/null; then
  open 'http://127.0.0.1:4176/feature-music.html'; exit 0
fi
(sleep 1; open 'http://127.0.0.1:4176/feature-music.html') &
print '图鸣 · 全图特征旋律。关闭这个终端窗口即可停止本机服务。'
exec "$PIXELMUSIC_PYTHON" scripts/reference_server.py --port 4176
