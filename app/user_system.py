"""
Multi-Account User System
Admin oversees all registered accounts
"""

import hashlib
import hmac
import secrets
import os

# ─── bcrypt with graceful fallback ───────────────────────────────────────────
try:
    import bcrypt as _bcrypt
    _BCRYPT_AVAILABLE = True
except ImportError:
    _BCRYPT_AVAILABLE = False
    import logging as _log
    _log.getLogger(__name__).warning(
        "bcrypt not installed — falling back to SHA-256. "
        "Add 'bcrypt' to requirements.txt for production."
    )
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import logging

logger = logging.getLogger(__name__)

# ─── Persistence (FIX BUG-005) ───────────────────────────────────────────────
from app.persistence import save_users, load_users

# In-memory user store - loaded from disk on startup
users_db: Dict[str, Dict] = load_users()
user_sessions: Dict[str, Dict] = {}


def hash_password(password: str) -> str:
    """Hash a password using bcrypt (preferred) or SHA-256 fallback."""
    if _BCRYPT_AVAILABLE:
        salt = _bcrypt.gensalt(rounds=12)
        return _bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")
    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a password — supports bcrypt ($2b$) and legacy SHA-256."""
    try:
        if hashed.startswith("$2b$") or hashed.startswith("$2a$"):
            if _BCRYPT_AVAILABLE:
                return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
            return False  # bcrypt hash but library missing — deny safely
        # Legacy SHA-256 path
        return hmac.compare_digest(hashlib.sha256(plain.encode()).hexdigest(), hashed)
    except Exception:
        return False


def create_user(
    email: str,
    password: str,
    business_name: str,
    trade: str,
    contact_name: str,
    phone: str = "",
    plan: str = "starter"
) -> Dict:
    """Register a new user account"""
    if email in users_db:
        raise ValueError("Email already registered")

    user_id = secrets.token_hex(8)
    now = datetime.now()

    user = {
        "id": user_id,
        "email": email,
        "password_hash": hash_password(password),
        "business_name": business_name,
        "trade": trade,
        "contact_name": contact_name,
        "phone": phone,
        "plan": plan,
        "role": "user",
        "status": "active",
        "created_at": now.isoformat(),
        "last_login": None,
        "nda_accepted": False,
        "nda_accepted_at": None,
        "email_access_granted": False,
        "gdrive_access_granted": False,
        "email_settings": {
            "connected_email": "",
            "auto_reply_enabled": False,
            "follow_up_enabled": False,
            "priority_filter": True,
            "gdrive_folder_id": ""
        },
        "permissions": {
            "email_read": False,
            "email_send": False,
            "gdrive_read": False,
            "gdrive_write": False
        },
        "data": {
            "transactions": [],
            "invoices": [],
            "projects": [],
            "permits": [],
            "training_records": [],
            "emails": [],
            "documents": []
        },
        "stats": {
            "emails_processed": 0,
            "files_saved": 0,
            "auto_replies_sent": 0,
            "leads_converted": 0
        }
    }

    users_db[email] = user
    save_users(users_db)  # FIX BUG-005: persist to disk
    logger.info(f"New user registered: {email} ({business_name})")
    return user


def authenticate_user(email: str, password: str) -> Optional[Dict]:
    """Authenticate a user"""
    user = users_db.get(email)
    if not user:
        return None
    if not verify_password(password, user["password_hash"]):
        return None

    # Create session
    token = secrets.token_urlsafe(64)
    expires = datetime.now() + timedelta(hours=24)
    session = {
        "token": token,
        "user_id": user["id"],
        "email": email,
        "expires_at": expires.isoformat()
    }
    user_sessions[token] = session
    user["last_login"] = datetime.now().isoformat()
    logger.info(f"User logged in: {email}")
    return {"user": user, "token": token, "expires_at": expires.isoformat()}


def verify_user_token(token: str) -> Optional[Dict]:
    """Verify a user session token"""
    session = user_sessions.get(token)
    if not session:
        return None
    if datetime.now() > datetime.fromisoformat(session["expires_at"]):
        del user_sessions[token]
        return None
    email = session["email"]
    return users_db.get(email)


def get_all_users() -> List[Dict]:
    """Get all users (admin only)"""
    return [
        {k: v for k, v in u.items() if k != "password_hash"}
        for u in users_db.values()
    ]


def get_user_by_id(user_id: str) -> Optional[Dict]:
    for u in users_db.values():
        if u["id"] == user_id:
            return u
    return None


def update_user_permissions(email: str, permissions: Dict) -> bool:
    user = users_db.get(email)
    if not user:
        return False
    user["permissions"].update(permissions)
    return True


def accept_nda(email: str) -> bool:
    user = users_db.get(email)
    if not user:
        return False
    user["nda_accepted"] = True
    user["nda_accepted_at"] = datetime.now().isoformat()
    return True


def grant_email_access(email: str) -> bool:
    user = users_db.get(email)
    if not user:
        return False
    user["email_access_granted"] = True
    user["permissions"]["email_read"] = True
    user["permissions"]["email_send"] = True
    return True


def grant_gdrive_access(email: str) -> bool:
    user = users_db.get(email)
    if not user:
        return False
    user["gdrive_access_granted"] = True
    user["permissions"]["gdrive_read"] = True
    user["permissions"]["gdrive_write"] = True
    return True


def get_platform_stats() -> Dict:
    """Get overall platform statistics for admin"""
    total = len(users_db)
    active = sum(1 for u in users_db.values() if u["status"] == "active")
    nda_signed = sum(1 for u in users_db.values() if u["nda_accepted"])
    email_connected = sum(1 for u in users_db.values() if u["email_access_granted"])
    gdrive_connected = sum(1 for u in users_db.values() if u["gdrive_access_granted"])

    plans = {"starter": 0, "professional": 0, "business": 0}
    for u in users_db.values():
        plans[u.get("plan", "starter")] = plans.get(u.get("plan", "starter"), 0) + 1

    return {
        "total_users": total,
        "active_users": active,
        "nda_signed": nda_signed,
        "email_connected": email_connected,
        "gdrive_connected": gdrive_connected,
        "plans": plans,
        "monthly_revenue_estimate": (
            plans["starter"] * 49 +
            plans["professional"] * 149 +
            plans["business"] * 299
        )
    }

# ─── Password Reset ───────────────────────────────────────────────────────────
_reset_tokens: Dict[str, Dict] = {}  # token -> {email, expires_at}

def create_reset_token(email: str) -> Optional[str]:
    """Create a password-reset token for the given email. Returns None if email not found."""
    if email not in users_db:
        return None  # silently return None (don't reveal whether email exists)
    token = secrets.token_urlsafe(32)
    expires = datetime.now() + timedelta(hours=1)
    _reset_tokens[token] = {"email": email, "expires_at": expires.isoformat()}
    return token

def reset_password(token: str, new_password: str) -> bool:
    """Reset password using a valid token. Returns True on success."""
    entry = _reset_tokens.get(token)
    if not entry:
        return False
    if datetime.now() > datetime.fromisoformat(entry["expires_at"]):
        del _reset_tokens[token]
        return False
    email = entry["email"]
    user = users_db.get(email)
    if not user:
        return False
    user["password_hash"] = hash_password(new_password)
    save_users(users_db)
    del _reset_tokens[token]
    logger.info(f"Password reset for: {email}")
    return True

def update_password(email: str, old_password: str, new_password: str) -> bool:
    """Change password after verifying the old one."""
    user = users_db.get(email)
    if not user:
        return False
    if not verify_password(old_password, user["password_hash"]):
        return False
    user["password_hash"] = hash_password(new_password)
    save_users(users_db)
    return True
