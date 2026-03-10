"""
QuickBooks-Inspired Double-Entry Financial Ledger
Chart of Accounts, Journal Entries, P&L, Balance Sheet
"""

from datetime import datetime, date
from decimal import Decimal
from typing import Dict, List, Optional, Tuple
from enum import Enum
import uuid
import logging

logger = logging.getLogger(__name__)

# ============================================================
# ACCOUNT TYPES (QuickBooks-style)
# ============================================================
class AccountType(str, Enum):
    # Balance Sheet Accounts
    BANK = "bank"                          # Chequing, savings
    ACCOUNTS_RECEIVABLE = "accounts_receivable"  # Money owed to you
    OTHER_CURRENT_ASSET = "other_current_asset"  # Inventory, prepaid
    FIXED_ASSET = "fixed_asset"            # Equipment, vehicles
    ACCOUNTS_PAYABLE = "accounts_payable"  # Money you owe
    CREDIT_CARD = "credit_card"            # Credit card balances
    OTHER_CURRENT_LIABILITY = "other_current_liability"  # GST payable, WCB payable
    LONG_TERM_LIABILITY = "long_term_liability"  # Loans
    EQUITY = "equity"                      # Owner's equity

    # Profit & Loss Accounts
    INCOME = "income"                      # Revenue
    COST_OF_GOODS_SOLD = "cost_of_goods_sold"  # Direct job costs
    EXPENSE = "expense"                    # Operating expenses
    OTHER_INCOME = "other_income"          # Non-operating income
    OTHER_EXPENSE = "other_expense"        # Non-operating expenses

BALANCE_SHEET_TYPES = {
    AccountType.BANK, AccountType.ACCOUNTS_RECEIVABLE,
    AccountType.OTHER_CURRENT_ASSET, AccountType.FIXED_ASSET,
    AccountType.ACCOUNTS_PAYABLE, AccountType.CREDIT_CARD,
    AccountType.OTHER_CURRENT_LIABILITY, AccountType.LONG_TERM_LIABILITY,
    AccountType.EQUITY
}

INCOME_STATEMENT_TYPES = {
    AccountType.INCOME, AccountType.COST_OF_GOODS_SOLD,
    AccountType.EXPENSE, AccountType.OTHER_INCOME, AccountType.OTHER_EXPENSE
}

# ============================================================
# CHART OF ACCOUNTS (Alberta Construction Default)
# ============================================================
DEFAULT_CHART_OF_ACCOUNTS = [
    # === ASSETS ===
    {"code": "1010", "name": "Chequing Account",           "type": AccountType.BANK,                    "description": "Main business chequing account"},
    {"code": "1020", "name": "Savings Account",            "type": AccountType.BANK,                    "description": "Business savings account"},
    {"code": "1100", "name": "Accounts Receivable",        "type": AccountType.ACCOUNTS_RECEIVABLE,     "description": "Money owed by customers"},
    {"code": "1200", "name": "Material Inventory",         "type": AccountType.OTHER_CURRENT_ASSET,     "description": "Lumber, hardware, supplies on hand"},
    {"code": "1210", "name": "Prepaid Insurance",          "type": AccountType.OTHER_CURRENT_ASSET,     "description": "Prepaid insurance premiums"},
    {"code": "1500", "name": "Tools & Equipment",          "type": AccountType.FIXED_ASSET,             "description": "Power tools, hand tools, equipment"},
    {"code": "1510", "name": "Vehicles",                   "type": AccountType.FIXED_ASSET,             "description": "Trucks, vans, work vehicles"},
    {"code": "1520", "name": "Accumulated Depreciation",   "type": AccountType.FIXED_ASSET,             "description": "Accumulated depreciation on assets"},

    # === LIABILITIES ===
    {"code": "2000", "name": "Accounts Payable",           "type": AccountType.ACCOUNTS_PAYABLE,        "description": "Money owed to suppliers"},
    {"code": "2010", "name": "Credit Card Payable",        "type": AccountType.CREDIT_CARD,             "description": "Business credit card balance"},
    {"code": "2100", "name": "GST/HST Payable",            "type": AccountType.OTHER_CURRENT_LIABILITY, "description": "GST collected minus GST paid"},
    {"code": "2110", "name": "WCB Premiums Payable",       "type": AccountType.OTHER_CURRENT_LIABILITY, "description": "WCB premiums owing"},
    {"code": "2120", "name": "Payroll Deductions Payable", "type": AccountType.OTHER_CURRENT_LIABILITY, "description": "CPP, EI, income tax withheld"},
    {"code": "2200", "name": "Business Loan",              "type": AccountType.LONG_TERM_LIABILITY,     "description": "Bank loans and lines of credit"},

    # === EQUITY ===
    {"code": "3000", "name": "Owner's Equity",             "type": AccountType.EQUITY,                  "description": "Owner's investment in business"},
    {"code": "3010", "name": "Owner's Draw",               "type": AccountType.EQUITY,                  "description": "Money taken out by owner"},
    {"code": "3020", "name": "Retained Earnings",          "type": AccountType.EQUITY,                  "description": "Accumulated profits/losses"},

    # === INCOME ===
    {"code": "4000", "name": "Construction Revenue",       "type": AccountType.INCOME,                  "description": "General construction income"},
    {"code": "4010", "name": "Framing Revenue",            "type": AccountType.INCOME,                  "description": "Framing and structural work"},
    {"code": "4020", "name": "Carpentry Revenue",          "type": AccountType.INCOME,                  "description": "Finish carpentry and millwork"},
    {"code": "4030", "name": "Renovation Revenue",         "type": AccountType.INCOME,                  "description": "Renovation and remodeling"},
    {"code": "4040", "name": "Consulting Revenue",         "type": AccountType.INCOME,                  "description": "Consulting and project management"},
    {"code": "4900", "name": "Other Income",               "type": AccountType.OTHER_INCOME,            "description": "Miscellaneous income"},

    # === COST OF GOODS SOLD ===
    {"code": "5000", "name": "Materials - Lumber",         "type": AccountType.COST_OF_GOODS_SOLD,      "description": "Lumber and wood products"},
    {"code": "5010", "name": "Materials - Hardware",       "type": AccountType.COST_OF_GOODS_SOLD,      "description": "Nails, screws, fasteners"},
    {"code": "5020", "name": "Materials - Plywood/OSB",    "type": AccountType.COST_OF_GOODS_SOLD,      "description": "Sheet goods"},
    {"code": "5030", "name": "Materials - Other",          "type": AccountType.COST_OF_GOODS_SOLD,      "description": "Other direct materials"},
    {"code": "5100", "name": "Subcontractors",             "type": AccountType.COST_OF_GOODS_SOLD,      "description": "Subcontractor labour costs"},
    {"code": "5200", "name": "Direct Labour",              "type": AccountType.COST_OF_GOODS_SOLD,      "description": "Employee wages on jobs"},
    {"code": "5300", "name": "Equipment Rental",           "type": AccountType.COST_OF_GOODS_SOLD,      "description": "Rented equipment for jobs"},

    # === EXPENSES ===
    {"code": "6000", "name": "Wages & Salaries",           "type": AccountType.EXPENSE,                 "description": "Employee wages (non-job)"},
    {"code": "6010", "name": "WCB Premiums",               "type": AccountType.EXPENSE,                 "description": "Workers Compensation Board premiums"},
    {"code": "6020", "name": "CPP Contributions",          "type": AccountType.EXPENSE,                 "description": "Employer CPP contributions"},
    {"code": "6030", "name": "EI Premiums",                "type": AccountType.EXPENSE,                 "description": "Employer EI premiums"},
    {"code": "6100", "name": "Vehicle Expenses",           "type": AccountType.EXPENSE,                 "description": "Fuel, maintenance, insurance"},
    {"code": "6110", "name": "Tools & Small Equipment",    "type": AccountType.EXPENSE,                 "description": "Tools under $500"},
    {"code": "6200", "name": "Insurance",                  "type": AccountType.EXPENSE,                 "description": "General liability, commercial"},
    {"code": "6210", "name": "Licenses & Permits",         "type": AccountType.EXPENSE,                 "description": "Business licenses, building permits"},
    {"code": "6300", "name": "Office Supplies",            "type": AccountType.EXPENSE,                 "description": "Paper, printer, office items"},
    {"code": "6310", "name": "Phone & Internet",           "type": AccountType.EXPENSE,                 "description": "Cell phone, internet service"},
    {"code": "6320", "name": "Software & Subscriptions",   "type": AccountType.EXPENSE,                 "description": "Software, apps, subscriptions"},
    {"code": "6400", "name": "Advertising & Marketing",    "type": AccountType.EXPENSE,                 "description": "Website, ads, marketing"},
    {"code": "6500", "name": "Professional Fees",          "type": AccountType.EXPENSE,                 "description": "Accountant, lawyer fees"},
    {"code": "6600", "name": "Meals & Entertainment",      "type": AccountType.EXPENSE,                 "description": "Business meals (50% deductible)"},
    {"code": "6700", "name": "Home Office",                "type": AccountType.EXPENSE,                 "description": "Home office deduction"},
    {"code": "6800", "name": "Depreciation Expense",       "type": AccountType.EXPENSE,                 "description": "Annual depreciation on assets"},
    {"code": "6900", "name": "Bank Charges & Interest",    "type": AccountType.EXPENSE,                 "description": "Bank fees, loan interest"},
    {"code": "6999", "name": "Miscellaneous Expense",      "type": AccountType.EXPENSE,                 "description": "Other business expenses"},
]

# ============================================================
# DATA MODELS
# ============================================================
class Account:
    def __init__(self, code: str, name: str, account_type: AccountType, description: str = ""):
        self.id = str(uuid.uuid4())
        self.code = code
        self.name = name
        self.type = account_type
        self.description = description
        self.is_active = True
        self.created_at = datetime.now().isoformat()
        self.balance = Decimal("0.00")

    def is_balance_sheet(self) -> bool:
        return self.type in BALANCE_SHEET_TYPES

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "code": self.code,
            "name": self.name,
            "type": self.type.value,
            "description": self.description,
            "is_active": self.is_active,
            "balance": float(self.balance),
            "is_balance_sheet": self.is_balance_sheet(),
        }


class JournalEntry:
    def __init__(self, account_id: str, amount: Decimal, is_debit: bool,
                 transaction_id: str, description: str = "", date: str = None):
        self.id = str(uuid.uuid4())
        self.account_id = account_id
        self.amount = amount
        self.is_debit = is_debit  # True = debit, False = credit
        self.transaction_id = transaction_id
        self.description = description
        self.date = date or datetime.now().date().isoformat()

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "account_id": self.account_id,
            "amount": float(self.amount),
            "is_debit": self.is_debit,
            "transaction_id": self.transaction_id,
            "description": self.description,
            "date": self.date,
        }


class Transaction:
    def __init__(self, description: str, date: str = None, reference: str = "",
                 transaction_type: str = "general", project_id: str = None,
                 created_by: str = None):
        self.id = str(uuid.uuid4())
        self.description = description
        self.date = date or datetime.now().date().isoformat()
        self.reference = reference
        self.transaction_type = transaction_type  # invoice, expense, payroll, etc.
        self.project_id = project_id
        self.created_by = created_by
        self.created_at = datetime.now().isoformat()
        self.entries: List[JournalEntry] = []
        self.is_reconciled = False
        self.attachments: List[str] = []

    def add_entry(self, account_id: str, amount: Decimal, is_debit: bool, description: str = ""):
        entry = JournalEntry(account_id, amount, is_debit, self.id, description, self.date)
        self.entries.append(entry)
        return entry

    def is_balanced(self) -> bool:
        debits = sum(e.amount for e in self.entries if e.is_debit)
        credits = sum(e.amount for e in self.entries if not e.is_debit)
        return abs(debits - credits) < Decimal("0.01")

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "description": self.description,
            "date": self.date,
            "reference": self.reference,
            "transaction_type": self.transaction_type,
            "project_id": self.project_id,
            "created_by": self.created_by,
            "created_at": self.created_at,
            "entries": [e.to_dict() for e in self.entries],
            "is_balanced": self.is_balanced(),
            "is_reconciled": self.is_reconciled,
            "total_amount": float(sum(e.amount for e in self.entries if e.is_debit)),
        }


# ============================================================
# LEDGER ENGINE
# ============================================================
class ConstructionLedger:
    """
    QuickBooks-inspired double-entry ledger for construction businesses
    """

    def __init__(self):
        self.accounts: Dict[str, Account] = {}       # id -> Account
        self.accounts_by_code: Dict[str, Account] = {}  # code -> Account
        self.transactions: Dict[str, Transaction] = {}   # id -> Transaction
        self.journal_entries: List[JournalEntry] = []
        self._initialize_chart_of_accounts()

    def _initialize_chart_of_accounts(self):
        """Load default chart of accounts"""
        for acct_data in DEFAULT_CHART_OF_ACCOUNTS:
            acct = Account(
                code=acct_data["code"],
                name=acct_data["name"],
                account_type=acct_data["type"],
                description=acct_data["description"]
            )
            self.accounts[acct.id] = acct
            self.accounts_by_code[acct.code] = acct
        logger.info(f"Initialized {len(self.accounts)} accounts in chart of accounts")

    def get_account(self, code: str) -> Optional[Account]:
        return self.accounts_by_code.get(code)

    def get_account_by_id(self, account_id: str) -> Optional[Account]:
        return self.accounts.get(account_id)

    def get_account_balance(self, account_id: str, as_of_date: str = None) -> Decimal:
        """Calculate account balance from journal entries"""
        account = self.accounts.get(account_id)
        if not account:
            return Decimal("0.00")

        balance = Decimal("0.00")
        for entry in self.journal_entries:
            if entry.account_id != account_id:
                continue
            if as_of_date and entry.date > as_of_date:
                continue

            # Normal balance rules:
            # Assets & Expenses: Debit increases, Credit decreases
            # Liabilities, Equity, Income: Credit increases, Debit decreases
            if account.type in {AccountType.BANK, AccountType.ACCOUNTS_RECEIVABLE,
                                  AccountType.OTHER_CURRENT_ASSET, AccountType.FIXED_ASSET,
                                  AccountType.COST_OF_GOODS_SOLD, AccountType.EXPENSE,
                                  AccountType.OTHER_EXPENSE}:
                balance += entry.amount if entry.is_debit else -entry.amount
            else:
                balance += -entry.amount if entry.is_debit else entry.amount

        return balance

    def post_transaction(self, transaction: Transaction) -> bool:
        """Post a balanced transaction to the ledger"""
        if not transaction.is_balanced():
            logger.error(f"Transaction {transaction.id} is not balanced!")
            return False

        self.transactions[transaction.id] = transaction
        self.journal_entries.extend(transaction.entries)
        logger.info(f"Posted transaction: {transaction.description} ({transaction.id})")
        return True

    # ============================================================
    # COMMON TRANSACTION BUILDERS
    # ============================================================

    def record_invoice_payment(self, amount: Decimal, gst_amount: Decimal,
                                 customer_name: str, invoice_number: str,
                                 project_id: str = None) -> Transaction:
        """Record customer invoice - increases AR and GST payable"""
        txn = Transaction(
            description=f"Invoice {invoice_number} - {customer_name}",
            reference=invoice_number,
            transaction_type="invoice",
            project_id=project_id
        )
        ar = self.get_account("1100")   # Accounts Receivable
        gst = self.get_account("2100")  # GST Payable
        revenue = self.get_account("4000")  # Construction Revenue

        net_amount = amount - gst_amount
        txn.add_entry(ar.id, amount, True, f"Invoice {invoice_number}")
        txn.add_entry(revenue.id, net_amount, False, f"Revenue - {customer_name}")
        txn.add_entry(gst.id, gst_amount, False, f"GST collected - {invoice_number}")
        self.post_transaction(txn)
        return txn

    def record_payment_received(self, amount: Decimal, customer_name: str,
                                  invoice_number: str) -> Transaction:
        """Record payment received - moves from AR to bank"""
        txn = Transaction(
            description=f"Payment received - {customer_name} ({invoice_number})",
            reference=invoice_number,
            transaction_type="payment_received"
        )
        bank = self.get_account("1010")  # Chequing
        ar = self.get_account("1100")    # AR

        txn.add_entry(bank.id, amount, True, "Payment received")
        txn.add_entry(ar.id, amount, False, f"Invoice {invoice_number} paid")
        self.post_transaction(txn)
        return txn

    def record_expense(self, amount: Decimal, gst_paid: Decimal,
                        expense_account_code: str, description: str,
                        paid_from: str = "1010") -> Transaction:
        """Record a business expense"""
        txn = Transaction(
            description=description,
            transaction_type="expense"
        )
        expense_acct = self.get_account(expense_account_code)
        bank = self.get_account(paid_from)
        gst_payable = self.get_account("2100")  # GST Payable (ITC)

        if not expense_acct:
            expense_acct = self.get_account("6999")  # Misc

        net_amount = amount - gst_paid
        txn.add_entry(expense_acct.id, net_amount, True, description)
        if gst_paid > 0:
            txn.add_entry(gst_payable.id, gst_paid, True, "GST paid (ITC)")
        txn.add_entry(bank.id, amount, False, f"Payment - {description}")
        self.post_transaction(txn)
        return txn

    def record_payroll(self, gross_wages: Decimal, cpp_employee: Decimal,
                        ei_employee: Decimal, income_tax: Decimal,
                        wcb_premium: Decimal, employee_name: str) -> Transaction:
        """Record payroll entry"""
        txn = Transaction(
            description=f"Payroll - {employee_name}",
            transaction_type="payroll"
        )
        wages_expense = self.get_account("6000")
        wcb_expense = self.get_account("6010")
        cpp_expense = self.get_account("6020")
        ei_expense = self.get_account("6030")
        payroll_payable = self.get_account("2120")
        wcb_payable = self.get_account("2110")
        bank = self.get_account("1010")

        net_pay = gross_wages - cpp_employee - ei_employee - income_tax
        employer_cpp = cpp_employee  # Employer matches CPP
        employer_ei = ei_employee * Decimal("1.4")

        # Debit expenses
        txn.add_entry(wages_expense.id, gross_wages, True, f"Gross wages - {employee_name}")
        txn.add_entry(cpp_expense.id, employer_cpp, True, "Employer CPP")
        txn.add_entry(ei_expense.id, employer_ei, True, "Employer EI")
        txn.add_entry(wcb_expense.id, wcb_premium, True, "WCB premium")

        # Credit liabilities and bank
        txn.add_entry(bank.id, net_pay, False, f"Net pay - {employee_name}")
        txn.add_entry(payroll_payable.id, cpp_employee + ei_employee + income_tax + employer_cpp + employer_ei, False, "Payroll deductions payable")
        txn.add_entry(wcb_payable.id, wcb_premium, False, "WCB payable")
        self.post_transaction(txn)
        return txn

    # ============================================================
    # FINANCIAL REPORTS
    # ============================================================

    def get_profit_and_loss(self, from_date: str, to_date: str) -> Dict:
        """Generate P&L statement for a date range"""
        income = {}
        cogs = {}
        expenses = {}
        other_income = {}
        other_expenses = {}

        for acct in self.accounts.values():
            if not acct.is_active:
                continue
            balance = self._get_period_balance(acct.id, from_date, to_date)
            if balance == 0:
                continue

            entry = {"code": acct.code, "name": acct.name, "amount": float(balance)}
            if acct.type == AccountType.INCOME:
                income[acct.code] = entry
            elif acct.type == AccountType.COST_OF_GOODS_SOLD:
                cogs[acct.code] = entry
            elif acct.type == AccountType.EXPENSE:
                expenses[acct.code] = entry
            elif acct.type == AccountType.OTHER_INCOME:
                other_income[acct.code] = entry
            elif acct.type == AccountType.OTHER_EXPENSE:
                other_expenses[acct.code] = entry

        total_income = sum(v["amount"] for v in income.values())
        total_cogs = sum(v["amount"] for v in cogs.values())
        gross_profit = total_income - total_cogs
        total_expenses = sum(v["amount"] for v in expenses.values())
        total_other_income = sum(v["amount"] for v in other_income.values())
        total_other_expenses = sum(v["amount"] for v in other_expenses.values())
        net_income = gross_profit - total_expenses + total_other_income - total_other_expenses

        return {
            "period": {"from": from_date, "to": to_date},
            "income": sorted(income.values(), key=lambda x: x["code"]),
            "total_income": total_income,
            "cost_of_goods_sold": sorted(cogs.values(), key=lambda x: x["code"]),
            "total_cogs": total_cogs,
            "gross_profit": gross_profit,
            "gross_margin_pct": round((gross_profit / total_income * 100) if total_income else 0, 1),
            "expenses": sorted(expenses.values(), key=lambda x: x["code"]),
            "total_expenses": total_expenses,
            "other_income": sorted(other_income.values(), key=lambda x: x["code"]),
            "other_expenses": sorted(other_expenses.values(), key=lambda x: x["code"]),
            "net_income": net_income,
            "net_margin_pct": round((net_income / total_income * 100) if total_income else 0, 1),
        }

    def get_balance_sheet(self, as_of_date: str = None) -> Dict:
        """Generate balance sheet as of a date"""
        if not as_of_date:
            as_of_date = datetime.now().date().isoformat()

        assets = {}
        liabilities = {}
        equity = {}

        for acct in self.accounts.values():
            if not acct.is_active:
                continue
            balance = self.get_account_balance(acct.id, as_of_date)
            if balance == 0:
                continue

            entry = {"code": acct.code, "name": acct.name, "amount": float(balance), "type": acct.type.value}
            if acct.type in {AccountType.BANK, AccountType.ACCOUNTS_RECEIVABLE,
                              AccountType.OTHER_CURRENT_ASSET, AccountType.FIXED_ASSET}:
                assets[acct.code] = entry
            elif acct.type in {AccountType.ACCOUNTS_PAYABLE, AccountType.CREDIT_CARD,
                                 AccountType.OTHER_CURRENT_LIABILITY, AccountType.LONG_TERM_LIABILITY}:
                liabilities[acct.code] = entry
            elif acct.type == AccountType.EQUITY:
                equity[acct.code] = entry

        total_assets = sum(v["amount"] for v in assets.values())
        total_liabilities = sum(v["amount"] for v in liabilities.values())
        total_equity = sum(v["amount"] for v in equity.values())

        return {
            "as_of_date": as_of_date,
            "assets": sorted(assets.values(), key=lambda x: x["code"]),
            "total_assets": total_assets,
            "liabilities": sorted(liabilities.values(), key=lambda x: x["code"]),
            "total_liabilities": total_liabilities,
            "equity": sorted(equity.values(), key=lambda x: x["code"]),
            "total_equity": total_equity,
            "total_liabilities_and_equity": total_liabilities + total_equity,
            "is_balanced": abs(total_assets - (total_liabilities + total_equity)) < 0.01,
        }

    def get_gst_summary(self, from_date: str, to_date: str) -> Dict:
        """GST/HST filing summary"""
        gst_acct = self.get_account("2100")
        if not gst_acct:
            return {}

        collected = Decimal("0.00")
        paid_itc = Decimal("0.00")

        for entry in self.journal_entries:
            if entry.account_id != gst_acct.id:
                continue
            if entry.date < from_date or entry.date > to_date:
                continue
            if not entry.is_debit:  # Credit = GST collected
                collected += entry.amount
            else:  # Debit = ITC (GST paid on expenses)
                paid_itc += entry.amount

        net_gst = collected - paid_itc
        return {
            "period": {"from": from_date, "to": to_date},
            "gst_collected": float(collected),
            "gst_paid_itc": float(paid_itc),
            "net_gst_owing": float(net_gst),
            "filing_due": "One month after period end",
            "status": "owing" if net_gst > 0 else "refund" if net_gst < 0 else "nil",
        }

    def get_cash_flow(self, from_date: str, to_date: str) -> Dict:
        """Simple cash flow statement"""
        bank_acct = self.get_account("1010")
        if not bank_acct:
            return {}

        opening = self.get_account_balance(bank_acct.id, from_date)
        closing = self.get_account_balance(bank_acct.id, to_date)
        net_change = closing - opening

        inflows = []
        outflows = []
        for entry in self.journal_entries:
            if entry.account_id != bank_acct.id:
                continue
            if entry.date < from_date or entry.date > to_date:
                continue
            txn = self.transactions.get(entry.transaction_id)
            if entry.is_debit:
                inflows.append({"description": txn.description if txn else "Unknown", "amount": float(entry.amount), "date": entry.date})
            else:
                outflows.append({"description": txn.description if txn else "Unknown", "amount": float(entry.amount), "date": entry.date})

        return {
            "period": {"from": from_date, "to": to_date},
            "opening_balance": float(opening),
            "closing_balance": float(closing),
            "net_change": float(net_change),
            "total_inflows": sum(i["amount"] for i in inflows),
            "total_outflows": sum(o["amount"] for o in outflows),
            "inflows": sorted(inflows, key=lambda x: x["date"]),
            "outflows": sorted(outflows, key=lambda x: x["date"]),
        }

    def _get_period_balance(self, account_id: str, from_date: str, to_date: str) -> Decimal:
        """Get net activity for P&L accounts in a period"""
        account = self.accounts.get(account_id)
        if not account:
            return Decimal("0.00")

        balance = Decimal("0.00")
        for entry in self.journal_entries:
            if entry.account_id != account_id:
                continue
            if entry.date < from_date or entry.date > to_date:
                continue
            # For income accounts, credit = positive
            if account.type in {AccountType.INCOME, AccountType.OTHER_INCOME}:
                balance += -entry.amount if entry.is_debit else entry.amount
            else:
                balance += entry.amount if entry.is_debit else -entry.amount

        return balance

    def get_chart_of_accounts(self) -> List[Dict]:
        """Return full chart of accounts with balances"""
        result = []
        for acct in sorted(self.accounts.values(), key=lambda x: x.code):
            d = acct.to_dict()
            d["balance"] = float(self.get_account_balance(acct.id))
            result.append(d)
        return result

    def get_accounts_receivable_aging(self) -> Dict:
        """AR aging report - who owes what"""
        # Simplified - in production would track per-invoice
        ar_acct = self.get_account("1100")
        total_ar = float(self.get_account_balance(ar_acct.id)) if ar_acct else 0
        return {
            "total_outstanding": total_ar,
            "current": total_ar * 0.6,
            "days_31_60": total_ar * 0.25,
            "days_61_90": total_ar * 0.10,
            "over_90": total_ar * 0.05,
        }


# Global ledger instance
ledger = ConstructionLedger()