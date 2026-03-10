"""
Financial API endpoints
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import date, datetime
from decimal import Decimal
import logging

from ..financial_system import (
    financial_system,
    TransactionType,
    ExpenseCategory
)

logger = logging.getLogger(__name__)

router = APIRouter()


class TransactionCreate(BaseModel):
    amount: float = Field(..., gt=0)
    transaction_type: str
    category: Optional[str] = None
    description: str = ""
    date: Optional[date] = None
    vendor: Optional[str] = None
    invoice_number: Optional[str] = None
    tax_deductible: bool = True
    gst_amount: Optional[float] = None


class InvoiceCreate(BaseModel):
    client_name: str
    amount: float = Field(..., gt=0)
    description: str
    due_date: date
    project_name: Optional[str] = None
    gst_included: bool = True


class PayrollCreate(BaseModel):
    employee_name: str
    hours_worked: float = Field(..., gt=0)
    hourly_rate: float = Field(..., gt=0)
    wcb_rate: float = 0.032
    cpp_rate: float = 0.0595
    ei_rate: float = 0.0163


@router.post("/transactions")
async def create_transaction(transaction: TransactionCreate):
    """Create a new financial transaction"""
    try:
        result = financial_system.add_transaction(
            amount=Decimal(str(transaction.amount)),
            transaction_type=TransactionType(transaction.transaction_type),
            category=ExpenseCategory(transaction.category) if transaction.category else None,
            description=transaction.description,
            date=transaction.date,
            vendor=transaction.vendor,
            invoice_number=transaction.invoice_number,
            tax_deductible=transaction.tax_deductible,
            gst_amount=Decimal(str(transaction.gst_amount)) if transaction.gst_amount else None
        )
        return {"status": "success", "transaction": result}
    except Exception as e:
        logger.error(f"Error creating transaction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/invoices")
async def create_invoice(invoice: InvoiceCreate):
    """Create a new invoice"""
    try:
        result = financial_system.create_invoice(
            client_name=invoice.client_name,
            amount=Decimal(str(invoice.amount)),
            description=invoice.description,
            due_date=invoice.due_date,
            project_name=invoice.project_name,
            gst_included=invoice.gst_included
        )
        return {"status": "success", "invoice": result}
    except Exception as e:
        logger.error(f"Error creating invoice: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/payroll")
async def process_payroll(payroll: PayrollCreate):
    """Process payroll for an employee"""
    try:
        result = financial_system.process_payroll(
            employee_name=payroll.employee_name,
            hours_worked=Decimal(str(payroll.hours_worked)),
            hourly_rate=Decimal(str(payroll.hourly_rate)),
            wcb_rate=Decimal(str(payroll.wcb_rate)),
            cpp_rate=Decimal(str(payroll.cpp_rate)),
            ei_rate=Decimal(str(payroll.ei_rate))
        )
        return {"status": "success", "payroll": result}
    except Exception as e:
        logger.error(f"Error processing payroll: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/summary")
async def get_financial_summary():
    """Get comprehensive financial summary"""
    try:
        summary = financial_system.get_financial_summary()
        return summary
    except Exception as e:
        logger.error(f"Error getting financial summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tax-summary/{year}")
async def get_tax_summary(year: int):
    """Get tax summary for a specific year"""
    try:
        summary = financial_system.get_tax_summary(year)
        return summary
    except Exception as e:
        logger.error(f"Error getting tax summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/catch-up-priorities")
async def get_catch_up_priorities():
    """Get prioritized action items for catching up on financial records"""
    try:
        priorities = financial_system.assess_catch_up_priorities()
        return priorities
    except Exception as e:
        logger.error(f"Error assessing catch-up priorities: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/suggest-category")
async def suggest_expense_category(
    description: str,
    amount: float
):
    """Suggest expense categorization based on description"""
    try:
        suggestion = financial_system.suggest_expense_categorization(
            description=description,
            amount=Decimal(str(amount))
        )
        return suggestion
    except Exception as e:
        logger.error(f"Error suggesting category: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/transactions")
async def list_transactions(
    skip: int = 0,
    limit: int = 100,
    transaction_type: Optional[str] = None
):
    """List financial transactions with optional filtering"""
    try:
        transactions = financial_system.transactions
        
        if transaction_type:
            transactions = [t for t in transactions if t["type"] == transaction_type]
        
        return {
            "transactions": transactions[skip:skip + limit],
            "total": len(transactions),
            "skip": skip,
            "limit": limit
        }
    except Exception as e:
        logger.error(f"Error listing transactions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/invoices")
async def list_invoices(
    skip: int = 0,
    limit: int = 100,
    status: Optional[str] = None
):
    """List invoices with optional filtering"""
    try:
        invoices = financial_system.invoices
        
        if status:
            invoices = [inv for inv in invoices if inv["status"] == status]
        
        return {
            "invoices": invoices[skip:skip + limit],
            "total": len(invoices),
            "skip": skip,
            "limit": limit
        }
    except Exception as e:
        logger.error(f"Error listing invoices: {e}")
        raise HTTPException(status_code=500, detail=str(e))