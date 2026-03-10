"""
Project Management API
Full project lifecycle with start/end dates, trades, line items
"""
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional, Dict, List, Any
from datetime import datetime, date
import logging
import uuid

from app.persistence import save_projects, load_projects, save_estimates, load_estimates
logger = logging.getLogger(__name__)
router = APIRouter()

# ─── In-Memory Store ──────────────────────────────────────────────────────────
projects_db: List[Dict] = load_projects()
estimates_db: List[Dict] = load_estimates()

# ─── Auth Helper (FIX BUG-004) ──────────────────────────────────────────────
def get_current_user(authorization: Optional[str] = Header(None)) -> Dict:
    """Require valid user or admin token on all project endpoints."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.replace("Bearer ", "").strip()
    from app.user_system import verify_user_token
    from app.admin_auth import verify_admin_token
    user = verify_user_token(token)
    if user:
        return user
    admin = verify_admin_token(token)
    if admin:
        return {"id": "admin", "email": "admin", "role": "admin", **admin}
    raise HTTPException(status_code=401, detail="Invalid or expired token")


# ─── Models ───────────────────────────────────────────────────────────────────

class InvoiceLineItem(BaseModel):
    description: str
    quantity: float = 1.0
    unit: str = "ls"
    rate: float = 0.0
    price: Optional[float] = None   # auto-calculated if None
    gst_exempt: bool = False
    notes: Optional[str] = None

class CreateProjectRequest(BaseModel):
    name: str
    client_name: str
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_address: Optional[str] = None
    project_address: str
    project_type: str
    description: Optional[str] = None
    start_date: Optional[str] = None
    scheduled_finish_date: Optional[str] = None
    contract_value: Optional[float] = None
    status: str = "pending"
    notes: Optional[str] = None

class UpdateProjectRequest(BaseModel):
    name: Optional[str] = None
    client_name: Optional[str] = None
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_address: Optional[str] = None
    project_address: Optional[str] = None
    project_type: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[str] = None
    scheduled_finish_date: Optional[str] = None
    actual_finish_date: Optional[str] = None
    contract_value: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None

class CreateInvoiceRequest(BaseModel):
    project_id: Optional[str] = None
    client_name: str
    client_email: Optional[str] = None
    client_address: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    due_date: Optional[str] = None
    payment_terms: str = "net_30"
    line_items: List[InvoiceLineItem] = []
    notes: Optional[str] = None
    footer_text: Optional[str] = None
    discount_percent: float = 0.0
    deposit_paid: float = 0.0
    is_estimate: bool = False

class CreateEstimateRequest(BaseModel):
    project_id: Optional[str] = None
    client_name: str
    client_email: Optional[str] = None
    client_address: Optional[str] = None
    estimate_number: Optional[str] = None
    estimate_date: Optional[str] = None
    valid_until: Optional[str] = None
    project_type: str = "general_contracting"
    line_items: List[InvoiceLineItem] = []
    notes: Optional[str] = None
    include_gst: bool = True

# ─── Helpers ──────────────────────────────────────────────────────────────────

def calculate_line_items(items: List[Dict], gst_rate: float = 0.05):
    """Calculate totals for line items"""
    processed = []
    subtotal = 0.0
    gst_total = 0.0

    for item in items:
        qty = float(item.get("quantity", 1))
        rate = float(item.get("rate", 0))
        price = qty * rate
        gst_exempt = item.get("gst_exempt", False)
        gst = 0.0 if gst_exempt else round(price * gst_rate, 2)

        processed.append({
            **item,
            "price": round(price, 2),
            "gst": gst,
            "line_total": round(price + gst, 2),
        })
        subtotal += price
        gst_total += gst

    return processed, round(subtotal, 2), round(gst_total, 2)

def _calculate_due_date(invoice_date: str, payment_terms: str) -> str:
    """Auto-calculate due date from invoice date and payment terms. FIX BUG-007."""
    from datetime import timedelta
    try:
        inv_dt = datetime.strptime(invoice_date, "%Y-%m-%d")
        terms_map = {
            "due_on_receipt": 0,
            "net_7": 7,
            "net_15": 15,
            "net_30": 30,
            "net_45": 45,
            "net_60": 60,
            "net_90": 90,
        }
        days = terms_map.get(payment_terms.lower().replace(" ", "_"), 30)
        return (inv_dt + timedelta(days=days)).strftime("%Y-%m-%d")
    except Exception:
        from datetime import timedelta
        return (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")

def next_invoice_number():
    from app.config import config
    prefix = getattr(config, "INVOICE_PREFIX", "INV")
    count = len([i for i in projects_db if not i.get("is_estimate")]) + 1
    return f"{prefix}-{datetime.now().year}-{count:04d}"

def next_estimate_number():
    count = len(estimates_db) + 1
    return f"EST-{datetime.now().year}-{count:04d}"

# ─── Project Endpoints ────────────────────────────────────────────────────────

@router.get("/")
async def list_projects(status: Optional[str] = None, project_type: Optional[str] = None, user: Dict = Depends(get_current_user)):
    """List all projects"""
    result = projects_db
    if status:
        result = [p for p in result if p.get("status") == status]
    if project_type:
        result = [p for p in result if p.get("project_type") == project_type]
    return {"projects": result, "total": len(result)}

@router.post("/")
async def create_project(request: CreateProjectRequest, user: Dict = Depends(get_current_user)):
    """Create a new project"""
    project = {
        "id": str(uuid.uuid4())[:8],
        **request.dict(),
        "invoices": [],
        "expenses": [],
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }
    projects_db.append(project)
    save_projects(projects_db)  # FIX BUG-005: persist
    logger.info(f"Project created: {project['name']}")
    return {"success": True, "project": project}

@router.get("/{project_id}")
async def get_project(project_id: str, user: Dict = Depends(get_current_user)):
    """Get a specific project"""
    project = next((p for p in projects_db if p["id"] == project_id), None)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

@router.put("/{project_id}")
async def update_project(project_id: str, request: UpdateProjectRequest, user: Dict = Depends(get_current_user)):
    """Update a project"""
    project = next((p for p in projects_db if p["id"] == project_id), None)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    update_data = {k: v for k, v in request.dict().items() if v is not None}
    project.update(update_data)
    project["updated_at"] = datetime.now().isoformat()
    save_projects(projects_db)  # FIX BUG-005: persist
    return {"success": True, "project": project}

@router.delete("/{project_id}")
async def delete_project(project_id: str, user: Dict = Depends(get_current_user)):
    """Delete a project"""
    global projects_db
    projects_db = [p for p in projects_db if p["id"] != project_id]
    return {"success": True}

# ─── Invoice Endpoints ────────────────────────────────────────────────────────

@router.get("/invoices/all")
async def list_all_invoices():
    """List all invoices across all projects"""
    all_invoices = []
    for p in projects_db:
        for inv in p.get("invoices", []):
            all_invoices.append({**inv, "project_name": p.get("name", "")})
    # Also standalone invoices
    return {"invoices": all_invoices, "total": len(all_invoices)}

@router.post("/{project_id}/invoice")
async def create_project_invoice(project_id: str, request: CreateInvoiceRequest, user: Dict = Depends(get_current_user)):
    """Create an invoice for a project"""
    project = next((p for p in projects_db if p["id"] == project_id), None)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return await _create_invoice(request, project)

@router.post("/invoice/standalone")
async def create_standalone_invoice(request: CreateInvoiceRequest, user: Dict = Depends(get_current_user)):
    """Create a standalone invoice (no project required)"""
    return await _create_invoice(request, None)

async def _create_invoice(request: CreateInvoiceRequest, project: Optional[Dict]):
    """Internal invoice creation"""
    from app.config import config
    gst_rate = float(getattr(config, "GST_RATE", 0.05))

    items_raw = [item.dict() for item in request.line_items]
    processed_items, subtotal, gst_total = calculate_line_items(items_raw, gst_rate)

    discount_amount = round(subtotal * (request.discount_percent / 100), 2)
    subtotal_after_discount = round(subtotal - discount_amount, 2)
    total = round(subtotal_after_discount + gst_total, 2)
    balance_due = round(total - request.deposit_paid, 2)

    invoice = {
        "id": str(uuid.uuid4())[:8],
        "invoice_number": request.invoice_number or next_invoice_number(),
        "project_id": project["id"] if project else None,
        "project_name": project["name"] if project else None,
        "client_name": request.client_name,
        "client_email": request.client_email,
        "client_address": request.client_address,
        "invoice_date": request.invoice_date or datetime.now().strftime("%Y-%m-%d"),
        "due_date": request.due_date or _calculate_due_date(
            request.invoice_date or datetime.now().strftime("%Y-%m-%d"),
            request.payment_terms
        ),
        "payment_terms": request.payment_terms,
        "line_items": processed_items,
        "subtotal": subtotal,
        "discount_percent": request.discount_percent,
        "discount_amount": discount_amount,
        "subtotal_after_discount": subtotal_after_discount,
        "gst_rate": gst_rate,
        "gst_total": gst_total,
        "total": total,
        "deposit_paid": request.deposit_paid,
        "balance_due": balance_due,
        "notes": request.notes,
        "footer_text": request.footer_text,
        "is_estimate": request.is_estimate,
        "status": "draft",
        "payments_received": [],
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }

    if project:
        project.setdefault("invoices", []).append(invoice)
    else:
        # Store in a global list
        if not hasattr(create_standalone_invoice, "_store"):
            create_standalone_invoice._store = []
        create_standalone_invoice._store.append(invoice)

    logger.info(f"Invoice created: {invoice['invoice_number']}")
    return {"success": True, "invoice": invoice}

@router.put("/invoice/{invoice_id}/status")
async def update_invoice_status(invoice_id: str, request: dict):
    """Update invoice status"""
    for project in projects_db:
        for inv in project.get("invoices", []):
            if inv["id"] == invoice_id:
                inv["status"] = request.get("status", inv["status"])
                inv["updated_at"] = datetime.now().isoformat()
                return {"success": True, "invoice": inv}
    raise HTTPException(status_code=404, detail="Invoice not found")

@router.post("/invoice/{invoice_id}/payment")
async def record_invoice_payment(invoice_id: str, request: dict):
    """Record a payment against an invoice"""
    for project in projects_db:
        for inv in project.get("invoices", []):
            if inv["id"] == invoice_id:
                payment = {
                    "id": str(uuid.uuid4())[:8],
                    "amount": float(request.get("amount", 0)),
                    "method": request.get("method", "cheque"),
                    "date": request.get("date", datetime.now().strftime("%Y-%m-%d")),
                    "notes": request.get("notes", ""),
                    "recorded_at": datetime.now().isoformat(),
                }
                inv.setdefault("payments_received", []).append(payment)
                total_paid = sum(p["amount"] for p in inv["payments_received"]) + inv.get("deposit_paid", 0)
                inv["balance_due"] = round(inv["total"] - total_paid, 2)
                inv["status"] = "paid" if inv["balance_due"] <= 0 else "partial"
                inv["updated_at"] = datetime.now().isoformat()
                return {"success": True, "invoice": inv, "payment": payment}
    raise HTTPException(status_code=404, detail="Invoice not found")

# ─── Estimate Endpoints ───────────────────────────────────────────────────────

@router.post("/estimate")
async def create_estimate(request: CreateEstimateRequest, user: Dict = Depends(get_current_user)):
    """Create a project estimate/quote"""
    from app.config import config
    gst_rate = float(getattr(config, "GST_RATE", 0.05)) if request.include_gst else 0.0

    items_raw = [item.dict() for item in request.line_items]
    processed_items, subtotal, gst_total = calculate_line_items(items_raw, gst_rate)
    total = round(subtotal + gst_total, 2)

    estimate = {
        "id": str(uuid.uuid4())[:8],
        "estimate_number": request.estimate_number or next_estimate_number(),
        "project_id": request.project_id,
        "client_name": request.client_name,
        "client_email": request.client_email,
        "client_address": request.client_address,
        "estimate_date": request.estimate_date or datetime.now().strftime("%Y-%m-%d"),
        "valid_until": request.valid_until,
        "project_type": request.project_type,
        "line_items": processed_items,
        "subtotal": subtotal,
        "gst_rate": gst_rate,
        "gst_total": gst_total,
        "total": total,
        "notes": request.notes,
        "status": "draft",
        "created_at": datetime.now().isoformat(),
    }
    estimates_db.append(estimate)
    return {"success": True, "estimate": estimate}

@router.get("/estimates/all")
async def list_estimates():
    """List all estimates"""
    return {"estimates": estimates_db, "total": len(estimates_db)}

@router.put("/estimate/{estimate_id}/convert")
async def convert_estimate_to_invoice(estimate_id: str, user: Dict = Depends(get_current_user)):
    """Convert an estimate to an invoice"""
    estimate = next((e for e in estimates_db if e["id"] == estimate_id), None)
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    invoice_req = CreateInvoiceRequest(
        client_name=estimate["client_name"],
        client_email=estimate.get("client_email"),
        client_address=estimate.get("client_address"),
        line_items=[InvoiceLineItem(**{k: v for k, v in item.items()
                                      if k in InvoiceLineItem.__fields__})
                    for item in estimate["line_items"]],
        notes=estimate.get("notes"),
        is_estimate=False,
    )
    result = await _create_invoice(invoice_req, None)
    estimate["status"] = "converted"
    estimate["converted_to_invoice"] = result["invoice"]["invoice_number"]
    return {"success": True, "invoice": result["invoice"]}

# ─── Summary ──────────────────────────────────────────────────────────────────

@router.get("/summary/overview")
async def projects_overview():
    """Get projects overview"""
    total_contract = sum(p.get("contract_value") or 0 for p in projects_db)
    invoiced = sum(
        inv.get("total", 0)
        for p in projects_db
        for inv in p.get("invoices", [])
    )
    collected = sum(
        inv.get("total", 0) - inv.get("balance_due", 0)
        for p in projects_db
        for inv in p.get("invoices", [])
    )
    outstanding = invoiced - collected

    by_status = {}
    for p in projects_db:
        s = p.get("status", "unknown")
        by_status[s] = by_status.get(s, 0) + 1

    return {
        "total_projects": len(projects_db),
        "total_estimates": len(estimates_db),
        "total_contract_value": round(total_contract, 2),
        "total_invoiced": round(invoiced, 2),
        "total_collected": round(collected, 2),
        "outstanding": round(outstanding, 2),
        "by_status": by_status,
    }