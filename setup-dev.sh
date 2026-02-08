#!/bin/bash

# ═══════════════════════════════════════════════════════════════
# ABA Stack - Development Setup Script
# One-stop shop for setting up the development environment
# ═══════════════════════════════════════════════════════════════

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Emojis
CHECK="✅"
CROSS="❌"
WARN="⚠️"
INFO="ℹ️"
ROCKET="🚀"
GEAR="⚙️"
LOCK="🔒"

echo -e "${CYAN}${BOLD}"
echo "═══════════════════════════════════════════════════════════════"
echo "   ABA Stack - Development Environment Setup"
echo "═══════════════════════════════════════════════════════════════"
echo -e "${NC}"

# Function to print status messages
log_info() {
    echo -e "${BLUE}${INFO}  $1${NC}"
}

log_success() {
    echo -e "${GREEN}${CHECK}  $1${NC}"
}

log_error() {
    echo -e "${RED}${CROSS}  $1${NC}"
}

log_warn() {
    echo -e "${YELLOW}${WARN}  $1${NC}"
}

log_step() {
    echo -e "\n${CYAN}${BOLD}${GEAR}  $1${NC}"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to prompt for user input
prompt_yes_no() {
    while true; do
        read -p "$1 (y/n): " yn
        case $yn in
            [Yy]* ) return 0;;
            [Nn]* ) return 1;;
            * ) echo "Please answer yes or no.";;
        esac
    done
}

# ═══════════════════════════════════════════════════════════════
# STEP 1: Check Prerequisites
# ═══════════════════════════════════════════════════════════════
log_step "Checking prerequisites..."

REQUIREMENTS_MET=true

# Check Docker
if command_exists docker; then
    DOCKER_VERSION=$(docker --version | cut -d ' ' -f3 | cut -d ',' -f1)
    log_success "Docker installed: v$DOCKER_VERSION"
else
    log_error "Docker is not installed"
    log_warn "Install Docker Desktop from: https://www.docker.com/products/docker-desktop"
    REQUIREMENTS_MET=false
fi

# Check Docker Compose
if command_exists docker-compose || docker compose version >/dev/null 2>&1; then
    if command_exists docker-compose; then
        COMPOSE_CMD="docker-compose"
        COMPOSE_VERSION=$(docker-compose --version | cut -d ' ' -f3 | cut -d ',' -f1)
    else
        COMPOSE_CMD="docker compose"
        COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || echo "v2+")
    fi
    log_success "Docker Compose installed: $COMPOSE_VERSION"
else
    log_error "Docker Compose is not installed"
    REQUIREMENTS_MET=false
fi

# Check if Docker is running
if docker info >/dev/null 2>&1; then
    log_success "Docker daemon is running"
else
    log_error "Docker daemon is not running"
    log_warn "Start Docker Desktop and try again"
    REQUIREMENTS_MET=false
fi

if [ "$REQUIREMENTS_MET" = false ]; then
    echo ""
    log_error "Prerequisites not met. Please install required software and try again."
    exit 1
fi

# ═══════════════════════════════════════════════════════════════
# STEP 2: Environment Configuration
# ═══════════════════════════════════════════════════════════════
log_step "Setting up environment configuration..."

ENV_FILE=".env.prod"
ENV_EXAMPLE=".env.prod.example"

# Check root .env.prod
if [ -f "$ENV_FILE" ]; then
    log_success "Found existing $ENV_FILE"
    if prompt_yes_no "Do you want to recreate it from the example template?"; then
        cp "$ENV_EXAMPLE" "$ENV_FILE"
        log_success "Created fresh $ENV_FILE from template"
        ENV_NEEDS_CONFIG=true
    else
        log_info "Using existing $ENV_FILE"
        ENV_NEEDS_CONFIG=false
    fi
fi

# ═══════════════════════════════════════════════════════════════
# STEP 3: Configure Credentials
# ═══════════════════════════════════════════════════════════════
if [ "$ENV_NEEDS_CONFIG" = true ]; then
    log_step "Interactive credential setup..."
    echo ""
    log_warn "The application requires credentials to run."
    echo ""
    
    if prompt_yes_no "Configure credentials interactively now?"; then
        echo ""
        
        # Database Password
        log_info "📊 Database Configuration"
        echo ""
        if prompt_yes_no "Generate a random database password? (Recommended)"; then
            DB_PASS=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-32)
            log_success "Generated secure database password"
        else
            echo -n "Enter database password: "
            read -s DB_PASS
            echo ""
        fi
        
        # JWT Secret
        echo ""
        log_info "🔑 JWT Secret Generation"
        JWT_SECRET=$(openssl rand -base64 48 | tr -d "=+/" | cut -c1-64)
        log_success "Generated JWT secret"
        
        # Admin Account
        echo ""
        log_info "👤 Admin Account Setup"
        echo -n "Admin email [admin@example.com]: "
        read ADMIN_EMAIL
        ADMIN_EMAIL=${ADMIN_EMAIL:-admin@example.com}
        
        echo -n "Admin full name [System Admin]: "
        read ADMIN_NAME
        ADMIN_NAME=${ADMIN_NAME:-System Admin}
        
        echo -n "Admin password: "
        read -s ADMIN_PASS
        echo ""
        if [ -z "$ADMIN_PASS" ]; then
            ADMIN_PASS="ChangeMe@$(date +%Y)"
            log_warn "No password provided, using: $ADMIN_PASS (change after first login!)"
        fi
        
        # Frontend URL
        echo ""
        log_info "🌐 Application URL"
        echo -n "Frontend URL [http://localhost]: "
        read FRONTEND_URL
        FRONTEND_URL=${FRONTEND_URL:-http://localhost}
        
        # SMTP Configuration (Optional)
        echo ""
        if prompt_yes_no "Configure SMTP for email notifications? (Optional)"; then
            echo ""
            log_info "📧 SMTP Configuration"
            echo -n "SMTP Host: "
            read SMTP_HOST
            echo -n "SMTP Port [587]: "
            read SMTP_PORT
            SMTP_PORT=${SMTP_PORT:-587}
            echo -n "SMTP User: "
            read SMTP_USER
            echo -n "SMTP Password: "
            read -s SMTP_PASS
            echo ""
            echo -n "From Email [$SMTP_USER]: "
            read SMTP_FROM
            SMTP_FROM=${SMTP_FROM:-$SMTP_USER}
            
            CONFIGURE_SMTP=true
        else
            CONFIGURE_SMTP=false
            log_info "Skipping SMTP configuration"
        fi
        
        # AI Helper (Optional)
        echo ""
        if prompt_yes_no "Enable AI Helper features? (Optional)"; then
            echo ""
            log_info "🤖 AI Helper Configuration"
            echo "Choose AI provider:"
            echo "  1) GitHub Models (requires GitHub token)"
            echo "  2) Ollama (local, requires Ollama running)"
            echo -n "Select [1]: "
            read AI_CHOICE
            AI_CHOICE=${AI_CHOICE:-1}
            
            if [ "$AI_CHOICE" = "1" ]; then
                echo -n "GitHub Personal Access Token: "
                read -s GITHUB_TOKEN
                echo ""
                AI_PROVIDER="github"
                AI_ENABLED=true
            else
                echo -n "Ollama base URL [http://172.17.0.1:11434]: "
                read OLLAMA_URL
                OLLAMA_URL=${OLLAMA_URL:-http://172.17.0.1:11434}
                AI_PROVIDER="ollama"
                AI_ENABLED=true
            fi
        else
            AI_ENABLED=false
            log_info "Skipping AI Helper configuration"
        fi
        
        # Save to .env.prod
        echo ""
        log_info "💾 Saving configuration to $ENV_FILE..."
        
        cat > "$ENV_FILE" << EOF
# ═══════════════════════════════════════════════════════════════
# ABA Stack Environment Configuration
# Generated: $(date)
# ═══════════════════════════════════════════════════════════════

# Server
PORT=4000

# Database Credentials
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$DB_PASS
POSTGRES_DB=aba
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=$DB_PASS
DB_NAME=aba

# Production Web Port
PROD_WEB_PORT=9000

# Authentication
JWT_SECRET=$JWT_SECRET
REVIEWER_SESSION_MINUTES=480
REVIEWER_TEMP_PASSWORD_LENGTH=12
BCRYPT_ROUNDS=12

# Front-end URL
FRONTEND_BASE_URL=$FRONTEND_URL

# Admin Account (Bootstrap)
DEFAULT_ADMIN_EMAIL=$ADMIN_EMAIL
DEFAULT_ADMIN_PASSWORD=$ADMIN_PASS
DEFAULT_ADMIN_NAME=$ADMIN_NAME

EOF

        # Add SMTP if configured
        if [ "$CONFIGURE_SMTP" = true ]; then
            cat >> "$ENV_FILE" << EOF
# SMTP Configuration
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_SECURE=false
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
SMTP_FROM=$SMTP_FROM
REPLY_TO_EMAIL=$SMTP_FROM

EOF
        else
            cat >> "$ENV_FILE" << EOF
# SMTP Configuration (Disabled)
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=noreply@example.com
# SMTP_PASS=your-password
# SMTP_FROM=noreply@example.com
# REPLY_TO_EMAIL=noreply@example.com

EOF
        fi

        # Add SFTP Sync Config
        cat >> "$ENV_FILE" << EOF
# SFTP Sync Configuration
SFTP_SYNC_METHOD=direct
WINDOWS_SYNC_URL=http://192.168.1.7:8088/sync-trigger
SYNC_TIMEOUT=30000

EOF

        # Add AI Helper if configured
        if [ "$AI_ENABLED" = true ]; then
            cat >> "$ENV_FILE" << EOF
# AI Helper Configuration
AI_HELPER_ENABLED=true
AI_PROVIDER=$AI_PROVIDER
EOF
            if [ "$AI_PROVIDER" = "github" ]; then
                cat >> "$ENV_FILE" << EOF
GITHUB_TOKEN=$GITHUB_TOKEN
GITHUB_MODEL=gpt-4o-mini
EOF
            else
                cat >> "$ENV_FILE" << EOF
OLLAMA_BASE_URL=$OLLAMA_URL
OLLAMA_MODEL=deepseek-v3.1:671b-cloud
EOF
            fi
        else
            cat >> "$ENV_FILE" << EOF
# AI Helper Configuration (Disabled)
AI_HELPER_ENABLED=false
# AI_PROVIDER=github
# GITHUB_TOKEN=your-token-here
# GITHUB_MODEL=gpt-4o-mini
# OLLAMA_BASE_URL=http://172.17.0.1:11434
# OLLAMA_MODEL=deepseek-v3.1:671b-cloud
EOF
        fi
        
        log_success "Configuration saved to $ENV_FILE"
        echo ""
        log_warn "Remember to change the admin password after first login!"
        
    else
        log_warn "Skipping interactive setup. You'll need to edit $ENV_FILE manually."
        echo ""
        if prompt_yes_no "Would you like to open the file in your editor now?"; then
            if command_exists nano; then
                nano "$ENV_FILE"
            elif command_exists vim; then
                vim "$ENV_FILE"
            elif command_exists vi; then
                vi "$ENV_FILE"
            elif [ "$(uname)" = "Darwin" ]; then
                open -t "$ENV_FILE"
                log_info "Opened in default text editor. Save and close when done."
                read -p "Press Enter when you've finished editing..."
            else
                log_warn "No suitable editor found. Please edit $ENV_FILE manually."
                read -p "Press Enter when you've finished editing..."
            fi
        else
            log_warn "Remember to edit $ENV_FILE before starting the services!"
            echo ""
            if prompt_yes_no "Do you want to continue anyway?"; then
                log_info "Continuing with default values..."
            else
                echo ""
                log_info "Setup paused. Edit $ENV_FILE and run this script again."
                exit 0
            fi
        fi
    fi
fi

# ═══════════════════════════════════════════════════════════════
# STEP 4: Network Setup
# ═══════════════════════════════════════════════════════════════
log_step "Setting up Docker network..."

NETWORK_NAME="ron-net"
if docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
    log_success "Network '$NETWORK_NAME' already exists"
else
    log_info "Creating Docker network '$NETWORK_NAME'..."
    docker network create "$NETWORK_NAME"
    log_success "Network '$NETWORK_NAME' created"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 5: Volume Setup
# ═══════════════════════════════════════════════════════════════
log_step "Setting up Docker volumes..."

VOLUME_NAME="ron-stack_pgdata"
if docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    log_success "Volume '$VOLUME_NAME' already exists"
    EXISTING_VOLUME=true
else
    log_info "Creating Docker volume '$VOLUME_NAME'..."
    docker volume create "$VOLUME_NAME"
    log_success "Volume '$VOLUME_NAME' created"
    EXISTING_VOLUME=false
fi

# ═══════════════════════════════════════════════════════════════
# STEP 6: Build and Start Services
# ═══════════════════════════════════════════════════════════════
log_step "Building and starting services..."

echo ""
if [ "$EXISTING_VOLUME" = true ]; then
    log_warn "Existing database volume found. Your data will be preserved."
fi

if prompt_yes_no "Do you want to build and start the services now?"; then
    echo ""
    log_info "Building Docker images (this may take a few minutes on first run)..."
    $COMPOSE_CMD build
    
    echo ""
    log_info "Starting services..."
    $COMPOSE_CMD up -d
    
    echo ""
    log_success "Services started!"
    
    # Wait for services to be healthy
    log_info "Waiting for services to be ready..."
    sleep 5
    
    # Check service status
    echo ""
    log_step "Service Status:"
    $COMPOSE_CMD ps
    
else
    log_info "Skipping service startup. You can start manually with:"
    echo "  $COMPOSE_CMD up -d"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 7: Post-Setup Information
# ═══════════════════════════════════════════════════════════════
echo ""
log_step "Setup Complete! ${ROCKET}"
echo ""

# Display access information
FRONTEND_URL=$(grep FRONTEND_BASE_URL "$ENV_FILE" 2>/dev/null | cut -d '=' -f2 || echo "http://localhost")
if [ "$FRONTEND_URL" = "http://localhost" ]; then
    FRONTEND_URL="http://localhost:80"
fi

echo -e "${GREEN}${BOLD}Access your application:${NC}"
echo -e "  ${CYAN}Web Interface:${NC} http://localhost"
echo -e "  ${CYAN}API Backend:${NC}   http://localhost/api"
echo -e "  ${CYAN}Health Check:${NC}  http://localhost/api/health"
echo ""

echo -e "${BLUE}${BOLD}Useful Commands:${NC}"
echo -e "  ${CYAN}View logs:${NC}           $COMPOSE_CMD logs -f"
echo -e "  ${CYAN}View API logs:${NC}       $COMPOSE_CMD logs -f api"
echo -e "  ${CYAN}Stop services:${NC}       $COMPOSE_CMD stop"
echo -e "  ${CYAN}Restart services:${NC}    $COMPOSE_CMD restart"
echo -e "  ${CYAN}Stop & remove:${NC}       $COMPOSE_CMD down"
echo -e "  ${CYAN}Rebuild:${NC}             $COMPOSE_CMD up -d --build"
echo ""

echo -e "${YELLOW}${BOLD}Database Management:${NC}"
echo -e "  ${CYAN}Access DB:${NC}           $COMPOSE_CMD exec postgres psql -U postgres -d aba"
echo -e "  ${CYAN}Backup DB:${NC}           $COMPOSE_CMD exec postgres pg_dump -U postgres aba > backup.sql"
echo -e "  ${CYAN}Restore DB:${NC}          cat backup.sql | $COMPOSE_CMD exec -T postgres psql -U postgres -d aba"
echo ""

echo -e "${GREEN}${BOLD}Default Admin Access:${NC}"
DEFAULT_EMAIL=$(grep DEFAULT_ADMIN_EMAIL "$ENV_FILE" 2>/dev/null | cut -d '=' -f2 || echo "admin@example.com")
DEFAULT_PASS=$(grep DEFAULT_ADMIN_PASSWORD "$ENV_FILE" 2>/dev/null | cut -d '=' -f2 || echo "change_me_on_first_login")
echo -e "  ${CYAN}Email:${NC}    $DEFAULT_EMAIL"
echo -e "  ${CYAN}Password:${NC} $DEFAULT_PASS"
echo -e "  ${YELLOW}(Change this password after first login!)${NC}"
echo ""

if [ "$ENV_NEEDS_CONFIG" = true ]; then
    log_warn "Remember to update credentials in $ENV_FILE"
    log_warn "Generate secure secrets with: openssl rand -base64 32"
fi

echo -e "${BLUE}${BOLD}Documentation:${NC}"
echo -e "  ${CYAN}Setup Guide:${NC}         SETUP-ENVIRONMENT.md"
echo -e "  ${CYAN}Main README:${NC}         README.md"
echo -e "  ${CYAN}Deployment:${NC}          PRODUCTION-DEPLOYMENT-CHECKLIST.md"
echo ""

echo -e "${GREEN}${BOLD}Next Steps:${NC}"
echo "  1. Verify services are running: $COMPOSE_CMD ps"
echo "  2. Check the logs if needed: $COMPOSE_CMD logs -f"
echo "  3. Open http://localhost in your browser"
echo "  4. Login with the default admin credentials"
echo "  5. Change the default admin password"
echo ""

if [ "$EXISTING_VOLUME" = false ]; then
    log_info "Fresh database created. The application will bootstrap automatically."
else
    log_info "Using existing database. Your previous data is intact."
fi

echo ""
echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Setup complete! Happy developing! ${ROCKET}${NC}"
echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo ""
