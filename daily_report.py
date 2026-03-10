#!/usr/bin/env python3
"""
Foreman AI — Daily Diagnostic Reporter (v2)
Delegates to monitoring/health_monitor.py for comprehensive 50-test coverage.
Maintains backward compatibility with scheduler.py.
"""

import sys
import os
import subprocess
from datetime import datetime
from pathlib import Path

# Ensure workspace root is on path
sys.path.insert(0, '/workspace')

REPORT_DIR = Path("/workspace/reports")
REPORT_DIR.mkdir(exist_ok=True)


def run_full_diagnostic() -> bool:
    """
    Run the comprehensive health monitor and return True if all tests pass.
    This replaces the old 15-test diagnostic with the new 50-test framework.
    """
    print(f"🏗️  Foreman AI Daily Diagnostic — {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)
    print("Delegating to monitoring/health_monitor.py (50-test framework)")
    print("=" * 60)

    try:
        result = subprocess.run(
            [sys.executable, '/workspace/monitoring/health_monitor.py'],
            capture_output=False,   # Let output stream live to console
            text=True,
            timeout=180,
            cwd='/workspace'
        )

        if result.returncode == 0:
            print("\n✅ Daily diagnostic completed successfully")
            # Find today's report
            date_str = datetime.utcnow().strftime("%Y-%m-%d")
            report_path = REPORT_DIR / f"DAILY_REPORT_{date_str}.md"
            if report_path.exists():
                print(f"📄 Report: {report_path}")
                # Print the report to stdout so scheduler can capture it
                print("\n" + "=" * 60)
                print(report_path.read_text())
            return True
        else:
            print(f"\n❌ Diagnostic exited with code {result.returncode}")
            return False

    except subprocess.TimeoutExpired:
        print("❌ Diagnostic timed out after 180 seconds")
        return False
    except Exception as e:
        print(f"❌ Diagnostic error: {e}")
        return False


def main() -> bool:
    return run_full_diagnostic()


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)