#!/usr/bin/env bash
# ==============================================================================
#  install.sh  —  ABA Stack: prerequisite installer + first-run setup wizard
#
#  Platforms: macOS · Ubuntu/Debian · WSL (Windows Subsystem for Linux)
#             · Other Linux (guided)
#
#  Usage:   ./install.sh          # fresh install or re-configure
#           ./install.sh --check  # only check prerequisites, no changes
# ==============================================================================

# ── Strict mode (bash 3.2+ compatible) ────────────────────────────────────────
set -uo pipefail

# ── Colours & glyphs ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓  $*${NC}"; }
err()  { echo -e "${RED}  ✗  $*${NC}"; }
warn() { echo -e "${YELLOW}  !  $*${NC}"; }
info() { echo -e "${BLUE}  →  $*${NC}"; }
step() { echo -e "\n${CYAN}${BOLD}┌─  $*${NC}"; }
die()  { err "$*"; exit 1; }

banner() {
  echo -e "${CYAN}${BOLD}"
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║        RON ABA Stack  —  Installer & Setup Wizard           ║"
  echo "║        github.com/ProFiveCK/nr-aba-webapp                   ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
}

# ── Helpers ───────────────────────────────────────────────────────────────────
cmd_exists() { command -v "$1" >/dev/null 2>&1; }

# Elevate only when not already root
SUDO=""
[[ "$(id -u)" -ne 0 ]] && SUDO="sudo"

run_sudo() { $SUDO "$@"; }

# docker wrapper: uses sudo when current session isn't in the docker group yet
docker() {
  if [[ "$(id -u)" -eq 0 ]] || id -Gn 2>/dev/null | grep -qw docker; then
    command docker "$@"
  else
    sudo docker "$@"
  fi
}

ask_yn() {
  local prompt="$1"
  local yn
  while true; do
    read -rp "  ${prompt} [y/n]: " yn
    case "$yn" in
      [Yy]*) return 0 ;;
      [Nn]*) return 1 ;;
      *)     echo "  Please answer y or n." ;;
    esac
  done
}

pause_for_manual_step() {
  echo ""
  warn "$1"
  read -rp "  Press Enter when done, or Ctrl-C to abort..." _
}

# ── Phase 0: Platform detection ───────────────────────────────────────────────
PLATFORM=""
PLATFORM_NAME=""
IS_WSL=false

detect_platform() {
  local os
  os="$(uname -s)"

  if [[ "$os" == "Darwin" ]]; then
    PLATFORM="macos"
    PLATFORM_NAME="macOS"
  elif [[ "$os" == "Linux" ]]; then
    if grep -qiE "microsoft|WSL" /proc/version 2>/dev/null; then
      IS_WSL=true
      PLATFORM="wsl"
      PLATFORM_NAME="WSL (Windows Subsystem for Linux)"
    elif [[ -f /etc/os-release ]]; then
      # shellcheck source=/dev/null
      . /etc/os-release
      case "${ID:-}" in
        ubuntu|debian|linuxmint|pop|raspbian|kali)
          PLATFORM="ubuntu"
          PLATFORM_NAME="${PRETTY_NAME:-Ubuntu/Debian}"
          ;;
        fedora|rhel|centos|rocky|almalinux)
          PLATFORM="rhel"
          PLATFORM_NAME="${PRETTY_NAME:-RHEL/Fedora}"
          ;;
        arch|manjaro|endeavouros)
          PLATFORM="arch"
          PLATFORM_NAME="${PRETTY_NAME:-Arch Linux}"
          ;;
        *)
          PLATFORM="linux"
          PLATFORM_NAME="${PRETTY_NAME:-Linux}"
          ;;
      esac
    else
      PLATFORM="linux"
      PLATFORM_NAME="Linux"
    fi
  else
    die "Unsupported OS: $os"
  fi
}

# ── Phase 1: Prerequisite check & install ─────────────────────────────────────

# ---- Homebrew (macOS) --------------------------------------------------------
ensure_homebrew() {
  if cmd_exists brew; then return 0; fi
  info "Homebrew not found — installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon may need PATH update
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    # Persist for future shells
    local profile="$HOME/.zprofile"
    [[ -f "$HOME/.bash_profile" ]] && profile="$HOME/.bash_profile"
    grep -q "homebrew" "$profile" 2>/dev/null || echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$profile"
  fi
}

# ---- Git ---------------------------------------------------------------------
install_git() {
  case "$PLATFORM" in
    macos)
      ensure_homebrew
      brew install git
      ;;
    ubuntu|wsl)
      run_sudo apt-get update -qq && run_sudo apt-get install -y git
      ;;
    rhel)
      run_sudo dnf install -y git
      ;;
    arch)
      run_sudo pacman -Sy --noconfirm git
      ;;
    *)
      die "Please install Git manually: https://git-scm.com/  Then re-run ./install.sh"
      ;;
  esac
}

check_git() {
  if cmd_exists git; then
    ok "Git $(git --version | awk '{print $3}')"
  else
    warn "Git not found — installing..."
    install_git
    cmd_exists git && ok "Git installed" || die "Git install failed"
  fi
}

# ---- Docker ------------------------------------------------------------------
install_docker() {
  case "$PLATFORM" in
    macos)
      ensure_homebrew
      info "Installing Docker Desktop via Homebrew Cask..."
      brew install --cask docker
      echo ""
      warn "Docker Desktop was installed. Please:"
      warn "  1. Open Docker Desktop from your Applications folder"
      warn "  2. Complete the initial setup"
      warn "  3. Wait for the Docker engine to start (whale icon in menu bar)"
      pause_for_manual_step "Press Enter once Docker Desktop is running..."
      ;;
    ubuntu|wsl)
      if [[ "$IS_WSL" == true ]]; then
        err "On WSL, Docker is provided by Docker Desktop for Windows."
        info "Steps:"
        info "  1. Install Docker Desktop on Windows: https://www.docker.com/products/docker-desktop"
        info "  2. In Docker Desktop → Settings → Resources → WSL Integration → enable this distro"
        info "  3. Restart this terminal, then re-run: ./install.sh"
        exit 1
      fi
      info "Installing curl and dependencies first..."
      run_sudo apt-get update -qq
      run_sudo apt-get install -y curl ca-certificates gnupg lsb-release
      info "Installing Docker Engine via official install script..."
      curl -fsSL https://get.docker.com | run_sudo sh
      run_sudo systemctl enable docker 2>/dev/null || true
      run_sudo systemctl start docker 2>/dev/null || true
      if [[ -n "${SUDO}" ]] && getent group docker >/dev/null 2>&1; then
        run_sudo usermod -aG docker "$USER"
        warn "Added $USER to the 'docker' group."
        warn "NOTE: group membership applies to new shells — this session uses 'sudo docker'."
      fi
      ;;
    rhel)
      info "Installing Docker Engine (RHEL/Fedora)..."
      run_sudo dnf install -y curl ca-certificates
      run_sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo 2>/dev/null || true
      run_sudo dnf install -y docker-ce docker-ce-cli containerd.io
      run_sudo systemctl enable docker --now
      if [[ -n "${SUDO}" ]] && getent group docker >/dev/null 2>&1; then run_sudo usermod -aG docker "$USER"; fi
      ;;
    arch)
      info "Installing Docker (Arch)..."
      run_sudo pacman -Sy --noconfirm docker curl
      run_sudo systemctl enable docker --now
      if [[ -n "${SUDO}" ]] && getent group docker >/dev/null 2>&1; then run_sudo usermod -aG docker "$USER"; fi
      ;;
    *)
      err "Cannot auto-install Docker on $PLATFORM_NAME."
      info "Install Docker Engine: https://docs.docker.com/engine/install/"
      die "Please install Docker then re-run ./install.sh"
      ;;
  esac
}

check_docker() {
  if cmd_exists docker; then
    ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
  else
    warn "Docker not found — installing..."
    install_docker
    cmd_exists docker || die "Docker install failed. Install manually and re-run."
    ok "Docker installed"
  fi

  # Daemon running?
  if docker info >/dev/null 2>&1; then
    ok "Docker daemon is running"
  else
    case "$PLATFORM" in
      macos)
        err "Docker daemon is not running."
        pause_for_manual_step "Open Docker Desktop, wait for 'Docker Desktop is running', then press Enter..."
        docker info >/dev/null 2>&1 || die "Docker daemon still not reachable."
        ;;
      *)
        info "Docker daemon is not running — attempting to start it..."
        run_sudo systemctl start docker 2>/dev/null || true
        local count=0
        until docker info >/dev/null 2>&1; do
          count=$((count+1))
          [[ $count -ge 15 ]] && die "Docker daemon did not start in time. Run: sudo systemctl start docker  then re-run ./install.sh"
          sleep 2
        done
        ok "Docker daemon started"
        ;;
    esac
  fi
}

# ---- Docker Compose ----------------------------------------------------------
COMPOSE_CMD=""

check_docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
    ok "Docker Compose v2 ($(docker compose version --short 2>/dev/null || echo 'plugin'))"
  elif cmd_exists docker-compose; then
    COMPOSE_CMD="docker-compose"
    ok "Docker Compose $(docker-compose --version | awk '{print $3}' | tr -d ',')"
  else
    warn "Docker Compose not found — installing..."
    case "$PLATFORM" in
      ubuntu|wsl)
        run_sudo apt-get install -y docker-compose-plugin 2>/dev/null \
          && COMPOSE_CMD="docker compose" \
          || { run_sudo apt-get install -y docker-compose 2>/dev/null && COMPOSE_CMD="docker-compose"; }
        ;;
      rhel)
        run_sudo dnf install -y docker-compose-plugin && COMPOSE_CMD="docker compose"
        ;;
      arch)
        run_sudo pacman -Sy --noconfirm docker-compose && COMPOSE_CMD="docker compose"
        ;;
      *)
        die "Cannot auto-install Docker Compose. See: https://docs.docker.com/compose/install/"
        ;;
    esac
    [[ -n "$COMPOSE_CMD" ]] && ok "Docker Compose installed" || die "Docker Compose install failed"
  fi
}

# ---- Node.js -----------------------------------------------------------------
install_nodejs() {
  case "$PLATFORM" in
    macos)
      ensure_homebrew
      info "Installing Node.js 20 via Homebrew..."
      brew install node@20
      brew link --overwrite node@20 2>/dev/null || brew link node@20 2>/dev/null || true
      ;;
    ubuntu|wsl)
      info "Installing Node.js 20 via NodeSource..."
      curl -fsSL https://deb.nodesource.com/setup_20.x | run_sudo -E bash -
      run_sudo apt-get install -y nodejs
      ;;
    rhel)
      curl -fsSL https://rpm.nodesource.com/setup_20.x | run_sudo bash -
      run_sudo dnf install -y nodejs
      ;;
    arch)
      run_sudo pacman -Sy --noconfirm nodejs npm
      ;;
    *)
      die "Cannot auto-install Node.js on $PLATFORM_NAME. Install from https://nodejs.org/ then re-run."
      ;;
  esac
}

check_nodejs() {
  local ver major
  if cmd_exists node; then
    ver="$(node --version)"
    major="$(echo "$ver" | tr -d 'v' | cut -d. -f1)"
    if [[ "$major" -ge 18 ]]; then
      ok "Node.js $ver"
      return
    else
      warn "Node.js $ver found but v18+ is required — upgrading..."
    fi
  else
    warn "Node.js not found — installing..."
  fi
  install_nodejs
  cmd_exists node && ok "Node.js $(node --version)" || die "Node.js install failed"
}

# ---- openssl (needed for secret generation) ----------------------------------
check_openssl() {
  if cmd_exists openssl; then
    ok "openssl $(openssl version | awk '{print $2}')"
  else
    case "$PLATFORM" in
      macos)   brew install openssl ;;
      ubuntu|wsl) run_sudo apt-get install -y openssl ;;
      rhel)    run_sudo dnf install -y openssl ;;
      arch)    run_sudo pacman -Sy --noconfirm openssl ;;
    esac
    ok "openssl installed"
  fi
}

check_prerequisites() {
  step "Phase 1 — Prerequisites"
  echo "  Platform: ${PLATFORM_NAME}"
  [[ "$IS_WSL" == true ]] && echo "  (Running inside WSL)"
  echo ""

  check_git
  check_docker
  check_docker_compose
  check_nodejs
  check_openssl

  echo ""
  ok "All prerequisites satisfied"
}

# ── Phase 2: Configure .env.prod ──────────────────────────────────────────────
ENV_FILE=".env.prod"
ENV_EXAMPLE=".env.prod.example"

configure_env() {
  step "Phase 2 — Application configuration"

  local needs_config=false

  if [[ -f "$ENV_FILE" ]]; then
    ok "Found existing $ENV_FILE"
    ask_yn "Reconfigure from scratch? (keeps existing if 'n')" && needs_config=true || needs_config=false
  else
    warn "$ENV_FILE not found — creating now"
    needs_config=true
  fi

  if [[ "$needs_config" == true ]]; then
    echo ""

    # ── Database password ───────────────────────────────────────────────
    echo "  ┌─ Database password ──────────────────────────────────┐"
    if ask_yn "  Generate a random password? (recommended)"; then
      DB_PASS="$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-32)"
      ok "Random password generated"
    else
      while true; do
        read -rsp "  Enter password (min 8 chars): " DB_PASS; echo
        [[ ${#DB_PASS} -ge 8 ]] && break
        warn "Too short — 8 characters minimum"
      done
    fi

    # ── JWT secret (always generated) ──────────────────────────────────
    JWT_SECRET="$(openssl rand -base64 48 | tr -d '=+/' | cut -c1-64)"
    ok "JWT secret generated"

    # ── Admin account ───────────────────────────────────────────────────
    echo ""
    echo "  ┌─ Admin account ───────────────────────────────────────┐"
    read -rp "  Admin email  [admin@example.com]: " ADMIN_EMAIL
    ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
    read -rp "  Admin name   [System Admin]: " ADMIN_NAME
    ADMIN_NAME="${ADMIN_NAME:-System Admin}"
    ADMIN_PASS="Admin123!"
    warn "Default admin password: Admin123!  ← change after first login"

    # ── Web port ────────────────────────────────────────────────────────
    echo ""
    echo "  ┌─ Web port ────────────────────────────────────────────┐"
    local default_port default_url
    if [[ "$PLATFORM" == "macos" ]]; then
      default_port=8080
      default_url="http://localhost:8080"
      info "macOS: using port 8080 (port 80 requires sudo)"
    else
      default_port=80
      default_url="http://localhost"
    fi
    read -rp "  Web port       [$default_port]: " WEB_PORT
    WEB_PORT="${WEB_PORT:-$default_port}"
    read -rp "  Frontend URL   [$default_url]: " FRONTEND_URL
    FRONTEND_URL="${FRONTEND_URL:-$default_url}"

    # ── SMTP (optional) ────────────────────────────────────────────────
    echo ""
    echo "  ┌─ Email / SMTP (optional — for notifications) ─────────┐"
    if ask_yn "  Configure SMTP now?"; then
      read -rp "  SMTP host:       " SMTP_HOST
      read -rp "  SMTP port [587]: " SMTP_PORT; SMTP_PORT="${SMTP_PORT:-587}"
      read -rp "  SMTP user:       " SMTP_USER
      read -rsp "  SMTP password:   " SMTP_PASS; echo
      read -rp "  From address:    " SMTP_FROM
    else
      SMTP_HOST=""; SMTP_PORT="587"; SMTP_USER=""; SMTP_PASS=""; SMTP_FROM=""
      info "SMTP skipped — email notifications will be disabled"
    fi

    # ── Write file ──────────────────────────────────────────────────────
    cat > "$ENV_FILE" <<EOF
# ════════════════════════════════════════════════════════════════
# ABA Stack — Environment configuration
# Generated: $(date)
# Edit with: nano $ENV_FILE   then restart: docker compose --env-file $ENV_FILE restart
# ════════════════════════════════════════════════════════════════

# API server port (internal)
PORT=4000

# ── Database ─────────────────────────────────────────────────────
POSTGRES_USER=postgres
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_DB=aba
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=${DB_PASS}
DB_NAME=aba

# ── Web server ───────────────────────────────────────────────────
# macOS dev: 8080  |  Linux/production: 80
WEB_PORT=${WEB_PORT}

# ── Authentication ───────────────────────────────────────────────
JWT_SECRET=${JWT_SECRET}
REVIEWER_SESSION_MINUTES=480
REVIEWER_TEMP_PASSWORD_LENGTH=12
BCRYPT_ROUNDS=12

# ── Frontend URL (used in email links) ───────────────────────────
FRONTEND_BASE_URL=${FRONTEND_URL}

# ── Bootstrap admin (removed automatically after first login) ────
DEFAULT_ADMIN_EMAIL=${ADMIN_EMAIL}
DEFAULT_ADMIN_PASSWORD=${ADMIN_PASS}
DEFAULT_ADMIN_NAME=${ADMIN_NAME}

# ── SMTP (leave blank to disable email) ──────────────────────────
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
SMTP_FROM=${SMTP_FROM}

# ── Windows SFTP sync (optional) ─────────────────────────────────
SFTP_SYNC_METHOD=database
WINDOWS_SYNC_URL=http://host.docker.internal:8088/sync-trigger
SYNC_TIMEOUT=30000

# ── AI helper (optional) ─────────────────────────────────────────
AI_HELPER_ENABLED=false
EOF

    ok "Saved $ENV_FILE"
  fi

  # Symlink .env → .env.prod for legacy tooling
  if [[ ! -L ".env" ]]; then
    ln -sf "$ENV_FILE" .env
    ok "Symlink .env → $ENV_FILE"
  fi
}

# ── Phase 3: Docker network & volume ──────────────────────────────────────────
NETWORK_NAME="ron-net"
VOLUME_NAME="ron-stack_pgdata"
FRESH_VOLUME=false

setup_docker_infra() {
  step "Phase 3 — Docker network & volume"

  # Network
  if docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
    ok "Network '$NETWORK_NAME' already exists"
  else
    docker network create "$NETWORK_NAME"
    ok "Network '$NETWORK_NAME' created"
  fi

  # Volume
  if docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    warn "Volume '$VOLUME_NAME' already exists (database retained)"
    echo ""
    if ask_yn "  Reset database volume? (DELETES all data — needed only for fresh credential change)"; then
      info "Stopping any running services..."
      $COMPOSE_CMD --env-file "$ENV_FILE" down >/dev/null 2>&1 || true
      docker volume rm "$VOLUME_NAME"
      docker volume create "$VOLUME_NAME"
      ok "Fresh volume created"
      FRESH_VOLUME=true
    else
      info "Keeping existing database"
    fi
  else
    docker volume create "$VOLUME_NAME"
    ok "Volume '$VOLUME_NAME' created"
    FRESH_VOLUME=true
  fi
}

# ── Phase 4: Database restore (offered on fresh volume or manually) ────────────
RESTORE_FILE=""

pick_restore_file() {
  # Collect .sql candidates from ./backup/ and current dir
  local candidates=()
  local f

  while IFS= read -r f; do
    [[ -f "$f" ]] && candidates+=("$f")
  done < <(ls -t ./backup/*.sql 2>/dev/null; ls -t ./*.sql 2>/dev/null | grep -v "schema" || true)

  echo ""
  if [[ ${#candidates[@]} -eq 0 ]]; then
    info "No SQL backup files found in ./backup/ or the current directory."
    info "Copy your .sql dump to ./backup/ first, or choose 'c' to enter a custom path."
  else
    echo "  Available backups:"
    local i=0
    for f in "${candidates[@]}"; do
      local size
      size="$(du -sh "$f" 2>/dev/null | awk '{print $1}')"
      echo "    $((i+1)).  $(basename "$f")  (${size})  —  $f"
      i=$((i+1))
    done
  fi
  echo "    c.  Enter a custom path to a .sql file"
  echo "    0.  Skip (start with empty database)"
  echo ""

  local sel
  while true; do
    read -rp "  Select [0]: " sel
    sel="${sel:-0}"
    if [[ "$sel" == "0" ]]; then
      RESTORE_FILE=""
      break
    elif [[ "$sel" == "c" || "$sel" == "C" ]]; then
      read -rp "  Path to .sql file: " RESTORE_FILE
      if [[ -f "$RESTORE_FILE" ]]; then
        ok "Using: $RESTORE_FILE"
        break
      else
        err "File not found: $RESTORE_FILE"
      fi
    elif [[ "$sel" =~ ^[0-9]+$ ]] && [[ "$sel" -ge 1 && "$sel" -le "${#candidates[@]}" ]]; then
      RESTORE_FILE="${candidates[$((sel-1))]}"
      break
    else
      warn "Invalid selection"
    fi
  done
}

maybe_restore_database() {
  step "Phase 4 — Database restore"

  if [[ "$FRESH_VOLUME" == true ]]; then
    info "Fresh database volume — do you want to restore from a backup?"
    pick_restore_file
  else
    info "Existing database in use."
    if ask_yn "  Restore a backup into it anyway? (will overwrite data)"; then
      pick_restore_file
    fi
  fi

  if [[ -n "$RESTORE_FILE" ]]; then
    ok "Will restore: $RESTORE_FILE  (after services start)"
  else
    info "No restore — database will be initialised fresh on first startup"
  fi
}

# ── Phase 5: Build frontend ───────────────────────────────────────────────────
build_frontend() {
  step "Phase 5 — Frontend build"

  local client="./app/client"

  if [[ -d "$client/dist" ]]; then
    if ! ask_yn "  Frontend is already built. Rebuild?"; then
      ok "Using existing build in $client/dist"
      return
    fi
  fi

  info "Installing npm dependencies (this may take a minute)..."
  (cd "$client" && npm install --prefer-offline 2>&1 | tail -3)

  info "Building production bundle..."
  (cd "$client" && npm run build)

  if [[ -d "$client/dist" ]]; then
    ok "Frontend built → $client/dist"
  else
    die "Frontend build failed — check npm errors above"
  fi
}

# ── Phase 6: Start services ───────────────────────────────────────────────────
start_services() {
  step "Phase 6 — Start services"

  if ! ask_yn "  Build Docker images and start all services now?"; then
    info "Skipped. Start later with:"
    echo "    $COMPOSE_CMD --env-file $ENV_FILE up -d"
    return
  fi

  info "Building Docker images (may take a few minutes on first run)..."
  $COMPOSE_CMD --env-file "$ENV_FILE" build

  info "Starting services..."
  $COMPOSE_CMD --env-file "$ENV_FILE" up -d

  # Run DB restore if selected
  if [[ -n "$RESTORE_FILE" ]]; then
    info "Waiting for PostgreSQL to be ready..."
    local count=0
    until docker exec ron-aba-postgres-prod pg_isready -U postgres >/dev/null 2>&1; do
      count=$((count+1))
      [[ $count -ge 20 ]] && warn "Database not ready after 20s — attempting restore anyway..." && break
      sleep 2
    done

    # Drop and recreate the database so the dump restores into a clean slate.
    # Without this, the backend's auto-bootstrap creates the schema first and
    # the dump errors on every "already exists" object.
    info "Resetting database to clean state before restore..."
    docker exec ron-aba-postgres-prod psql -U postgres -c "DROP DATABASE aba;" 2>/dev/null || true
    docker exec ron-aba-postgres-prod psql -U postgres -c "CREATE DATABASE aba;"
    ok "Clean database ready"

    info "Restoring $RESTORE_FILE ..."
    if docker exec -i ron-aba-postgres-prod psql -U postgres -d aba < "$RESTORE_FILE"; then
      ok "Database restored from $RESTORE_FILE"
    else
      warn "Restore completed with warnings — check output above."
      warn "To retry manually:"
      warn "  sudo docker exec ron-aba-postgres-prod psql -U postgres -c 'DROP DATABASE aba;'"
      warn "  sudo docker exec ron-aba-postgres-prod psql -U postgres -c 'CREATE DATABASE aba;'"
      warn "  sudo docker exec -i ron-aba-postgres-prod psql -U postgres -d aba < $RESTORE_FILE"
    fi
  fi

  info "Waiting for health checks..."
  sleep 8

  echo ""
  $COMPOSE_CMD --env-file "$ENV_FILE" ps
}

# ── Summary ───────────────────────────────────────────────────────────────────
print_summary() {
  local port admin_email
  port="$(grep "^WEB_PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d ' ')"
  port="${port:-80}"
  admin_email="$(grep "^DEFAULT_ADMIN_EMAIL=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d ' ')"
  admin_email="${admin_email:-admin@example.com}"

  echo ""
  echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════╗"
  echo    "║                    Setup complete!                           ║"
  echo    "╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  Web UI    →  ${CYAN}http://localhost:${port}${NC}"
  echo -e "  API       →  ${CYAN}http://localhost:${port}/api/${NC}"
  echo -e "  Health    →  ${CYAN}http://localhost:${port}/health${NC}"
  echo ""
  echo -e "  Login email :  ${admin_email}"
  echo -e "  Password    :  ${YELLOW}Admin123!${NC}  ← change this now"
  echo ""
  echo "  Useful commands:"
  echo "    $COMPOSE_CMD --env-file $ENV_FILE logs -f         # tail all logs"
  echo "    $COMPOSE_CMD --env-file $ENV_FILE ps              # service status"
  echo "    $COMPOSE_CMD --env-file $ENV_FILE restart         # restart all"
  echo "    $COMPOSE_CMD --env-file $ENV_FILE down            # stop all"
  echo ""
  echo "  To restore a DB backup later:"
  echo "    docker exec -i ron-aba-postgres-prod psql -U postgres -d aba < backup/yourfile.sql"
  echo ""
}

# ── Entry point ───────────────────────────────────────────────────────────────
main() {
  banner
  detect_platform
  info "Detected: $PLATFORM_NAME"
  echo ""

  # --check flag: only verify prerequisites
  if [[ "${1:-}" == "--check" ]]; then
    check_prerequisites
    echo ""
    info "Run ./install.sh (without --check) to configure and start the stack."
    exit 0
  fi

  check_prerequisites
  configure_env
  setup_docker_infra
  maybe_restore_database
  build_frontend
  start_services
  print_summary
}

main "$@"
