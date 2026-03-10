"""
Financial Management System for Alberta Construction Assistant
Handles transactions, invoicing, payroll, taxes, and catch-up situations
"""

from typing import Dict, List, Optional, Any
from datetime import datetime, date
from decimal import Decimal
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class TransactionType(Enum):
    """Types of financial transactions"""
    INCOME = "income"
    EXPENSE = "expense"
    PAYROLL = "payroll"
    TAX_PAYMENT = "tax_payment"
    GST_COLLECTED = "gst_collected"
    GST_PAID = "gst_paid"


class ExpenseCategory(Enum):
    """Categories for construction expenses"""
    MATERIALS = "materials"
    LABOR = "labor"
    EQUIPMENT = "equipment"
    VEHICLE = "vehicle"
    TOOLS = "tools"
    INSURANCE = "insurance"
    LICENSES_PERMITS = "licenses_permits"
    UTILITIES = "utilities"
    RENT = "rent"
    MARKETING = "marketing"
    PROFESSIONAL_SERVICES = "professional_services"
    MEALS_ENTERTAINMENT = "meals_entertainment"
    HOME_OFFICE = "home_office"
    OTHER = "other"


class TaxStatus(Enum):
    """Tax filing status"""
    UP_TO_DATE = "up_to_date"
    BEHIND = "behind"
    IN_PROGRESS = "in_progress"
    REVIEW_NEEDED = "review_needed"


class FinancialSystem:
    """Comprehensive financial management system"""
    
    def __init__(self, config=None):
        self.transactions: List[Dict] = []
        self.invoices: List[Dict] = []
        self.payroll_records: List[Dict] = []
        self.tax_filings: List[Dict] = []
        self.gst_tracking: Dict = {
            "collected": Decimal("0.00"),
            "paid": Decimal("0.00"),
            "net_remittance": Decimal("0.00")
        }
        self.config = config
        
    def add_transaction(
        self,
        amount: Decimal,
        transaction_type: TransactionType,
        category: Optional[ExpenseCategory] = None,
        description: str = "",
        date: Optional[date] = None,
        vendor: Optional[str] = None,
        invoice_number: Optional[str] = None,
        tax_deductible: bool = True,
        gst_amount: Optional[Decimal] = None
    ) -> Dict:
        """
        Add a financial transaction
        
        Args:
            amount: Transaction amount
            transaction_type: Type of transaction
            category: Expense category (for expenses)
            description: Transaction description
            date: Transaction date (defaults to today)
            vendor: Vendor name (for expenses)
            invoice_number: Related invoice number
            tax_deductible: Whether expense is tax deductible
            gst_amount: GST amount (if applicable)
            
        Returns:
            Created transaction record
        """
        transaction = {
            "id": len(self.transactions) + 1,
            "amount": float(amount),
            "type": transaction_type.value,
            "category": category.value if category else None,
            "description": description,
            "date": date or datetime.now().date(),
            "vendor": vendor,
            "invoice_number": invoice_number,
            "tax_deductible": tax_deductible,
            "gst_amount": float(gst_amount) if gst_amount else None,
            "created_at": datetime.now()
        }
        
        self.transactions.append(transaction)
        
        # Update GST tracking
        if gst_amount:
            if transaction_type == TransactionType.GST_COLLECTED:
                self.gst_tracking["collected"] += gst_amount
            elif transaction_type == TransactionType.GST_PAID:
                self.gst_tracking["paid"] += gst_amount
            self._update_gst_remittance()
        
        logger.info(f"Transaction added: {transaction_type.value} - ${amount}")
        return transaction
    
    def _update_gst_remittance(self):
        """Update net GST remittance"""
        self.gst_tracking["net_remittance"] = (
            self.gst_tracking["collected"] - self.gst_tracking["paid"]
        )
    
    def create_invoice(
        self,
        client_name: str,
        amount: Decimal,
        description: str,
        due_date: date,
        project_name: Optional[str] = None,
        gst_included: bool = True
    ) -> Dict:
        """
        Create a new invoice
        
        Args:
            client_name: Client's name
            amount: Invoice amount (before GST)
            description: Invoice description
            due_date: Payment due date
            project_name: Related project
            gst_included: Whether GST is included
            
        Returns:
            Created invoice record
        """
        # Use GST rate from config if available, otherwise default to 5%
        gst_rate = self.config.GST_RATE if self.config else Decimal("0.05")
        gst_amount = amount * gst_rate if gst_included else Decimal("0.00")
        total_amount = amount + gst_amount
        
        # Use invoice prefix from config if available
        invoice_prefix = self.config.INVOICE_PREFIX if self.config else "INV"
        
        invoice = {
            "id": len(self.invoices) + 1,
            "invoice_number": f"{invoice_prefix}-{datetime.now().strftime('%Y%m%d')}-{len(self.invoices) + 1:04d}",
            "client_name": client_name,
            "amount": float(amount),
            "gst_amount": float(gst_amount),
            "total_amount": float(total_amount),
            "description": description,
            "project_name": project_name,
            "due_date": due_date,
            "status": "pending",
            "created_at": datetime.now()
        }
        
        self.invoices.append(invoice)
        
        # Add as income transaction
        self.add_transaction(
            amount=total_amount,
            transaction_type=TransactionType.INCOME,
            description=f"Invoice {invoice['invoice_number']} - {client_name}",
            invoice_number=invoice['invoice_number']
        )
        
        # Track GST collected
        if gst_included:
            self.add_transaction(
                amount=gst_amount,
                transaction_type=TransactionType.GST_COLLECTED,
                description=f"GST from invoice {invoice['invoice_number']}"
            )
        
        logger.info(f"Invoice created: {invoice['invoice_number']} for {client_name}")
        return invoice
    
    def process_payroll(
        self,
        employee_name: str,
        hours_worked: Decimal,
        hourly_rate: Decimal,
        wcb_rate: Optional[Decimal] = None,
        cpp_rate: Optional[Decimal] = None,
        ei_rate: Optional[Decimal] = None
    ) -> Dict:
        """
        Process payroll for an employee
        
        Args:
            employee_name: Employee's name
            hours_worked: Hours worked in pay period
            hourly_rate: Hourly wage rate
            wcb_rate: WCB premium rate (uses config default if not provided)
            cpp_rate: CPP contribution rate (uses config default if not provided)
            ei_rate: EI premium rate (uses config default if not provided)
            
        Returns:
            Payroll record with all calculations
        """
        # Use rates from config if available, otherwise use defaults
        if self.config:
            wcb_rate = wcb_rate or self.config.WCB_RATES.get("construction_general", Decimal("0.032"))
            cpp_rate = cpp_rate or self.config.CPP_RATE
            ei_rate = ei_rate or self.config.EI_RATE
        else:
            wcb_rate = wcb_rate or Decimal("0.032")
            cpp_rate = cpp_rate or Decimal("0.0595")
            ei_rate = ei_rate or Decimal("0.0163")
        
        # Calculate gross pay
        gross_pay = hours_worked * hourly_rate
        
        # Calculate deductions
        cpp_deduction = gross_pay * cpp_rate
        ei_deduction = gross_pay * ei_rate
        wcb_premium = gross_pay * wcb_rate
        
        # Calculate net pay
        total_deductions = cpp_deduction + ei_deduction
        net_pay = gross_pay - total_deductions
        
        # Employer costs
        employer_cpp = gross_pay * cpp_rate
        employer_ei = gross_pay * (ei_rate * (self.config.EI_EMPLOYER_MULTIPLIER if self.config else Decimal("1.4")))
        total_employer_cost = gross_pay + employer_cpp + employer_ei + wcb_premium
        
        payroll_record = {
            "id": len(self.payroll_records) + 1,
            "employee_name": employee_name,
            "hours_worked": float(hours_worked),
            "hourly_rate": float(hourly_rate),
            "gross_pay": float(gross_pay),
            "deductions": {
                "cpp": float(cpp_deduction),
                "ei": float(ei_deduction),
                "total": float(total_deductions)
            },
            "net_pay": float(net_pay),
            "employer_costs": {
                "cpp": float(employer_cpp),
                "ei": float(employer_ei),
                "wcb": float(wcb_premium),
                "total": float(total_employer_cost)
            },
            "pay_period_end": datetime.now().date(),
            "created_at": datetime.now()
        }
        
        self.payroll_records.append(payroll_record)
        
        # Add as expense transaction
        self.add_transaction(
            amount=total_employer_cost,
            transaction_type=TransactionType.PAYROLL,
            category=ExpenseCategory.LABOR,
            description=f"Payroll for {employee_name}",
            tax_deductible=True
        )
        
        logger.info(f"Payroll processed for {employee_name}: ${net_pay} net pay")
        return payroll_record
    
    def get_financial_summary(self) -> Dict[str, Any]:
        """Get comprehensive financial summary"""
        total_income = Decimal("0.00")
        total_expenses = Decimal("0.00")
        total_deductible = Decimal("0.00")
        
        for transaction in self.transactions:
            amount = Decimal(str(transaction["amount"]))
            if transaction["type"] == TransactionType.INCOME.value:
                total_income += amount
            elif transaction["type"] == TransactionType.EXPENSE.value:
                total_expenses += amount
                if transaction.get("tax_deductible"):
                    total_deductible += amount
        
        net_profit = total_income - total_expenses
        pending_invoices = sum(
            Decimal(str(inv["total_amount"]))
            for inv in self.invoices
            if inv["status"] == "pending"
        )
        
        return {
            "total_income": float(total_income),
            "total_expenses": float(total_expenses),
            "net_profit": float(net_profit),
            "total_deductible_expenses": float(total_deductible),
            "pending_invoices": float(pending_invoices),
            "gst_remittance": float(self.gst_tracking["net_remittance"]),
            "total_transactions": len(self.transactions),
            "pending_invoices_count": len([inv for inv in self.invoices if inv["status"] == "pending"]),
            "payroll_records": len(self.payroll_records)
        }
    
    def get_tax_summary(self, year: int) -> Dict[str, Any]:
        """
        Get tax summary for a specific year
        
        Args:
            year: Tax year
            
        Returns:
            Comprehensive tax summary
        """
        year_transactions = [
            t for t in self.transactions
            if t["date"].year == year
        ]
        
        total_income = Decimal("0.00")
        total_expenses = Decimal("0.00")
        deductible_expenses = Decimal("0.00")
        
        expense_breakdown = {}
        
        for transaction in year_transactions:
            amount = Decimal(str(transaction["amount"]))
            
            if transaction["type"] == TransactionType.INCOME.value:
                total_income += amount
            elif transaction["type"] == TransactionType.EXPENSE.value:
                total_expenses += amount
                if transaction.get("tax_deductible"):
                    deductible_expenses += amount
                    
                    # Break down by category
                    category = transaction.get("category", "other")
                    if category not in expense_breakdown:
                        expense_breakdown[category] = Decimal("0.00")
                    expense_breakdown[category] += amount
        
        taxable_income = total_income - deductible_expenses
        
        # Estimate federal tax (simplified)
        if taxable_income <= Decimal("50000"):
            federal_tax = taxable_income * Decimal("0.15")
        elif taxable_income <= Decimal("100000"):
            federal_tax = Decimal("7500") + (taxable_income - Decimal("50000")) * Decimal("0.205")
        else:
            federal_tax = Decimal("17750") + (taxable_income - Decimal("100000")) * Decimal("0.26")
        
        # Alberta provincial tax (simplified)
        alberta_tax = taxable_income * Decimal("0.10")
        
        total_tax_estimate = federal_tax + alberta_tax
        
        return {
            "year": year,
            "total_income": float(total_income),
            "total_expenses": float(total_expenses),
            "deductible_expenses": float(deductible_expenses),
            "taxable_income": float(taxable_income),
            "expense_breakdown": {
                k: float(v) for k, v in expense_breakdown.items()
            },
            "tax_estimates": {
                "federal": float(federal_tax),
                "alberta": float(alberta_tax),
                "total": float(total_tax_estimate)
            },
            "gst_remittance": float(self.gst_tracking["net_remittance"]),
            "transaction_count": len(year_transactions)
        }
    
    def assess_catch_up_priorities(self) -> Dict[str, Any]:
        """
        Assess priorities for catching up on financial records
        Returns prioritized action items
        """
        priorities = {
            "critical": [],
            "high": [],
            "medium": [],
            "low": []
        }
        
        today = datetime.now().date()
        
        # Check for overdue invoices
        overdue_invoices = [
            inv for inv in self.invoices
            if inv["due_date"] < today and inv["status"] == "pending"
        ]
        if overdue_invoices:
            priorities["critical"].append({
                "issue": "Overdue invoices",
                "count": len(overdue_invoices),
                "total_amount": sum(float(inv["total_amount"]) for inv in overdue_invoices),
                "action": "Follow up on overdue payments immediately"
            })
        
        # Check GST remittance
        if abs(self.gst_tracking["net_remittance"]) > Decimal("1000"):
            priorities["high"].append({
                "issue": "GST remittance due",
                "amount": float(self.gst_tracking["net_remittance"]),
                "action": "Calculate and remit GST to CRA"
            })
        
        # Check for missing payroll records
        if len(self.payroll_records) == 0:
            priorities["critical"].append({
                "issue": "No payroll records found",
                "action": "Set up payroll tracking immediately - personal liability risk"
            })
        
        # Check for recent transactions
        recent_transactions = [
            t for t in self.transactions
            if (today - t["date"]).days <= 30
        ]
        if len(recent_transactions) < 10:
            priorities["medium"].append({
                "issue": "Low transaction activity",
                "action": "Ensure all business transactions are being recorded"
            })
        
        # Check for uncategorized expenses
        uncategorized = [
            t for t in self.transactions
            if t["type"] == TransactionType.EXPENSE.value and not t.get("category")
        ]
        if uncategorized:
            priorities["low"].append({
                "issue": "Uncategorized expenses",
                "count": len(uncategorized),
                "action": "Categorize expenses for better tax deductions"
            })
        
        return priorities
    
    def suggest_expense_categorization(
        self,
        description: str,
        amount: Decimal
    ) -> Dict[str, Any]:
        """
        Suggest expense categorization based on description and amount
        
        Args:
            description: Expense description
            amount: Expense amount
            
        Returns:
            Suggested category with confidence and reasoning
        """
        description_lower = description.lower()
        
        # Keyword matching for categories
        category_keywords = {
            ExpenseCategory.MATERIALS: ["lumber", "wood", "plywood", "concrete", "drywall", "insulation", "roofing", "siding"],
            ExpenseCategory.LABOR: ["wage", "salary", "payroll", "subcontractor", "labor"],
            ExpenseCategory.EQUIPMENT: ["rental", "equipment", "machinery", "tool rental"],
            ExpenseCategory.VEHICLE: ["gas", "fuel", "maintenance", "repair", "insurance", "truck", "van"],
            ExpenseCategory.TOOLS: ["tool", "saw", "drill", "hammer", "equipment"],
            ExpenseCategory.INSURANCE: ["insurance", "liability", "wcb"],
            ExpenseCategory.LICENSES_PERMITS: ["permit", "license", "fee", "city", "municipal"],
            ExpenseCategory.UTILITIES: ["hydro", "electricity", "water", "heat", "phone", "internet"],
            ExpenseCategory.RENT: ["rent", "lease"],
            ExpenseCategory.MARKETING: ["advertising", "marketing", "website", "business cards"],
            ExpenseCategory.PROFESSIONAL_SERVICES: ["accountant", "lawyer", "legal", "consultant", "bookkeeper"],
            ExpenseCategory.MEALS_ENTERTAINMENT: ["meal", "food", "restaurant", "coffee", "lunch"],
            ExpenseCategory.HOME_OFFICE: ["office", "supplies", "desk", "chair"]
        }
        
        best_category = ExpenseCategory.OTHER
        best_match_count = 0
        
        for category, keywords in category_keywords.items():
            match_count = sum(1 for keyword in keywords if keyword in description_lower)
            if match_count > best_match_count:
                best_match_count = match_count
                best_category = category
        
        # Determine confidence and provide reasoning
        if best_match_count >= 2:
            confidence = "high"
            reasoning = f"Multiple keywords match {best_category.value} category"
        elif best_match_count == 1:
            confidence = "medium"
            reasoning = f"One keyword matches {best_category.value} category"
        else:
            confidence = "low"
            reasoning = "No clear category match - review manually"
        
        # Special handling for vehicle expenses (grey area)
        if best_category == ExpenseCategory.VEHICLE:
            reasoning += ". Note: Vehicle expenses can be deducted based on business-use percentage. Maintain a mileage log."
        
        # Special handling for meals (50% deductible)
        if best_category == ExpenseCategory.MEALS_ENTERTAINMENT:
            reasoning += ". Note: Only 50% of meal expenses are tax deductible."
        
        return {
            "suggested_category": best_category.value,
            "confidence": confidence,
            "reasoning": reasoning,
            "tax_deductible": True,
            "special_considerations": self._get_special_considerations(best_category)
        }
    
    def _get_special_considerations(self, category: ExpenseCategory) -> List[str]:
        """Get special tax considerations for a category"""
        considerations = {
            ExpenseCategory.VEHICLE: [
                "Maintain mileage log for business-use percentage",
                "70-90% business use is typical for construction",
                "Keep all fuel and maintenance receipts"
            ],
            ExpenseCategory.MEALS_ENTERTAINMENT: [
                "Only 50% deductible",
                "Must have business purpose documented",
                "Client meetings and site visits qualify"
            ],
            ExpenseCategory.HOME_OFFICE: [
                "Based on square footage used for business",
                "Must be dedicated space",
                "Keep floor plan and measurements"
            ],
            ExpenseCategory.TOOLS: [
                "Tools under $500 can be expensed immediately",
                "Larger tools must be depreciated",
                "Keep purchase receipts"
            ]
        }
        return considerations.get(category, [])


# Singleton instance (will be initialized with config later)
financial_system = FinancialSystem()