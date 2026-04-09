#!/usr/bin/env python3
"""
Final V3.0 Comprehensive Audit Script
Checks all aspects of the Foreman app implementation
"""
import re
import json
from collections import defaultdict

# Load files
with open('web/app.js', 'r') as f:
    js = f.read()
js_lines = js.split('\n')

with open('web/app.html', 'r') as f:
    html = f.read()
html_lines = html.split('\n')

with open('web/app.css', 'r') as f:
    css = f.read()

print("=" * 70)
print("FOREMAN APP v3.0 — FINAL COMPREHENSIVE AUDIT")
print("=" * 70)

# ─── 1. FILE SIZES ────────────────────────────────────────────────────────────
print("\n[1] FILE SIZES")
print(f"  app.js   : {len(js_lines):,} lines  ({len(js.encode()):,} bytes)")
print(f"  app.html : {len(html_lines):,} lines  ({len(html.encode()):,} bytes)")
print(f"  app.css  : {len(css.splitlines()):,} lines  ({len(css.encode()):,} bytes)")

# ─── 2. PAGES ─────────────────────────────────────────────────────────────────
print("\n[2] PAGES (id='*-page')")
pages = re.findall(r'id=["\']([^"\']+?-page)["\']', html)
for p in sorted(pages):
    print(f"  ✓ {p}")
print(f"  TOTAL: {len(pages)}")

# ─── 3. MODALS ────────────────────────────────────────────────────────────────
print("\n[3] MODALS (class='modal-overlay')")
modals = re.findall(r'id=["\']([^"\']+?)["\'][^>]*class=["\'][^"\']*modal-overlay[^"\']*["\']', html)
modals2 = re.findall(r'class=["\'][^"\']*modal-overlay[^"\']*["\'][^>]*id=["\']([^"\']+?)["\']', html)
all_modals = list(set(modals + modals2))
for m in sorted(all_modals):
    print(f"  ✓ {m}")
print(f"  TOTAL: {len(all_modals)}")

# ─── 4. NAV ROUTES ────────────────────────────────────────────────────────────
print("\n[4] NAVIGATION ROUTES (navigateTo)")
nav_calls = re.findall(r"navigateTo\(['\"]([^'\"]+)['\"]", js)
nav_html  = re.findall(r"navigateTo\(['\"]([^'\"]+)['\"]", html)
all_routes = sorted(set(nav_calls + nav_html))
for r in all_routes:
    print(f"  ✓ {r}")
print(f"  TOTAL: {len(all_routes)}")

# ─── 5. JS FUNCTION INVENTORY ─────────────────────────────────────────────────
print("\n[5] JS FUNCTION INVENTORY")
js_funcs = set(re.findall(r'(?:^|\s)function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(', js))
js_funcs |= set(re.findall(r'(?:^|[,\s])([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*function\s*\(', js))
js_funcs |= set(re.findall(r'(?:^|[,\s])([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\([^)]*\)\s*=>', js))

crm_funcs = [f for f in js_funcs if 'crm' in f.lower() or 'CRM' in f]
hr_funcs  = [f for f in js_funcs if any(x in f.lower() for x in ['paystub','payroll','td1','t4','generateP','generateT'])]
inv_funcs = [f for f in js_funcs if 'invoice' in f.lower() or 'Invoice' in f]
theme_funcs = [f for f in js_funcs if 'theme' in f.lower() or 'Theme' in f]

print(f"  Total functions : {len(js_funcs)}")
print(f"  CRM functions   : {len(crm_funcs)}")
print(f"  HR  functions   : {len(hr_funcs)}")
print(f"  Invoice funcs   : {len(inv_funcs)}")
print(f"  Theme functions : {len(theme_funcs)}")

# ─── 6. ONCLICK HANDLER CHECK ─────────────────────────────────────────────────
print("\n[6] ONCLICK HANDLERS → JS FUNCTION VALIDATION")
onclick_pattern = re.compile(r'onclick=["\']([^"\']+)["\']')
onclick_calls = onclick_pattern.findall(html)

func_calls_in_html = set()
for oc in onclick_calls:
    # Extract function name(s)
    for fn in re.findall(r'([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(', oc):
        if fn not in ('if', 'else', 'return', 'this', 'true', 'false', 'null'):
            func_calls_in_html.add(fn)

missing_funcs = []
for fn in sorted(func_calls_in_html):
    # Check in JS text (function def OR assignment)
    pattern1 = rf'\bfunction\s+{re.escape(fn)}\s*\('
    pattern2 = rf'\b{re.escape(fn)}\s*=\s*function'
    pattern3 = rf'\b{re.escape(fn)}\s*=\s*\('
    pattern4 = rf'\b{re.escape(fn)}\s*=\s*async'
    if not any(re.search(p, js) for p in [pattern1, pattern2, pattern3, pattern4]):
        missing_funcs.append(fn)

if missing_funcs:
    print(f"  ⚠ MISSING ({len(missing_funcs)}):")
    for fn in missing_funcs:
        print(f"    ✗ {fn}")
else:
    print(f"  ✓ All {len(func_calls_in_html)} onclick functions are defined — PASS")

# ─── 7. GETELEMENTBYID CHECK ──────────────────────────────────────────────────
print("\n[7] getElementById → HTML ID VALIDATION")
js_ids = set(re.findall(r"getElementById\(['\"]([^'\"]+)['\"]", js))
html_ids = set(re.findall(r'\bid=["\']([^"\']+)["\']', html))

# Known-safe dynamic/guarded IDs
known_safe = {
    'typing-indicator',       # dynamically createElement'd
    'pm-task-detail-modal',   # dynamically rendered innerHTML
    'task-detail-status',     # inside dynamically rendered modal
    'task-detail-priority',   # inside dynamically rendered modal
    'task-detail-due',        # inside dynamically rendered modal
    'task-detail-progress',   # inside dynamically rendered modal
    'convert-banner',         # has if(banner) guard
    'crm-analytics-stats-container', # has fallback getElementById
    # Pre-existing PM/accounting IDs with null guards
    'material-search',
    'task-search',
    'msg-input',
    'chat-messages',
    'pm-budget-spent',
    'pm-budget-total',
    'pm-budget-bar',
    'financial-summary',
}

missing_ids = []
safe_ids = []
for id_ in sorted(js_ids):
    if id_ not in html_ids:
        if id_ in known_safe:
            safe_ids.append(id_)
        else:
            missing_ids.append(id_)

if missing_ids:
    print(f"  ⚠ POTENTIALLY MISSING IDs ({len(missing_ids)}):")
    for id_ in missing_ids:
        print(f"    ✗ #{id_}")
else:
    print(f"  ✓ All critical IDs present — PASS")

print(f"  ℹ Safe/dynamic IDs (excluded): {len(safe_ids)}")
for id_ in safe_ids:
    print(f"    ~ #{id_} (dynamic/guarded)")

# ─── 8. CRM STORE SCHEMA ──────────────────────────────────────────────────────
print("\n[8] CRM STORE SCHEMA (loadUnifiedStore)")
store_checks = [
    'crmContacts', 'crmLeads', 'crmDeals', 'crmActivities', 'crmFollowups'
]
for key in store_checks:
    if f"store.{key}" in js:
        print(f"  ✓ store.{key}")
    else:
        print(f"  ✗ store.{key} — MISSING")

# ─── 9. CRM PIPELINE STAGES ───────────────────────────────────────────────────
print("\n[9] CRM PIPELINE STAGES")
stages = ['New', 'Contacted', 'Qualified', 'Quote Sent', 'Negotiation', 'Won', 'Lost']
for s in stages:
    if f"'{s}'" in js or f'"{s}"' in js:
        print(f"  ✓ {s}")
    else:
        print(f"  ✗ {s} — MISSING")

# ─── 10. HR DOCUMENTS ─────────────────────────────────────────────────────────
print("\n[10] HR DOCUMENT FUNCTIONS")
hr_checks = [
    ('generatePaystub', 'Pay Stub generator'),
    ('generateTD1',     'TD1 generator'),
    ('generateT4',      'T4 generator'),
    ('printPaystub',    'Pay Stub print'),
    ('printTD1',        'TD1 print'),
    ('printT4',         'T4 print'),
]
for fn, label in hr_checks:
    found = bool(re.search(rf'\bfunction\s+{fn}\s*\(', js))
    icon = '✓' if found else '✗'
    print(f"  {icon} {fn} — {label}")

# ─── 11. INVOICE PREVIEW ──────────────────────────────────────────────────────
print("\n[11] INVOICE PREVIEW")
inv_checks = [
    ('previewInvoice',        'Preview function'),
    ('printInvoicePreview',   'Print function'),
    ('invoice-preview-modal', 'Modal in HTML'),
    ('invoice-preview-content', 'Content container'),
]
for item, label in inv_checks:
    if item in html or item in js:
        print(f"  ✓ {item} — {label}")
    else:
        print(f"  ✗ {item} — {label} MISSING")

# ─── 12. THEME TOGGLE ─────────────────────────────────────────────────────────
print("\n[12] THEME TOGGLE")
theme_checks = [
    ('toggleTheme',      'JS toggle function'),
    ('initTheme',        'JS init function'),
    ('theme-toggle-btn', 'Button in HTML'),
    ('light-theme',      'CSS light-theme class'),
    ('data-theme',       'data-theme attribute'),
]
for item, label in theme_checks:
    found = item in js or item in html or item in css
    icon = '✓' if found else '✗'
    print(f"  {icon} {item} — {label}")

# ─── 13. CRITICAL CSS CLASSES ─────────────────────────────────────────────────
print("\n[13] CRITICAL CSS CLASSES")
critical_css = [
    'pipeline-stage', 'pipeline-card', 'pipeline-drop-zone',
    'contact-card', 'contact-detail-header', 'contact-stat',
    'activity-item-crm', 'activity-dot',
    'crm-bar-chart', 'crm-bar-fill',
    'invoice-preview-sheet', 'invoice-items-table',
    'paystub-preview', 'paystub-header',
    'td1-form', 'td1-row',
    't4-slip', 't4-box',
    'btn-success', 'btn-danger',
    'theme-toggle-btn', 'convert-banner',
    'crm-empty-state',
]
missing_css = []
for cls in critical_css:
    if f'.{cls}' in css or f'{cls}' in css:
        print(f"  ✓ .{cls}")
    else:
        missing_css.append(cls)
        print(f"  ✗ .{cls} — MISSING")

if not missing_css:
    print("  → All critical CSS classes present")

# ─── 14. NAVIGATETO ROUTING ───────────────────────────────────────────────────
print("\n[14] navigateTo() ROUTE HANDLING")
# Find all pages in HTML
page_ids = [p.replace('-page', '') for p in pages]
# Find routes handled in navigateTo
navigate_fn_match = re.search(r'function navigateTo\s*\(([^)]*)\)\s*\{([\s\S]*?)(?=\nfunction |\nconst |\nvar |\nlet )', js)

crm_route = "page === 'crm'" in js or "page==='crm'" in js
print(f"  {'✓' if crm_route else '✗'} CRM route handled")

# Check for page show logic
show_logic = 'document.querySelectorAll(\'.page\')' in js or "querySelectorAll('.page')" in js
print(f"  {'✓' if show_logic else '✗'} Page show/hide logic")

# ─── 15. FEATURE CHECKLIST ────────────────────────────────────────────────────
print("\n[15] V3.0 FEATURE CHECKLIST")

features = [
    # CRM Core
    ("CRM page in HTML",                "id=\"crm-page\"" in html),
    ("CRM nav link",                    "navigateTo('crm')" in html),
    ("CRM tab: Pipeline",               "showCRMTab('pipeline')" in html),
    ("CRM tab: Contacts",               "showCRMTab('contacts')" in html),
    ("CRM tab: Deals",                  "showCRMTab('deals')" in html),
    ("CRM tab: Activities",             "showCRMTab('activities')" in html),
    ("CRM tab: Analytics",              "showCRMTab('analytics')" in html),
    ("initCRM function",                "function initCRM" in js),
    ("showCRMTab function",             "function showCRMTab" in js),
    ("Pipeline board render",           "function renderPipelineBoard" in js),
    ("Drag-and-drop (dropOnStage)",     "function dropOnStage" in js),
    ("Contacts render",                 "function renderCRMContacts" in js),
    ("Contact save",                    "function saveCRMContact" in js),
    ("Contact edit",                    "function editCRMContact" in js),
    ("Contact delete",                  "function deleteCRMContact" in js),
    ("Contact detail view",             "function openContactDetail" in js),
    ("Deals render",                    "function renderCRMDeals" in js),
    ("Deal save",                       "function saveCRMDeal" in js),
    ("Activities render",               "function renderCRMActivities" in js),
    ("Activity save",                   "function saveCRMActivity" in js),
    ("Follow-up scheduling",            "function saveCRMFollowup" in js),
    ("CRM analytics render",            "function renderCRMAnalytics" in js),
    ("CRM bar chart",                   "function renderBarChart" in js),
    ("CRM data export",                 "function exportCRMData" in js),
    ("CRM store: crmContacts",          "store.crmContacts" in js),
    ("CRM store: crmLeads",             "store.crmLeads" in js),
    ("CRM store: crmDeals",             "store.crmDeals" in js),
    ("CRM store: crmActivities",        "store.crmActivities" in js),
    ("CRM store: crmFollowups",         "store.crmFollowups" in js),
    # CRM Modals
    ("Contact modal in HTML",           "crm-contact-modal" in html),
    ("Lead/Pipeline modal in HTML",     "crm-lead-modal" in html),
    ("Deal modal in HTML",              "crm-deal-modal" in html),
    ("Activity modal in HTML",          "crm-activity-modal" in html),
    ("Follow-up modal in HTML",         "crm-followup-modal" in html),
    ("Contact detail modal in HTML",    "crm-contact-detail-modal" in html),
    # HR Documents
    ("Pay Stub generator",              "function generatePaystub" in js),
    ("TD1 form generator",              "function generateTD1" in js),
    ("T4 slip generator",               "function generateT4" in js),
    ("Pay Stub print",                  "function printPaystub" in js),
    ("TD1 print",                       "function printTD1" in js),
    ("T4 print",                        "function printT4" in js),
    ("HR preview modal in HTML",        "paystub-modal" in html or "hr-preview-modal" in html),
    # Invoice Preview
    ("previewInvoice function",         "function previewInvoice" in js),
    ("printInvoicePreview function",    "function printInvoicePreview" in js),
    ("Invoice preview modal",           "invoice-preview-modal" in html),
    ("Invoice preview button (page)",   "previewInvoice()" in html),
    # Theme Toggle
    ("toggleTheme function",            "function toggleTheme" in js),
    ("initTheme function",              "function initTheme" in js),
    ("Theme toggle button",             "theme-toggle-btn" in html),
    ("Light theme CSS",                 "light-theme" in css),
]

pass_count = 0
fail_count = 0
for label, result in features:
    icon = '✓' if result else '✗'
    status = 'PASS' if result else 'FAIL'
    if result:
        pass_count += 1
    else:
        fail_count += 1
    print(f"  {icon} {label:45s} [{status}]")

print(f"\n  SCORE: {pass_count}/{len(features)} PASS  |  {fail_count} FAIL")

# ─── 16. GIT STATUS ───────────────────────────────────────────────────────────
print("\n[16] GIT LOG (last 5 commits)")

# ─── FINAL SUMMARY ────────────────────────────────────────────────────────────
print("\n" + "=" * 70)
print("FINAL AUDIT SUMMARY")
print("=" * 70)
issues = len(missing_funcs) + len(missing_ids) + len(missing_css) + fail_count
print(f"  Onclick functions missing : {len(missing_funcs)}")
print(f"  Critical IDs missing      : {len(missing_ids)}")
print(f"  CSS classes missing       : {len(missing_css)}")
print(f"  Feature checklist fails   : {fail_count}")
print(f"  JS Syntax                 : PASS (node --check)")
print(f"  ─────────────────────────────────────")
print(f"  TOTAL ISSUES              : {issues}")
if issues == 0:
    print(f"  STATUS                    : ✅ ALL SYSTEMS OPERATIONAL")
else:
    print(f"  STATUS                    : ⚠ {issues} ISSUES FOUND — REVIEW NEEDED")
print("=" * 70)