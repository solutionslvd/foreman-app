"""
Settings API - In-app customization endpoints
Admin-only and user-level settings with proper RBAC
"""

from fastapi import APIRouter, HTTPException, Depends, Header
from typing import Optional, Dict, Any
from pydantic import BaseModel
import logging

from app.settings_manager import settings_manager
from app.admin_auth import verify_admin_token
from app.user_system import verify_user_token

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================
# HELPERS
# ============================================================
def get_admin_from_header(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Admin authentication required")
    token = authorization.replace("Bearer ", "")
    session = verify_admin_token(token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")
    return session

def get_user_from_header(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.replace("Bearer ", "")
    user = verify_user_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user


# ============================================================
# PUBLIC SETTINGS (no auth required)
# ============================================================
@router.get("/public")
async def get_public_settings():
    """Get public-facing settings (branding, app name, etc.)"""
    return settings_manager.get_public_settings()


# ============================================================
# ADMIN SETTINGS ENDPOINTS
# ============================================================

@router.get("/admin/all")
async def get_all_settings(admin=Depends(get_admin_from_header)):
    """Get ALL settings - admin only"""
    return settings_manager.get_all()


@router.get("/admin/branding")
async def get_branding(admin=Depends(get_admin_from_header)):
    return settings_manager.get("branding")

@router.put("/admin/branding")
async def update_branding(data: Dict[str, Any], admin=Depends(get_admin_from_header)):
    """Update branding settings - admin only"""
    try:
        updated = settings_manager.update_branding(data)
        return {"success": True, "branding": updated}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/admin/business")
async def get_business(admin=Depends(get_admin_from_header)):
    return settings_manager.get("business")

@router.put("/admin/business")
async def update_business(data: Dict[str, Any], admin=Depends(get_admin_from_header)):
    """Update business info - admin only"""
    try:
        updated = settings_manager.update_business(data)
        return {"success": True, "business": updated}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/admin/ai")
async def get_ai_settings(admin=Depends(get_admin_from_header)):
    return settings_manager.get("ai")

@router.put("/admin/ai")
async def update_ai_settings(data: Dict[str, Any], admin=Depends(get_admin_from_header)):
    """Update AI assistant settings - admin only"""
    try:
        updated = settings_manager.update_ai_settings(data)
        return {"success": True, "ai": updated}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/admin/financial")
async def get_financial_settings(admin=Depends(get_admin_from_header)):
    return settings_manager.get("financial")

@router.put("/admin/financial")
async def update_financial_settings(data: Dict[str, Any], admin=Depends(get_admin_from_header)):
    """Update financial settings - admin only"""
    try:
        updated = settings_manager.update_financial_settings(data)
        return {"success": True, "financial": updated}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/admin/compliance")
async def get_compliance_settings(admin=Depends(get_admin_from_header)):
    return settings_manager.get("compliance")

@router.put("/admin/compliance")
async def update_compliance_settings(data: Dict[str, Any], admin=Depends(get_admin_from_header)):
    """Update compliance settings - admin only"""
    try:
        updated = settings_manager.update_compliance_settings(data)
        return {"success": True, "compliance": updated}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/admin/notifications")
async def get_notification_settings(admin=Depends(get_admin_from_header)):
    return settings_manager.get("notifications")

@router.put("/admin/notifications")
async def update_notification_settings(data: Dict[str, Any], admin=Depends(get_admin_from_header)):
    try:
        updated = settings_manager.update_section("notifications", data, is_admin=True)
        return {"success": True, "notifications": updated}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/admin/integrations")
async def get_integrations(admin=Depends(get_admin_from_header)):
    return settings_manager.get("integrations")

@router.put("/admin/integrations")
async def update_integrations(data: Dict[str, Any], admin=Depends(get_admin_from_header)):
    try:
        updated = settings_manager.update_section("integrations", data, is_admin=True)
        return {"success": True, "integrations": updated}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/admin/subscription")
async def get_subscription(admin=Depends(get_admin_from_header)):
    return settings_manager.get("subscription")

@router.put("/admin/subscription")
async def update_subscription(data: Dict[str, Any], admin=Depends(get_admin_from_header)):
    try:
        updated = settings_manager.update_section("subscription", data, is_admin=True)
        return {"success": True, "subscription": updated}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


class PasswordChange(BaseModel):
    new_password: str
    confirm_password: str

@router.post("/admin/change-password")
async def change_admin_password(data: PasswordChange, admin=Depends(get_admin_from_header)):
    """Change admin password - admin only"""
    if data.new_password != data.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    if len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    new_hash = settings_manager.change_admin_password(data.new_password)
    return {
        "success": True,
        "message": "Password changed successfully",
        "new_hash": new_hash,
        "note": "Save this hash in your .env as ADMIN_PASSWORD_HASH"
    }


# ============================================================
# USER SETTINGS (authenticated users - limited)
# ============================================================

@router.get("/user/preferences")
async def get_user_preferences(user=Depends(get_user_from_header)):
    """Get user's own preferences"""
    user_prefs = user.get("preferences", {})
    defaults = settings_manager.get("user_defaults")
    return {**defaults, **user_prefs}

@router.put("/user/preferences")
async def update_user_preferences(data: Dict[str, Any], user=Depends(get_user_from_header)):
    """Update user's own preferences - limited fields only"""
    ALLOWED_USER_FIELDS = {
        "theme", "language", "timezone", "date_format",
        "notifications_push", "notifications_email",
        "dashboard_widgets", "default_view", "currency_display"
    }
    # Filter to only allowed fields
    filtered = {k: v for k, v in data.items() if k in ALLOWED_USER_FIELDS}
    if not filtered:
        raise HTTPException(status_code=400, detail="No valid preference fields provided")

    # In production, save per-user. For now update defaults.
    updated = settings_manager.update_user_preferences(filtered)
    return {"success": True, "preferences": filtered, "message": "Preferences updated"}

@router.get("/user/role-permissions")
async def get_role_permissions(user=Depends(get_user_from_header)):
    """Get what the current user's role can and cannot do"""
    from app.roles import UserRole, get_restricted_settings_for_role, get_role_permissions
    role_str = user.get("role", "client")
    try:
        role = UserRole(role_str)
    except ValueError:
        role = UserRole.CLIENT

    return {
        "role": role.value,
        "permissions": get_role_permissions(role),
        "settings_access": get_restricted_settings_for_role(role),
        "can_access_admin_panel": role == UserRole.ADMIN,
        "can_change_business_settings": role == UserRole.ADMIN,
        "can_change_financial_settings": role == UserRole.ADMIN,
        "can_change_branding": role == UserRole.ADMIN,
        "can_manage_users": role in {UserRole.ADMIN},
        "can_view_all_financials": role in {UserRole.ADMIN, UserRole.MANAGER},
        "can_create_invoices": role in {UserRole.ADMIN, UserRole.MANAGER},
        "can_view_reports": role in {UserRole.ADMIN, UserRole.MANAGER},
    }