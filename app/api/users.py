"""
User Registration, Login, NDA, and Permissions API
"""

from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel, EmailStr
from typing import Optional, List
import logging
import time
from collections import defaultdict

from app.user_system import (
    create_user, authenticate_user, verify_user_token,
    accept_nda, grant_email_access, grant_gdrive_access,
    get_all_users, get_platform_stats, update_user_permissions,
    users_db
)
from app.nda_generator import (
    generate_nda, generate_email_permission_request,
    generate_gdrive_permission_request
)
from app.admin_auth import verify_admin_token
from app.persistence import save_users

logger = logging.getLogger(__name__)
router = APIRouter()

# ─── Simple in-memory rate limiter ───────────────────────────────────────────
_login_attempts: dict = defaultdict(list)  # ip -> [timestamps]
RATE_LIMIT_MAX   = 10   # max attempts
RATE_LIMIT_WINDOW = 300  # per 5 minutes

def _check_rate_limit(ip: str):
    now = time.time()
    attempts = [t for t in _login_attempts[ip] if now - t < RATE_LIMIT_WINDOW]
    _login_attempts[ip] = attempts
    if len(attempts) >= RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail=f"Too many login attempts. Please wait {RATE_LIMIT_WINDOW // 60} minutes."
        )
    _login_attempts[ip].append(now)

# ─── Models ───────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str
    password: str
    business_name: str
    trade: str
    contact_name: str
    phone: Optional[str] = ""
    plan: Optional[str] = "starter"

class LoginRequest(BaseModel):
    email: str
    password: str

class AcceptNDARequest(BaseModel):
    accepted: bool
    signature: str  # Full name as digital signature

class EmailSettingsRequest(BaseModel):
    connected_email: Optional[str] = None
    auto_reply_enabled: Optional[bool] = None
    follow_up_enabled: Optional[bool] = None
    priority_filter: Optional[bool] = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_current_user(authorization: Optional[str]) -> dict:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization required")
    token = authorization.replace("Bearer ", "").strip()
    user = verify_user_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user

def get_business_config():
    from app.config import config
    return {
        "business_name": config.BUSINESS_NAME,
        "business_address": config.BUSINESS_ADDRESS,
        "business_phone": config.BUSINESS_PHONE,
        "business_email": config.BUSINESS_EMAIL,
        "contact_name": config.CONTACT_PERSON,
        "trade": config.BUSINESS_TYPE
    }


# ─── Registration & Auth ──────────────────────────────────────────────────────

@router.post("/register")
async def register(request: RegisterRequest, req: Request):
    """Register a new user account"""
    client_ip = req.client.host if req.client else "unknown"
    _check_rate_limit(client_ip)
    if len(request.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    try:
        user = create_user(
            email=request.email,
            password=request.password,
            business_name=request.business_name,
            trade=request.trade,
            contact_name=request.contact_name,
            phone=request.phone,
            plan=request.plan
        )
        # Send welcome email (non-blocking — don't fail if email fails)
        try:
            from app.email_sender import send_welcome_email
            send_welcome_email(
                request.email,
                request.contact_name,
                request.business_name,
                request.plan or "starter"
            )
        except Exception as e:
            logger.warning(f"Welcome email failed: {e}")
        return {
            "success": True,
            "message": "Account created successfully",
            "user_id": user["id"],
            "next_step": "Please review and accept the NDA to activate all features"
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login")
async def login(request: LoginRequest, req: Request):
    """User login"""
    client_ip = req.client.host if req.client else "unknown"
    _check_rate_limit(client_ip)
    result = authenticate_user(request.email, request.password)
    if not result:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    user = result["user"]
    return {
        "success": True,
        "token": result["token"],
        "expires_at": result["expires_at"],
        "user": {
            "id": user["id"],
            "email": user["email"],
            "business_name": user["business_name"],
            "trade": user["trade"],
            "contact_name": user["contact_name"],
            "plan": user["plan"],
            "role": user.get("role", "user"),
            "nda_accepted": user["nda_accepted"],
            "email_access_granted": user["email_access_granted"],
            "gdrive_access_granted": user["gdrive_access_granted"]
        }
    }


@router.get("/me")
async def get_profile(authorization: Optional[str] = Header(None)):
    """Get current user profile"""
    user = get_current_user(authorization)
    profile = {k: v for k, v in user.items() if k != "password_hash"}
    # Always ensure role is present (backfill for users created before BUG-NEW-F fix)
    if "role" not in profile:
        profile["role"] = "user"
    return profile


# ─── NDA ──────────────────────────────────────────────────────────────────────

@router.get("/nda")
async def get_nda(authorization: Optional[str] = Header(None)):
    """Get NDA document for user to review"""
    user = get_current_user(authorization)
    config = get_business_config()
    nda_text = generate_nda(user, config)
    return {
        "nda_text": nda_text,
        "already_accepted": user["nda_accepted"],
        "accepted_at": user.get("nda_accepted_at")
    }


@router.post("/nda/accept")
async def accept_nda_endpoint(
    request: AcceptNDARequest,
    authorization: Optional[str] = Header(None)
):
    """Accept the NDA"""
    user = get_current_user(authorization)
    if not request.accepted:
        raise HTTPException(status_code=400, detail="NDA must be accepted to proceed")
    if not request.signature:
        raise HTTPException(status_code=400, detail="Digital signature required")

    accept_nda(user["email"])
    logger.info(f"NDA accepted by {user['email']} with signature: {request.signature}")
    return {
        "success": True,
        "message": "NDA accepted successfully",
        "next_steps": [
            "Grant email access to enable auto-replies",
            "Grant Google Drive access to enable file management"
        ]
    }


# ─── Permissions ──────────────────────────────────────────────────────────────

@router.get("/permissions/email")
async def get_email_permission_info(authorization: Optional[str] = Header(None)):
    """Get email permission request details"""
    user = get_current_user(authorization)
    if not user["nda_accepted"]:
        raise HTTPException(status_code=403, detail="Please accept the NDA first")
    config = get_business_config()
    return generate_email_permission_request(user, config)


@router.post("/permissions/email/grant")
async def grant_email_permission(authorization: Optional[str] = Header(None)):
    """Grant email access permission"""
    user = get_current_user(authorization)
    if not user["nda_accepted"]:
        raise HTTPException(status_code=403, detail="Please accept the NDA first")
    grant_email_access(user["email"])
    return {
        "success": True,
        "message": "Email access granted",
        "features_enabled": [
            "Auto-reply to new leads",
            "Follow-up email scheduling",
            "Email priority categorization",
            "Attachment extraction"
        ]
    }


@router.post("/permissions/email/revoke")
async def revoke_email_permission(authorization: Optional[str] = Header(None)):
    """Revoke email access permission"""
    user = get_current_user(authorization)
    update_user_permissions(user["email"], {
        "email_read": False, "email_send": False
    })
    users_db[user["email"]]["email_access_granted"] = False
    save_users(users_db)  # persist
    return {"success": True, "message": "Email access revoked"}


@router.get("/permissions/gdrive")
async def get_gdrive_permission_info(authorization: Optional[str] = Header(None)):
    """Get Google Drive permission request details"""
    user = get_current_user(authorization)
    if not user["nda_accepted"]:
        raise HTTPException(status_code=403, detail="Please accept the NDA first")
    config = get_business_config()
    return generate_gdrive_permission_request(user, config)


@router.post("/permissions/gdrive/grant")
async def grant_gdrive_permission(authorization: Optional[str] = Header(None)):
    """Grant Google Drive access permission"""
    user = get_current_user(authorization)
    if not user["nda_accepted"]:
        raise HTTPException(status_code=403, detail="Please accept the NDA first")
    grant_gdrive_access(user["email"])
    return {
        "success": True,
        "message": "Google Drive access granted",
        "folder_structure": "We'll create your business folder structure automatically",
        "features_enabled": [
            "Auto-save email attachments",
            "Organized folder structure",
            "Document categorization",
            "File management"
        ]
    }


@router.post("/permissions/gdrive/revoke")
async def revoke_gdrive_permission(authorization: Optional[str] = Header(None)):
    """Revoke Google Drive access permission"""
    user = get_current_user(authorization)
    update_user_permissions(user["email"], {
        "gdrive_read": False, "gdrive_write": False
    })
    users_db[user["email"]]["gdrive_access_granted"] = False
    save_users(users_db)  # persist
    return {"success": True, "message": "Google Drive access revoked"}


# ─── Email Settings ───────────────────────────────────────────────────────────

@router.get("/email-settings")
async def get_email_settings(authorization: Optional[str] = Header(None)):
    """Get user email settings"""
    user = get_current_user(authorization)
    return user.get("email_settings", {})


@router.put("/email-settings")
async def update_email_settings(
    request: EmailSettingsRequest,
    authorization: Optional[str] = Header(None)
):
    """Update user email settings"""
    user = get_current_user(authorization)
    settings = user.get("email_settings", {})
    if request.connected_email is not None:
        settings["connected_email"] = request.connected_email
    if request.auto_reply_enabled is not None:
        settings["auto_reply_enabled"] = request.auto_reply_enabled
    if request.follow_up_enabled is not None:
        settings["follow_up_enabled"] = request.follow_up_enabled
    if request.priority_filter is not None:
        settings["priority_filter"] = request.priority_filter
    users_db[user["email"]]["email_settings"] = settings
    save_users(users_db)  # persist
    return {"success": True, "settings": settings}


# ─── Admin: All Users ─────────────────────────────────────────────────────────

@router.get("/admin/all")
async def admin_get_all_users(authorization: Optional[str] = Header(None)):
    """Admin: Get all registered users"""
    token = authorization.replace("Bearer ", "").strip() if authorization else ""
    if not verify_admin_token(token):
        raise HTTPException(status_code=401, detail="Admin access required")
    return {"users": get_all_users(), "stats": get_platform_stats()}


@router.get("/admin/stats")
async def admin_get_stats(authorization: Optional[str] = Header(None)):
    """Admin: Get platform statistics"""
    token = authorization.replace("Bearer ", "").strip() if authorization else ""
    if not verify_admin_token(token):
        raise HTTPException(status_code=401, detail="Admin access required")
    return get_platform_stats()

# ─── Change Password (FIX BUG-003) ──────────────────────────────────────────
class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str

@router.post("/change-password")
async def change_password(request: ChangePasswordRequest, authorization: Optional[str] = Header(None)):
    """Change user password securely via API - never store passwords client-side."""
    from app.user_system import verify_user_token, verify_password, hash_password
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.replace("Bearer ", "").strip()
    user = verify_user_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    if request.new_password != request.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    if len(request.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    db_user = users_db.get(user["email"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(request.current_password, db_user["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    users_db[user["email"]]["password_hash"] = hash_password(request.new_password)
    save_users(users_db)
    return {"success": True, "message": "Password changed successfully"}


# ─── User Store Sync (FIX BUG-001) ──────────────────────────────────────────
class StoreSyncRequest(BaseModel):
    store: dict

@router.put("/store")
async def sync_user_store(request: StoreSyncRequest, authorization: Optional[str] = Header(None)):
    """Sync frontend localStorage store to server. Called by syncStore() in app.js."""
    from app.user_system import verify_user_token
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.replace("Bearer ", "").strip()
    user = verify_user_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    db_user = users_db.get(user["email"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    # Merge store data into user record
    if "store" not in db_user:
        db_user["store"] = {}
    db_user["store"].update(request.store)
    db_user["store"]["last_synced"] = __import__('datetime').datetime.now().isoformat()
    save_users(users_db)
    return {"success": True, "message": "Store synced"}

@router.get("/store")
async def get_user_store(authorization: Optional[str] = Header(None)):
    """Get user's synced store data."""
    from app.user_system import verify_user_token
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.replace("Bearer ", "").strip()
    user = verify_user_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    db_user = users_db.get(user["email"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"store": db_user.get("store", {}), "success": True}


# ─── Password Reset Endpoints ─────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

@router.post("/forgot-password")
async def forgot_password(request: ForgotPasswordRequest, req: Request):
    """Send password reset email. Always returns success to prevent email enumeration."""
    from app.user_system import create_reset_token
    from app.email_sender import send_password_reset
    from app.user_system import users_db
    client_ip = req.client.host if req.client else "unknown"
    _check_rate_limit(client_ip)
    token = create_reset_token(request.email)
    if token:
        user = users_db.get(request.email, {})
        send_password_reset(request.email, token, user.get("contact_name", ""))
    # Always return success (don't reveal if email exists)
    return {"success": True, "message": "If that email exists, a reset link has been sent."}

@router.post("/reset-password")
async def reset_password_endpoint(request: ResetPasswordRequest):
    """Reset password using a token from the reset email."""
    from app.user_system import reset_password
    if len(request.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    success = reset_password(request.token, request.new_password)
    if not success:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    return {"success": True, "message": "Password reset successfully. You can now log in."}

@router.post("/change-password")
async def change_password(request: ChangePasswordRequest, authorization: Optional[str] = Header(None)):
    """Change password while logged in."""
    user = get_current_user(authorization)
    from app.user_system import update_password
    success = update_password(user["email"], request.old_password, request.new_password)
    if not success:
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    return {"success": True, "message": "Password changed successfully"}


# ─── Invoice Email Endpoint ───────────────────────────────────────────────────

class SendInvoiceEmailRequest(BaseModel):
    to_email: str
    client_name: str
    invoice_number: str
    invoice_total: str
    due_date: str
    business_name: Optional[str] = "The Foreman AI"

@router.post("/send-invoice-email")
async def send_invoice_email_endpoint(
    request: SendInvoiceEmailRequest,
    authorization: Optional[str] = Header(None)
):
    """Send an invoice email to a client."""
    get_current_user(authorization)  # auth check
    from app.email_sender import send_invoice_email
    success = send_invoice_email(
        to_email=request.to_email,
        client_name=request.client_name,
        invoice_number=request.invoice_number,
        invoice_total=request.invoice_total,
        due_date=request.due_date,
        business_name=request.business_name or "The Foreman AI"
    )
    if not success:
        raise HTTPException(
            status_code=503,
            detail="Email could not be sent. Check SMTP settings in Render environment variables."
        )
    return {"success": True, "message": f"Invoice emailed to {request.to_email}"}
