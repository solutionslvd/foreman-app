"""
AI Engine for Foreman Construction Assistant
Full LLM integration with app data context, document analysis, and action execution
"""

import json
import os
import re
from typing import Dict, List, Optional, Any
from datetime import datetime
import logging
import httpx

logger = logging.getLogger(__name__)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

SYSTEM_PROMPT = """You are Foreman AI — a highly capable construction business assistant built into the Foreman app. You help Canadian (primarily Alberta) construction contractors run their business.

You have FULL ACCESS to the user's live app data including:
- Projects (names, clients, status, scope of work, budgets, finish dates)
- Invoices (amounts, clients, due dates, payment status)
- Expenses (categories, amounts, receipts)
- Payroll (employees, contractors, hours, wages)
- Accounting (journal entries, AR, AP, bank reconciliation)
- Documents (blueprints, contracts, permits, photos)

CAPABILITIES:
1. Answer questions about their business data ("How much is outstanding on invoices?")
2. Help create content (invoices, quotes, contracts, emails to clients)
3. Alberta construction regulations, WCB, OHS, GST, CRA guidance
4. Project management advice and scope of work suggestions
5. Analyze documents and blueprints when provided
6. Suggest actions the user can take in the app

RESPONSE FORMAT:
- Be concise and practical — contractors are busy
- Use bullet points and headers for complex answers
- When referencing their data, be specific (use actual names/numbers)
- Suggest app actions when relevant (e.g., "Click + New Invoice to create this")
- For Alberta regulations, be accurate and cite sources when possible
- Format currency as CAD (e.g., $1,250.00)

TONE: Professional but friendly. Like a smart business partner who knows construction."""


class ConstructionAIEngine:
    """Main AI engine for construction business assistance"""

    def __init__(self, config=None):
        self.config = config

    async def process_message(
        self,
        message: str,
        user_context: Dict[str, Any],
        trade_specialization: Optional[str] = None,
        app_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Process user message and generate AI response with full app context
        """
        try:
            # Build context string from app data
            context_str = self._build_context_string(user_context, app_data, trade_specialization)

            # Try OpenAI first, then Anthropic, then fallback
            response = None
            if OPENAI_API_KEY:
                response = await self._call_openai(message, context_str)
            elif ANTHROPIC_API_KEY:
                response = await self._call_anthropic(message, context_str)

            if not response:
                response = self._fallback_response(message, user_context, app_data)

            # Detect suggested actions from response
            actions = self._extract_actions(message, response)
            suggestions = self._get_suggestions(message, app_data)

            return {
                "response": response,
                "suggestions": suggestions,
                "actions": actions,
                "confidence": 0.95 if (OPENAI_API_KEY or ANTHROPIC_API_KEY) else 0.7
            }

        except Exception as e:
            logger.error(f"Error processing message: {e}")
            return {
                "response": "I encountered an error. Please try again.",
                "suggestions": [],
                "actions": [],
                "confidence": 0.0
            }

    def _build_context_string(
        self,
        user_context: Dict,
        app_data: Optional[Dict],
        trade: Optional[str]
    ) -> str:
        """Build a rich context string from the user's app data"""
        parts = []

        # User info
        if user_context:
            name = user_context.get("contact_name") or user_context.get("business_name", "")
            biz = user_context.get("business_name", "")
            if name or biz:
                parts.append(f"USER: {name} | Business: {biz} | Trade: {trade or 'General Contractor'}")

        if not app_data:
            return "\n".join(parts) if parts else ""

        # Projects summary
        projects = app_data.get("projects", [])
        if projects:
            active = [p for p in projects if p.get("status") in ("active", "In Progress")]
            parts.append(f"\nPROJECTS ({len(projects)} total, {len(active)} active):")
            for p in projects[:8]:  # limit to 8
                sow = p.get("scope_of_work", [])
                done = sum(1 for s in sow if s.get("completed"))
                total = len(sow)
                progress = f"{done}/{total} scope items" if total else "no scope"
                budget = p.get("contract_value") or p.get("budget", 0)
                finish = p.get("scheduled_finish_date", "no date")
                parts.append(
                    f"  - {p.get('name')} | Client: {p.get('client_name','?')} | "
                    f"Status: {p.get('status')} | Budget: ${budget:,.0f} | "
                    f"Finish: {finish} | Progress: {progress}"
                )

        # Invoices summary
        invoices = app_data.get("invoices", [])
        if invoices:
            total_invoiced = sum(float(i.get("total", 0) or 0) for i in invoices)
            unpaid = [i for i in invoices if i.get("status") not in ("paid", "Paid")]
            total_outstanding = sum(float(i.get("total", 0) or 0) for i in unpaid)
            parts.append(
                f"\nINVOICES: {len(invoices)} total | "
                f"Total invoiced: ${total_invoiced:,.2f} | "
                f"Outstanding: ${total_outstanding:,.2f} ({len(unpaid)} unpaid)"
            )
            for inv in unpaid[:5]:
                parts.append(
                    f"  - #{inv.get('invoice_number','?')} | {inv.get('customer','?')} | "
                    f"${float(inv.get('total',0)):,.2f} | Due: {inv.get('due_date','?')}"
                )

        # Expenses summary
        expenses = app_data.get("expenses", [])
        if expenses:
            total_exp = sum(float(e.get("amount", 0) or 0) for e in expenses)
            parts.append(f"\nEXPENSES: {len(expenses)} entries | Total: ${total_exp:,.2f}")

        # Payroll summary
        employees = app_data.get("employees", [])
        contractors = app_data.get("contractors", [])
        if employees or contractors:
            parts.append(
                f"\nPAYROLL: {len(employees)} employees, {len(contractors)} contractors"
            )

        # Accounting
        journal = app_data.get("journal_entries", [])
        ar = app_data.get("ar_entries", [])
        ap = app_data.get("ap_entries", [])
        if journal or ar or ap:
            ar_total = sum(float(e.get("amount", 0) or 0) for e in ar if not e.get("paid"))
            ap_total = sum(float(e.get("amount", 0) or 0) for e in ap if not e.get("paid"))
            parts.append(
                f"\nACCOUNTING: {len(journal)} journal entries | "
                f"AR outstanding: ${ar_total:,.2f} | AP outstanding: ${ap_total:,.2f}"
            )

        # Documents
        documents = app_data.get("documents", [])
        if documents:
            cats = {}
            for d in documents:
                c = d.get("category", "Other")
                cats[c] = cats.get(c, 0) + 1
            doc_summary = ", ".join(f"{v} {k}" for k, v in cats.items())
            parts.append(f"\nDOCUMENTS: {len(documents)} files ({doc_summary})")

        return "\n".join(parts)

    async def _call_openai(self, message: str, context: str) -> Optional[str]:
        """Call OpenAI GPT API"""
        try:
            system = SYSTEM_PROMPT
            if context:
                system += f"\n\n--- CURRENT APP DATA ---\n{context}\n--- END APP DATA ---"

            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {OPENAI_API_KEY}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "gpt-4o-mini",
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": message}
                        ],
                        "max_tokens": 1000,
                        "temperature": 0.7
                    }
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return data["choices"][0]["message"]["content"]
                else:
                    logger.error(f"OpenAI error: {resp.status_code} {resp.text}")
                    return None
        except Exception as e:
            logger.error(f"OpenAI call failed: {e}")
            return None

    async def _call_anthropic(self, message: str, context: str) -> Optional[str]:
        """Call Anthropic Claude API"""
        try:
            system = SYSTEM_PROMPT
            if context:
                system += f"\n\n--- CURRENT APP DATA ---\n{context}\n--- END APP DATA ---"

            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": ANTHROPIC_API_KEY,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "claude-3-haiku-20240307",
                        "max_tokens": 1000,
                        "system": system,
                        "messages": [{"role": "user", "content": message}]
                    }
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return data["content"][0]["text"]
                else:
                    logger.error(f"Anthropic error: {resp.status_code} {resp.text}")
                    return None
        except Exception as e:
            logger.error(f"Anthropic call failed: {e}")
            return None

    def _fallback_response(self, message: str, user_context: Dict, app_data: Optional[Dict]) -> str:
        """Smart fallback when no LLM API is configured"""
        msg = message.lower()

        # Data-aware responses
        if app_data:
            projects = app_data.get("projects", [])
            invoices = app_data.get("invoices", [])
            expenses = app_data.get("expenses", [])

            if any(w in msg for w in ["invoice", "outstanding", "owed", "unpaid"]):
                unpaid = [i for i in invoices if i.get("status") not in ("paid", "Paid")]
                total = sum(float(i.get("total", 0) or 0) for i in unpaid)
                if unpaid:
                    lines = [f"You have **{len(unpaid)} unpaid invoice(s)** totalling **${total:,.2f} CAD**:\n"]
                    for inv in unpaid[:5]:
                        lines.append(f"• #{inv.get('invoice_number','?')} — {inv.get('customer','?')} — ${float(inv.get('total',0)):,.2f} (due {inv.get('due_date','?')})")
                    return "\n".join(lines)
                return "All invoices are paid — great work! 🎉"

            if any(w in msg for w in ["project", "job", "site"]):
                active = [p for p in projects if p.get("status") in ("active", "In Progress")]
                if active:
                    lines = [f"You have **{len(active)} active project(s)**:\n"]
                    for p in active[:5]:
                        sow = p.get("scope_of_work", [])
                        done = sum(1 for s in sow if s.get("completed"))
                        total_sow = len(sow)
                        pct = f"{round(done/total_sow*100)}%" if total_sow else "no checklist"
                        lines.append(f"• **{p.get('name')}** — {p.get('client_name','?')} — Progress: {pct}")
                    return "\n".join(lines)
                return "No active projects right now. Create one from the Projects page."

            if any(w in msg for w in ["expense", "spent", "cost"]):
                total = sum(float(e.get("amount", 0) or 0) for e in expenses)
                return f"You have **{len(expenses)} expense entries** totalling **${total:,.2f} CAD**. Head to the Expenses page to review or add more."

        # General knowledge responses
        if any(w in msg for w in ["gst", "tax", "hst"]):
            return """**GST in Alberta Construction:**

• Alberta has **no provincial sales tax** — only 5% federal GST applies
• Charge GST on all labour and materials unless the client is GST-exempt
• File GST returns **quarterly** (or annually if under $1.5M revenue)
• GST remittance due **one month after quarter end**
• Input tax credits (ITCs) let you recover GST paid on business expenses

**Quick tip:** Always include your GST registration number on invoices. Need help calculating GST on an invoice? Just ask!"""

        if any(w in msg for w in ["wcb", "workers comp", "workers compensation"]):
            return """**WCB Alberta for Construction:**

• WCB coverage is **mandatory** for most construction workers in Alberta
• 2024 premium rates vary by trade (framing ~3.2%, carpentry ~2.8%)
• Register at **wcb.ab.ca** — penalties for late registration
• Report all workplace injuries within **24 hours**
• Subcontractors must have their own WCB or be covered under yours

**Clearance letters:** Always get a WCB clearance letter from subcontractors before they start work."""

        if any(w in msg for w in ["permit", "building code", "inspection"]):
            return """**Alberta Building Permits:**

• Required for: new construction, structural changes, electrical, plumbing, HVAC
• Apply through your **local municipality** (not province-wide)
• Typical timeline: 2-6 weeks for residential, longer for commercial
• Required inspections: foundation, framing, insulation, final
• **Fines** for unpermitted work can be significant — always pull permits

Need help with a specific permit type or municipality?"""

        if any(w in msg for w in ["quote", "estimate", "bid"]):
            return """**Writing a Construction Quote:**

A professional quote should include:
1. **Scope of work** — detailed description of what's included (and excluded)
2. **Materials** — itemized list with quantities and unit costs
3. **Labour** — hours × rate, broken down by trade
4. **Timeline** — start date, milestones, completion date
5. **Payment terms** — deposit %, progress payments, holdback
6. **Validity period** — quotes typically valid 30 days
7. **GST** — always show GST separately

**Pro tip:** Use the Invoices page to create professional estimates that convert to invoices when approved."""

        return """I'm your **Foreman AI Assistant** — here to help you run your construction business smarter.

I can help with:
📊 **Your business data** — invoices, projects, expenses, payroll
📋 **Alberta regulations** — WCB, OHS, permits, building code
💰 **Tax & accounting** — GST, CRA, deductions, catch-up
📝 **Documents** — contracts, quotes, change orders
🏗️ **Project management** — scope of work, scheduling, client communication

**To unlock full AI responses**, add an OpenAI or Anthropic API key in your environment variables (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`).

What can I help you with today?"""

    def _extract_actions(self, message: str, response: str) -> List[Dict[str, str]]:
        """Extract suggested app actions based on message and response"""
        msg = message.lower()
        actions = []

        if any(w in msg for w in ["invoice", "bill", "charge"]):
            actions.append({"action": "open_invoice", "label": "➕ New Invoice", "page": "invoices"})
        if any(w in msg for w in ["project", "job", "site"]):
            actions.append({"action": "open_projects", "label": "📋 View Projects", "page": "projects"})
        if any(w in msg for w in ["expense", "receipt", "cost"]):
            actions.append({"action": "open_expenses", "label": "💳 Add Expense", "page": "expenses"})
        if any(w in msg for w in ["payroll", "employee", "pay", "wage"]):
            actions.append({"action": "open_payroll", "label": "👷 Payroll", "page": "payroll"})
        if any(w in msg for w in ["document", "blueprint", "contract", "permit"]):
            actions.append({"action": "open_documents", "label": "📁 Documents", "page": "documents"})
        if any(w in msg for w in ["account", "journal", "balance", "reconcil"]):
            actions.append({"action": "open_accounting", "label": "📊 Accounting", "page": "accounting"})

        return actions[:3]  # max 3 actions

    def _get_suggestions(self, message: str, app_data: Optional[Dict]) -> List[str]:
        """Get contextual follow-up suggestions"""
        suggestions = []
        today = datetime.now()

        if app_data:
            invoices = app_data.get("invoices", [])
            unpaid = [i for i in invoices if i.get("status") not in ("paid", "Paid")]
            if unpaid:
                suggestions.append(f"📬 Send payment reminders for {len(unpaid)} unpaid invoice(s)")

            projects = app_data.get("projects", [])
            overdue = [
                p for p in projects
                if p.get("scheduled_finish_date") and
                p.get("scheduled_finish_date") < today.strftime("%Y-%m-%d") and
                p.get("status") not in ("completed", "Completed")
            ]
            if overdue:
                suggestions.append(f"⚠️ {len(overdue)} project(s) are past their finish date")

        if today.month in [1, 4, 7, 10] and today.day <= 31:
            suggestions.append("📅 GST remittance due this quarter — want help calculating?")
        if today.day <= 15:
            suggestions.append("💳 Payroll deductions due by the 15th")

        return suggestions[:3]

    def _get_proactive_suggestions(self, user_context, trade_specialization):
        return self._get_suggestions("", None)


# Singleton instance
ai_engine = ConstructionAIEngine()