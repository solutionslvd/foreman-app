#!/usr/bin/env python3
"""
Foreman AI — Daily Report Scheduler (v2)
- Runs comprehensive 50-test diagnostic at 7:00 AM Mountain Time every day
- Startup diagnostic on launch
- Server watchdog: auto-restarts uvicorn if it goes down
- Graceful shutdown on SIGTERM/SIGINT
- Logs to /workspace/scheduler.log
"""

import asyncio
import time
import logging
import signal
import subprocess
import sys
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ── Logging Setup ──────────────────────────────────────────────────────────────
LOG_DIR = Path("/workspace/logs")
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s — %(message)s',
    handlers=[
        logging.FileHandler('/workspace/scheduler.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("ForemanScheduler")

# ── Configuration ──────────────────────────────────────────────────────────────
MOUNTAIN_OFFSET   = timedelta(hours=-7)   # MDT (UTC-7); change to -6 for MST
REPORT_HOUR       = 7
REPORT_MINUTE     = 0
SERVER_URL        = "http://127.0.0.1:8050/health"
WATCHDOG_INTERVAL = 60      # seconds between health checks
DIAGNOSTIC_TIMEOUT = 180    # seconds before diagnostic is killed
_shutdown_flag    = False

# ── Time Helpers ───────────────────────────────────────────────────────────────

def get_mountain_time() -> datetime:
    return datetime.now(timezone.utc) + MOUNTAIN_OFFSET


def seconds_until_next_report() -> tuple[float, datetime]:
    mt_now = get_mountain_time()
    next_report = mt_now.replace(
        hour=REPORT_HOUR, minute=REPORT_MINUTE, second=0, microsecond=0
    )
    if mt_now >= next_report:
        next_report += timedelta(days=1)
    return (next_report - mt_now).total_seconds(), next_report


# ── Server Watchdog ────────────────────────────────────────────────────────────

async def check_server_health() -> bool:
    """Return True if the FastAPI server is responding."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "curl", "-sf", "--max-time", "5", SERVER_URL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        return proc.returncode == 0 and b"healthy" in stdout
    except Exception:
        return False


async def restart_server():
    """Force-kill port 8050 and restart uvicorn."""
    logger.warning("🔄 Attempting server restart...")
    try:
        # Kill anything on port 8050
        await asyncio.create_subprocess_shell(
            "fuser -k 8050/tcp 2>/dev/null; sleep 2",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL
        )
        await asyncio.sleep(2)

        # Clear stale .pyc cache
        await asyncio.create_subprocess_shell(
            "find /workspace/app -name '*.pyc' -delete 2>/dev/null; "
            "find /workspace/app -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL
        )

        # Start uvicorn in background
        subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app",
             "--host", "0.0.0.0", "--port", "8050", "--workers", "1"],
            cwd="/workspace",
            stdout=open("/workspace/logs/uvicorn.log", "a"),
            stderr=subprocess.STDOUT
        )
        logger.info("✅ Server restart initiated — waiting 10s for startup...")
        await asyncio.sleep(10)

        # Verify it came back
        if await check_server_health():
            logger.info("✅ Server is back online")
        else:
            logger.error("❌ Server did not come back after restart")
    except Exception as e:
        logger.error(f"❌ Restart failed: {e}")


# ── Diagnostic Runner ──────────────────────────────────────────────────────────

def run_diagnostic(label: str = "Scheduled"):
    """Run the daily_report.py diagnostic (which delegates to health_monitor.py)."""
    logger.info(f"🏗️  [{label}] Running Foreman AI diagnostic...")
    try:
        result = subprocess.run(
            [sys.executable, '/workspace/daily_report.py'],
            capture_output=True,
            text=True,
            timeout=DIAGNOSTIC_TIMEOUT,
            cwd='/workspace'
        )
        if result.returncode == 0:
            logger.info(f"✅ [{label}] Diagnostic completed successfully")
            # Log last 800 chars of output (summary section)
            tail = result.stdout[-800:] if len(result.stdout) > 800 else result.stdout
            for line in tail.splitlines():
                logger.info(f"  {line}")
        else:
            logger.error(f"❌ [{label}] Diagnostic failed (exit {result.returncode})")
            if result.stderr:
                logger.error(result.stderr[-400:])
    except subprocess.TimeoutExpired:
        logger.error(f"❌ [{label}] Diagnostic timed out after {DIAGNOSTIC_TIMEOUT}s")
    except Exception as e:
        logger.error(f"❌ [{label}] Diagnostic error: {e}")


# ── Watchdog Loop ──────────────────────────────────────────────────────────────

async def watchdog_loop():
    """Continuously monitor server health and auto-restart if needed."""
    consecutive_failures = 0
    logger.info("🐕 Watchdog started — checking server every 60s")

    while not _shutdown_flag:
        await asyncio.sleep(WATCHDOG_INTERVAL)
        if _shutdown_flag:
            break

        healthy = await check_server_health()
        if healthy:
            if consecutive_failures > 0:
                logger.info(f"✅ Server recovered after {consecutive_failures} failed checks")
            consecutive_failures = 0
        else:
            consecutive_failures += 1
            logger.warning(f"⚠️  Server health check failed ({consecutive_failures}/3)")
            if consecutive_failures >= 3:
                logger.error("🔴 Server down — triggering auto-restart")
                await restart_server()
                consecutive_failures = 0


# ── Scheduler Loop ─────────────────────────────────────────────────────────────

async def scheduler_loop():
    """Wait until 7:00 AM MT then run the daily diagnostic."""
    global _shutdown_flag
    logger.info("🕐 Scheduler started")
    logger.info(f"📅 Reports scheduled daily at {REPORT_HOUR:02d}:{REPORT_MINUTE:02d} AM Mountain Time")

    while not _shutdown_flag:
        secs, next_report = seconds_until_next_report()
        mt_now = get_mountain_time()

        logger.info(f"⏰ Current MT: {mt_now.strftime('%Y-%m-%d %H:%M:%S')}")
        logger.info(f"📋 Next report: {next_report.strftime('%Y-%m-%d %H:%M:%S')} MT "
                    f"({secs/3600:.1f}h / {secs/60:.0f}min)")

        # Sleep in 60-second chunks so we can respond to shutdown
        while secs > 60 and not _shutdown_flag:
            await asyncio.sleep(60)
            secs, _ = seconds_until_next_report()

        if _shutdown_flag:
            break

        # It's report time!
        logger.info("🚀 7:00 AM MT — Running daily diagnostic report!")
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: run_diagnostic("7AM-Scheduled"))

        # Sleep 2 minutes to avoid double-running
        await asyncio.sleep(120)


# ── Graceful Shutdown ──────────────────────────────────────────────────────────

def handle_shutdown(signum, frame):
    global _shutdown_flag
    logger.info(f"🛑 Received signal {signum} — shutting down gracefully...")
    _shutdown_flag = True


# ── Main Entry Point ───────────────────────────────────────────────────────────

async def main():
    global _shutdown_flag

    # Register signal handlers
    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)

    mt_now = get_mountain_time()
    logger.info("=" * 60)
    logger.info("🏗️  FOREMAN AI SCHEDULER v2 — STARTING")
    logger.info(f"   Mountain Time: {mt_now.strftime('%Y-%m-%d %H:%M:%S MT')}")
    logger.info(f"   Python: {sys.version.split()[0]}")
    logger.info(f"   PID: {os.getpid()}")
    logger.info("=" * 60)

    secs, next_report = seconds_until_next_report()
    logger.info(f"Next scheduled report: {next_report.strftime('%Y-%m-%d %H:%M:%S MT')}")
    logger.info(f"Time until next report: {secs/3600:.1f}h ({secs/60:.0f}min)")

    # Run startup diagnostic immediately
    logger.info("🔍 Running startup diagnostic...")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: run_diagnostic("Startup"))

    # Launch watchdog and scheduler concurrently
    await asyncio.gather(
        watchdog_loop(),
        scheduler_loop(),
        return_exceptions=True
    )

    logger.info("👋 Foreman AI Scheduler stopped")


if __name__ == "__main__":
    asyncio.run(main())