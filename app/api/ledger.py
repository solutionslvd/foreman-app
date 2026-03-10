"""
Financial Ledger API - QuickBooks-inspired double-entry accounting
"""

from fastapi import APIRouter, HTTPException, Depends, Header, Query
from typing import Optional, Dict, Any, List
from pydantic import BaseModel
from decimal import Decimal
from datetime import datetime, date
import logging

from app.financial_ledger import ledger, Transaction
from app.admin_auth import verify_admin_token
from app.user_system import verify_user_token

logger = logging.getLogger(__name__)
router = APIRouter()


def get_admin_or_manager(authorization: Optional[str] = Header(None)):
    """
    BUG-NEW-D FIX: All authenticated users can access their own financial reports.
    Role restriction only applies to cross-user admin operations.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.replace("Bearer ", "")
    # Try admin first
    admin = verify_admin_token(token)
    if admin:
        return {"role": "admin", **admin}
    # Any authenticated user can access their own reports
    user = verify_user_token(token)
    if user:
        return user
    raise HTTPException(status_code=401, detail="Authentication required")

def get_any_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.replace("Bearer ", "")
    admin = verify_admin_token(token)
    if admin:
        return {"role": "admin", **admin}
    user = verify_user_token(token)
    if user:
        return user
    raise HTTPException(status_code=401, detail="Invalid token")


# ============================================================
# CHART OF ACCOUNTS
# ============================================================
@router.get("/accounts")
async def get_chart_of_accounts(user=Depends(get_any_user)):
    """Get full chart of accounts with balances"""
    return {
        "accounts": ledger.get_chart_of_accounts(),
        "total_accounts": len(ledger.accounts)
    }

@router.get("/accounts/{account_code}/balance")
async def get_account_balance(account_code: str, as_of: Optional[str] = None, user=Depends(get_any_user)):
    """Get balance for a specific account"""
    acct = ledger.get_account(account_code)
    if not acct:
        raise HTTPException(status_code=404, detail=f"Account {account_code} not found")
    balance = ledger.get_account_balance(acct.id, as_of)
    return {
        "account": acct.to_dict(),
        "balance": float(balance),
        "as_of": as_of or datetime.now().date().isoformat()
    }


# ============================================================
# TRANSACTIONS
# ============================================================
class ExpenseRequest(BaseModel):
    amount: float
    gst_paid: float = 0.0
    expense_account_code: str = "6999"
    description: str
    paid_from: str = "1010"
    date: Optional[str] = None
    project_id: Optional[str] = None

class InvoiceRequest(BaseModel):
    amount: float
    gst_amount: float
    customer_name: str
    invoice_number: Optional[str] = None
    project_id: Optional[str] = None
    date: Optional[str] = None

class PaymentReceivedRequest(BaseModel):
    amount: float
    customer_name: str
    invoice_number: str
    date: Optional[str] = None

class PayrollRequest(BaseModel):
    employee_name: str
    gross_wages: float
    cpp_employee: float
    ei_employee: float
    income_tax: float
    wcb_premium: float
    date: Optional[str] = None


@router.post("/transactions/expense")
async def record_expense(req: ExpenseRequest, user=Depends(get_admin_or_manager)):
    """Record a business expense"""
    try:
        txn = ledger.record_expense(
            amount=Decimal(str(req.amount)),
            gst_paid=Decimal(str(req.gst_paid)),
            expense_account_code=req.expense_account_code,
            description=req.description,
            paid_from=req.paid_from
        )
        return {"success": True, "transaction": txn.to_dict()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/transactions/invoice")
async def record_invoice(req: InvoiceRequest, user=Depends(get_admin_or_manager)):
    """Record a customer invoice"""
    try:
        from app.settings_manager import settings_manager
        invoice_number = req.invoice_number or settings_manager.get_invoice_number()
        txn = ledger.record_invoice_payment(
            amount=Decimal(str(req.amount)),
            gst_amount=Decimal(str(req.gst_amount)),
            customer_name=req.customer_name,
            invoice_number=invoice_number,
            project_id=req.project_id
        )
        return {"success": True, "transaction": txn.to_dict(), "invoice_number": invoice_number}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/transactions/payment-received")
async def record_payment_received(req: PaymentReceivedRequest, user=Depends(get_admin_or_manager)):
    """Record payment received from customer"""
    try:
        txn = ledger.record_payment_received(
            amount=Decimal(str(req.amount)),
            customer_name=req.customer_name,
            invoice_number=req.invoice_number
        )
        return {"success": True, "transaction": txn.to_dict()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/transactions/payroll")
async def record_payroll(req: PayrollRequest, user=Depends(get_admin_or_manager)):
    """Record payroll entry"""
    try:
        txn = ledger.record_payroll(
            gross_wages=Decimal(str(req.gross_wages)),
            cpp_employee=Decimal(str(req.cpp_employee)),
            ei_employee=Decimal(str(req.ei_employee)),
            income_tax=Decimal(str(req.income_tax)),
            wcb_premium=Decimal(str(req.wcb_premium)),
            employee_name=req.employee_name
        )
        return {"success": True, "transaction": txn.to_dict()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/transactions")
async def get_transactions(
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    transaction_type: Optional[str] = None,
    user=Depends(get_any_user)
):
    """Get all transactions"""
    txns = list(ledger.transactions.values())
    if transaction_type:
        txns = [t for t in txns if t.transaction_type == transaction_type]
    txns.sort(key=lambda x: x.date, reverse=True)
    total = len(txns)
    txns = txns[offset:offset+limit]
    return {
        "transactions": [t.to_dict() for t in txns],
        "total": total,
        "limit": limit,
        "offset": offset
    }


# ============================================================
# FINANCIAL REPORTS
# ============================================================
@router.get("/reports/profit-loss")
async def profit_and_loss(
    from_date: str = Query(..., description="YYYY-MM-DD"),
    to_date: str = Query(..., description="YYYY-MM-DD"),
    user=Depends(get_admin_or_manager)
):
    """Profit & Loss Statement"""
    return ledger.get_profit_and_loss(from_date, to_date)

@router.get("/reports/balance-sheet")
async def balance_sheet(
    as_of: Optional[str] = Query(None, description="YYYY-MM-DD"),
    user=Depends(get_admin_or_manager)
):
    """Balance Sheet"""
    return ledger.get_balance_sheet(as_of)

@router.get("/reports/gst-summary")
async def gst_summary(
    from_date: str = Query(..., description="YYYY-MM-DD"),
    to_date: str = Query(..., description="YYYY-MM-DD"),
    user=Depends(get_admin_or_manager)
):
    """GST/HST Filing Summary"""
    return ledger.get_gst_summary(from_date, to_date)

@router.get("/reports/cash-flow")
async def cash_flow(
    from_date: str = Query(..., description="YYYY-MM-DD"),
    to_date: str = Query(..., description="YYYY-MM-DD"),
    user=Depends(get_admin_or_manager)
):
    """Cash Flow Statement"""
    return ledger.get_cash_flow(from_date, to_date)

@router.get("/reports/ar-aging")
async def ar_aging(user=Depends(get_admin_or_manager)):
    """Accounts Receivable Aging Report"""
    return ledger.get_accounts_receivable_aging()

@router.get("/reports/dashboard-summary")
async def dashboard_summary(user=Depends(get_any_user)):
    """Quick financial summary for dashboard"""
    today = datetime.now().date()
    year_start = f"{today.year}-01-01"
    month_start = f"{today.year}-{today.month:02d}-01"
    today_str = today.isoformat()

    ytd_pl = ledger.get_profit_and_loss(year_start, today_str)
    mtd_pl = ledger.get_profit_and_loss(month_start, today_str)
    ar = ledger.get_accounts_receivable_aging()

    return {
        "ytd": {
            "revenue": ytd_pl["total_income"],
            "expenses": ytd_pl["total_expenses"] + ytd_pl["total_cogs"],
            "net_income": ytd_pl["net_income"],
            "gross_margin": ytd_pl["gross_margin_pct"],
        },
        "mtd": {
            "revenue": mtd_pl["total_income"],
            "expenses": mtd_pl["total_expenses"] + mtd_pl["total_cogs"],
            "net_income": mtd_pl["net_income"],
        },
        "ar_outstanding": ar["total_outstanding"],
        "ar_overdue": ar["days_31_60"] + ar["days_61_90"] + ar["over_90"],
        "bank_balance": float(ledger.get_account_balance(
            ledger.get_account("1010").id if ledger.get_account("1010") else ""
        )),
    }