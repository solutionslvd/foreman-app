# 🚀 Deployment Guide: The Foreman

This guide provides step-by-step instructions to push your project to GitHub and deploy it to your existing custom domain.

---

## 📋 Prerequisites Checklist

Before starting, ensure you have:

- [ ] **GitHub Account** - Free or paid tier
- [ ] **Git installed locally** - [Download Git](https://git-scm.com/downloads)
- [ ] **Code editor** - VS Code, etc.
- [ ] **Domain name** - Purchased from a registrar (GoDaddy, Namecheap, Google Domains, etc.)
- [ ] **Deployment platform account** - Choose one:
  - [Vercel](https://vercel.com) (Recommended for this project)
  - [Railway](https://railway.app) (Good for FastAPI backends)
  - [Render](https://render.com) (Free tier available)
  - [Netlify](https://netlify.com) (Best for static sites)
  - [GitHub Pages](https://pages.github.com) (Static sites only)

---

## Step 1: Initialize Git Repository

### 1.1 Initialize Git in Your Project

```bash
# Navigate to your project directory
cd /path/to/your/project

# Initialize git repository
git init

# Check status
git status
```

### 1.2 Create .gitignore File

Create a `.gitignore` file to exclude unnecessary files:

```bash
# Create .gitignore
cat > .gitignore << 'EOF'
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg

# Virtual environments
venv/
ENV/
env/
.venv/

# Environment variables
.env
.env.local
.env.production

# IDE
.idea/
.vscode/
*.swp
*.swo
*~

# OS files
.DS_Store
Thumbs.db

# Logs
*.log
logs/

# Database
*.db
*.sqlite3

# Secrets
secrets/
*.pem
*.key

# Node modules (if any frontend build)
node_modules/

# Build outputs
.webpack-cache/
EOF
```

### 1.3 Create README.md

```bash
cat > README.md << 'EOF'
# The Foreman

AI-powered construction management platform for Alberta contractors.

## Features

- 📊 Dashboard with KPIs
- 📄 Invoicing & Expenses
- 👷 Payroll Management
- 🏗️ Project Tracking
- ✅ Compliance Management
- 📁 Document Management
- 🤖 AI Assistant

## Tech Stack

- **Backend**: FastAPI (Python 3.11)
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Database**: SQLite (local), PostgreSQL (production)

## Getting Started

```bash
# Install dependencies
pip install -r requirements.txt

# Run development server
uvicorn app.main:app --reload --port 8050
```

## License

MIT License
EOF
```

---

## Step 2: Commit and Push to GitHub

### 2.1 Stage All Files

```bash
# Add all files to staging
git add .

# Or add specific files
git add app/ web/ requirements.txt

# Check what will be committed
git status
```

### 2.2 Create Initial Commit

```bash
# Create commit with message
git commit -m "Initial commit: The Foreman construction management platform

Features:
- Dashboard with financial KPIs
- Invoicing and expense tracking
- Payroll management
- Project management
- Compliance tracking (WCB, permits, incidents)
- Document management
- AI assistant integration
- Admin panel"
```

### 2.3 Connect to GitHub Remote

```bash
# Add your GitHub repository as remote
# Replace YOUR_USERNAME and YOUR_REPO with your actual values
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# Verify remote
git remote -v
```

### 2.4 Push to GitHub

```bash
# Set main branch and push
git branch -M main
git push -u origin main

# If you get authentication errors, use Personal Access Token:
# Go to GitHub → Settings → Developer settings → Personal access tokens → Generate new token
# Use token as password when prompted
```

### 2.5 Using SSH Instead (Recommended)

```bash
# Change remote URL to SSH
git remote set-url origin git@github.com:YOUR_USERNAME/YOUR_REPO.git

# Push
git push -u origin main
```

---

## Step 3: Choose Deployment Platform

Since your project has a **FastAPI backend**, you need a platform that supports Python backends. Here are your best options:

### Option A: Vercel (Recommended)

Vercel is great for full-stack applications with serverless functions.

#### Create vercel.json

```json
{
  "version": 2,
  "builds": [
    {
      "src": "app/main.py",
      "use": "@vercel/python"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "app/main.py"
    }
  ]
}
```

#### Create requirements.txt (if not exists)

```txt
fastapi>=0.104.0
uvicorn>=0.24.0
python-multipart>=0.0.6
jinja2>=3.1.2
aiofiles>=23.2.1
python-dotenv>=1.0.0
httpx>=0.25.0
openai>=1.3.0
pydantic>=2.5.0
pydantic-settings>=2.1.0
sqlalchemy>=2.0.23
aiosqlite>=0.19.0
stripe>=7.0.0
```

#### Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up with GitHub
2. Click "Add New Project"
3. Import your GitHub repository
4. Vercel will auto-detect the framework
5. Configure environment variables (see Step 5)
6. Click "Deploy"

### Option B: Railway (Great for FastAPI)

Railway is excellent for Python backends with database support.

#### Create railway.json (optional)

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "uvicorn app.main:app --host 0.0.0.0 --port $PORT",
    "healthcheckPath": "/",
    "healthcheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

#### Create Procfile (alternative)

```
web: uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

#### Deploy to Railway

1. Go to [railway.app](https://railway.app) and sign up with GitHub
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Select your repository
5. Railway will auto-detect Python and install dependencies
6. Set environment variables
7. Deploy!

### Option C: Render (Free Tier Available)

#### Create render.yaml

```yaml
services:
  - type: web
    name: the-foreman
    env: python
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: PYTHON_VERSION
        value: 3.11.0
      - key: OPENAI_API_KEY
        sync: false
    plan: free
```

#### Deploy to Render

1. Go to [render.com](https://render.com) and sign up with GitHub
2. Click "New" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Name**: the-foreman
   - **Environment**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Add environment variables
6. Click "Create Web Service"

---

## Step 4: Connect Custom Domain

### 4.1 Add Domain in Deployment Platform

#### Vercel
1. Go to your project → Settings → Domains
2. Add your custom domain (e.g., `foremanapp.ca`)
3. Vercel will show DNS records to configure

#### Railway
1. Go to your project → Settings → Domains
2. Add custom domain
3. Railway provides a CNAME target

#### Render
1. Go to your service → Settings → Custom Domain
2. Add your domain
3. Verify ownership

### 4.2 Configure DNS Records

Go to your domain registrar (GoDaddy, Namecheap, etc.) and configure DNS:

#### For Root Domain (e.g., `foremanapp.ca`)

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | @ | 76.76.21.21 (Vercel) | 3600 |
| or CNAME | @ | cname.vercel-dns.com | 3600 |

#### For Subdomain (e.g., `app.foremanapp.ca`)

| Type | Name | Value | TTL |
|------|------|-------|-----|
| CNAME | app | your-app.vercel.app | 3600 |

#### Platform-Specific DNS Values

**Vercel:**
```
A Record: @ → 76.76.21.21
CNAME: www → cname.vercel-dns.com
```

**Railway:**
```
CNAME: @ → your-app.up.railway.app
```

**Render:**
```
A Record: @ → 216.24.57.1
A Record: @ → 216.24.57.2
CNAME: www → your-app.onrender.com
```

### 4.3 Wait for DNS Propagation

DNS changes can take 5 minutes to 48 hours to propagate. Check with:

```bash
# Check DNS propagation
nslookup your-domain.com

# Or use dig
dig your-domain.com

# Online tools:
# https://dnschecker.org
# https://whatsmydns.net
```

---

## Step 5: Configure Environment Variables

### 5.1 Create .env.example (for reference)

```bash
cat > .env.example << 'EOF'
# Required
OPENAI_API_KEY=sk-your-openai-key
SECRET_KEY=your-secret-key-here

# Optional
DATABASE_URL=postgresql://user:pass@host:5432/db
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# App Settings
APP_ENV=production
DEBUG=false
ALLOWED_ORIGINS=https://your-domain.com
EOF
```

### 5.2 Set Variables in Deployment Platform

**Vercel:**
```bash
# Using Vercel CLI
vercel env add OPENAI_API_KEY
vercel env add SECRET_KEY
```

**Railway:**
```bash
# Using Railway CLI
railway variables set OPENAI_API_KEY=sk-xxx
railway variables set SECRET_KEY=xxx
```

**Render:**
- Go to Environment tab in dashboard
- Add each variable manually

---

## Step 6: Verification Steps

### 6.1 Check Deployment Status

```bash
# For Vercel
vercel ls

# Check deployment logs
vercel logs
```

### 6.2 Test Your Application

```bash
# Health check
curl https://your-domain.com/

# Test API endpoint
curl https://your-domain.com/api/docs

# Test specific endpoints
curl https://your-domain.com/app
```

### 6.3 Verify SSL Certificate

Your deployment platform should automatically provision SSL certificates:

1. Visit `https://your-domain.com`
2. Check for padlock icon in browser
3. Verify certificate details

### 6.4 Test All Pages

Visit these URLs and verify they load correctly:
- `https://your-domain.com/` (Landing page)
- `https://your-domain.com/app` (Main application)
- `https://your-domain.com/admin` (Admin panel)
- `https://your-domain.com/api/docs` (API documentation)

---

## Step 7: Set Up Automatic Deployments

### 7.1 Configure CI/CD (Automatic)

Most platforms automatically deploy when you push to main branch:

**Vercel:** Automatic by default
**Railway:** Automatic by default
**Render:** Automatic by default

### 7.2 Manual Deployment Trigger

```bash
# Make changes and commit
git add .
git commit -m "Update feature X"
git push origin main

# Platform will automatically:
# 1. Detect the push
# 2. Build the application
# 3. Deploy to production
```

### 7.3 Branch Previews (Optional)

**Vercel** automatically creates preview deployments for pull requests:
1. Create a branch: `git checkout -b feature/new-feature`
2. Push: `git push origin feature/new-feature`
3. Create PR on GitHub
4. Vercel creates a preview URL

---

## Quick Reference Commands

```bash
# Initialize git
git init

# Add all files
git add .

# Commit
git commit -m "Your message"

# Push to GitHub
git push origin main

# Check remote
git remote -v

# View logs (Vercel)
vercel logs

# View logs (Railway)
railway logs
```

---

## Troubleshooting

### Build Fails
- Check `requirements.txt` for correct dependencies
- Ensure Python version is specified
- Check build logs for specific errors

### Application Won't Start
- Verify start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Check for missing environment variables
- Review application logs

### Domain Not Working
- Verify DNS records are correct
- Wait for DNS propagation (up to 48 hours)
- Check SSL certificate status

### Environment Variables Missing
- Add all required variables in platform dashboard
- Restart the application after adding variables

---

## Next Steps

1. ✅ Initialize git and commit files
2. ✅ Push to GitHub
3. ✅ Connect deployment platform
4. ✅ Configure custom domain
5. ✅ Set environment variables
6. ✅ Verify deployment
7. ✅ Set up monitoring (optional)

Good luck with your deployment! 🎉