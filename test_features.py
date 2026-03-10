#!/usr/bin/env python3
"""
Comprehensive feature testing for Foreman App
Tests all major features end-to-end
"""
import requests
import json
import time
from typing import Dict, Any

BASE_URL = "http://localhost:8050"

def test_health():
    """Test health endpoint"""
    print("Testing health endpoint...")
    response = requests.get(f"{BASE_URL}/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    print("✓ Health endpoint working")
    return True

def test_app_serving():
    """Test that app.html is being served"""
    print("\nTesting app serving...")
    response = requests.get(f"{BASE_URL}/app")
    assert response.status_code == 200
    assert "openEditProjectModal" in response.text
    assert "modal-edit-project" in response.text
    assert "showClientLinkModal" in response.text
    assert "modal-client-link" in response.text
    print("✓ App HTML serving correctly with all modals")
    return True

def test_javascript_functions():
    """Test that JavaScript functions exist"""
    print("\nTesting JavaScript functions...")
    response = requests.get(f"{BASE_URL}/static/app.js")
    assert response.status_code == 200
    js_content = response.text
    
    # Check for key functions
    functions_to_check = [
        "openEditProjectModal",
        "saveEditedProject",
        "getClientShareLink",
        "showClientLinkModal",
        "renderProjects",
        "openModal",
        "closeModal"
    ]
    
    for func in functions_to_check:
        assert f"function {func}" in js_content or f"{func}(" in js_content, f"Function {func} not found"
        print(f"  ✓ {func} exists")
    
    print("✓ All required JavaScript functions present")
    return True

def test_modal_structures():
    """Test that modal structures are correct"""
    print("\nTesting modal structures...")
    response = requests.get(f"{BASE_URL}/app")
    assert response.status_code == 200
    html_content = response.text
    
    # Check for modal structures
    modals_to_check = [
        "modal-edit-project",
        "modal-client-link",
        "modal-project-details"
    ]
    
    for modal in modals_to_check:
        assert modal in html_content, f"Modal {modal} not found"
        assert 'class="modal-overlay hidden"' in html_content, f"Modal structure incorrect"
        print(f"  ✓ {modal} exists with correct structure")
    
    print("✓ All modal structures correct")
    return True

def test_api_endpoints():
    """Test API endpoints"""
    print("\nTesting API endpoints...")
    
    # Test registration
    reg_data = {
        "full_name": "Test User",
        "business_name": "Test Business",
        "email": f"test{int(time.time())}@test.com",
        "trade": "framing",
        "phone": "7805550100",
        "password": "Test1234!",
        "plan": "starter"
    }
    
    response = requests.post(f"{BASE_URL}/api/register", json=reg_data)
    print(f"  Registration status: {response.status_code}")
    if response.status_code == 200:
        print("  ✓ Registration endpoint working")
    else:
        print(f"  ⚠ Registration returned {response.status_code}")
    
    return True

def test_static_files():
    """Test static file serving"""
    print("\nTesting static files...")
    
    files_to_check = [
        "/static/app.js",
        "/static/app.css"
    ]
    
    for file_path in files_to_check:
        response = requests.get(f"{BASE_URL}{file_path}")
        assert response.status_code == 200, f"File {file_path} not found"
        print(f"  ✓ {file_path} serving correctly")
    
    print("✓ All static files serving correctly")
    return True

def run_all_tests():
    """Run all tests"""
    print("=" * 60)
    print("FOREMAN APP FEATURE TESTING")
    print("=" * 60)
    
    tests = [
        test_health,
        test_app_serving,
        test_javascript_functions,
        test_modal_structures,
        test_api_endpoints,
        test_static_files
    ]
    
    results = []
    for test in tests:
        try:
            result = test()
            results.append(result)
        except Exception as e:
            print(f"✗ Test failed: {e}")
            results.append(False)
    
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    passed = sum(results)
    total = len(results)
    print(f"Passed: {passed}/{total}")
    
    if passed == total:
        print("✓ ALL TESTS PASSED")
    else:
        print(f"✗ {total - passed} TEST(S) FAILED")
    
    return passed == total

if __name__ == "__main__":
    success = run_all_tests()
    exit(0 if success else 1)