# 🏗️ THE FOREMAN — AI CONTROL CENTER
## Daily Diagnostic Report
**Date:** Sunday, March 8, 2026 — 10:06 PM MT (First Full Diagnostic Run)
**Reported By:** Foreman AI Central Intelligence
**Server Status:** 🟢 ONLINE | Port 8050 | Python 3.11.14

---

## 🚨 CRITICAL BUGS (Fix Immediately)

### BUG-001 — `syncStore()` Called But Never Defined
**Severity:** 🔴 CRITICAL
**File:** `web/app.js` — Lines 2610, 4237, 4248, 4670, 4725
**Impact:** Any action that calls `syncStore()` silently fails. Data sync between frontend and backend is completely broken. Users lose data on page refresh.
**Details:** The function `syncStore` is called 5 times throughout the app but has zero definitions. This means every time a project is saved, an employee is added, or a document is uploaded — the sync to the API never fires. The app falls back to localStorage only, meaning all data is lost when the browser cache is cleared or a new device is used.
**Fix Required:** Define `syncStore()` as an async function that pushes the local store to `/api/users/store` or equivalent endpoint.

---

### BUG-002 — `apiDelete()` Function Missing
**Severity:** 🔴 CRITICAL
**File:** `web/app.js`
**Impact:** Delete operations (projects, invoices, employees, documents) have no HTTP DELETE method available. Any delete button that relies on `apiDelete()` will throw a ReferenceError and crash silently.
**Details:** `apiGet`, `apiPost`, and `apiPut` are all defined, but `apiDelete` is completely absent. The backend has DELETE endpoints defined (e.g., `/api/projects/{id}`) but the frontend cannot reach them.
**Fix Required:** Add `async function apiDelete(url)` alongside the other API helpers.

---

### BUG-003 — Password Stored in Plaintext in localStorage
**Severity:** 🔴 CRITICAL — SECURITY VULNERABILITY
**File:** `web/app.js` — Lines 3173–3175
**Impact:** User passwords are written directly to `localStorage.userPassword`. Any JavaScript running on the page (including browser extensions, XSS attacks) can read this value. This is a serious security breach.
**Details:**
```javascript
const stored = localStorage.getItem('userPassword') || 'default';
localStorage.setItem('userPassword', newPw);  // PLAINTEXT PASSWORD STORED
```
**Fix Required:** Remove password from localStorage entirely. Password changes must go through the API only (`/api/users/change-password`). Never store credentials client-side.

---

### BUG-004 — Backend Projects API Has Zero Authentication
**Severity:** 🔴 CRITICAL — SECURITY VULNERABILITY
**File:** `app/api/projects.py` — Lines 128–180
**Impact:** ANY unauthenticated user can list, create, update, or delete ALL projects from ALL users. There is no `Authorization` header check, no `Depends(verify_user_token)`, nothing. The entire project database is publicly accessible.
**Details:** Every endpoint in `projects.py` (`GET /`, `POST /`, `GET /{id}`, `PUT /{id}`, `DELETE /{id}`) has no authentication or authorization. The same applies to `financial.py` and `compliance.py`.
**Fix Required:** Add `authorization: Optional[str] = Header(None)` + `verify_user_token()` to every endpoint, and filter data by user ID.

---

### BUG-005 — All Backend Data Lost on Every Server Restart
**Severity:** 🔴 CRITICAL — DATA LOSS
**Files:** `app/api/projects.py:16`, `app/api/financial.py`, `app/compliance_engine.py:50`
**Impact:** Every time the Render server restarts (which happens every 15 minutes on free tier when idle), ALL data is wiped. Projects, invoices, transactions, compliance records — everything gone.
**Details:**
```python
projects_db: List[Dict] = []  # In-memory only — wiped on restart
```
Render free tier spins down after 15 minutes of inactivity. The keep-alive ping prevents spin-down but any deploy or crash wipes all data permanently.
**Fix Required:** Implement file-based JSON persistence (immediate fix) or migrate to PostgreSQL (proper fix). At minimum, write data to disk on every write operation.

---

## ⚠️ HIGH SEVERITY BUGS

### BUG-006 — Plan Pricing Mismatch Between Backend and Frontend
**Severity:** 🟠 HIGH
**Files:** `app/api/billing.py:27-30` vs `web/app.html:95-97, 1852-1885`
**Impact:** Customers see different prices depending on where they look. This causes billing confusion and potential legal/financial issues.
**Details:**
| Plan | Backend Price | Frontend (Register) | Frontend (Billing Page) |
|------|--------------|---------------------|------------------------|
| Starter | $49/mo | $49/mo ✅ | $49/mo ✅ |
| Professional | $99/mo | **$149/mo** ❌ | **$149/mo** ❌ |
| Business | $199/mo | **$299/mo** ❌ | **$299/mo** ❌ |
**Fix Required:** Standardize pricing. Either update backend to match frontend or vice versa. Recommend pulling prices dynamically from `/api/billing/plans`.

---

### BUG-007 — Invoice `due_date` Always Returns `null`
**Severity:** 🟠 HIGH
**File:** `app/api/projects.py` — Invoice creation
**Impact:** Every invoice generated has a null due date. Clients receive invoices with no payment deadline, making collections impossible to enforce.
**Details:** The `CreateInvoiceRequest` model accepts `due_date` as optional but the invoice creation logic never auto-calculates it from `payment_terms` (e.g., net_30 = invoice_date + 30 days).
**Fix Required:** Auto-calculate `due_date` from `invoice_date + payment_terms` when not provided.

---

### BUG-008 — Fragmented localStorage (14 Different Keys)
**Severity:** 🟠 HIGH
**File:** `web/app.js`
**Impact:** Data is scattered across 14+ separate localStorage keys (`foreman_store`, `receiptStore`, `acctStore`, `foreman_employees`, `foreman_contractors`, `foreman_payroll_history`, `foreman_transactions`, `userProfile`, `userPassword`, `avatarColor`, etc.). This makes data backup, migration, and sync impossible. Users who clear one key lose partial data with no warning.
**Fix Required:** Consolidate all data into a single `foreman_store` object with proper sub-keys.

---

### BUG-009 — No Token Expiry Handling on Frontend
**Severity:** 🟠 HIGH
**File:** `web/app.js`
**Impact:** When a user's auth token expires (24 hours), API calls silently return `null` or fail. The user sees blank data with no explanation. They must manually log out and back in.
**Details:** `apiGet()` returns `null` on non-OK responses with no 401 detection. There is no interceptor to catch expired tokens and redirect to login.
**Fix Required:** Add 401 detection in `apiGet/apiPost/apiPut` that auto-logs out and shows "Session expired, please log in again."

---

### BUG-010 — Admin Dashboard Shows `[YOUR BUSINESS NAME]` Placeholder
**Severity:** 🟠 HIGH
**File:** `app/config.py`, `app/api/admin.py:170`
**Impact:** The admin dashboard displays literal placeholder text `[YOUR BUSINESS NAME]`, `[YOUR TRADE]`, `[YOUR AI NAME]` to all admin users. Looks completely unprofessional and broken.
**Details:** `config.py` has never been configured with real values and the settings system doesn't override these defaults properly.
**Fix Required:** Settings manager must take priority over config.py defaults. Admin should be prompted to complete setup on first login.

---

## 🟡 MEDIUM SEVERITY ISSUES

### BUG-011 — XSS Risk: 200+ innerHTML Template Literals Without Sanitization
**Severity:** 🟡 MEDIUM
**File:** `web/app.js`
**Impact:** User-supplied data (project names, client names, notes) is injected directly into `innerHTML` via template literals. A malicious user could inject `<script>` tags.
**Details:** `escapeHtml()` function exists at line 3029 but is not consistently applied to user data before rendering.
**Fix Required:** Wrap all user-supplied strings in `escapeHtml()` before inserting into innerHTML.

---

### BUG-012 — Chat AI Returns Generic Response (No API Key Configured)
**Severity:** 🟡 MEDIUM
**File:** `app/ai_engine.py`
**Impact:** The AI assistant is the core selling point of the platform. Without an OpenAI/Anthropic API key, it returns a generic "add an API key" message to every user. The platform's #1 feature is non-functional.
**Details:** Response confirms: "To unlock full AI responses, add an OpenAI or Anthropic API key in your environment variables."
**Fix Required:** Configure `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in environment. Add graceful fallback with rule-based responses for common construction queries.

---

### BUG-013 — `payrollStore` Not Included in Main `store` Object
**Severity:** 🟡 MEDIUM
**File:** `web/app.js:1196-1208`
**Impact:** Payroll data (employees, contractors, history, transactions) is stored in a completely separate object with its own localStorage keys. It cannot be backed up, exported, or synced with the main store.
**Fix Required:** Merge `payrollStore` into main `store` object under `store.payroll`.

---

### BUG-014 — `receiptStore` Uses `window.receiptStore` Global (Memory Leak Risk)
**Severity:** 🟡 MEDIUM
**File:** `web/app.js:3269`
**Impact:** Receipt data is attached to the global `window` object. This is an anti-pattern that can cause memory leaks and namespace collisions.
**Fix Required:** Move receipt data into `store.receipts`.

---

### BUG-015 — Compliance Score Hardcoded at 80% When No Data Exists
**Severity:** 🟡 MEDIUM
**File:** `app/compliance_engine.py`
**Impact:** New users with zero compliance data see an 80% compliance score. This is misleading — a company with no WCB registration, no permits, and no training records should not show 80% compliant.
**Details:** API response: `"compliance_score": 80.0, "overall_status": "warning"` with zero records.
**Fix Required:** Score should start at 0% and build up as records are added, or show "Not Configured" for new accounts.

---

## 🔵 LOW SEVERITY / IMPROVEMENTS

### BUG-016 — `uvicorn` Version Incompatibility Warning
**File:** `requirements.txt`
**Details:** `uvicorn==0.24.0` conflicts with `mcp>=0.31.1` requirement. Upgraded to latest during this session.
**Fix Required:** Update `requirements.txt` to `uvicorn[standard]>=0.31.1`

### BUG-017 — Keep-Alive Ping Uses `localhost` (Breaks on Render)
**File:** `app/main.py:42`
**Details:** Keep-alive pings `http://localhost:{port}/health`. On Render, the internal hostname may differ.
**Fix Required:** Use `http://0.0.0.0:{port}/health` or `http://127.0.0.1:{port}/health`

### BUG-018 — Admin Password Uses SHA-256 (Weak Hashing)
**File:** `app/admin_auth.py`
**Details:** SHA-256 without salt is vulnerable to rainbow table attacks. Should use bcrypt or argon2.
**Fix Required:** Migrate to `passlib[bcrypt]` (already in requirements) for admin password hashing.

### BUG-019 — NDA Template Has Unfilled Placeholders
**File:** `app/nda_generator.py`, `app/config.py`
**Details:** NDA shows `[YOUR BUSINESS NAME]`, `[YOUR ADDRESS]`, `[YOUR EMAIL]` to users. Legal document with placeholder text is invalid.
**Fix Required:** Pull from settings_manager which has real configurable values.

### BUG-020 — `chat/suggestions` Returns Only 1 Hardcoded Suggestion
**File:** `app/api/chat.py:94`
**Details:** Suggestions endpoint returns only `"💳 Payroll deductions due by the 15th"` regardless of user context, date, or actual data.
**Fix Required:** Generate dynamic suggestions based on user's actual projects, invoices, and compliance status.

---

## 📊 ENDPOINT TEST RESULTS

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /health` | ✅ 200 | Healthy |
| `GET /ping` | ✅ 200 | Responsive |
| `POST /api/users/register` | ✅ 200 | Working |
| `POST /api/users/login` | ✅ 200 | Working |
| `GET /api/users/me` | ✅ 200 | Working |
| `GET /api/users/nda` | ✅ 200 | Has placeholder text |
| `POST /api/admin/login` | ✅ 200 | Working (pw: ChangeMe2024!) |
| `GET /api/admin/dashboard` | ✅ 200 | Shows placeholders |
| `GET /api/admin/system/status` | ✅ 200 | Working |
| `GET /api/admin/users` | ✅ 200 | Working |
| `GET /api/projects/` | ✅ 200 | **NO AUTH** — public |
| `POST /api/projects/` | ✅ 201 | **NO AUTH** — public |
| `POST /api/projects/invoice/standalone` | ✅ 200 | Working, due_date=null |
| `GET /api/financial/summary` | ✅ 200 | Working |
| `GET /api/ledger/accounts` | ✅ 200 | 48 accounts loaded |
| `GET /api/ledger/reports/dashboard-summary` | ✅ 200 | Working |
| `GET /api/ledger/reports/profit-loss` | ✅ 200 | Requires from_date/to_date |
| `GET /api/ledger/reports/balance-sheet` | ✅ 200 | Working |
| `GET /api/ledger/reports/gst-summary` | ✅ 200 | Working |
| `GET /api/ledger/reports/ar-aging` | ✅ 200 | Working |
| `GET /api/compliance/status` | ✅ 200 | Score hardcoded 80% |
| `GET /api/compliance/safety-checklist` | ✅ 200 | Working |
| `GET /api/billing/plans` | ✅ 200 | Price mismatch vs frontend |
| `GET /api/billing/admin/overview` | ✅ 200 | Stripe not configured |
| `GET /api/chat/suggestions` | ✅ 200 | Only 1 hardcoded suggestion |
| `POST /api/chat/message` | ✅ 200 | No AI key — generic response |
| `GET /api/email/inbox` | ✅ 200 | Empty |
| `GET /api/email/templates` | ✅ 200 | Working |
| `GET /api/settings/public` | ✅ 200 | Working |
| `GET /api/dropdowns` | ✅ 200 | Working |

**Total Endpoints Tested:** 29
**Passing:** 29/29 (HTTP level)
**Functional Issues Found:** 20 bugs

---

## 🛠️ FIX PRIORITY QUEUE

| Priority | Bug | Estimated Fix Time |
|----------|-----|--------------------|
| 1 | BUG-001: syncStore undefined | 30 min |
| 2 | BUG-002: apiDelete missing | 10 min |
| 3 | BUG-004: No auth on projects/financial/compliance | 45 min |
| 4 | BUG-005: Data loss on restart (JSON persistence) | 1 hour |
| 5 | BUG-003: Password in localStorage | 20 min |
| 6 | BUG-006: Pricing mismatch | 15 min |
| 7 | BUG-007: Invoice due_date null | 15 min |
| 8 | BUG-009: Token expiry handling | 20 min |
| 9 | BUG-010: Placeholder text in admin | 30 min |
| 10 | BUG-008: Fragmented localStorage | 2 hours |

---

## 🚀 NEXT ACTIONS

I am ready to begin fixing all bugs immediately, starting with the critical ones.
Fixes will be applied in priority order and re-tested after each fix.

**Awaiting your go-ahead to begin fixes.**

---
*Report generated by Foreman AI Central Intelligence*
*Next scheduled report: Monday, March 9, 2026 — 7:00 AM MT*
*Server uptime: Active | Keep-alive: Running | Sessions: 2 users*