"""
Admin Authentication System
Secure JWT-based authentication for admin access only
BUG-018 FIX: Migrated from SHA-256 to bcrypt for password hashing
"""

import os
import secrets
import hashlib
import hmac
from datetime import datetime, timedelta
from typing import Optional, Dict
import logging

logger = logging.getLogger(__name__)

# ============================================================
# BCRYPT — imported with graceful fallback to SHA-256
# ============================================================
try:
    import bcrypt as _bcrypt
    _BCRYPT_AVAILABLE = True
except ImportError:
    _BCRYPT_AVAILABLE = False
    logger.warning("bcrypt not available — falling back to SHA-256 (install bcrypt for production)")

# ============================================================
# ADMIN CREDENTIALS - CHANGE THESE BEFORE DEPLOYMENT
# ============================================================
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")

# Support both bcrypt hashes ($2b$...) and legacy SHA-256 hashes
# Default is the bcrypt hash of "ChangeMe2024!" — MUST change in .env
_DEFAULT_BCRYPT_HASH = "$2b$12$KFH96eyMZYtkIAAVhV/hcelD34dxn1XR4wG7hX8yACAIsndbIlS2y"
_DEFAULT_SHA256_HASH = "400136f398d0be8f9e12dd5878c076787470b0a978f2d146852631bd2c477cfb"

ADMIN_PASSWORD_HASH = os.environ.get(
    "ADMIN_PASSWORD_HASH", ""
) or (_DEFAULT_BCRYPT_HASH if _BCRYPT_AVAILABLE else _DEFAULT_SHA256_HASH)

SECRET_KEY = os.environ.get(
    "ADMIN_SECRET_KEY",
    "alberta-construction-admin-secret-key-change-in-production-2024"
)
TOKEN_EXPIRE_HOURS = int(os.environ.get("ADMIN_TOKEN_EXPIRE_HOURS", "8"))

# In-memory session store (use Redis in production)
active_sessions: Dict[str, Dict] = {}


def hash_password(password: str) -> str:
    """Hash a password using bcrypt (preferred) or SHA-256 fallback"""
    if _BCRYPT_AVAILABLE:
        salt = _bcrypt.gensalt(rounds=12)
        return _bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")
    # Legacy SHA-256 fallback
    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password — supports bcrypt hashes ($2b$) and legacy SHA-256"""
    try:
        if hashed_password.startswith("$2b$") or hashed_password.startswith("$2a$"):
            if _BCRYPT_AVAILABLE:
                return _bcrypt.checkpw(
                    plain_password.encode("utf-8"),
                    hashed_password.encode("utf-8")
                )
            # bcrypt hash but library not available — deny access safely
            logger.error("bcrypt hash stored but bcrypt library not installed")
            return False
        # Legacy SHA-256 path
        return hmac.compare_digest(
            hashlib.sha256(plain_password.encode()).hexdigest(),
            hashed_password
        )
    except Exception as e:
        logger.error(f"Password verification error: {e}")
        return False


def create_session_token() -> str:
    """Create a secure random session token"""
    return secrets.token_urlsafe(64)


def create_admin_session(username: str) -> Dict:
    """Create a new admin session"""
    token = create_session_token()
    expires_at = datetime.now() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    
    session = {
        "token": token,
        "username": username,
        "created_at": datetime.now().isoformat(),
        "expires_at": expires_at.isoformat(),
        "is_valid": True
    }
    
    active_sessions[token] = session
    logger.info(f"Admin session created for {username}")
    return session


def verify_admin_token(token: str) -> Optional[Dict]:
    """Verify an admin session token"""
    if not token:
        return None
    
    session = active_sessions.get(token)
    if not session:
        return None
    
    # Check expiry
    expires_at = datetime.fromisoformat(session["expires_at"])
    if datetime.now() > expires_at:
        del active_sessions[token]
        logger.warning("Admin session expired")
        return None
    
    if not session.get("is_valid"):
        return None
    
    return session


def invalidate_session(token: str) -> bool:
    """Invalidate an admin session (logout)"""
    if token in active_sessions:
        del active_sessions[token]
        logger.info("Admin session invalidated")
        return True
    return False


def authenticate_admin(username: str, password: str) -> Optional[Dict]:
    """Authenticate admin credentials"""
    if username != ADMIN_USERNAME:
        logger.warning(f"Failed admin login attempt for username: {username}")
        return None
    
    if not verify_password(password, ADMIN_PASSWORD_HASH):
        logger.warning(f"Failed admin login attempt - wrong password for: {username}")
        return None
    
    return create_admin_session(username)


def get_active_sessions_count() -> int:
    """Get count of active sessions"""
    now = datetime.now()
    valid = [
        s for s in active_sessions.values()
        if datetime.fromisoformat(s["expires_at"]) > now
    ]
    return len(valid)


def cleanup_expired_sessions():
    """Remove expired sessions"""
    now = datetime.now()
    expired = [
        token for token, session in active_sessions.items()
        if datetime.fromisoformat(session["expires_at"]) <= now
    ]
    for token in expired:
        del active_sessions[token]
    return len(expired)