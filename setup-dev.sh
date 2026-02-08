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

# Check Node.js (required for frontend build)
if command_exists node; then
    NODE_VERSION=$(node --version)
    log_success "Node.js installed: $NODE_VERSION"
else
    log_error "Node.js is not installed"
    log_warn "Install Node.js from: https://nodejs.org/"
    REQUIREMENTS_MET=false
fi

# Check required port availability
if [ "$(uname)" = "Darwin" ]; then
    # macOS - check port 8080
    REQUIRED_PORT=8080
else
    # Linux - check port 80
    REQUIRED_PORT=80
fi

if lsof -Pi :$REQUIRED_PORT -sTCP:LISTEN -t >/dev/null 2>&1 || nc -z localhost $REQUIRED_PORT 2>/dev/null; then
    log_error "Port $REQUIRED_PORT is already in use"
    log_warn "Stop the service using port $REQUIRED_PORT or use: lsof -ti:$REQUIRED_PORT | xargs kill"
    REQUIREMENTS_MET=false
else
    log_success "Port $REQUIRED_PORT is available"
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
else
    # Missing file - MUST create and configure
    log_warn "$ENV_FILE not found - credential setup is required"
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    log_success "Created $ENV_FILE from template"
    ENV_NEEDS_CONFIG=true
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
            while true; do
                echo -n "Enter database password (minimum 6 characters): "
                read -s DB_PASS
                echo ""
                
                if [ ${#DB_PASS} -lt 6 ]; then
                    log_error "Password must be at least 6 characters. Please try again."
                    echo ""
                else
                    log_success "Password accepted"
                    break
                fi
            done
        fi
        
        # JWT Secret
        echo ""
        log_info "🔑 JWT Secret Generation"
        JWT_SECRET=$(openssl rand -base64 48 | tr -d "=+/" | cut -c1-64)
        log_success "Generated JWT secret"
        
        # Admin Account - Auto-configured with defaults
        echo ""
        log_info "👤 Creating Default Admin Account"
        ADMIN_EMAIL="admin@example.com"
        ADMIN_NAME="System Admin"
        ADMIN_PASS="Admin123!"
        log_success "Default admin account configured"
        
        # Detect OS and set appropriate web port
        echo ""
        log_info "🌐 Deployment Environment"
        if [ "$(uname)" = "Darwin" ]; then
            # macOS - use port 8080 (port 80 requires sudo)
            WEB_PORT=8080
            DEFAULT_URL="http://localhost:8080"
            log_info "Detected macOS - using port 8080 for local development"
        else
            # Linux - production server, use port 80
            WEB_PORT=80
            DEFAULT_URL="http://localhost"
            log_info "Detected Linux - using port 80 for production"
        fi
        
        echo -n "Frontend URL [$DEFAULT_URL]: "
        read FRONTEND_URL
        FRONTEND_URL=${FRONTEND_URL:-$DEFAULT_URL}
        
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

# Web Server Port (8080 for macOS dev, 80 for production)
WEB_PORT=$WEB_PORT

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
        # User declined credential setup - cannot continue
        echo ""
        log_error "❌ Credential configuration is required to run the application."
        log_error "❌ Cannot start services with placeholder values."
        echo ""
        log_info "Please run this script again when you're ready to configure credentials."
        exit 1
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
    log_warn "Existing database volume found"
    EXISTING_VOLUME=true
    echo ""
    log_info "⚠️  If you're setting up fresh with NEW credentials, you MUST reset the database"
    echo ""
    
    if prompt_yes_no "Reset database? (deletes all data)"; then
        log_warn "Stopping services..."
        $COMPOSE_CMD --env-file .env.prod down >/dev/null 2>&1 || true
        log_warn "Deleting database volume..."
        docker volume rm "$VOLUME_NAME"
        log_info "Creating fresh volume..."
        docker volume create "$VOLUME_NAME"
        log_success "Fresh database volume created"
        EXISTING_VOLUME=false
    else
        log_info "Keeping existing database (ensure password matches!)"
    fi
else
    log_info "Creating Docker volume '$VOLUME_NAME'..."
    docker volume create "$VOLUME_NAME"
    log_success "Volume '$VOLUME_NAME' created"
    EXISTING_VOLUME=false
fi

# ═══════════════════════════════════════════════════════════════
# STEP 6: Verify Configuration
# ═══════════════════════════════════════════════════════════════
log_step "Verifying configuration..."

if [ ! -f "$ENV_FILE" ]; then
    log_error "$ENV_FILE not found! Setup failed."
    exit 1
fi

log_success "Configuration file exists"

# ═══════════════════════════════════════════════════════════════
# STEP 6B: Build Frontend
# ═══════════════════════════════════════════════════════════════
log_step "Building frontend application..."

CLIENT_DIR="./app/client"
if [ ! -d "$CLIENT_DIR/dist" ] || prompt_yes_no "Rebuild frontend?"; then
    echo ""
    log_info "Installing frontend dependencies..."
    cd "$CLIENT_DIR"
    
    if [ ! -d "node_modules" ]; then
        npm install
    else
        log_info "Dependencies already installed"
    fi
    
    echo ""
    log_info "Building production frontend (this may take a minute)..."
    npm run build
    
    cd - > /dev/null
    
    if [ -d "$CLIENT_DIR/dist" ]; then
        log_success "Frontend built successfully"
    else
        log_error "Frontend build failed!"
        exit 1
    fi
else
    log_success "Using existing frontend build"
fi

echo ""

# ═══════════════════════════════════════════════════════════════
# STEP 7: Build and Start Docker Services
# ═══════════════════════════════════════════════════════════════
log_step "Building and starting services..."

echo ""
if [ "$EXISTING_VOLUME" = true ]; then
    log_info "Using existing database"
else
    log_info "Fresh database will be created"
fi
echo ""

if prompt_yes_no "Build and start services now?"; then
    echo ""
    log_info "Building Docker images (this may take a few minutes on first run)..."
    $COMPOSE_CMD --env-file .env.prod build
    
    echo ""
    log_info "Starting services..."
    $COMPOSE_CMD --env-file .env.prod up -d
    
    echo ""
    log_success "Services started!"
    
    # Wait for services to be healthy
    log_info "Waiting for services to be ready..."
    sleep 5
    
    # Check service status
    echo ""
    log_step "Service Status:"
    $COMPOSE_CMD --env-file .env.prod ps
    
else
    log_info "Skipping service startup. You can start manually with:"
    echo "  $COMPOSE_CMD --env-file .env.prod up -d"
fi

# ═══════════════════════════════════════════════════════════════
# STEP 7: Post-Setup Information
# ═══════════════════════════════════════════════════════════════
echo ""
log_step "Setup Complete! ${ROCKET}"
echo ""

# Display access information
WEB_PORT=$(grep "^WEB_PORT=" "$ENV_FILE" 2>/dev/null | cut -d '=' -f2 || echo "80")
FRONTEND_URL=$(grep FRONTEND_BASE_URL "$ENV_FILE" 2>/dev/null | cut -d '=' -f2)

if [ -z "$FRONTEND_URL" ] || [ "$FRONTEND_URL" = "http://localhost" ]; then
    if [ "$WEB_PORT" = "80" ]; then
        FRONTEND_URL="http://localhost"
    else
        FRONTEND_URL="http://localhost:$WEB_PORT"
    fi
fi

echo ""
echo "══════════════════════════════════════════════════════════════════════════════"
echo -e "${GREEN}${BOLD}                    🎉 SETUP COMPLETE! 🎉${NC}"
echo "══════════════════════════════════════════════════════════════════════════════"
echo ""
echo -e "${YELLOW}${BOLD}📋 LOGIN TO YOUR APPLICATION:${NC}"
echo ""
echo -e "  ${GREEN}${BOLD}URL:${NC}      $FRONTEND_URL"
echo -e "  ${GREEN}${BOLD}Username:${NC} admin@example.com"
echo -e "  ${GREEN}${BOLD}Password:${NC} Admin123!"
echo ""
echo -e "${RED}${BOLD}⚠️  IMPORTANT: Change the password immediately after first login!${NC}"
echo ""
echo "══════════════════════════════════════════════════════════════════════════════"
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
echo ""

echo -e "${BLUE}${BOLD}Documentation:${NC}"
echo -e "  ${CYAN}Setup Guide:${NC}         DEPLOYMENT.md"
echo -e "  ${CYAN}Main README:${NC}         README.md"
echo -e "  ${CYAN}Quick Start:${NC}         QUICK-START-MACOS.md"
echo ""

if [ "$EXISTING_VOLUME" = false ]; then
    log_info "Fresh database created. Application will bootstrap automatically."
else
    log_info "Using existing database. Your previous data is intact."
fi

echo ""
log_success "Ready to go! Open the URL above and login with the provided credentials."
echo ""echo ""
echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Setup complete! Happy developing! ${ROCKET}${NC}"
echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo ""
