#!/usr/bin/env bash
# Build the app and install a user service that starts at boot through linger.
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME=xunlei-web.service

if (( EUID == 0 )); then
    echo '安装失败：请以项目所属的普通用户运行本脚本。' >&2
    exit 1
fi

for command in uv bun loginctl systemctl systemd-analyze; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "安装失败：找不到 $command，请先安装并加入 PATH。" >&2
        exit 1
    fi
done

if [[ "$(loginctl show-user "$(id -un)" -p Linger --value)" != yes ]]; then
    if ! loginctl enable-linger "$(id -un)"; then
        echo "安装失败：请先由管理员执行 sudo loginctl enable-linger $(id -un)，再重新运行本脚本。" >&2
        exit 1
    fi
fi

echo 'Installing backend dependencies...'
(cd "$ROOT_DIR/backend" && uv sync --locked)
echo 'Installing frontend dependencies...'
(cd "$ROOT_DIR/frontend" && bun install --frozen-lockfile)
if [[ ! -e "$ROOT_DIR/backend/.env.development" ]]; then
    cp -- "$ROOT_DIR/backend/.env.example" "$ROOT_DIR/backend/.env.development"
    echo 'Created backend/.env.development from .env.example'
fi
echo 'Building frontend...'
(cd "$ROOT_DIR/frontend" && bun --bun run build)

# Quote paths for systemd, including literal specifiers and environment syntax.
unit_quote() {
    local value="$1"
    if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
        echo '安装失败：服务路径不能包含换行符。' >&2
        exit 1
    fi
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    value="${value//%/%%}"
    printf '"%s"' "$value"
}

# WorkingDirectory takes a literal path rather than an ExecStart argument list.
WORKING_DIRECTORY="${ROOT_DIR//%/%%}/backend"
# ExecStart also expands dollar signs; double them to preserve literal paths.
PYTHON_EXECUTABLE="${ROOT_DIR//\$/\$\$}/backend/.venv/bin/python"
PYTHON_EXECUTABLE="$(unit_quote "$PYTHON_EXECUTABLE")"
HOME_ENVIRONMENT="$(unit_quote "HOME=$HOME")"
UNIT_DIRECTORY="$(mktemp -d)"
INSTALL_DIRECTORY="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
trap 'rm -rf -- "$UNIT_DIRECTORY"' EXIT

cat > "$UNIT_DIRECTORY/$SERVICE_NAME" <<EOF
[Unit]
Description=Xunlei Downloader Web
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=exec
WorkingDirectory=$WORKING_DIRECTORY
Environment=$HOME_ENVIRONMENT
Environment=PYTHONUNBUFFERED=1
ExecStart=$PYTHON_EXECUTABLE -m uvicorn app.main:app --host 0.0.0.0 --port 8011 --workers 1 --timeout-graceful-shutdown 30
Restart=always
RestartSec=5
KillMode=mixed
TimeoutStopSec=60

[Install]
WantedBy=default.target
EOF

systemd-analyze --user verify "$UNIT_DIRECTORY/$SERVICE_NAME"
mkdir -p -- "$INSTALL_DIRECTORY"
install -m 0644 -- "$UNIT_DIRECTORY/$SERVICE_NAME" "$INSTALL_DIRECTORY/$SERVICE_NAME"
systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"
systemctl --user --no-pager --full status "$SERVICE_NAME"
echo '服务已安装并启用开机自启：http://127.0.0.1:8011'
echo '局域网访问：http://<本机局域网 IP>:8011'
echo '查看日志：journalctl --user -u xunlei-web.service -f'
