# Foreman App - 24/7 Keep-Alive Setup Guide

## Overview

This guide provides a complete, step-by-step process to keep your Foreman app running 24/7 on Render's free tier. The solution uses multiple layers of protection to ensure maximum uptime.

## Understanding the Problem

**Render Free Tier Limitations:**
- Services spin down after 15 minutes of inactivity
- Cold starts take 30-60 seconds when the app wakes up
- This affects user experience and availability

**Solution:** Multiple keep-alive mechanisms working together.

---

## Layer 1: Internal Self-Ping (Already Implemented ✅)

Your app already has a built-in keep-alive mechanism in `app/main.py`:

```python
async def keep_alive_ping():
    """Self-ping every 10 minutes to prevent Render free tier from sleeping."""
    await asyncio.sleep(30)
    while True:
        try:
            port = os.environ.get("PORT", "8050")
            url = f"http://127.0.0.1:{port}/health"
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url)
                logger.info(f"🏓 Keep-alive ping: {resp.status_code}")
        except Exception as e:
            logger.warning(f"Keep-alive ping failed: {e}")
        await asyncio.sleep(600)  # Ping every 10 minutes
```

**Status:** ✅ Already running in your app

**Limitation:** This only works when the app is running. If Render spins down the service, this stops too.

---

## Layer 2: External Uptime Monitor (UptimeRobot - FREE)

UptimeRobot is a free service that monitors your website and pings it every 5 minutes. This keeps your app awake 24/7.

### Step-by-Step Setup:

### Step 1: Create UptimeRobot Account

1. Go to https://uptimerobot.com/
2. Click "Sign Up Free"
3. Enter your email and create a password
4. Verify your email

### Step 2: Add Your First Monitor

1. Click "+ Add New Monitor"
2. Configure as follows:
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** Foreman App - Health
   - **URL:** `https://foreman-app.onrender.com/health`
   - **Monitoring Interval:** 5 minutes (free tier default)
3. Click "Create Monitor"

### Step 3: Add Additional Monitors

Create monitors for critical endpoints:

| Monitor Name | URL | Purpose |
|-------------|-----|---------|
| Foreman - Health | `/health` | Main health check |
| Foreman - App | `/app` | Keep main app awake |
| Foreman - Ping | `/ping` | Lightweight endpoint |

### Step 4: Configure Alert Contacts

1. Go to "My Settings" → "Alert Contacts"
2. Add your email
3. (Optional) Add Slack webhook for instant notifications

### Step 5: Verify It's Working

1. Wait 10-15 minutes
2. Check the UptimeRobot dashboard
3. You should see successful pings every 5 minutes
4. Your app will now stay awake 24/7!

---

## Layer 3: Render Configuration Optimizations

### Step 1: Update render.yaml

Add these optimizations to your `render.yaml`:

```yaml
services:
  - type: web
    name: foreman-app
    runtime: python
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1
    # Health check configuration
    healthCheckPath: /health
    envVars:
      - key: PYTHON_VERSION
        value: 3.11.0
      # ... other env vars ...
```

### Step 2: Enable Health Checks (Render Dashboard)

1. Go to your Render dashboard
2. Select your service
3. Go to "Settings" → "Health & Timeout"
4. Set Health Check Path: `/health`
5. This helps Render know when your app is ready

---

## Layer 4: Redundant Keep-Alive Service (Optional)

For mission-critical applications, deploy a separate keep-alive service on another platform.

### Option A: Deploy to Railway (Recommended)

1. Create a `railway.json` file (already exists in your project)
2. The `monitoring/keepalive_service.py` can be deployed
3. Railway's free tier doesn't spin down

### Option B: Deploy to Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Create app
fly apps create foreman-monitor

# Deploy
fly deploy
```

### Option C: Use GitHub Actions (Free)

Create `.github/workflows/keepalive.yml`:

```yaml
name: Keep-Alive Ping
on:
  schedule:
    # Run every 10 minutes
    - cron: '*/10 * * * *'
  workflow_dispatch:

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping Foreman App
        run: |
          curl -s ${{ secrets.FOREMAN_URL }}/health
          curl -s ${{ secrets.FOREMAN_URL }}/ping
```

---

## Layer 5: Browser-Based Keep-Alive (For Active Users)

Add a keep-alive script in your app that runs when users have the app open:

```javascript
// Add to web/app.js
(function() {
    // Ping every 10 minutes while user has the app open
    setInterval(() => {
        fetch('/ping').catch(() => {});
    }, 600000); // 10 minutes
})();
```

**This is already implemented** in your SSE stream feature in `main.py`.

---

## Complete Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     24/7 KEEP-ALIVE SYSTEM                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐     ┌─────────────────┐                    │
│  │   UptimeRobot   │────▶│  /health        │                    │
│  │  (External)     │     │  /ping          │                    │
│  │  Every 5 min    │     │  /app           │                    │
│  └─────────────────┘     └────────┬────────┘                    │
│                                   │                              │
│  ┌─────────────────┐              │     ┌─────────────────┐     │
│  │  Internal Self  │──────────────┘     │  GitHub Actions │     │
│  │  Ping (main.py) │                    │  (Backup)       │     │
│  │  Every 10 min   │                    │  Every 10 min   │     │
│  └─────────────────┘                    └─────────────────┘     │
│                                                                  │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    RENDER SERVICE                        │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │    │
│  │  │  FastAPI    │  │  Keep-Alive │  │  SSE Stream  │     │    │
│  │  │  Backend    │  │  Task       │  │  (30s heart) │     │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │    │
│  │                                                         │    │
│  │  Status: RUNNING 24/7 ✅                                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quick Setup Checklist

### Immediate Actions (5 minutes):
- [ ] Create UptimeRobot account
- [ ] Add monitor for `https://foreman-app.onrender.com/health`
- [ ] Add monitor for `https://foreman-app.onrender.com/app`
- [ ] Configure email alerts

### Recommended Actions (15 minutes):
- [ ] Add Slack/Discord webhook for instant alerts
- [ ] Set up GitHub Actions backup ping (see code below)
- [ ] Enable Render health checks in dashboard

### Optional Advanced Setup (30 minutes):
- [ ] Deploy keepalive_service.py to Railway/Fly.io
- [ ] Configure email SMTP for alerts
- [ ] Set up monitoring dashboard

---

## GitHub Actions Setup

Create this file at `.github/workflows/keepalive.yml`:

```yaml
name: Keep-Alive Ping

on:
  schedule:
    # Ping every 10 minutes (Render spins down after 15 min)
    - cron: '*/10 * * * *'
  workflow_dispatch:

jobs:
  ping:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Ping Health Endpoint
        run: |
          response=$(curl -s -o /dev/null -w "%{http_code}" https://foreman-app.onrender.com/health)
          echo "Health check response: $response"
          if [ "$response" != "200" ]; then
            echo "::warning::Health check returned $response"
          fi
          
      - name: Ping App Endpoint
        run: |
          response=$(curl -s -o /dev/null -w "%{http_code}" https://foreman-app.onrender.com/app)
          echo "App ping response: $response"
```

---

## Monitoring & Alerts

### Health Check Endpoints

Your app has these endpoints for monitoring:

| Endpoint | Purpose | Response |
|----------|---------|----------|
| `/health` | Full health check | `{"status":"healthy",...}` |
| `/ping` | Lightweight ping | `{"pong":true}` |
| `/api/stream` | SSE stream with heartbeats | Event stream |

### Setting Up Alerts

1. **UptimeRobot Alerts:**
   - Email (free)
   - Slack (free via webhook)
   - Discord (free via webhook)
   - SMS (paid)

2. **Render Alerts:**
   - Built-in deployment notifications
   - Service down alerts

3. **Custom Alerts:**
   - Use `monitoring/keepalive_service.py`
   - Configure email SMTP
   - Add webhook URLs

---

## Troubleshooting

### App Still Spinning Down?

1. **Check UptimeRobot is active:**
   - Dashboard should show recent successful pings
   - Verify correct URL (no typos)

2. **Check Render logs:**
   - Look for "Keep-alive ping" messages
   - Check for errors

3. **Verify health endpoints:**
   ```bash
   curl https://foreman-app.onrender.com/health
   curl https://foreman-app.onrender.com/ping
   ```

4. **Check Render service type:**
   - Ensure it's a "Web Service" not "Background Worker"
   - Web services stay alive longer

### Cold Starts Still Happening?

Even with keep-alive, cold starts can occur during:
- Render maintenance windows
- Deployments
- Resource constraints

**Solutions:**
1. Upgrade to Render's Starter plan ($7/month) - no spin-down
2. Deploy to Railway (free tier doesn't spin down)
3. Use multiple ping services for redundancy

---

## Cost Comparison

| Solution | Cost | Reliability |
|----------|------|-------------|
| UptimeRobot only | Free | 95%+ uptime |
| UptimeRobot + GitHub Actions | Free | 99%+ uptime |
| Multiple ping services | Free | 99.9%+ uptime |
| Render Starter Plan | $7/month | 99.99% uptime |
| Railway Pro Plan | $5/month | 99.99% uptime |

---

## Summary

Your Foreman app now has **three layers of keep-alive protection**:

1. ✅ **Internal Self-Ping** - Built into the app, pings every 10 minutes
2. ⏳ **UptimeRobot** - External free monitoring, pings every 5 minutes  
3. ⏳ **GitHub Actions** - Backup ping every 10 minutes

**Next Steps:**
1. Set up UptimeRobot (5 minutes)
2. Add GitHub Actions workflow (2 minutes)
3. Monitor for 24 hours
4. Enjoy 24/7 uptime! 🎉