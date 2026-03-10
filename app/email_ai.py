"""
Email AI System
Auto-replies, lead follow-ups, priority categorization, file extraction
"""

import re
import secrets
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import logging

logger = logging.getLogger(__name__)


# ─── Priority Levels ──────────────────────────────────────────────────────────
PRIORITY_RULES = {
    "urgent": {
        "keywords": ["urgent", "asap", "emergency", "immediately", "today", "deadline",
                     "overdue", "critical", "right away", "as soon as possible"],
        "score": 100,
        "color": "#c62828",
        "label": "🔴 Urgent"
    },
    "high": {
        "keywords": ["quote", "estimate", "proposal", "contract", "permit", "inspection",
                     "payment", "invoice", "bid", "tender", "project start", "start date"],
        "score": 75,
        "color": "#f57f17",
        "label": "🟠 High"
    },
    "medium": {
        "keywords": ["question", "inquiry", "information", "details", "schedule",
                     "meeting", "call", "discuss", "follow up", "update", "status"],
        "score": 50,
        "color": "#1565c0",
        "label": "🔵 Medium"
    },
    "low": {
        "keywords": ["newsletter", "unsubscribe", "promotion", "sale", "offer",
                     "fyi", "no action", "just letting you know"],
        "score": 25,
        "color": "#2e7d32",
        "label": "🟢 Low"
    }
}

# ─── Email Categories ─────────────────────────────────────────────────────────
EMAIL_CATEGORIES = {
    "new_lead": {
        "keywords": ["interested in", "looking for", "need a contractor", "need help with",
                     "can you help", "do you do", "are you available", "new project",
                     "renovation", "build", "construction", "framing", "carpentry"],
        "label": "New Lead",
        "icon": "🎯",
        "folder": "Leads"
    },
    "quote_request": {
        "keywords": ["quote", "estimate", "how much", "price", "cost", "bid",
                     "proposal", "pricing", "rates", "what do you charge"],
        "label": "Quote Request",
        "icon": "💰",
        "folder": "Quotes"
    },
    "project_update": {
        "keywords": ["update", "progress", "status", "how is it going", "timeline",
                     "schedule", "when will", "completion", "phase"],
        "label": "Project Update",
        "icon": "🏗️",
        "folder": "Projects"
    },
    "invoice_payment": {
        "keywords": ["invoice", "payment", "paid", "bill", "receipt", "e-transfer",
                     "cheque", "check", "deposit", "balance owing"],
        "label": "Invoice/Payment",
        "icon": "💳",
        "folder": "Financial"
    },
    "permit_compliance": {
        "keywords": ["permit", "inspection", "code", "compliance", "wcb", "ohs",
                     "safety", "certificate", "license", "approval"],
        "label": "Permit/Compliance",
        "icon": "📋",
        "folder": "Compliance"
    },
    "complaint": {
        "keywords": ["unhappy", "complaint", "problem", "issue", "wrong", "mistake",
                     "not satisfied", "disappointed", "refund", "redo"],
        "label": "Complaint",
        "icon": "⚠️",
        "folder": "Complaints"
    },
    "general": {
        "keywords": [],
        "label": "General",
        "icon": "📧",
        "folder": "General"
    }
}

# ─── Auto-Reply Templates ─────────────────────────────────────────────────────
AUTO_REPLY_TEMPLATES = {
    "new_lead": {
        "subject": "Re: {original_subject} - Thank you for reaching out!",
        "body": """Hi {sender_name},

Thank you for reaching out to {business_name}! We're excited to hear about your project.

I've received your message and will personally review the details. Here's what happens next:

✅ **Within 24 hours**: I'll review your project requirements
✅ **Within 48 hours**: I'll send you a detailed quote or schedule a site visit
✅ **Site Visit**: We'll walk through the project together at no charge

To help me prepare the most accurate quote for you, could you please answer a few quick questions?

1. What is the approximate size/scope of the project?
2. What is your ideal start date?
3. Do you have any plans, drawings, or permits already?
4. What is your approximate budget range?
5. Is there anything specific you'd like us to know?

Feel free to reply to this email or call us directly at {business_phone}.

Looking forward to working with you!

Best regards,
{contact_name}
{business_name}
{business_phone}
{business_email}

---
*This is an automated response. A team member will follow up personally within 24 hours.*"""
    },

    "quote_request": {
        "subject": "Re: {original_subject} - Quote Request Received",
        "body": """Hi {sender_name},

Thank you for requesting a quote from {business_name}!

I've received your request and am preparing a detailed estimate for you.

**To provide you with the most accurate quote, I need a few details:**

📐 **Project Details:**
1. What type of work is needed? (framing, carpentry, renovation, new build, etc.)
2. What are the approximate dimensions or square footage?
3. What materials do you prefer? (standard, premium, specific brands?)
4. Are there any special requirements or challenges?

📅 **Timeline:**
5. When would you like the project to start?
6. Is there a completion deadline?

📍 **Location:**
7. What is the project address?
8. Is there easy access for equipment and materials?

📎 **Documents:**
9. Do you have any plans, drawings, or photos you can share?

Once I have these details, I can provide you with a comprehensive quote within 24-48 hours.

Best regards,
{contact_name}
{business_name}
{business_phone}"""
    },

    "project_update": {
        "subject": "Re: {original_subject} - Project Update",
        "body": """Hi {sender_name},

Thank you for your message regarding your project.

I'll review the current status and get back to you with a detailed update within a few hours.

In the meantime, here's a quick overview of where things stand:

🏗️ **Your Project**: {project_name}
📅 **Current Phase**: Being reviewed
📊 **Next Update**: Within 24 hours

If you have any urgent concerns, please don't hesitate to call us directly at {business_phone}.

Best regards,
{contact_name}
{business_name}"""
    },

    "invoice_payment": {
        "subject": "Re: {original_subject} - Payment Confirmation",
        "body": """Hi {sender_name},

Thank you for your message regarding payment.

Our accounting team will review and confirm receipt within 1 business day.

**Payment Methods We Accept:**
💳 E-Transfer to: {business_email}
🏦 Cheque payable to: {business_name}
💵 Cash (receipt provided)

If you have any questions about your invoice or payment, please contact us at {business_phone}.

Best regards,
{contact_name}
{business_name}"""
    },

    "complaint": {
        "subject": "Re: {original_subject} - We're Here to Help",
        "body": """Hi {sender_name},

Thank you for bringing this to our attention. We take all feedback very seriously and want to make this right.

I've flagged your message as a priority and will personally review the situation.

**What happens next:**
🔴 **Within 2 hours**: A team member will contact you directly
🔴 **Within 24 hours**: We'll have a resolution plan in place

Please know that your satisfaction is our top priority. We stand behind our work and will do whatever it takes to resolve this to your satisfaction.

You can also reach me directly at {business_phone}.

Sincerely,
{contact_name}
{business_name}
{business_phone}"""
    },

    "general": {
        "subject": "Re: {original_subject} - Message Received",
        "body": """Hi {sender_name},

Thank you for contacting {business_name}!

I've received your message and will respond personally within 24 hours.

If your matter is urgent, please call us at {business_phone}.

Best regards,
{contact_name}
{business_name}
{business_phone}
{business_email}"""
    }
}

# ─── Follow-Up Templates ──────────────────────────────────────────────────────
FOLLOW_UP_TEMPLATES = {
    "lead_day1": {
        "delay_hours": 24,
        "subject": "Following up - {business_name} Quote",
        "body": """Hi {sender_name},

I wanted to follow up on your inquiry from yesterday.

Have you had a chance to review my previous message? I'd love to learn more about your project and see how we can help.

**Quick reminder of what we offer:**
✅ Free site visits and consultations
✅ Detailed written quotes within 48 hours
✅ Alberta-certified and fully insured
✅ 7+ years of experience in {trade}

Are you available for a quick 15-minute call this week?

Best regards,
{contact_name}
{business_name}
{business_phone}"""
    },

    "lead_day3": {
        "delay_hours": 72,
        "subject": "Still interested? - {business_name}",
        "body": """Hi {sender_name},

I'm reaching out one more time about your project inquiry.

I understand you're busy, so I'll keep this brief:

🏗️ We specialize in {trade} in Alberta
⭐ Fully licensed, insured, and WCB covered
💰 Competitive pricing with no hidden fees
📅 Currently booking projects for {next_month}

If you're still interested, I'd love to chat. If the timing isn't right, no worries at all - feel free to reach out whenever you're ready.

Best regards,
{contact_name}
{business_name}
{business_phone}"""
    },

    "quote_followup": {
        "delay_hours": 48,
        "subject": "Your Quote from {business_name} - Any Questions?",
        "body": """Hi {sender_name},

I wanted to follow up on the quote I sent you.

Have you had a chance to review it? I'm happy to:
📞 Walk you through the details on a call
🔧 Adjust the scope or materials to fit your budget
📅 Discuss flexible scheduling options
❓ Answer any questions you might have

Quotes are valid for 30 days. I want to make sure you have everything you need to make the best decision for your project.

Best regards,
{contact_name}
{business_name}
{business_phone}"""
    }
}


class EmailAIEngine:
    """AI-powered email management system"""

    def __init__(self):
        self.processed_emails: List[Dict] = []
        self.pending_replies: List[Dict] = []
        self.follow_up_queue: List[Dict] = []

    def categorize_email(self, subject: str, body: str, sender: str) -> Dict:
        """Categorize an email by type and priority"""
        text = (subject + " " + body).lower()

        # Determine category
        category = "general"
        category_score = 0
        for cat, rules in EMAIL_CATEGORIES.items():
            score = sum(1 for kw in rules["keywords"] if kw in text)
            if score > category_score:
                category_score = score
                category = cat

        # Determine priority
        priority = "low"
        priority_score = 0
        for pri, rules in PRIORITY_RULES.items():
            score = sum(1 for kw in rules["keywords"] if kw in text)
            if score > priority_score:
                priority_score = score
                priority = pri

        # Detect attachments mentioned
        has_attachments = any(word in text for word in [
            "attached", "attachment", "enclosed", "see attached",
            "find attached", "document", "file", "photo", "image", "pdf"
        ])

        # Extract sender name
        sender_name = self._extract_name(sender)

        return {
            "category": category,
            "category_label": EMAIL_CATEGORIES[category]["label"],
            "category_icon": EMAIL_CATEGORIES[category]["icon"],
            "gdrive_folder": EMAIL_CATEGORIES[category]["folder"],
            "priority": priority,
            "priority_label": PRIORITY_RULES[priority]["label"],
            "priority_color": PRIORITY_RULES[priority]["color"],
            "priority_score": PRIORITY_RULES[priority]["score"],
            "has_attachments": has_attachments,
            "sender_name": sender_name,
            "sender_email": sender,
            "requires_followup": category in ["new_lead", "quote_request"],
            "auto_reply_template": category
        }

    def generate_auto_reply(
        self,
        email_data: Dict,
        business_config: Dict
    ) -> Dict:
        """Generate an auto-reply for an email"""
        category = email_data.get("category", "general")
        template = AUTO_REPLY_TEMPLATES.get(category, AUTO_REPLY_TEMPLATES["general"])

        # Fill template variables
        variables = {
            "sender_name": email_data.get("sender_name", "there"),
            "original_subject": email_data.get("subject", "Your Inquiry"),
            "business_name": business_config.get("business_name", "[YOUR BUSINESS NAME]"),
            "business_phone": business_config.get("business_phone", "[YOUR PHONE]"),
            "business_email": business_config.get("business_email", "[YOUR EMAIL]"),
            "contact_name": business_config.get("contact_name", "[YOUR NAME]"),
            "trade": business_config.get("trade", "construction"),
            "project_name": email_data.get("project_name", "your project"),
            "next_month": (datetime.now() + timedelta(days=30)).strftime("%B %Y")
        }

        subject = template["subject"].format(**variables)
        body = template["body"].format(**variables)

        return {
            "to": email_data.get("sender_email"),
            "subject": subject,
            "body": body,
            "category": category,
            "generated_at": datetime.now().isoformat(),
            "status": "pending"
        }

    def schedule_follow_ups(
        self,
        email_data: Dict,
        business_config: Dict
    ) -> List[Dict]:
        """Schedule follow-up emails for leads"""
        follow_ups = []
        category = email_data.get("category", "general")

        if category == "new_lead":
            for key in ["lead_day1", "lead_day3"]:
                tmpl = FOLLOW_UP_TEMPLATES[key]
                variables = {
                    "sender_name": email_data.get("sender_name", "there"),
                    "business_name": business_config.get("business_name", "[YOUR BUSINESS NAME]"),
                    "business_phone": business_config.get("business_phone", "[YOUR PHONE]"),
                    "contact_name": business_config.get("contact_name", "[YOUR NAME]"),
                    "trade": business_config.get("trade", "construction"),
                    "next_month": (datetime.now() + timedelta(days=30)).strftime("%B %Y")
                }
                follow_ups.append({
                    "to": email_data.get("sender_email"),
                    "subject": tmpl["subject"].format(**variables),
                    "body": tmpl["body"].format(**variables),
                    "send_at": (datetime.now() + timedelta(hours=tmpl["delay_hours"])).isoformat(),
                    "type": key,
                    "status": "scheduled"
                })

        elif category == "quote_request":
            tmpl = FOLLOW_UP_TEMPLATES["quote_followup"]
            variables = {
                "sender_name": email_data.get("sender_name", "there"),
                "business_name": business_config.get("business_name", "[YOUR BUSINESS NAME]"),
                "business_phone": business_config.get("business_phone", "[YOUR PHONE]"),
                "contact_name": business_config.get("contact_name", "[YOUR NAME]")
            }
            follow_ups.append({
                "to": email_data.get("sender_email"),
                "subject": tmpl["subject"].format(**variables),
                "body": tmpl["body"].format(**variables),
                "send_at": (datetime.now() + timedelta(hours=tmpl["delay_hours"])).isoformat(),
                "type": "quote_followup",
                "status": "scheduled"
            })

        return follow_ups

    def process_email(
        self,
        sender: str,
        subject: str,
        body: str,
        attachments: List[Dict],
        business_config: Dict
    ) -> Dict:
        """Full email processing pipeline"""
        email_id = secrets.token_hex(8)

        # Categorize
        categorization = self.categorize_email(subject, body, sender)

        # Build email record
        email_record = {
            "id": email_id,
            "sender": sender,
            "subject": subject,
            "body_preview": body[:200] + "..." if len(body) > 200 else body,
            "received_at": datetime.now().isoformat(),
            "attachments": attachments,
            **categorization
        }

        # Generate auto-reply
        auto_reply = self.generate_auto_reply(
            {**email_record, "subject": subject},
            business_config
        )

        # Schedule follow-ups
        follow_ups = self.schedule_follow_ups(email_record, business_config)

        # Categorize attachments for Google Drive
        gdrive_files = []
        for att in attachments:
            gdrive_files.append({
                "filename": att.get("filename", "unknown"),
                "folder": categorization["gdrive_folder"],
                "subfolder": self._get_subfolder(att.get("filename", "")),
                "size": att.get("size", 0),
                "mime_type": att.get("mime_type", "application/octet-stream"),
                "status": "pending_upload"
            })

        self.processed_emails.append(email_record)
        self.pending_replies.append(auto_reply)
        self.follow_up_queue.extend(follow_ups)

        return {
            "email": email_record,
            "auto_reply": auto_reply,
            "follow_ups": follow_ups,
            "gdrive_files": gdrive_files,
            "action_required": categorization["priority"] in ["urgent", "high"]
        }

    def get_email_stats(self) -> Dict:
        """Get email processing statistics"""
        total = len(self.processed_emails)
        by_priority = {}
        by_category = {}

        for email in self.processed_emails:
            p = email.get("priority", "low")
            c = email.get("category", "general")
            by_priority[p] = by_priority.get(p, 0) + 1
            by_category[c] = by_category.get(c, 0) + 1

        return {
            "total_processed": total,
            "pending_replies": len(self.pending_replies),
            "scheduled_followups": len(self.follow_up_queue),
            "by_priority": by_priority,
            "by_category": by_category
        }

    def _extract_name(self, email_or_name: str) -> str:
        """Extract first name from email or name string"""
        if "<" in email_or_name:
            name_part = email_or_name.split("<")[0].strip().strip('"')
            if name_part:
                return name_part.split()[0]
        if "@" in email_or_name:
            local = email_or_name.split("@")[0]
            return local.replace(".", " ").replace("_", " ").title().split()[0]
        return email_or_name.split()[0] if email_or_name else "there"

    def _get_subfolder(self, filename: str) -> str:
        """Determine Google Drive subfolder based on file type"""
        ext = filename.lower().split(".")[-1] if "." in filename else ""
        mapping = {
            "pdf": "PDFs",
            "doc": "Documents", "docx": "Documents",
            "xls": "Spreadsheets", "xlsx": "Spreadsheets",
            "jpg": "Photos", "jpeg": "Photos", "png": "Photos", "heic": "Photos",
            "dwg": "Drawings", "dxf": "Drawings",
            "mp4": "Videos", "mov": "Videos",
            "zip": "Archives", "rar": "Archives"
        }
        return mapping.get(ext, "Other")


# Singleton
email_ai = EmailAIEngine()