"""
Billing & Payment System
Handles subscriptions, payments, invoices for the platform itself
"""
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional, Dict, List, Any
from datetime import datetime, timedelta
from decimal import Decimal
import logging
import uuid
import os

logger = logging.getLogger(__name__)
router = APIRouter()

# ─── In-Memory Billing Store ──────────────────────────────────────────────────
subscriptions_db: Dict[str, Dict] = {}
payments_db: List[Dict] = []
billing_settings: Dict = {
    "stripe_publishable_key": os.environ.get("STRIPE_PUBLISHABLE_KEY", ""),
    "stripe_secret_key": os.environ.get("STRIPE_SECRET_KEY", ""),
    "currency": "CAD",
    "tax_rate": 0.05,
    "trial_days": 14,
    "plans": {
        # FIX BUG-006: Prices now match frontend display exactly
        "starter": {"price": 49, "name": "Starter", "users": 1, "features": ["AI Chat", "Invoicing", "Basic Compliance", "1 User", "Project Tracking"]},
        "professional": {"price": 149, "name": "Professional", "users": 5, "features": ["All Starter", "Email AI", "Payroll", "Advanced Reports", "5 Users", "Client Portal"]},
        "business": {"price": 299, "name": "Business", "users": 15, "features": ["All Professional", "White Label", "Priority Support", "API Access", "15 Users", "Custom Branding"]},
        "enterprise": {"price": 499, "name": "Enterprise", "users": -1, "features": ["All Business", "Custom Domain", "Dedicated Support", "SLA", "Unlimited Users", "On-Premise Option"]},
    }
}

# ─── Models ───────────────────────────────────────────────────────────────────

class CreateSubscriptionRequest(BaseModel):
    user_email: str
    plan: str
    payment_method_id: Optional[str] = None
    trial: bool = True

class UpdateSubscriptionRequest(BaseModel):
    plan: str

class RecordPaymentRequest(BaseModel):
    user_email: str
    amount: float
    plan: str
    payment_method: str = "card"
    transaction_id: Optional[str] = None
    notes: Optional[str] = None

class UpdateBillingSettingsRequest(BaseModel):
    stripe_publishable_key: Optional[str] = None
    stripe_secret_key: Optional[str] = None
    currency: Optional[str] = None
    tax_rate: Optional[float] = None
    trial_days: Optional[int] = None

class UpdatePlanRequest(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = None
    users: Optional[int] = None
    features: Optional[List[str]] = None
    active: Optional[bool] = None

# ─── Auth Helper ──────────────────────────────────────────────────────────────

def require_admin(authorization: Optional[str] = None) -> Dict:
    from app.admin_auth import verify_admin_token
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    token = authorization.replace("Bearer ", "").strip()
    session = verify_admin_token(token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")
    return session


def get_current_user_billing(authorization: Optional[str] = None) -> Dict:
    """Get current user from session token for billing endpoints."""
    from app.user_system import verify_user_token
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    token = authorization.replace("Bearer ", "").strip()
    # verify_user_token returns the full user dict directly
    user = verify_user_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user

# ─── Public Endpoints ─────────────────────────────────────────────────────────

@router.get("/plans")
async def get_plans():
    """Get all available subscription plans"""
    return {"plans": billing_settings["plans"], "currency": billing_settings["currency"]}

@router.get("/stripe-key")
async def get_stripe_key():
    """Get Stripe publishable key for frontend"""
    return {"publishable_key": billing_settings["stripe_publishable_key"]}

# ─── User Billing Endpoints ───────────────────────────────────────────────────

@router.get("/subscription/{user_email}")
async def get_subscription(user_email: str):
    """Get subscription for a user"""
    sub = subscriptions_db.get(user_email)
    if not sub:
        return {"subscription": None, "status": "none"}
    return {"subscription": sub}

@router.post("/subscription")
async def create_subscription(request: CreateSubscriptionRequest):
    """Create a new subscription for a user"""
    if request.plan not in billing_settings["plans"]:
        raise HTTPException(status_code=400, detail=f"Invalid plan: {request.plan}")

    plan_info = billing_settings["plans"][request.plan]
    now = datetime.now()
    trial_end = now + timedelta(days=billing_settings["trial_days"]) if request.trial else None

    subscription = {
        "id": str(uuid.uuid4())[:8],
        "user_email": request.user_email,
        "plan": request.plan,
        "plan_name": plan_info["name"],
        "price": plan_info["price"],
        "status": "trialing" if request.trial else "active",
        "trial_end": trial_end.isoformat() if trial_end else None,
        "current_period_start": now.isoformat(),
        "current_period_end": (now + timedelta(days=30)).isoformat(),
        "created_at": now.isoformat(),
        "payment_method": request.payment_method_id,
        "cancel_at_period_end": False,
    }

    subscriptions_db[request.user_email] = subscription

    # Update user plan
    from app.user_system import users_db
    if request.user_email in users_db:
        users_db[request.user_email]["plan"] = request.plan
        users_db[request.user_email]["subscription_status"] = subscription["status"]

    logger.info(f"Subscription created for {request.user_email}: {request.plan}")
    return {"success": True, "subscription": subscription}

@router.put("/subscription/{user_email}")
async def update_subscription(user_email: str, request: UpdateSubscriptionRequest):
    """Update a user's subscription plan"""
    if user_email not in subscriptions_db:
        raise HTTPException(status_code=404, detail="Subscription not found")
    if request.plan not in billing_settings["plans"]:
        raise HTTPException(status_code=400, detail=f"Invalid plan: {request.plan}")

    plan_info = billing_settings["plans"][request.plan]
    subscriptions_db[user_email]["plan"] = request.plan
    subscriptions_db[user_email]["plan_name"] = plan_info["name"]
    subscriptions_db[user_email]["price"] = plan_info["price"]
    subscriptions_db[user_email]["updated_at"] = datetime.now().isoformat()

    from app.user_system import users_db
    if user_email in users_db:
        users_db[user_email]["plan"] = request.plan

    return {"success": True, "subscription": subscriptions_db[user_email]}

@router.delete("/subscription/{user_email}")
async def cancel_subscription(user_email: str):
    """Cancel a subscription"""
    if user_email not in subscriptions_db:
        raise HTTPException(status_code=404, detail="Subscription not found")
    subscriptions_db[user_email]["cancel_at_period_end"] = True
    subscriptions_db[user_email]["status"] = "cancelling"
    return {"success": True, "message": "Subscription will cancel at period end"}

# ─── Payment Endpoints ────────────────────────────────────────────────────────

@router.post("/payment")
async def record_payment(request: RecordPaymentRequest):
    """Record a payment"""
    payment = {
        "id": str(uuid.uuid4())[:8],
        "user_email": request.user_email,
        "amount": request.amount,
        "plan": request.plan,
        "payment_method": request.payment_method,
        "transaction_id": request.transaction_id or str(uuid.uuid4()),
        "status": "succeeded",
        "notes": request.notes,
        "created_at": datetime.now().isoformat(),
    }
    payments_db.append(payment)

    # Update subscription
    if request.user_email in subscriptions_db:
        now = datetime.now()
        subscriptions_db[request.user_email]["status"] = "active"
        subscriptions_db[request.user_email]["last_payment"] = now.isoformat()
        subscriptions_db[request.user_email]["current_period_end"] = (now + timedelta(days=30)).isoformat()

    return {"success": True, "payment": payment}

@router.get("/status")
async def get_billing_status(authorization: Optional[str] = Header(None)):
    """Get current user's billing status — plan, subscription, payment history."""
    user = get_current_user_billing(authorization)
    email = user["email"]
    sub = subscriptions_db.get(email)
    user_payments = [p for p in payments_db if p.get("user_email") == email]
    plan_key = user.get("plan", "starter")
    plan_info = billing_settings["plans"].get(plan_key, {})
    return {
        "plan": plan_key,
        "plan_name": plan_info.get("name", plan_key.title()),
        "plan_price": plan_info.get("price", 0),
        "plan_features": plan_info.get("features", []),
        "subscription": sub,
        "payment_count": len(user_payments),
        "last_payment": user_payments[-1] if user_payments else None,
        "trial_active": sub.get("trial_end") is not None if sub else False,
    }


@router.get("/payments")
async def get_all_payments(authorization: Optional[str] = Header(None)):
    """Get payments — admin gets all, user gets their own."""
    from app.admin_auth import verify_admin_token
    from app.user_system import verify_user_token

    token = (authorization or "").replace("Bearer ", "").strip()

    # Try admin first
    admin_session = verify_admin_token(token)
    if admin_session:
        total = sum(p["amount"] for p in payments_db if p["status"] == "succeeded")
        return {"payments": payments_db, "total": total, "count": len(payments_db)}

    # Try user token — verify_user_token returns full user dict
    user = verify_user_token(token)
    if user:
        email = user.get("email", "")
        user_payments = [p for p in payments_db if p.get("user_email") == email]
        total = sum(p["amount"] for p in user_payments if p["status"] == "succeeded")
        return {"payments": user_payments, "total": total, "count": len(user_payments)}

    raise HTTPException(status_code=401, detail="Authentication required")


@router.get("/payments/{user_email}")
async def get_user_payments(user_email: str, authorization: Optional[str] = Header(None)):
    """Get payments for a specific user (admin only or own account)."""
    from app.admin_auth import verify_admin_token
    from app.user_system import verify_user_token

    token = (authorization or "").replace("Bearer ", "").strip()
    admin_session = verify_admin_token(token)
    if not admin_session:
        user = verify_user_token(token)
        if not user or user.get("email") != user_email:
            raise HTTPException(status_code=403, detail="Access denied")

    user_payments = [p for p in payments_db if p["user_email"] == user_email]
    return {"payments": user_payments, "count": len(user_payments)}

# ─── Admin Billing Management ─────────────────────────────────────────────────

@router.get("/admin/overview")
async def billing_overview(authorization: Optional[str] = Header(None)):
    """Get billing overview for admin"""
    require_admin(authorization)

    active_subs = [s for s in subscriptions_db.values() if s["status"] in ["active", "trialing"]]
    total_mrr = sum(s["price"] for s in active_subs if s["status"] == "active")
    trial_count = sum(1 for s in active_subs if s["status"] == "trialing")

    plan_breakdown = {}
    for sub in subscriptions_db.values():
        plan = sub["plan"]
        plan_breakdown[plan] = plan_breakdown.get(plan, 0) + 1

    return {
        "mrr": total_mrr,
        "arr": total_mrr * 12,
        "total_subscriptions": len(subscriptions_db),
        "active_subscriptions": len([s for s in subscriptions_db.values() if s["status"] == "active"]),
        "trialing": trial_count,
        "cancelled": len([s for s in subscriptions_db.values() if s["status"] in ["cancelled", "cancelling"]]),
        "plan_breakdown": plan_breakdown,
        "total_payments": len(payments_db),
        "total_revenue": sum(p["amount"] for p in payments_db if p["status"] == "succeeded"),
        "stripe_configured": bool(billing_settings["stripe_publishable_key"]),
    }

@router.get("/admin/subscriptions")
async def get_all_subscriptions(authorization: Optional[str] = Header(None)):
    """Get all subscriptions"""
    require_admin(authorization)
    return {"subscriptions": list(subscriptions_db.values()), "count": len(subscriptions_db)}

@router.put("/admin/subscription/{user_email}/override")
async def admin_override_subscription(
    user_email: str,
    request: dict,
    authorization: Optional[str] = Header(None)
):
    """Admin override for any subscription field"""
    require_admin(authorization)
    if user_email not in subscriptions_db:
        # Create one
        subscriptions_db[user_email] = {
            "id": str(uuid.uuid4())[:8],
            "user_email": user_email,
            "created_at": datetime.now().isoformat(),
        }
    subscriptions_db[user_email].update(request)
    subscriptions_db[user_email]["updated_at"] = datetime.now().isoformat()
    return {"success": True, "subscription": subscriptions_db[user_email]}

@router.get("/admin/settings")
async def get_billing_settings(authorization: Optional[str] = Header(None)):
    """Get billing settings"""
    require_admin(authorization)
    safe = {k: v for k, v in billing_settings.items() if k != "stripe_secret_key"}
    safe["stripe_secret_key"] = "***" if billing_settings.get("stripe_secret_key") else ""
    return safe

@router.put("/admin/settings")
async def update_billing_settings(
    request: UpdateBillingSettingsRequest,
    authorization: Optional[str] = Header(None)
):
    """Update billing settings"""
    require_admin(authorization)
    if request.stripe_publishable_key is not None:
        billing_settings["stripe_publishable_key"] = request.stripe_publishable_key
    if request.stripe_secret_key is not None:
        billing_settings["stripe_secret_key"] = request.stripe_secret_key
    if request.currency is not None:
        billing_settings["currency"] = request.currency
    if request.tax_rate is not None:
        billing_settings["tax_rate"] = request.tax_rate
    if request.trial_days is not None:
        billing_settings["trial_days"] = request.trial_days
    return {"success": True, "message": "Billing settings updated"}

@router.put("/admin/plans/{plan_id}")
async def update_plan(
    plan_id: str,
    request: UpdatePlanRequest,
    authorization: Optional[str] = Header(None)
):
    """Update a subscription plan"""
    require_admin(authorization)
    if plan_id not in billing_settings["plans"]:
        billing_settings["plans"][plan_id] = {"name": plan_id, "price": 0, "users": 1, "features": []}
    plan = billing_settings["plans"][plan_id]
    if request.name is not None: plan["name"] = request.name
    if request.price is not None: plan["price"] = request.price
    if request.users is not None: plan["users"] = request.users
    if request.features is not None: plan["features"] = request.features
    return {"success": True, "plan": plan}

@router.post("/admin/plans")
async def create_plan(request: dict, authorization: Optional[str] = Header(None)):
    """Create a new subscription plan"""
    require_admin(authorization)
    plan_id = request.get("id", str(uuid.uuid4())[:8])
    billing_settings["plans"][plan_id] = {
        "name": request.get("name", plan_id),
        "price": request.get("price", 0),
        "users": request.get("users", 1),
        "features": request.get("features", []),
    }
    return {"success": True, "plan_id": plan_id, "plan": billing_settings["plans"][plan_id]}

@router.delete("/admin/plans/{plan_id}")
async def delete_plan(plan_id: str, authorization: Optional[str] = Header(None)):
    """Delete a subscription plan"""
    require_admin(authorization)
    if plan_id in billing_settings["plans"]:
        del billing_settings["plans"][plan_id]
    return {"success": True}