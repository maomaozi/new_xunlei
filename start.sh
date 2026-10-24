#!/usr/bin/env bash
# Usage: ./start.sh          development (Vite on :5176 + API on :8011)
#        ./start.sh --prod   build the frontend and serve everything from the API on :8011
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-dev}"

if (( BASH_VERSINFO[0] < 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] < 3) )); then
    echo '启动失败：需要 Bash 4.3 或更新版本。' >&2
    exit 1
fi

for command in uv bun setsid; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "启动失败：找不到 $command，请先安装并加入 PATH。" >&2
        exit 1
    fi
done

echo 'Installing backend dependencies...'
(cd "$ROOT_DIR/backend" && uv sync --locked)
echo 'Installing frontend dependencies...'
(cd "$ROOT_DIR/frontend" && bun install --frozen-lockfile)

for directory in backend frontend; do
    if [[ ! -e "$ROOT_DIR/$directory/.env.development" ]]; then
        cp -- "$ROOT_DIR/$directory/.env.example" "$ROOT_DIR/$directory/.env.development"
        echo "Created $directory/.env.development from .env.example"
    fi
done

if [[ "$MODE" == "--prod" ]]; then
    echo 'Building frontend...'
    (cd "$ROOT_DIR/frontend" && bun --bun run build)
    echo '生产模式：http://127.0.0.1:8011 （局域网访问请替换为本机 IP）'
    cd "$ROOT_DIR/backend"
    exec uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port 8011 --workers 1
fi

SERVICE_PIDS=()
cleanup() {
    trap '' INT TERM
    for pid in "${SERVICE_PIDS[@]}"; do
        kill -TERM -- "-$pid" 2>/dev/null || true
    done
    for pid in "${SERVICE_PIDS[@]}"; do
        wait "$pid" 2>/dev/null || true
    done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Separate process groups let cleanup stop the launchers and their child processes.
(
    cd "$ROOT_DIR/backend"
    exec setsid uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port 8011 --workers 1
) &
SERVICE_PIDS+=("$!")

(
    cd "$ROOT_DIR/frontend"
    exec setsid bun --bun run dev
) &
SERVICE_PIDS+=("$!")

echo '正在启动前后端，启动结果请查看下方日志。'
echo '前端：http://127.0.0.1:5176'
echo 'API 文档：http://127.0.0.1:8011/docs'
echo '局域网访问：将上述地址中的 127.0.0.1 替换为本机局域网 IP。'
echo '注意：本站没有独立登录，能访问本站的人即可操作已登录的迅雷账号，请仅在可信网络中使用。'
echo '按 Ctrl+C 停止前后端。'

status=0
wait -n "${SERVICE_PIDS[@]}" || status=$?
echo '服务已退出，正在停止前后端。' >&2
if (( status == 0 )); then
    status=1
fi
exit "$status"
