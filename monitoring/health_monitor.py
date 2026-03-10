"""
The Foreman — Advanced Health Monitor
Runs comprehensive checks across all platform systems.
Designed to be called by the daily scheduler and on-demand.
"""

import urllib.request
import urllib.error
import json
import time
import os
import sys
from datetime import datetime, timezone
from typing import Dict, List, Tuple, Optional, Any

BASE_URL = os.getenv("FOREMAN_BASE_URL", "http://localhost:8050")
REPORT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "reports")

# ── HTTP Helper ───────────────────────────────────────────────────────────────

def http(path: str, token: str = "", method: str = "GET",
         body: Optional[Dict] = None, timeout: int = 8) -> Tuple[int, float, Any]:
    url = BASE_URL + path
    req = urllib.request.Request(url, method=method)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    if body:
        req.data = json.dumps(body).encode()
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            ms = round((time.time() - t0) * 1000, 1)
            try:
                data = json.loads(r.read())
            except Exception:
                data = {}
            return r.status, ms, data
    except urllib.error.HTTPError as e:
        ms = round((time.time() - t0) * 1000, 1)
        try:
            data = json.loads(e.read())
        except Exception:
            data = {"http_error": e.code}
        return e.code, ms, data
    except Exception as ex:
        ms = round((time.time() - t0) * 1000, 1)
        return 0, ms, {"connection_error": str(ex)}


# ── Auth Setup ────────────────────────────────────────────────────────────────

def get_tokens() -> Tuple[str, str]:
    """Get user and admin tokens for testing."""
    # Register monitor user if needed
    http("/api/users/register", method="POST", body={
        "email": "monitor@foreman.ai",
        "password": "Monitor2024!",
        "contact_name": "System Monitor",
        "business_name": "Foreman Monitor",
        "trade": "general_contracting"
    })

    _, _, login = http("/api/users/login", method="POST", body={
        "email": "monitor@foreman.ai",
        "password": "Monitor2024!"
    })
    user_token = login.get("token", "")

    _, _, admin_login = http("/api/admin/login", method="POST", body={
        "username": "admin",
        "password": os.getenv("ADMIN_PASSWORD", "ChangeMe2024!")
    })
    admin_token = admin_login.get("token", "")

    return user_token, admin_token


# ── Test Suite ────────────────────────────────────────────────────────────────

class TestResult:
    def __init__(self, name: str, category: str, status: str,
                 code: int, ms: float, detail: str = "", severity: str = "info"):
        self.name = name
        self.category = category
        self.status = status   # PASS / FAIL / WARN / SKIP
        self.code = code
        self.ms = ms
        self.detail = detail
        self.severity = severity  # critical / high / medium / low / info

    @property
    def icon(self):
        return {"PASS": "✅", "FAIL": "❌", "WARN": "⚠️", "SKIP": "⏭️"}.get(self.status, "❓")


def run_all_tests(user_token: str, admin_token: str) -> List[TestResult]:
    results = []

    def t(name: str, category: str, path: str, token: str = "",
          method: str = "GET", body: Optional[Dict] = None,
          expect: int = 200, severity: str = "high",
          detail_fn=None):
        code, ms, data = http(path, token, method, body)
        ok = code == expect
        status = "PASS" if ok else ("WARN" if code in [422, 403] else "FAIL")
        detail = ""
        if detail_fn and ok:
            try:
                detail = detail_fn(data)
            except Exception:
                pass
        elif not ok:
            detail = str(data.get("detail", data))[:80]
        results.append(TestResult(name, category, status, code, ms, detail, severity))

    U = user_token
    A = admin_token
    Y = datetime.now().strftime("%Y")

    # ── Infrastructure ────────────────────────────────────────────────────────
    t("Server Health",          "Infrastructure", "/health",                    severity="critical",
      detail_fn=lambda d: f"status={d.get('status')}")
    t("OpenAPI Schema",         "Infrastructure", "/openapi.json",              severity="medium",
      detail_fn=lambda d: f"{len(d.get('paths',{}))} endpoints registered")

    # ── Authentication ────────────────────────────────────────────────────────
    t("User Login",             "Auth", "/api/users/login",   method="POST",
      body={"email": "monitor@foreman.ai", "password": "Monitor2024!"},
      detail_fn=lambda d: f"role={d.get('user',{}).get('role','?')}", severity="critical")
    t("Admin Login",            "Auth", "/api/admin/login",   method="POST",
      body={"username": "admin", "password": os.getenv("ADMIN_PASSWORD","ChangeMe2024!")},
      detail_fn=lambda d: "session created", severity="critical")
    t("User Profile /me",       "Auth", "/api/users/me",      token=U, severity="high",
      detail_fn=lambda d: f"role={d.get('role','?')}, plan={d.get('plan','?')}")
    t("Unauth blocked",         "Auth", "/api/projects/",     token="bad_token", expect=401, severity="high")

    # ── Projects ──────────────────────────────────────────────────────────────
    t("Projects List",          "Projects", "/api/projects/",                   token=U,
      detail_fn=lambda d: f"{d.get('total',0)} projects")
    t("Projects Invoices",      "Projects", "/api/projects/invoices/all",       token=U,
      detail_fn=lambda d: f"{d.get('total',0)} invoices")
    t("Projects Estimates",     "Projects", "/api/projects/estimates/all",      token=U,
      detail_fn=lambda d: f"{d.get('total',0)} estimates")
    t("Projects Overview",      "Projects", "/api/projects/summary/overview",   token=U)

    # ── Financial ─────────────────────────────────────────────────────────────
    t("Financial Summary",      "Financial", "/api/financial/summary",          token=U)
    t("Financial Invoices",     "Financial", "/api/financial/invoices",         token=U,
      detail_fn=lambda d: f"{d.get('total',0)} invoices")
    t("Financial Transactions", "Financial", "/api/financial/transactions",     token=U,
      detail_fn=lambda d: f"{d.get('total',0)} transactions")
    t("Tax Summary",            "Financial", f"/api/financial/tax-summary/{Y}", token=U)

    # ── Ledger ────────────────────────────────────────────────────────────────
    t("Ledger Accounts",        "Ledger", "/api/ledger/accounts",               token=U,
      detail_fn=lambda d: f"{d.get('total_accounts',0)} accounts")
    t("Ledger Transactions",    "Ledger", "/api/ledger/transactions",           token=U,
      detail_fn=lambda d: f"{d.get('total',0)} entries")
    t("Ledger Dashboard",       "Ledger", "/api/ledger/reports/dashboard-summary", token=U)
    t("Ledger P&L",             "Ledger", f"/api/ledger/reports/profit-loss?from_date={Y}-01-01&to_date={Y}-12-31", token=U)
    t("Ledger AR Aging",        "Ledger", "/api/ledger/reports/ar-aging",       token=U)
    t("Ledger Balance Sheet",   "Ledger", "/api/ledger/reports/balance-sheet",  token=U)
    t("Ledger GST",             "Ledger", f"/api/ledger/reports/gst-summary?from_date={Y}-01-01&to_date={Y}-12-31", token=U)
    t("Ledger Cash Flow",       "Ledger", f"/api/ledger/reports/cash-flow?from_date={Y}-01-01&to_date={Y}-12-31", token=U)

    # ── Compliance ────────────────────────────────────────────────────────────
    t("Compliance Status",      "Compliance", "/api/compliance/status",         token=U,
      detail_fn=lambda d: f"status={d.get('overall_status')}, score={d.get('compliance_score')}%, nc={d.get('not_configured')}")
    t("Compliance Summary",     "Compliance", "/api/compliance/summary",        token=U)
    t("Compliance WCB",         "Compliance", "/api/compliance/wcb",            token=U,
      detail_fn=lambda d: f"status={d.get('status','?')}")
    t("Compliance Permits",     "Compliance", "/api/compliance/permits",        token=U,
      detail_fn=lambda d: f"{d.get('total',0)} permits")
    t("Compliance Training",    "Compliance", "/api/compliance/training",       token=U,
      detail_fn=lambda d: f"{d.get('total',0)} records")
    t("Compliance Incidents",   "Compliance", "/api/compliance/incidents",      token=U,
      detail_fn=lambda d: f"{d.get('total',0)} incidents")
    t("Safety Checklist",       "Compliance", "/api/compliance/safety-checklist", token=U)

    # ── Billing ───────────────────────────────────────────────────────────────
    t("Billing Plans",          "Billing", "/api/billing/plans",                severity="medium",
      detail_fn=lambda d: f"{len(d.get('plans',{}))} plans")
    t("Billing Status (user)",  "Billing", "/api/billing/status",               token=U,
      detail_fn=lambda d: f"plan={d.get('plan')}, price=${d.get('plan_price')}")
    t("Billing Payments (user)","Billing", "/api/billing/payments",             token=U,
      detail_fn=lambda d: f"{d.get('count',0)} payments")
    t("Billing Payments (admin)","Billing", "/api/billing/payments",            token=A,
      detail_fn=lambda d: f"{d.get('count',0)} total payments")
    t("Billing Admin Subs",     "Billing", "/api/billing/admin/subscriptions",  token=A,
      detail_fn=lambda d: f"{d.get('count',0)} subscriptions")

    # ── Settings ──────────────────────────────────────────────────────────────
    t("Settings Public",        "Settings", "/api/settings/public",             severity="medium")
    t("Settings User Prefs",    "Settings", "/api/settings/user/preferences",   token=U, severity="medium")
    t("Settings Admin All",     "Settings", "/api/settings/admin/all",          token=A, severity="medium")
    t("Settings Business",      "Settings", "/api/settings/admin/business",     token=A, severity="medium")
    t("Settings Financial",     "Settings", "/api/settings/admin/financial",    token=A, severity="medium")
    t("Settings AI",            "Settings", "/api/settings/admin/ai",           token=A, severity="medium")

    # ── Email ─────────────────────────────────────────────────────────────────
    t("Email Inbox",            "Email", "/api/email/inbox",                    token=U, severity="low",
      detail_fn=lambda d: f"{d.get('total',0)} emails")
    t("Email Stats",            "Email", "/api/email/stats",                    token=U, severity="low")
    t("Email Templates",        "Email", "/api/email/templates",                token=U, severity="low")

    # ── AI Chat ───────────────────────────────────────────────────────────────
    code, ms, data = http("/api/chat/message", token=U, method="POST", body={
        "message": "What is my compliance status?",
        "context": "dashboard",
        "app_data": {}
    })
    has_api_key = bool(os.getenv("OPENAI_API_KEY") or os.getenv("ANTHROPIC_API_KEY"))
    if code == 200:
        resp = data.get("response", "")
        status = "PASS"
        detail = f"{'LLM' if has_api_key else 'Fallback'} response ({len(resp)} chars)"
        sev = "info" if not has_api_key else "high"
    else:
        status = "WARN" if not has_api_key else "FAIL"
        detail = "No AI API key — fallback mode active" if not has_api_key else str(data)[:60]
        sev = "low" if not has_api_key else "high"
    results.append(TestResult("AI Chat", "AI", status, code, ms, detail, sev))

    t("Chat Suggestions",       "AI", "/api/chat/suggestions",                  token=U, severity="low")

    # ── Admin ─────────────────────────────────────────────────────────────────
    t("Admin Dashboard",        "Admin", "/api/admin/dashboard",                token=A,
      detail_fn=lambda d: f"{d.get('total_users',0)} users, {d.get('active_users',0)} active")
    t("Admin Users",            "Admin", "/api/admin/users",                    token=A,
      detail_fn=lambda d: f"{len(d.get('users',[]))} users")
    t("Admin System Status",    "Admin", "/api/admin/system/status",            token=A,
      detail_fn=lambda d: f"status={d.get('status')}")
    t("Admin System Logs",      "Admin", "/api/admin/system/logs",              token=A, severity="medium")

    # ── Persistence ───────────────────────────────────────────────────────────
    data_dir = "/tmp/foreman_data"
    if os.path.exists(data_dir):
        files = os.listdir(data_dir)
        results.append(TestResult(
            "Data Persistence", "Infrastructure", "PASS", 200, 0,
            f"{len(files)} data files on disk: {', '.join(files)}", "high"
        ))
    else:
        results.append(TestResult(
            "Data Persistence", "Infrastructure", "WARN", 0, 0,
            "No data directory found — data may not be persisted", "high"
        ))

    return results


# ── Performance Analysis ──────────────────────────────────────────────────────

def analyze_performance(results: List[TestResult]) -> Dict:
    passing = [r for r in results if r.status == "PASS"]
    if not passing:
        return {}
    times = [r.ms for r in passing]
    slow = [r for r in passing if r.ms > 500]
    return {
        "avg_ms": round(sum(times) / len(times), 1),
        "max_ms": max(times),
        "min_ms": min(times),
        "slow_endpoints": [(r.name, r.ms) for r in slow],
        "p95_ms": sorted(times)[int(len(times) * 0.95)] if len(times) > 1 else times[0]
    }


# ── Report Generation ─────────────────────────────────────────────────────────

def generate_report(results: List[TestResult]) -> str:
    now = datetime.now()
    mt_offset = -6  # MDT
    mt_time = now.strftime("%I:%M %p MT")
    date_str = now.strftime("%A, %B %d, %Y")

    total = len(results)
    passed = sum(1 for r in results if r.status == "PASS")
    failed = sum(1 for r in results if r.status == "FAIL")
    warned = sum(1 for r in results if r.status == "WARN")
    pass_rate = round(passed / total * 100, 1) if total else 0

    perf = analyze_performance(results)

    # Health emoji
    if pass_rate >= 95:
        health_icon = "🟢"
        health_label = "EXCELLENT"
    elif pass_rate >= 85:
        health_icon = "🟡"
        health_label = "GOOD"
    elif pass_rate >= 70:
        health_icon = "🟠"
        health_label = "DEGRADED"
    else:
        health_icon = "🔴"
        health_label = "CRITICAL"

    # Group by category
    categories = {}
    for r in results:
        categories.setdefault(r.category, []).append(r)

    # Critical issues
    critical_issues = [r for r in results if r.status == "FAIL" and r.severity in ("critical", "high")]
    warnings = [r for r in results if r.status in ("FAIL", "WARN") and r.severity not in ("critical", "high")]

    lines = [
        f"# 🏗️ THE FOREMAN — AI CONTROL CENTER",
        f"## Daily Diagnostic Report",
        f"**Date:** {date_str} — {mt_time}",
        f"**Server:** {BASE_URL}",
        f"**Overall Health:** {health_icon} {health_label} ({pass_rate}% — {passed}/{total} tests passing)",
        "",
        "---",
        "",
        "## 📋 Executive Summary",
        "",
    ]

    # Executive summary
    if failed == 0 and warned <= 1:
        lines.append(f"The Foreman platform is operating at **{pass_rate}% health** with all critical systems online. "
                     f"{total} automated tests were executed across {len(categories)} system categories. "
                     f"{'One minor warning was detected.' if warned == 1 else 'No issues detected.'}")
    elif failed > 0:
        lines.append(f"**{failed} critical failure(s) detected** across {total} automated tests. "
                     f"Immediate attention required on: {', '.join(r.name for r in critical_issues[:3])}. "
                     f"Platform is operating at {pass_rate}% capacity.")
    else:
        lines.append(f"Platform is operating at **{pass_rate}% health** with {warned} warning(s) detected. "
                     f"All critical systems are online. Non-critical issues are noted below for review.")

    lines += ["", "---", "", "## 📊 Test Results by Category", ""]

    for cat, cat_results in sorted(categories.items()):
        cat_pass = sum(1 for r in cat_results if r.status == "PASS")
        cat_total = len(cat_results)
        cat_icon = "✅" if cat_pass == cat_total else ("⚠️" if cat_pass >= cat_total * 0.7 else "❌")
        lines.append(f"### {cat_icon} {cat} ({cat_pass}/{cat_total})")
        lines.append("")
        lines.append("| Test | Status | HTTP | Time | Detail |")
        lines.append("|------|--------|------|------|--------|")
        for r in cat_results:
            lines.append(f"| {r.name} | {r.icon} {r.status} | {r.code} | {r.ms}ms | {r.detail} |")
        lines.append("")

    lines += ["---", "", "## 🚨 Issues Detected", ""]

    if critical_issues:
        lines.append("### 🔴 Critical / High Severity")
        for r in critical_issues:
            lines.append(f"- **{r.name}** [{r.category}]: {r.detail or f'HTTP {r.code}'}")
        lines.append("")

    if warnings:
        lines.append("### 🟡 Warnings / Low Severity")
        for r in warnings:
            lines.append(f"- {r.name} [{r.category}]: {r.detail or f'HTTP {r.code}'}")
        lines.append("")

    if not critical_issues and not warnings:
        lines.append("✅ No issues detected — all systems nominal.")
        lines.append("")

    lines += ["---", "", "## ⚡ Performance Metrics", ""]
    if perf:
        lines += [
            f"| Metric | Value |",
            f"|--------|-------|",
            f"| Average Response Time | {perf['avg_ms']}ms |",
            f"| Fastest Response | {perf['min_ms']}ms |",
            f"| Slowest Response | {perf['max_ms']}ms |",
            f"| P95 Response Time | {perf['p95_ms']}ms |",
            f"| Slow Endpoints (>500ms) | {len(perf['slow_endpoints'])} |",
        ]
        if perf["slow_endpoints"]:
            lines.append("")
            lines.append("**Slow endpoints:**")
            for name, ms in perf["slow_endpoints"]:
                lines.append(f"- {name}: {ms}ms")
    lines.append("")

    lines += ["---", "", "## 💡 Innovative Recommendations", ""]
    lines += [
        "### 🚀 This Week's Priority Improvements",
        "",
        "1. **Real-time WebSocket Dashboard** — Replace polling with WebSocket push for live KPI updates. "
           "Eliminates the need for manual refresh and gives contractors instant visibility into new invoices, "
           "payments received, and compliance alerts.",
        "",
        "2. **AI-Powered Invoice Chasing** — When an invoice is 7+ days overdue, automatically draft a "
           "personalized follow-up email using the client's name, project details, and payment history. "
           "One-click send from the dashboard. Estimated recovery rate improvement: 23%.",
        "",
        "3. **Offline-First PWA Mode** — Cache all project data locally using IndexedDB so the app works "
           "on job sites with poor connectivity. Sync changes when back online. Critical for Alberta rural sites.",
        "",
        "4. **Photo-to-Expense OCR** — When a receipt photo is uploaded, use GPT-4 Vision to extract "
           "vendor, amount, date, and GST automatically. Zero manual entry for expenses.",
        "",
        "5. **Compliance Countdown Widget** — Add a dashboard widget showing days until next WCB payment, "
           "permit expiry, and training renewal. Color-coded: green (>30 days), yellow (7-30), red (<7).",
        "",
        "6. **Smart Scope-of-Work Templates** — Pre-built SOW templates for 12 common Alberta trade jobs "
           "(framing, electrical rough-in, concrete pour, etc.) that auto-populate based on project type.",
        "",
    ]

    lines += ["---", "", "## 📋 Action Items", ""]
    action_num = 1
    if not os.getenv("OPENAI_API_KEY") and not os.getenv("ANTHROPIC_API_KEY"):
        lines.append(f"{action_num}. **[HIGH]** Add `OPENAI_API_KEY` to Render environment variables to enable full AI chat")
        action_num += 1
    if os.getenv("ADMIN_PASSWORD", "ChangeMe2024!") == "ChangeMe2024!":
        lines.append(f"{action_num}. **[HIGH]** Change default admin password — set `ADMIN_PASSWORD_HASH` in Render env vars")
        action_num += 1
    for r in critical_issues:
        lines.append(f"{action_num}. **[CRITICAL]** Fix {r.name}: {r.detail}")
        action_num += 1
    for r in warnings[:5]:
        lines.append(f"{action_num}. **[LOW]** Review {r.name}: {r.detail}")
        action_num += 1
    if action_num == 1:
        lines.append("✅ No action items — platform is fully operational.")

    lines += [
        "",
        "---",
        "",
        f"## 📈 Summary",
        "",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Tests Run | {total} |",
        f"| Passing | {passed} ✅ |",
        f"| Warnings | {warned} ⚠️ |",
        f"| Failing | {failed} ❌ |",
        f"| Pass Rate | {pass_rate}% |",
        f"| Categories Tested | {len(categories)} |",
        f"| Avg Response Time | {perf.get('avg_ms', 'N/A')}ms |",
        "",
        "---",
        "*Report generated by Foreman AI Central Intelligence*",
        f"*Next report: Tomorrow at 7:00 AM MT*",
    ]

    return "\n".join(lines)


# ── Main Entry Point ──────────────────────────────────────────────────────────

def run_diagnostic() -> Dict:
    """Run full diagnostic and return results dict."""
    print(f"🔍 Starting Foreman diagnostic at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    user_token, admin_token = get_tokens()
    if not user_token:
        print("❌ Could not obtain user token — server may be down")
        return {"error": "Could not authenticate"}
    if not admin_token:
        print("⚠️  Could not obtain admin token — admin tests will fail")

    print(f"✅ Auth tokens obtained")
    results = run_all_tests(user_token, admin_token)

    total = len(results)
    passed = sum(1 for r in results if r.status == "PASS")
    failed = sum(1 for r in results if r.status == "FAIL")
    warned = sum(1 for r in results if r.status == "WARN")
    pass_rate = round(passed / total * 100, 1)

    print(f"📊 Results: {passed}/{total} passing ({pass_rate}%) | {warned} warnings | {failed} failures")

    # Generate and save report
    report_md = generate_report(results)
    os.makedirs(REPORT_DIR, exist_ok=True)
    date_str = datetime.now().strftime("%Y-%m-%d")
    report_path = os.path.join(REPORT_DIR, f"DAILY_REPORT_{date_str}.md")
    with open(report_path, "w") as f:
        f.write(report_md)
    print(f"📄 Report saved to: {report_path}")

    # Save JSON diagnostic
    diag = {
        "timestamp": datetime.now().isoformat(),
        "total": total,
        "passed": passed,
        "failed": failed,
        "warned": warned,
        "pass_rate": pass_rate,
        "results": [
            {"name": r.name, "category": r.category, "status": r.status,
             "code": r.code, "ms": r.ms, "detail": r.detail, "severity": r.severity}
            for r in results
        ]
    }
    diag_path = os.path.join(REPORT_DIR, f"diagnostic_{date_str}.json")
    with open(diag_path, "w") as f:
        json.dump(diag, f, indent=2)

    return diag


if __name__ == "__main__":
    result = run_diagnostic()
    sys.exit(0 if result.get("failed", 1) == 0 else 1)