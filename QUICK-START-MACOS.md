# 🚀 Quick Start Guide for macOS Development

Get the ABA Stack up and running on your Mac in minutes.

## Prerequisites

- **macOS** (Intel or Apple Silicon)
- **Docker Desktop** ([Download here](https://www.docker.com/products/docker-desktop))
- **Git** (comes with macOS or install via Xcode Command Line Tools)

## One-Command Setup

```bash
# Clone the repository
git clone https://github.com/YOUR-USERNAME/aba-stack.git
cd aba-stack

# Run interactive setup
./setup-dev.sh
```

The setup script will:
- ✅ Check prerequisites (Docker, Docker Compose)
- ✅ Interactively prompt for credentials:
  - Database password (or generate one automatically)
  - JWT secret (auto-generated)
  - Admin account details
  - SMTP configuration (optional)
  - AI Helper configuration (optional)
- ✅ Create Docker network and volumes
- ✅ Build and start all services
- ✅ Display access information

## Access the Application

- **Web Interface:** http://localhost
- **API:** http://localhost/api
- **Health Check:** http://localhost/api/health

**Default Admin:** Use the credentials you configured during setup.

⚠️ **Important:** Change the admin password after first login!

## Common Commands

```bash
# View services status
docker compose ps

# View logs
docker compose logs -f

# Stop services
docker compose stop

# Restart services
docker compose restart

# Rebuild after code changes
docker compose up -d --build
```

## Need More Help?

- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Complete deployment guide with troubleshooting
- **[README.md](README.md)** - Application overview and architecture
- **[docs/](docs/)** - User guides

## macOS Specific Notes

### Apple Silicon (M1/M2/M3)
Fully compatible - Docker Desktop handles architecture automatically.

### Resource Allocation
Ensure Docker Desktop has sufficient resources:
1. Open Docker Desktop → Settings → Resources
2. Recommended: 4+ CPUs, 4-8 GB Memory

### Port Conflicts
If port 80 is in use, edit `docker-compose.yml`:
```yaml
web:
  ports:
    - "8080:80"  # Access via http://localhost:8080
```

---

That's it! You're ready to develop on macOS. 🎉

If you prefer to set things up manually:

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR-USERNAME/aba-production-stack.git
cd aba-production-stack
```

### 2. Create Environment Files

```bash
# Copy the production example
cp .env.prod.example .env.prod

# Edit with your credentials
nano .env.prod
```

**Required Configuration:**
- `POSTGRES_PASSWORD` and `DB_PASSWORD` - Set same secure password
- `JWT_SECRET` - Generate with: `openssl rand -base64 32`
- `DEFAULT_ADMIN_PASSWORD` - Initial admin password (change after first login)

**Optional Configuration:**
- SMTP credentials (for email notifications)
- GitHub token (for AI helper features)

### 3. Create Docker Network and Volume

```bash
# Create the network
docker network create ron-net

# Create the database volume
docker volume create ron-stack_pgdata
```

### 4. Build and Start Services

```bash
# Build images
docker-compose build

# Start services in detached mode
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

### 5. Access the Application

Open your browser and navigate to:
- **Web Interface:** http://localhost
- **API:** http://localhost/api
- **Health Check:** http://localhost/api/health

**Default Admin Credentials:**
- Email: `admin@example.com` (or as configured in `.env.prod`)
- Password: As set in `DEFAULT_ADMIN_PASSWORD`

**⚠️ Important:** Change the default password after first login!

## Common Development Commands

### Service Management

```bash
# View all services status
docker-compose ps

# View logs (all services)
docker-compose logs -f

# View API logs only
docker-compose logs -f api

# Stop services (data preserved)
docker-compose stop

# Start stopped services
docker-compose start

# Restart services
docker-compose restart

# Rebuild after code changes
docker-compose up -d --build

# Stop and remove containers (data preserved in volumes)
docker-compose down
```

### Database Operations

```bash
# Access PostgreSQL CLI
docker-compose exec postgres psql -U postgres -d aba

# Create a backup
docker-compose exec postgres pg_dump -U postgres aba > backup-$(date +%Y%m%d).sql

# Restore from backup
cat backup-20260208.sql | docker-compose exec -T postgres psql -U postgres -d aba

# View database tables
docker-compose exec postgres psql -U postgres -d aba -c "\dt"
```

### Debugging

```bash
# Access backend container shell
docker-compose exec api sh

# Check backend environment variables
docker-compose exec api env

# Restart just the API service
docker-compose restart api

# View real-time API logs
docker-compose logs -f --tail=100 api
```

## Development Workflow

### Making Code Changes

1. **Backend changes** (`app/backend/src/`):
   ```bash
   # The backend has hot-reload enabled in development
   # Just save your changes and they'll be reflected automatically
   
   # If you need to restart:
   docker-compose restart api
   ```

2. **Frontend changes** (`app/client/src/`):
   ```bash
   # Rebuild the frontend
   cd app/client
   npm install  # if you added dependencies
   npm run build
   
   # Restart the web service
   docker-compose restart web
   ```

3. **Environment changes** (`.env.prod`):
   ```bash
   # After editing .env.prod:
   docker-compose down
   docker-compose up -d
   ```

### Testing Email Notifications

If you've configured SMTP:

```bash
# Check email configuration in logs
docker-compose logs api | grep -i smtp

# Test by creating a reviewer or triggering notifications
# through the web interface
```

### Database Schema Changes

If you modify the database schema in `app/backend/src/db.js`:

```bash
# Restart the API to apply migrations
docker-compose restart api

# Check logs to verify schema updates
docker-compose logs api | grep -i schema
```

## Troubleshooting

### Services Won't Start

```bash
# Check Docker is running
docker info

# Check logs for errors
docker-compose logs

# Remove and recreate
docker-compose down
docker-compose up -d
```

### Database Connection Errors

```bash
# Verify database is running
docker-compose ps postgres

# Check database logs
docker-compose logs postgres

# Verify passwords match in .env.prod:
# POSTGRES_PASSWORD should equal DB_PASSWORD
```

### Port Already in Use

If port 80 is already in use on your Mac:

```bash
# Edit docker-compose.yml to use a different port:
# Change: "80:80" to "8080:80"
# Then access via: http://localhost:8080
```

### Frontend Not Loading

```bash
# Check if web service is running
docker-compose ps web

# Verify nginx configuration
docker-compose exec web cat /etc/nginx/conf.d/default.conf

# Check web logs
docker-compose logs web
```

### API Not Responding

```bash
# Check API health endpoint
curl http://localhost/api/health

# Check API logs for errors
docker-compose logs api | tail -50

# Restart API
docker-compose restart api
```

## Cleaning Up

### Remove Everything (Fresh Start)

```bash
# Stop and remove containers
docker-compose down

# Remove volumes (⚠️ deletes all data!)
docker volume rm ron-stack_pgdata

# Remove network
docker network rm ron-net

# Remove images
docker-compose down --rmi all
```

### Reset Database Only

```bash
# Stop services
docker-compose down

# Remove database volume (⚠️ deletes all data!)
docker volume rm ron-stack_pgdata

# Start fresh
docker volume create ron-stack_pgdata
docker-compose up -d
```

## macOS Specific Notes

### Apple Silicon (M1/M2/M3)

The application is compatible with Apple Silicon. Docker Desktop will handle the architecture automatically.

### File System Performance

Docker Desktop on macOS uses a virtualized file system. For best performance:
- Keep the codebase on your macOS filesystem (not in Docker volumes for development)
- Use Docker volumes for database data (as configured)
- Consider using Docker Desktop's VirtioFS for faster file sharing

### Resource Allocation

Make sure Docker Desktop has enough resources:
1. Open Docker Desktop preferences
2. Resources → Advanced
3. Recommended settings:
   - CPUs: 4+
   - Memory: 4-8 GB
   - Swap: 1-2 GB

## Additional Resources

- **[SETUP-ENVIRONMENT.md](SETUP-ENVIRONMENT.md)** - Detailed environment configuration
- **[README.md](README.md)** - Full application documentation
- **[GITHUB-PUSH-READY.md](GITHUB-PUSH-READY.md)** - Security best practices

## Getting Help

If you encounter issues:

1. Check the logs: `docker-compose logs -f`
2. Verify environment variables are set correctly
3. Ensure Docker Desktop is running and has sufficient resources
4. Review the troubleshooting section above

## Happy Developing! 🚀

The setup script has automated most of the complexity. You should be up and running in minutes!

```bash
# Quick reference
./setup-dev.sh          # Run setup
docker-compose ps       # Check status
docker-compose logs -f  # View logs
open http://localhost   # Access app
```
