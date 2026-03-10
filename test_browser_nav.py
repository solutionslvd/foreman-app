"""
Test navigation by simulating login and checking navigation elements
"""
import httpx
import json

BASE = "http://localhost:8050"

# First, login to get a token
r = httpx.post(f"{BASE}/api/users/login", json={
    "email": "test@foreman.ca", 
    "password": "Test1234!"
})

if r.status_code != 200:
    print(f"Login failed: {r.status_code}")
    exit(1)

data = r.json()
token = data.get("token")
user = data.get("user")

print(f"Logged in as: {user.get('email')} (role: {user.get('role')})")
print(f"Token: {token[:30]}...")

# Test navigation-related API endpoints
print("\n" + "=" * 60)
print("TESTING NAVIGATION-RELATED API ENDPOINTS")
print("=" * 60)

endpoints = [
    ("/api/users/me", "User profile"),
    ("/api/projects/", "Projects list"),
    ("/api/financial/summary", "Financial summary"),
    ("/api/compliance/status", "Compliance status"),
    ("/api/billing/status", "Billing status"),
    ("/api/ledger/reports/dashboard-summary", "Dashboard data"),
    ("/api/settings/public", "Public settings"),
]

headers = {"Authorization": f"Bearer {token}"}

for endpoint, name in endpoints:
    try:
        r = httpx.get(f"{BASE}{endpoint}", headers=headers, timeout=5)
        status = "✅" if r.status_code == 200 else "❌"
        print(f"  {status} {endpoint:45} -> {r.status_code} ({name})")
    except Exception as e:
        print(f"  ❌ {endpoint:45} -> ERROR: {e}")

# Test admin-only endpoints with regular user token
print("\n" + "=" * 60)
print("TESTING ADMIN ENDPOINTS WITH USER TOKEN (should fail)")
print("=" * 60)

admin_endpoints = [
    ("/api/admin/dashboard", "Admin dashboard"),
    ("/api/admin/users", "Admin users list"),
]

for endpoint, name in admin_endpoints:
    try:
        r = httpx.get(f"{BASE}{endpoint}", headers=headers, timeout=5)
        # 401/403 is expected for non-admin users
        status = "✅" if r.status_code in [401, 403] else "⚠️"
        print(f"  {status} {endpoint:45} -> {r.status_code} ({name})")
    except Exception as e:
        print(f"  ❌ {endpoint:45} -> ERROR: {e}")

print("\n" + "=" * 60)
print("NAVIGATION TEST COMPLETE")
print("=" * 60)
