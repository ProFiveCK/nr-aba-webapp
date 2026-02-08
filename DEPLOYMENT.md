# 🚀 ABA Stack Deployment Guide

Complete guide for deploying the ABA Stack in development or production environments.

---

## 📋 Prerequisites

### Required Software

- **Docker** (v20.10+)
  - Linux: `curl -fsSL https://get.docker.com | sh`
  - macOS: [Docker Desktop](https://www.docker.com/products/docker-desktop)
  - Windows: [Docker Desktop](https://www.docker.com/products/docker-desktop)

- **Docker Compose** (v2.0+)
  - Usually included with Docker Desktop
  - Linux: `sudo apt-get install docker-compose-plugin`
  - Verify: `docker compose version`

### System Requirements

| Environment | CPU | RAM | Disk |
|------------|-----|-----|------|
| Development | 2+ cores | 4GB | 10GB |
| Production | 4+ cores | 8GB | 50GB |

### Network Requirements

- **Development:** Port 80 available
- **Production:** Port 80 (HTTP) + Port 9001 (Portainer Agent)
- Outbound SMTP access (port 587) for email notifications

---

## 🎯 Quick Start

### Development (macOS/Linux)

```bash
# Clone the repository
git clone https://github.com/YOUR-USERNAME/aba-stack.git
cd aba-stack

# Run the interactive setup script
./setup-dev.sh
```

The script will:
- ✅ Check prerequisites
- ✅ Prompt for database credentials
- ✅ Generate JWT secrets
- ✅ Configure admin account
- ✅ Set up SMTP (optional)
- ✅ Create Docker network and volumes
- ✅ Build and start all services

**Access:** http://localhost

---

## 🔧 Manual Deployment

### 1. Clone Repository

```bash
git clone https://github.com/YOUR-USERNAME/aba-stack.git
cd aba-stack
```

### 2. Create Environment Configuration

```bash
cp .env.prod.example .env.prod
```

Edit `.env.prod` and configure:

#### Database Credentials (Required)
```bash
POSTGRES_PASSWORD=<strong-password>
DB_PASSWORD=<same-as-postgres-password>
```

Generate a strong password:
```bash
openssl rand -base64 24
```

#### Authentication (Required)
```bash
JWT_SECRET=<random-secret>
```

Generate JWT secret:
```bash
openssl rand -base64 32
```

#### Admin Account (Required)
```bash
DEFAULT_ADMIN_EMAIL=admin@example.com
DEFAULT_ADMIN_PASSWORD=<change-on-first-login>
DEFAULT_ADMIN_NAME=Admin User
```

#### Application Settings
```bash
FRONTEND_BASE_URL=http://localhost  # Or your production domain
PROD_WEB_PORT=9000                  # Internal port (don't change)
```

#### Email/SMTP (Optional - for notifications)
```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=notifications@example.com
SMTP_PASS=<smtp-password>
SMTP_FROM=notifications@example.com
```

#### AI Helper (Optional)
```bash
AI_HELPER_ENABLED=true
AI_PROVIDER=github
GITHUB_TOKEN=<your-github-token>
```

### 3. Create Docker Network

```bash
docker network create ron-net
```

### 4. Create Database Volume

```bash
docker volume create ron-stack_pgdata
```

### 5. Build and Start Services

```bash
# Build images
docker compose build

# Start in detached mode
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f
```

### 6. Verify Deployment

```bash
# Check health endpoint
curl http://localhost/api/health

# Should return: {"status":"ok"}
```

**Access the application:** http://localhost

---

## 🔐 Security Configuration

### Change Default Admin Password

1. Login with default credentials
2. Go to Admin → Settings
3. Change your password immediately
4. Update `.env.prod` and remove or comment out `DEFAULT_ADMIN_PASSWORD`

### Secure Your Environment File

```bash
# Ensure .env files are not tracked in git
git check-ignore .env.prod

# If not ignored, add to .gitignore
echo ".env.prod" >> .gitignore
```

### Regular Security Practices

- Rotate database passwords quarterly
- Regenerate JWT secrets after security incidents
- Use separate credentials for dev/staging/production
- Enable HTTPS in production (use reverse proxy like Nginx or Caddy)

---

## 🏭 Production Deployment

### Production Server Setup

**Requirements:**
- Linux server (Ubuntu 20.04+ or Debian 11+)
- Docker and Docker Compose installed
- SSH access with sudo privileges
- Domain name (optional but recommended)

### Initial Production Deployment

1. **SSH into production server:**
```bash
ssh user@your-server.com
```

2. **Install Docker:**
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

3. **Clone repository:**
```bash
cd /home/fmis/Stacks
git clone https://github.com/YOUR-USERNAME/aba-stack.git
cd aba-stack
```

4. **Run setup script:**
```bash
./setup-dev.sh
```

Or configure manually following the Manual Deployment steps above.

5. **Configure production domain (if using):**

Edit `.env.prod`:
```bash
FRONTEND_BASE_URL=https://your-domain.com
```

6. **Set up reverse proxy (recommended for HTTPS):**

Example Nginx configuration:
```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Production Environment Variables

Use strong, unique values for production:

```bash
# Generate secure credentials
POSTGRES_PASSWORD=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 48)

# Update .env.prod with these values
```

### Backup Configuration

Production deployments should include regular backups:

```bash
# Database backup (runs daily via cron)
docker compose exec postgres pg_dump -U postgres aba > backup-$(date +%Y%m%d).sql

# Volume backup
docker run --rm -v ron-stack_pgdata:/data -v $(pwd)/backups:/backup \
  alpine tar czf /backup/pgdata-$(date +%Y%m%d).tar.gz -C /data .
```

Add to crontab:
```bash
0 2 * * * /home/fmis/Stacks/aba-stack/scripts/backup-and-monitor.sh
```

---

## 🔄 Updates and Maintenance

### Pulling Updates

```bash
cd /path/to/aba-stack

# Pull latest code
git pull origin main

# Rebuild and restart
docker compose build
docker compose up -d

# Check logs
docker compose logs -f
```

### Database Migrations

The database schema is automatically managed by the backend. Schema updates are applied on startup.

### Rollback Procedure

If an update causes issues:

```bash
# Stop current version
docker compose down

# Restore previous code
git checkout <previous-commit>

# Restore database from backup (if needed)
cat backup-YYYYMMDD.sql | docker compose exec -T postgres psql -U postgres -d aba

# Restart
docker compose up -d
```

---

## 🐛 Troubleshooting

### Services Won't Start

```bash
# Check Docker is running
docker info

# Check logs for errors
docker compose logs

# Check disk space
df -h

# Check port conflicts
sudo netstat -tlnp | grep :80
```

### Database Connection Issues

```bash
# Verify database is running
docker compose ps postgres

# Check database logs
docker compose logs postgres

# Verify credentials in .env.prod
cat .env.prod | grep -i password

# Ensure POSTGRES_PASSWORD equals DB_PASSWORD
```

### Frontend Not Loading

```bash
# Check web service
docker compose ps web

# Check nginx logs
docker compose logs web

# Verify frontend files exist
docker compose exec web ls -la /usr/share/nginx/html
```

### API Errors

```bash
# Check API health
curl http://localhost/api/health

# Check API logs
docker compose logs api | tail -100

# Restart API
docker compose restart api
```

### Email Not Sending

```bash
# Check SMTP configuration in .env.prod
cat .env.prod | grep SMTP

# Test SMTP connection
docker compose exec api nc -zv $SMTP_HOST $SMTP_PORT

# Check API logs for email errors
docker compose logs api | grep -i smtp
```

---

## 📊 Monitoring

### Health Checks

```bash
# API health
curl http://localhost/api/health

# Database health
docker compose exec postgres pg_isready -U postgres

# Service status
docker compose ps
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api
docker compose logs -f postgres
docker compose logs -f web

# Last 100 lines
docker compose logs --tail=100 api
```

### Resource Usage

```bash
# Container stats
docker stats

# Disk usage
docker system df

# Volume size
docker volume inspect ron-stack_pgdata
```

---

## 🔧 Advanced Configuration

### Custom Port

Edit `docker-compose.yml`:
```yaml
services:
  web:
    ports:
      - "8080:80"  # Change 80 to your desired port
```

### External Database

To use an external PostgreSQL database instead of the containerized one:

1. Update `.env.prod`:
```bash
DB_HOST=external-db-host.com
DB_PORT=5432
DB_USER=aba_user
DB_PASSWORD=<password>
DB_NAME=aba
```

2. Comment out or remove the `postgres` service from `docker-compose.yml`

### Email Testing Mode

Disable email sending during testing:

1. Login as admin
2. Go to Reviewer Settings
3. Enable "Testing Mode" to suppress email notifications

---

## 📚 Additional Resources

- **[README.md](README.md)** - Application overview and architecture
- **[QUICK-START-MACOS.md](QUICK-START-MACOS.md)** - macOS-specific development setup
- **[PRODUCTION-MIGRATION-GUIDE.md](PRODUCTION-MIGRATION-GUIDE.md)** - Migrating from old to new stack
- **[docs/](docs/)** - User guides for submitters, reviewers, and administrators

---

## 🆘 Getting Help

If you encounter issues:

1. Check the troubleshooting section above
2. Review logs: `docker compose logs -f`
3. Verify environment configuration
4. Ensure prerequisites are met
5. Check Docker resources (CPU, memory, disk)

---

**Last Updated:** February 8, 2026  
**Version:** 1.0
