import httpx

BASE = "http://localhost:8050"

# Test login API directly
print("Testing login API...")
r = httpx.post(f"{BASE}/api/users/login", json={
    "email": "test@foreman.ca",
    "password": "Test1234!"
})
print(f"Status: {r.status_code}")
print(f"Response: {r.json()}")

if r.status_code == 200:
    token = r.json().get("token")
    print(f"\nToken received: {token[:20]}...")
    
    # Test using token to access dashboard
    r2 = httpx.get(f"{BASE}/api/ledger/reports/dashboard-summary", 
                   headers={"Authorization": f"Bearer {token}"})
    print(f"\nDashboard API: {r2.status_code}")
    if r2.status_code == 200:
        print(f"Dashboard data: {r2.json()}")
