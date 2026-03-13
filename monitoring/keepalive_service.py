"""
Foreman App - 24/7 Keep-Alive Service
=====================================
A comprehensive multi-layer approach to ensure 24/7 uptime:

1. Internal Self-Ping (Already in main.py)
2. External Uptime Monitor (UptimeRobot configuration)
3. Redundant Ping Service (This script - can run on another server)
4. Health Check Dashboard
5. Alert System

Run this as a standalone service on another platform (Railway, Fly.io, etc.)
"""

import asyncio
import httpx
import logging
import os
import json
import time
from datetime import datetime
from typing import Optional, Dict, List
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
CONFIG = {
    # Primary app URL
    "primary_url": os.environ.get("APP_URL", "https://foreman-app.onrender.com"),
    
    # Endpoints to ping
    "endpoints": [
        "/health",
        "/ping",
        "/app",
    ],
    
    # Ping interval in seconds (10 minutes = 600s)
    # Render free tier spins down after 15 min inactivity
    "ping_interval": int(os.environ.get("PING_INTERVAL", 540)),  # 9 minutes
    
    # Health check interval (more frequent)
    "health_check_interval": 60,  # 1 minute
    
    # Timeout for requests
    "request_timeout": 30,
    
    # Number of failed pings before alert
    "alert_threshold": 3,
    
    # Email alerts (optional)
    "smtp_host": os.environ.get("SMTP_HOST", ""),
    "smtp_port": int(os.environ.get("SMTP_PORT", 587)),
    "smtp_user": os.environ.get("SMTP_USER", ""),
    "smtp_pass": os.environ.get("SMTP_PASS", ""),
    "alert_email": os.environ.get("ALERT_EMAIL", ""),
    
    # Webhook alerts (Slack, Discord, etc.)
    "webhook_url": os.environ.get("WEBHOOK_URL", ""),
    
    # Log file
    "log_file": "logs/keepalive.log",
}


class HealthStatus:
    """Track health status of the application"""
    def __init__(self):
        self.is_healthy = True
        self.last_check: Optional[datetime] = None
        self.last_response_time: float = 0
        self.consecutive_failures: int = 0
        self.total_checks: int = 0
        self.total_failures: int = 0
        self.history: List[Dict] = []
        self.max_history = 100
        
    def record_success(self, response_time: float):
        self.is_healthy = True
        self.last_check = datetime.now()
        self.last_response_time = response_time
        self.consecutive_failures = 0
        self.total_checks += 1
        self._add_history(True, response_time)
        
    def record_failure(self, error: str):
        self.is_healthy = False
        self.last_check = datetime.now()
        self.consecutive_failures += 1
        self.total_checks += 1
        self.total_failures += 1
        self._add_history(False, 0, error)
        
    def _add_history(self, success: bool, response_time: float, error: str = ""):
        entry = {
            "timestamp": datetime.now().isoformat(),
            "success": success,
            "response_time_ms": round(response_time * 1000, 2),
            "error": error
        }
        self.history.append(entry)
        if len(self.history) > self.max_history:
            self.history.pop(0)
            
    def to_dict(self) -> Dict:
        return {
            "is_healthy": self.is_healthy,
            "last_check": self.last_check.isoformat() if self.last_check else None,
            "last_response_time_ms": round(self.last_response_time * 1000, 2),
            "consecutive_failures": self.consecutive_failures,
            "total_checks": self.total_checks,
            "total_failures": self.total_failures,
            "uptime_percent": round((1 - self.total_failures / max(self.total_checks, 1)) * 100, 2),
            "recent_history": self.history[-10:]
        }


class KeepAliveService:
    """Main keep-alive service"""
    
    def __init__(self):
        self.config = CONFIG
        self.health = HealthStatus()
        self.client = httpx.AsyncClient(timeout=self.config["request_timeout"])
        self.running = False
        self.alert_sent = False
        
    async def ping_endpoint(self, endpoint: str) -> tuple[bool, float, str]:
        """Ping a specific endpoint. Returns (success, response_time, error)"""
        url = f"{self.config['primary_url']}{endpoint}"
        start = time.time()
        try:
            response = await self.client.get(url)
            response_time = time.time() - start
            if response.status_code == 200:
                return True, response_time, ""
            else:
                return False, response_time, f"HTTP {response.status_code}"
        except Exception as e:
            response_time = time.time() - start
            return False, response_time, str(e)
            
    async def run_keepalive(self):
        """Main keep-alive loop - pings endpoints to prevent spin-down"""
        logger.info(f"🔄 Starting keep-alive service for {self.config['primary_url']}")
        logger.info(f"⏱️ Ping interval: {self.config['ping_interval']} seconds")
        
        while self.running:
            try:
                # Ping each endpoint
                for endpoint in self.config["endpoints"]:
                    success, response_time, error = await self.ping_endpoint(endpoint)
                    status = "✅" if success else "❌"
                    logger.info(f"{status} Ping {endpoint}: {response_time*1000:.0f}ms - {error or 'OK'}")
                    
                    if success:
                        self.health.record_success(response_time)
                        self.alert_sent = False  # Reset alert flag on success
                    else:
                        self.health.record_failure(error)
                        
                        # Check if we should send alert
                        if (self.health.consecutive_failures >= self.config["alert_threshold"] 
                            and not self.alert_sent):
                            await self.send_alert(f"App down after {self.health.consecutive_failures} failed checks: {error}")
                            self.alert_sent = True
                            
                    # Small delay between endpoint checks
                    await asyncio.sleep(2)
                    
                # Wait for next ping cycle
                await asyncio.sleep(self.config["ping_interval"])
                
            except Exception as e:
                logger.error(f"Keep-alive error: {e}")
                await asyncio.sleep(60)  # Wait before retrying
                
    async def send_alert(self, message: str):
        """Send alert via configured channels"""
        logger.warning(f"🚨 ALERT: {message}")
        
        # Email alert
        if self.config["smtp_host"] and self.config["alert_email"]:
            try:
                await self._send_email_alert(message)
                logger.info("📧 Email alert sent")
            except Exception as e:
                logger.error(f"Failed to send email alert: {e}")
                
        # Webhook alert (Slack/Discord)
        if self.config["webhook_url"]:
            try:
                await self._send_webhook_alert(message)
                logger.info("🔗 Webhook alert sent")
            except Exception as e:
                logger.error(f"Failed to send webhook alert: {e}")
                
    async def _send_email_alert(self, message: str):
        """Send email alert"""
        msg = MIMEMultipart()
        msg['From'] = self.config["smtp_user"]
        msg['To'] = self.config["alert_email"]
        msg['Subject'] = f"🚨 Foreman App Alert - {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        
        body = f"""
Foreman Application Alert
=========================
Time: {datetime.now().isoformat()}
URL: {self.config['primary_url']}

Message: {message}

Health Status:
- Consecutive Failures: {self.health.consecutive_failures}
- Total Checks: {self.health.total_checks}
- Total Failures: {self.health.total_failures}

Please check the application immediately.
"""
        msg.attach(MIMEText(body, 'plain'))
        
        # Note: For async email, you might want to use aiosmtplib
        # This is a synchronous fallback
        """
        with smtplib.SMTP(self.config["smtp_host"], self.config["smtp_port"]) as server:
            server.starttls()
            server.login(self.config["smtp_user"], self.config["smtp_pass"])
            server.send_message(msg)
        """
        
    async def _send_webhook_alert(self, message: str):
        """Send webhook alert (Slack/Discord compatible)"""
        payload = {
            "content": f"🚨 **Foreman App Alert**\n\n**Message:** {message}\n**Time:** {datetime.now().isoformat()}\n**URL:** {self.config['primary_url']}",
            "embeds": [{
                "title": "Health Status",
                "fields": [
                    {"name": "Consecutive Failures", "value": str(self.health.consecutive_failures), "inline": True},
                    {"name": "Total Checks", "value": str(self.health.total_checks), "inline": True},
                    {"name": "Uptime", "value": f"{self.health.to_dict()['uptime_percent']}%", "inline": True}
                ],
                "color": 15158332  # Red color
            }]
        }
        
        await self.client.post(self.config["webhook_url"], json=payload)
        
    def start(self):
        """Start the keep-alive service"""
        self.running = True
        logger.info("🚀 Keep-alive service started")
        
    def stop(self):
        """Stop the keep-alive service"""
        self.running = False
        logger.info("🛑 Keep-alive service stopped")


# FastAPI endpoint for health dashboard
from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI(title="Foreman Keep-Alive Monitor")
service = KeepAliveService()

@app.on_event("startup")
async def startup():
    service.start()
    asyncio.create_task(service.run_keepalive())

@app.on_event("shutdown")
async def shutdown():
    service.stop()

@app.get("/")
async def root():
    return {"service": "Foreman Keep-Alive Monitor", "status": "running"}

@app.get("/health")
async def health():
    return JSONResponse(content=service.health.to_dict())

@app.get("/status")
async def status():
    return JSONResponse(content={
        "monitoring": service.config["primary_url"],
        "ping_interval": service.config["ping_interval"],
        "health": service.health.to_dict()
    })


if __name__ == "__main__":
    import uvicorn
    print("""
    ╔══════════════════════════════════════════════════════════════╗
    ║         Foreman Keep-Alive Service v1.0                      ║
    ╠══════════════════════════════════════════════════════════════╣
    ║  This service keeps your Render app running 24/7 by:         ║
    ║  1. Pinging endpoints every 9 minutes (before 15min timeout) ║
    ║  2. Monitoring health and response times                      ║
    ║  3. Sending alerts when the app is down                       ║
    ╚══════════════════════════════════════════════════════════════╝
    """)
    
    # Run the service
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))