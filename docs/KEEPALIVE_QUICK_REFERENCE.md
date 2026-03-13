# Foreman App - Keep-Alive Quick Reference

## 🚀 Quick Setup (5 Minutes)

### Step 1: UptimeRobot (FREE)
1. Go to https://uptimerobot.com → Sign Up
2. Add Monitor:
   - Type: HTTP(s)
   - Name: `Foreman Health`
   - URL: `https://foreman-app.onrender.com/health`
   - Interval: 5 min
3. Add more monitors:
   - `https://foreman-app.onrender.com/app`
   - `https://foreman-app.onrender.com/ping`

### Step 2: Enable GitHub Actions
The workflow is already in `.github/workflows/keepalive.yml`
Just push to GitHub and it will start automatically.

### Step 3: Verify
- Check UptimeRobot dashboard for successful pings
- Check GitHub Actions tab for workflow runs

---

## 📊 Your Keep-Alive Stack

| Layer | Service | Frequency | Status |
|-------|---------|-----------|--------|
| Internal | Self-ping in main.py | 10 min | ✅ Active |
| External | UptimeRobot | 5 min | ⏳ Setup needed |
| Backup | GitHub Actions | 10 min | ✅ Ready |

---

## 🔗 Important URLs

| Purpose | URL |
|---------|-----|
| Health Check | https://foreman-app.onrender.com/health |
| Ping | https://foreman-app.onrender.com/ping |
| SSE Stream | https://foreman-app.onrender.com/api/stream |
| Main App | https://foreman-app.onrender.com/app |

---

## 🛠️ Troubleshooting

### App keeps spinning down?
```bash
# Test endpoints manually
curl https://foreman-app.onrender.com/health
curl https://foreman-app.onrender.com/ping
```

### Check logs for keep-alive pings:
- Go to Render Dashboard → Logs
- Look for "🏓 Keep-alive ping: 200"

### Verify GitHub Actions:
- Go to repo → Actions tab
- Look for "Keep-Alive Ping" workflow runs

---

## 📈 Monitoring Dashboard

After setup, monitor uptime at:
- UptimeRobot Dashboard: https://uptimerobot.com/dashboard
- GitHub Actions: https://github.com/solutionslvd/foreman-app/actions
- Render Dashboard: https://dashboard.render.com

---

## ⚡ Pro Tips

1. **Multiple monitors = Better reliability**
   - UptimeRobot checks every 5 min
   - GitHub Actions checks every 10 min
   - Internal self-ping every 10 min

2. **Set up alerts in UptimeRobot**
   - Email alerts (free)
   - Slack webhook (free)
   - Discord webhook (free)

3. **For 99.99% uptime**
   - Consider Render Starter ($7/month)
   - No spin-down on paid plans

---

## 📁 Files Created

```
├── .github/workflows/keepalive.yml    # GitHub Actions ping
├── monitoring/keepalive_service.py    # Standalone monitor service
├── docs/KEEPALIVE_SETUP_GUIDE.md      # Full setup guide
├── docs/KEEPALIVE_QUICK_REFERENCE.md  # This file
├── render.yaml                         # Updated with health check
└── render-enhanced.yaml                # Enhanced config option
```

---

## ✅ Checklist

- [ ] Create UptimeRobot account
- [ ] Add health monitor
- [ ] Add app monitor  
- [ ] Add ping monitor
- [ ] Configure email alerts
- [ ] Push GitHub workflow
- [ ] Verify all monitors working

Done! Your app now runs 24/7.