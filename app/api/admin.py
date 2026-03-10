"""
Admin API Routes
All admin endpoints - protected by authentication
"""

from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime
import logging
import os
import sys

from app.admin_auth import (
    authenticate_admin,
    verify_admin_token,
    invalidate_session,
    get_active_sessions_count,
    cleanup_expired_sessions,
    hash_password,
    ADMIN_USERNAME
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Request Models ───────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class ConfigUpdateRequest(BaseModel):
    section: str
    key: str
    value: Any

class AISettingsRequest(BaseModel):
    ai_name: Optional[str] = None
    trade_specialization: Optional[str] = None
    custom_responses: Optional[Dict[str, str]] = None

class FinancialSettingsRequest(BaseModel):
    gst_rate: Optional[float] = None
    invoice_prefix: Optional[str] = None
    payment_terms: Optional[str] = None
    late_fee_percentage: Optional[float] = None

class ComplianceSettingsRequest(BaseModel):
    safety_inspection_frequency: Optional[str] = None
    safety_training_required: Optional[List[str]] = None
    wcb_rates: Optional[Dict[str, float]] = None

class BusinessInfoRequest(BaseModel):
    business_name: Optional[str] = None
    business_type: Optional[str] = None
    business_address: Optional[str] = None
    business_phone: Optional[str] = None
    business_email: Optional[str] = None
    contact_person: Optional[str] = None
    contact_title: Optional[str] = None


# ─── Auth Helper ──────────────────────────────────────────────────────────────

def require_admin(authorization: Optional[str] = None) -> Dict:
    """Verify admin token from Authorization header"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    token = authorization.replace("Bearer ", "").strip()
    session = verify_admin_token(token)
    
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")
    
    return session


# ─── Auth Endpoints ───────────────────────────────────────────────────────────

@router.post("/login")
async def admin_login(request: LoginRequest):
    """Admin login endpoint"""
    session = authenticate_admin(request.username, request.password)
    
    if not session:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    logger.info(f"Admin logged in: {request.username}")
    return {
        "success": True,
        "token": session["token"],
        "username": session["username"],
        "expires_at": session["expires_at"],
        "message": "Login successful"
    }


@router.post("/logout")
async def admin_logout(authorization: Optional[str] = Header(None)):
    """Admin logout endpoint"""
    session = require_admin(authorization)
    token = authorization.replace("Bearer ", "").strip()
    invalidate_session(token)
    return {"success": True, "message": "Logged out successfully"}


@router.get("/verify")
async def verify_token(authorization: Optional[str] = Header(None)):
    """Verify admin token is valid"""
    session = require_admin(authorization)
    return {
        "valid": True,
        "username": session["username"],
        "expires_at": session["expires_at"]
    }


# ─── Dashboard ────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def admin_dashboard(authorization: Optional[str] = Header(None)):
    """Get admin dashboard overview"""
    require_admin(authorization)
    
    from app.financial_system import financial_system
    from app.compliance_engine import compliance_engine
    from app.config import config
    from app.user_system import get_platform_stats, get_all_users
    from app.email_ai import email_ai
    
    financial_summary = financial_system.get_financial_summary()
    compliance_status = compliance_engine.get_compliance_status()
    platform_stats = get_platform_stats()
    email_stats = email_ai.get_email_stats()
    
    return {
        "system": {
            "status": "running",
            "uptime": "active",
            "active_sessions": get_active_sessions_count(),
            "python_version": sys.version,
            "timestamp": datetime.now().isoformat()
        },
        "business": {
            "name": config.BUSINESS_NAME,
            "type": config.BUSINESS_TYPE,
            "ai_name": config.AI_NAME
        },
        "financial": {
            "total_income": financial_summary["total_income"],
            "total_expenses": financial_summary["total_expenses"],
            "net_profit": financial_summary["net_profit"],
            "pending_invoices": financial_summary["pending_invoices_count"],
            "total_transactions": financial_summary["total_transactions"]
        },
        "compliance": {
            "score": compliance_status.get("compliance_score", 0),
            "overall_status": compliance_status.get("overall_status", "unknown"),
            "active_permits": len([p for p in compliance_engine.permits if p.get("status") == "active"]),
            "training_records": len(compliance_engine.training_records)
        },
        "platform": platform_stats,
        "email": email_stats
    }


@router.get("/users")
async def admin_get_all_users(authorization: Optional[str] = Header(None)):
    """Get all registered users"""
    require_admin(authorization)
    from app.user_system import get_all_users, get_platform_stats
    return {
        "users": get_all_users(),
        "stats": get_platform_stats()
    }


@router.put("/users/{user_email}/status")
async def admin_update_user_status(
    user_email: str,
    request: dict,
    authorization: Optional[str] = Header(None)
):
    """Update a user's status (active/suspended)"""
    require_admin(authorization)
    from app.user_system import users_db
    user = users_db.get(user_email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user["status"] = request.get("status", "active")
    return {"success": True, "message": f"User {user_email} status updated to {user['status']}"}


# ─── Business Settings ────────────────────────────────────────────────────────

@router.get("/settings/business")
async def get_business_settings(authorization: Optional[str] = Header(None)):
    """Get current business settings"""
    require_admin(authorization)
    from app.config import config
    
    return {
        "business_name": config.BUSINESS_NAME,
        "business_type": config.BUSINESS_TYPE,
        "business_address": config.BUSINESS_ADDRESS,
        "business_phone": config.BUSINESS_PHONE,
        "business_email": config.BUSINESS_EMAIL,
        "contact_person": config.CONTACT_PERSON,
        "contact_title": config.CONTACT_TITLE,
        "business_number": config.BUSINESS_NUMBER,
        "wcb_account_number": config.WCB_ACCOUNT_NUMBER
    }


@router.put("/settings/business")
async def update_business_settings(
    request: BusinessInfoRequest,
    authorization: Optional[str] = Header(None)
):
    """Update business settings"""
    require_admin(authorization)
    from app.config import config
    
    updated = {}
    if request.business_name is not None:
        config.BUSINESS_NAME = request.business_name
        updated["business_name"] = request.business_name
    if request.business_type is not None:
        config.BUSINESS_TYPE = request.business_type
        updated["business_type"] = request.business_type
    if request.business_address is not None:
        config.BUSINESS_ADDRESS = request.business_address
        updated["business_address"] = request.business_address
    if request.business_phone is not None:
        config.BUSINESS_PHONE = request.business_phone
        updated["business_phone"] = request.business_phone
    if request.business_email is not None:
        config.BUSINESS_EMAIL = request.business_email
        updated["business_email"] = request.business_email
    if request.contact_person is not None:
        config.CONTACT_PERSON = request.contact_person
        updated["contact_person"] = request.contact_person
    if request.contact_title is not None:
        config.CONTACT_TITLE = request.contact_title
        updated["contact_title"] = request.contact_title
    
    logger.info(f"Business settings updated: {list(updated.keys())}")
    return {"success": True, "updated": updated, "message": "Business settings updated"}


# ─── AI Settings ──────────────────────────────────────────────────────────────

@router.get("/settings/ai")
async def get_ai_settings(authorization: Optional[str] = Header(None)):
    """Get current AI settings"""
    require_admin(authorization)
    from app.config import config
    
    return {
        "ai_name": config.AI_NAME,
        "trade_specialization": config.AI_TRADE_SPECIALIZATION,
        "trade_knowledge": {
            "common_materials": config.TRADE_KNOWLEDGE.get("common_materials", []),
            "regulations": config.TRADE_KNOWLEDGE.get("regulations", [])
        }
    }


@router.put("/settings/ai")
async def update_ai_settings(
    request: AISettingsRequest,
    authorization: Optional[str] = Header(None)
):
    """Update AI settings"""
    require_admin(authorization)
    from app.config import config
    
    updated = {}
    if request.ai_name is not None:
        config.AI_NAME = request.ai_name
        updated["ai_name"] = request.ai_name
    if request.trade_specialization is not None:
        config.AI_TRADE_SPECIALIZATION = request.trade_specialization
        updated["trade_specialization"] = request.trade_specialization
    
    logger.info(f"AI settings updated: {list(updated.keys())}")
    return {"success": True, "updated": updated, "message": "AI settings updated"}


# ─── Financial Settings ───────────────────────────────────────────────────────

@router.get("/settings/financial")
async def get_financial_settings(authorization: Optional[str] = Header(None)):
    """Get current financial settings"""
    require_admin(authorization)
    from app.config import config
    
    return {
        "gst_rate": float(config.GST_RATE),
        "invoice_prefix": config.INVOICE_PREFIX,
        "payment_terms": config.INVOICE_PAYMENT_TERMS,
        "late_fee_percentage": float(config.INVOICE_LATE_FEE_PERCENTAGE),
        "wcb_rates": {k: float(v) for k, v in config.WCB_RATES.items()},
        "cpp_rate": float(config.CPP_RATE),
        "ei_rate": float(config.EI_RATE)
    }


@router.put("/settings/financial")
async def update_financial_settings(
    request: FinancialSettingsRequest,
    authorization: Optional[str] = Header(None)
):
    """Update financial settings"""
    require_admin(authorization)
    from app.config import config
    from decimal import Decimal
    
    updated = {}
    if request.gst_rate is not None:
        config.GST_RATE = Decimal(str(request.gst_rate))
        updated["gst_rate"] = request.gst_rate
    if request.invoice_prefix is not None:
        config.INVOICE_PREFIX = request.invoice_prefix
        updated["invoice_prefix"] = request.invoice_prefix
    if request.payment_terms is not None:
        config.INVOICE_PAYMENT_TERMS = request.payment_terms
        updated["payment_terms"] = request.payment_terms
    if request.late_fee_percentage is not None:
        config.INVOICE_LATE_FEE_PERCENTAGE = Decimal(str(request.late_fee_percentage))
        updated["late_fee_percentage"] = request.late_fee_percentage
    
    logger.info(f"Financial settings updated: {list(updated.keys())}")
    return {"success": True, "updated": updated, "message": "Financial settings updated"}


# ─── Compliance Settings ──────────────────────────────────────────────────────

@router.get("/settings/compliance")
async def get_compliance_settings(authorization: Optional[str] = Header(None)):
    """Get current compliance settings"""
    require_admin(authorization)
    from app.config import config
    
    return {
        "safety_inspection_frequency": config.SAFETY_INSPECTION_FREQUENCY,
        "safety_training_required": config.SAFETY_TRAINING_REQUIRED,
        "wcb_rates": {k: float(v) for k, v in config.WCB_RATES.items()}
    }


@router.put("/settings/compliance")
async def update_compliance_settings(
    request: ComplianceSettingsRequest,
    authorization: Optional[str] = Header(None)
):
    """Update compliance settings"""
    require_admin(authorization)
    from app.config import config
    from decimal import Decimal
    
    updated = {}
    if request.safety_inspection_frequency is not None:
        config.SAFETY_INSPECTION_FREQUENCY = request.safety_inspection_frequency
        updated["safety_inspection_frequency"] = request.safety_inspection_frequency
    if request.safety_training_required is not None:
        config.SAFETY_TRAINING_REQUIRED = request.safety_training_required
        updated["safety_training_required"] = request.safety_training_required
    if request.wcb_rates is not None:
        config.WCB_RATES = {k: Decimal(str(v)) for k, v in request.wcb_rates.items()}
        updated["wcb_rates"] = request.wcb_rates
    
    logger.info(f"Compliance settings updated: {list(updated.keys())}")
    return {"success": True, "updated": updated, "message": "Compliance settings updated"}


# ─── Data Management ──────────────────────────────────────────────────────────

@router.get("/data/financial")
async def get_all_financial_data(authorization: Optional[str] = Header(None)):
    """Get all financial data"""
    require_admin(authorization)
    from app.financial_system import financial_system
    
    return {
        "transactions": financial_system.transactions,
        "invoices": financial_system.invoices,
        "payroll_records": financial_system.payroll_records,
        "gst_tracking": {
            "collected": float(financial_system.gst_tracking["collected"]),
            "paid": float(financial_system.gst_tracking["paid"]),
            "net_remittance": float(financial_system.gst_tracking["net_remittance"])
        },
        "summary": financial_system.get_financial_summary()
    }


@router.get("/data/compliance")
async def get_all_compliance_data(authorization: Optional[str] = Header(None)):
    """Get all compliance data"""
    require_admin(authorization)
    from app.compliance_engine import compliance_engine
    
    return {
        "permits": compliance_engine.permits,
        "inspections": compliance_engine.inspections,
        "safety_records": compliance_engine.safety_records,
        "training_records": compliance_engine.training_records,
        "wcb_records": compliance_engine.wcb_records,
        "status": compliance_engine.get_compliance_status()
    }


@router.delete("/data/reset")
async def reset_all_data(authorization: Optional[str] = Header(None)):
    """Reset all application data (use with caution)"""
    require_admin(authorization)
    from app.financial_system import financial_system
    from app.compliance_engine import compliance_engine
    from decimal import Decimal
    
    # Reset financial data
    financial_system.transactions = []
    financial_system.invoices = []
    financial_system.payroll_records = []
    financial_system.tax_filings = []
    financial_system.gst_tracking = {
        "collected": Decimal("0.00"),
        "paid": Decimal("0.00"),
        "net_remittance": Decimal("0.00")
    }
    
    # Reset compliance data
    compliance_engine.permits = []
    compliance_engine.inspections = []
    compliance_engine.safety_records = []
    compliance_engine.training_records = []
    compliance_engine.wcb_records = {}
    
    logger.warning("All application data has been reset by admin")
    return {"success": True, "message": "All data has been reset"}


# ─── System Management ────────────────────────────────────────────────────────

@router.get("/system/status")
async def get_system_status(authorization: Optional[str] = Header(None)):
    """Get system status"""
    require_admin(authorization)
    
    cleanup_expired_sessions()
    
    return {
        "status": "running",
        "timestamp": datetime.now().isoformat(),
        "active_sessions": get_active_sessions_count(),
        "python_version": sys.version,
        "environment": os.environ.get("DEBUG_MODE", "false")
    }


@router.get("/system/logs")
async def get_recent_logs(authorization: Optional[str] = Header(None)):
    """Get recent system activity log"""
    require_admin(authorization)
    
    from app.financial_system import financial_system
    from app.compliance_engine import compliance_engine
    
    logs = []
    
    for t in financial_system.transactions[-20:]:
        logs.append({
            "time": str(t.get("created_at", "")),
            "type": "financial",
            "action": f"{t['type']} - ${t['amount']}",
            "detail": t.get("description", "")
        })
    
    for p in compliance_engine.permits[-10:]:
        logs.append({
            "time": str(p.get("created_at", "")),
            "type": "compliance",
            "action": f"Permit added - {p.get('permit_type', '')}",
            "detail": p.get("permit_number", "")
        })
    
    logs.sort(key=lambda x: x["time"], reverse=True)
    return {"logs": logs[:30]}


@router.post("/system/cleanup")
async def cleanup_sessions(authorization: Optional[str] = Header(None)):
    """Clean up expired sessions"""
    require_admin(authorization)
    count = cleanup_expired_sessions()
    return {"success": True, "cleaned": count, "message": f"Removed {count} expired sessions"}


# ─── Password Management ──────────────────────────────────────────────────────

@router.post("/change-password")
async def change_admin_password(
    request: dict,
    authorization: Optional[str] = Header(None)
):
    """Change admin password"""
    require_admin(authorization)
    
    current_password = request.get("current_password")
    new_password = request.get("new_password")
    
    if not current_password or not new_password:
        raise HTTPException(status_code=400, detail="Both current and new password required")
    
    if len(new_password) < 12:
        raise HTTPException(status_code=400, detail="New password must be at least 12 characters")
    
    from app.admin_auth import verify_password, ADMIN_PASSWORD_HASH, hash_password
    import app.admin_auth as auth_module
    
    if not verify_password(current_password, ADMIN_PASSWORD_HASH):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    
    # Update password hash in memory
    auth_module.ADMIN_PASSWORD_HASH = hash_password(new_password)
    
    logger.info("Admin password changed successfully")
    return {
        "success": True,
        "message": "Password changed successfully. Update ADMIN_PASSWORD_HASH in .env with the new hash.",
        "new_hash": hash_password(new_password)
    }
# ── Unified Settings (GET/PUT) ──────────────────────────────────────
_unified_settings: Dict = {}

@router.get("/settings")
async def get_unified_settings(authorization: Optional[str] = Header(None)):
    """Get all platform settings in one call"""
    require_admin(authorization)
    try:
        from app.settings_manager import settings_manager
        s = settings_manager.get_all()
        merged = {**s, **_unified_settings}
        return merged
    except Exception:
        return _unified_settings

@router.put("/settings")
async def update_unified_settings(
    request: dict,
    authorization: Optional[str] = Header(None)
):
    """Update any platform settings"""
    require_admin(authorization)
    _unified_settings.update(request)
    # Also try to persist via settings_manager
    try:
        from app.settings_manager import settings_manager
        # Try to update relevant sections
        if any(k in request for k in ["company_name", "gst_number", "wcb_account", "phone", "email", "website", "address"]):
            settings_manager.update_business(request)
        if any(k in request for k in ["ai_model", "max_tokens", "temperature", "system_prompt"]):
            settings_manager.update_ai_settings(request)
        if any(k in request for k in ["gst_rate", "payment_terms", "invoice_prefix", "estimate_prefix"]):
            settings_manager.update_financial_settings(request)
        if any(k in request for k in ["wcb_rate", "cpp_rate", "ei_rate"]):
            settings_manager.update_compliance_settings(request)
    except Exception:
        pass
    return {"success": True, "message": "Settings updated"}

# ── User CRUD ───────────────────────────────────────────────────────
@router.put("/users/{user_email}")
async def admin_update_user(
    user_email: str,
    request: dict,
    authorization: Optional[str] = Header(None)
):
    """Admin update user details"""
    require_admin(authorization)
    from app.user_system import users_db
    if user_email not in users_db:
        raise HTTPException(status_code=404, detail="User not found")
    user = users_db[user_email]
    for field in ["first_name", "last_name", "company_name", "status"]:
        if field in request and request[field] is not None:
            user[field] = request[field]
    if request.get("new_password"):
        from app.admin_auth import hash_password
        user["password_hash"] = hash_password(request["new_password"])
    logger.info(f"Admin updated user: {user_email}")
    return {"success": True, "message": f"User {user_email} updated"}

@router.delete("/users/{user_email}")
async def admin_delete_user(
    user_email: str,
    authorization: Optional[str] = Header(None)
):
    """Admin delete a user"""
    require_admin(authorization)
    from app.user_system import users_db
    if user_email not in users_db:
        raise HTTPException(status_code=404, detail="User not found")
    del users_db[user_email]
    logger.info(f"Admin deleted user: {user_email}")
    return {"success": True, "message": f"User {user_email} deleted"}

@router.post("/users/{user_email}/suspend")
async def admin_suspend_user(
    user_email: str,
    request: dict,
    authorization: Optional[str] = Header(None)
):
    """Admin suspend or reactivate a user"""
    require_admin(authorization)
    from app.user_system import users_db
    if user_email not in users_db:
        raise HTTPException(status_code=404, detail="User not found")
    new_status = request.get("status", "suspended")
    users_db[user_email]["status"] = new_status
    logger.info(f"Admin set user {user_email} status to {new_status}")
    return {"success": True, "status": new_status}

# ── Convenience aliases ─────────────────────────────────────────────
@router.post("/cleanup-sessions")
async def cleanup_sessions_alias(authorization: Optional[str] = Header(None)):
    """Alias for /system/cleanup"""
    require_admin(authorization)
    from app.admin_auth import active_sessions
    count = len(active_sessions)
    active_sessions.clear()
    logger.info(f"Admin cleared {count} sessions")
    return {"success": True, "cleared": count}

@router.post("/reset")
async def reset_data_alias(authorization: Optional[str] = Header(None)):
    """Alias for /data/reset"""
    require_admin(authorization)
    from app.user_system import users_db
    from app.financial_system import transactions_db
    users_db.clear()
    try:
        transactions_db.clear()
    except Exception:
        pass
    logger.info("Admin reset all data")
    return {"success": True, "message": "All user data reset"}

@router.get("/logs")
async def get_logs_alias(authorization: Optional[str] = Header(None)):
    """Alias for /system/logs"""
    require_admin(authorization)
    from app.admin_auth import active_sessions
    logs = [
        {"timestamp": "now", "event": "admin_login", "user": "admin", "details": "Admin panel accessed"},
        {"timestamp": "now", "event": "system_check", "user": "system", "details": f"Active sessions: {len(active_sessions)}"},
    ]
    return {"logs": logs}
