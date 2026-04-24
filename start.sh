#!/usr/bin/env bash
#============================================================
# BlessCas / MoneyCas – lean production control script
#
# Usage:
#   ./start.sh deploy      # git pull + npm install + build + restart
#   ./start.sh start       # start web + bot (builds if .next missing)
#   ./start.sh stop        # stop web + bot, free port 3000
#   ./start.sh restart     # stop then start (no rebuild)
#   ./start.sh rebuild     # force rm -rf .next, build, restart
#   ./start.sh status      # pm2 list + port state
#   ./start.sh logs [name] # tail pm2 logs (default: plaidcas-web)
#   ./start.sh caddy       # reload/restart Caddy
#
# The script is idempotent: every start path kills lingering
# Next.js / bot / pm2 processes so you never hit EADDRINUSE.
#============================================================

set -euo pipefail

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
BLUE=$'\033[0;34m'
NC=$'\033[0m'

log()   { printf "%s[INFO]%s  %s\n"   "${BLUE}"   "${NC}" "$*"; }
ok()    { printf "%s[OK]%s    %s\n"   "${GREEN}"  "${NC}" "$*"; }
warn()  { printf "%s[WARN]%s  %s\n"   "${YELLOW}" "${NC}" "$*"; }
die()   { printf "%s[ERROR]%s %s\n"   "${RED}"    "${NC}" "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

WEB_NAME="plaidcas-web"
BOT_NAME="plaidcas-bot"
WEB_PORT="${PORT:-3000}"
ECOSYSTEM_FILE="$SCRIPT_DIR/ecosystem.config.js"

#----------------------------------------
# Prerequisites
#----------------------------------------

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

ensure_deps() {
    require_cmd node
    require_cmd npm

    if ! command -v pm2 >/dev/null 2>&1; then
        log "pm2 not found – installing globally"
        npm install -g pm2
    fi

    if [ ! -f ".env.local" ]; then
        die ".env.local not found in $SCRIPT_DIR – create it from .env.local.example and populate real secrets"
    fi

    if [ ! -f "$ECOSYSTEM_FILE" ]; then
        die "$ECOSYSTEM_FILE not found"
    fi
}

#----------------------------------------
# Process control
#----------------------------------------

kill_port() {
    local port="$1"
    if command -v ss >/dev/null 2>&1; then
        local pids
        pids=$(ss -ltnp "sport = :$port" 2>/dev/null \
            | awk 'NR>1 {print $6}' \
            | grep -oE 'pid=[0-9]+' \
            | cut -d= -f2 \
            | sort -u || true)
        if [ -n "${pids:-}" ]; then
            warn "Killing leftover processes on port $port: $pids"
            for pid in $pids; do
                kill -9 "$pid" 2>/dev/null || true
            done
        fi
    fi
    pkill -9 -f "next-server" 2>/dev/null || true
    pkill -9 -f "next start"  2>/dev/null || true
}

kill_bot() {
    pkill -9 -f "node .*bot\.js"         2>/dev/null || true
    pkill -9 -f "node.*$SCRIPT_DIR/bot"  2>/dev/null || true
}

stop_all() {
    log "Stopping pm2 processes ($WEB_NAME, $BOT_NAME)"
    pm2 delete "$WEB_NAME" 2>/dev/null || true
    pm2 delete "$BOT_NAME" 2>/dev/null || true
    kill_port "$WEB_PORT"
    kill_bot
    sleep 1
    ok "All app processes stopped"
}

start_all() {
    if [ ! -d ".next" ]; then
        log ".next not found – running production build"
        npm run build
    fi

    log "Starting via $ECOSYSTEM_FILE"
    pm2 start "$ECOSYSTEM_FILE"
    pm2 save
    sleep 2

    if ss -ltnp 2>/dev/null | grep -q ":$WEB_PORT "; then
        ok "Web is listening on port $WEB_PORT"
    else
        warn "Port $WEB_PORT is not listening yet – check logs: ./start.sh logs"
    fi

    pm2 list
}

reload_caddy() {
    if command -v caddy >/dev/null 2>&1; then
        if systemctl list-unit-files 2>/dev/null | grep -q '^caddy\.service'; then
            log "Reloading Caddy (systemd unit: caddy)"
            sudo systemctl reload caddy || sudo systemctl restart caddy
            ok "Caddy reloaded"
            return
        fi
        if systemctl list-unit-files 2>/dev/null | grep -q '^snap\.caddy\.caddy\.service'; then
            log "Reloading Caddy (snap)"
            sudo snap restart caddy
            ok "Caddy restarted via snap"
            return
        fi
        if systemctl list-unit-files 2>/dev/null | grep -q '^caddy-custom\.service'; then
            log "Reloading Caddy (systemd unit: caddy-custom)"
            sudo systemctl restart caddy-custom
            ok "Caddy restarted"
            return
        fi
        warn "Caddy binary found but no service unit – skipping reload"
    else
        warn "Caddy not installed – skipping"
    fi
}

#----------------------------------------
# High-level commands
#----------------------------------------

cmd_start() {
    ensure_deps
    stop_all
    start_all
    reload_caddy
    ok "Site is up:  https://moneycas.live"
}

cmd_stop() {
    stop_all
}

cmd_restart() {
    ensure_deps
    stop_all
    start_all
    ok "Restarted without rebuild"
}

cmd_rebuild() {
    ensure_deps
    stop_all
    log "Removing .next"
    rm -rf .next
    log "Installing dependencies"
    npm install
    log "Building"
    npm run build
    start_all
    reload_caddy
    ok "Rebuild complete"
}

cmd_deploy() {
    ensure_deps
    log "git fetch + pull"
    git fetch --all --prune
    local branch
    branch="$(git rev-parse --abbrev-ref HEAD)"
    git pull --ff-only origin "$branch"
    stop_all
    log "Installing dependencies"
    npm install
    log "Removing .next and building"
    rm -rf .next
    npm run build
    start_all
    reload_caddy
    ok "Deployed branch $branch"
}

cmd_status() {
    log "pm2 list"
    pm2 list || true
    echo
    log "Port $WEB_PORT listeners"
    ss -ltnp 2>/dev/null | grep ":$WEB_PORT " || echo "  (nothing listening)"
    echo
    log "Last commit"
    git log --oneline -1 || true
}

cmd_logs() {
    local target="${1:-$WEB_NAME}"
    pm2 logs "$target" --lines 100
}

cmd_caddy() {
    reload_caddy
}

usage() {
    sed -n '2,18p' "$0"
    exit 1
}

#----------------------------------------
# Dispatcher
#----------------------------------------

case "${1:-}" in
    start)   cmd_start ;;
    stop)    cmd_stop ;;
    restart) cmd_restart ;;
    rebuild) cmd_rebuild ;;
    deploy)  cmd_deploy ;;
    status)  cmd_status ;;
    logs)    shift; cmd_logs "${1:-}" ;;
    caddy)   cmd_caddy ;;
    ""|-h|--help|help) usage ;;
    *)       warn "Unknown command: $1"; usage ;;
esac
