#!/usr/bin/env python3
"""Create a test user account that will work on next server restart"""

from app.user_system import create_user, users_db

# Create a test user
try:
    user = create_user(
        email="test@foreman.ca",
        password="Test1234!",
        business_name="Test Construction Ltd.",
        trade="Framing",
        contact_name="Test User",
        phone="780-555-1234",
        plan="pro"
    )
    print(f"✅ Test user created successfully!")
    print(f"\nLogin credentials:")
    print(f"  Email: test@foreman.ca")
    print(f"  Password: Test1234!")
    print(f"\nUser ID: {user['id']}")
    print(f"Business: {user['business_name']}")
except ValueError as e:
    print(f"❌ Error creating user: {e}")
    print("\nUser may already exist or there was another issue.")
    # Check if user already exists
    if "test@foreman.ca" in users_db:
        print("\nUser 'test@foreman.ca' already exists in users_db:")
        u = users_db["test@foreman.ca"]
        print(f"  Business: {u['business_name']}")
        print(f"  ID: {u['id']}")