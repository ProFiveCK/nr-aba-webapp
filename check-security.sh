#!/bin/bash

# Pre-commit Security Check Script
# Run this before pushing to GitHub to ensure no secrets are exposed

set -e

echo "🔒 Running security checks..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ISSUES_FOUND=0

# Check 1: Look for .env files that would be committed
echo "1️⃣  Checking for .env files in git..."
ENV_FILES=$(git ls-files | grep -E '\.env$|\.env\.prod$|\.env\.dev$|\.env\.local$' || true)
if [ -n "$ENV_FILES" ]; then
    echo -e "${RED}❌ FAIL: Found .env files that would be committed:${NC}"
    echo "$ENV_FILES"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
    echo -e "${GREEN}✅ PASS: No .env files in git${NC}"
fi
echo ""

# Check 2: Look for potential secrets in staged files
echo "2️⃣  Checking for hardcoded secrets..."
PATTERNS=(
    'password\s*=\s*["\x27][^"\x27]{6,}'
    'secret\s*=\s*["\x27][^"\x27]{10,}'
    'api[_-]?key\s*=\s*["\x27][^"\x27]{10,}'
    'token\s*=\s*["\x27][^"\x27]{20,}'
    'ghp_[a-zA-Z0-9]{36}'
    'AKIA[0-9A-Z]{16}'
    'smtp.*pass.*=.*["\x27][^"\x27]+'
)

SECRETS_FOUND=false
for pattern in "${PATTERNS[@]}"; do
    MATCHES=$(git diff --cached | grep -iE "$pattern" || true)
    if [ -n "$MATCHES" ]; then
        SECRETS_FOUND=true
        echo -e "${RED}❌ Found potential secret matching pattern: $pattern${NC}"
        echo "$MATCHES" | head -3
        echo ""
    fi
done

if [ "$SECRETS_FOUND" = true ]; then
    echo -e "${RED}❌ FAIL: Potential secrets found in staged changes${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
    echo -e "${GREEN}✅ PASS: No obvious secrets in staged changes${NC}"
fi
echo ""

# Check 3: Look for SQL dumps
echo "3️⃣  Checking for SQL dumps..."
SQL_FILES=$(git ls-files | grep '\.sql$' || true)
if [ -n "$SQL_FILES" ]; then
    echo -e "${RED}❌ FAIL: Found SQL files that would be committed:${NC}"
    echo "$SQL_FILES"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
    echo -e "${GREEN}✅ PASS: No SQL dumps in git${NC}"
fi
echo ""

# Check 4: Check for large files (backups, archives)
echo "4️⃣  Checking for large files..."
LARGE_FILES=$(git ls-files | xargs -I {} sh -c 'if [ -f "{}" ] && [ $(stat -f%z "{}" 2>/dev/null || stat -c%s "{}" 2>/dev/null) -gt 10485760 ]; then echo "{}"; fi' || true)
if [ -n "$LARGE_FILES" ]; then
    echo -e "${YELLOW}⚠️  WARNING: Found large files (>10MB):${NC}"
    echo "$LARGE_FILES"
    echo -e "${YELLOW}Consider using Git LFS or excluding these files${NC}"
else
    echo -e "${GREEN}✅ PASS: No unusually large files${NC}"
fi
echo ""

# Check 5: Verify .gitignore exists and has required patterns
echo "5️⃣  Checking .gitignore..."
if [ ! -f ".gitignore" ]; then
    echo -e "${RED}❌ FAIL: No .gitignore file found${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
    REQUIRED_PATTERNS=("\.env" "\.env\.prod" "archive/" "\*\.sql" "node_modules/")
    MISSING_PATTERNS=()
    
    for pattern in "${REQUIRED_PATTERNS[@]}"; do
        if ! grep -q "$pattern" .gitignore; then
            MISSING_PATTERNS+=("$pattern")
        fi
    done
    
    if [ ${#MISSING_PATTERNS[@]} -gt 0 ]; then
        echo -e "${RED}❌ FAIL: Missing patterns in .gitignore:${NC}"
        printf '%s\n' "${MISSING_PATTERNS[@]}"
        ISSUES_FOUND=$((ISSUES_FOUND + 1))
    else
        echo -e "${GREEN}✅ PASS: .gitignore has required patterns${NC}"
    fi
fi
echo ""

# Check 6: Look for backup files
echo "6️⃣  Checking for backup files..."
BACKUP_FILES=$(git ls-files | grep -E '\.backup$|\.bak$|\.old$|\.orig$' || true)
if [ -n "$BACKUP_FILES" ]; then
    echo -e "${YELLOW}⚠️  WARNING: Found backup files:${NC}"
    echo "$BACKUP_FILES"
    echo -e "${YELLOW}These may contain sensitive data${NC}"
else
    echo -e "${GREEN}✅ PASS: No backup files in git${NC}"
fi
echo ""

# Final result
echo "═══════════════════════════════════════"
if [ $ISSUES_FOUND -eq 0 ]; then
    echo -e "${GREEN}✅ All security checks passed!${NC}"
    echo -e "${GREEN}Safe to push to GitHub${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}❌ Found $ISSUES_FOUND critical issue(s)${NC}"
    echo -e "${RED}DO NOT push to GitHub until these are resolved${NC}"
    echo ""
    echo "To fix:"
    echo "  1. Remove sensitive files from git: git rm --cached <file>"
    echo "  2. Add patterns to .gitignore"
    echo "  3. Run this script again"
    echo ""
    exit 1
fi
