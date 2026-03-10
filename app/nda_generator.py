"""
NDA Generator & Permission System
Generates NDA and handles permission requests for email and Google Drive access
"""

from datetime import datetime
from typing import Dict, Optional
import logging

logger = logging.getLogger(__name__)


def _resolve_field(config: Dict, *keys, fallback: str = "") -> str:
    """Try multiple key names to find a value, return fallback if none found."""
    for key in keys:
        val = config.get(key, "")
        if val and str(val).strip():
            return str(val).strip()
    return fallback


def generate_nda(user: Dict, business_config: Dict) -> str:
    """Generate a Non-Disclosure Agreement for a user.
    BUG-019 FIX: Resolves key-name mismatches between settings_manager and NDA template.
    Shows [NOT SET — update in Admin Settings] for missing fields instead of bare brackets.
    """
    today = datetime.now().strftime("%B %d, %Y")
    year = datetime.now().year

    NOT_SET = "[NOT SET — update in Admin → Settings → Business Info]"

    # Resolve business fields — settings_manager uses 'address', 'email', 'phone'
    # but older code passed 'business_address', 'business_email', 'business_phone'
    biz_name    = _resolve_field(business_config, "business_name", fallback=NOT_SET)
    biz_address = _resolve_field(business_config, "address", "business_address",
                                 fallback=NOT_SET)
    biz_city    = _resolve_field(business_config, "city", fallback="")
    biz_province= _resolve_field(business_config, "province", fallback="Alberta")
    biz_postal  = _resolve_field(business_config, "postal_code", fallback="")
    biz_contact = _resolve_field(business_config, "contact_name", fallback=NOT_SET)
    biz_email   = _resolve_field(business_config, "email", "business_email",
                                 fallback=NOT_SET)
    biz_phone   = _resolve_field(business_config, "phone", "business_phone",
                                 fallback=NOT_SET)

    # Build full address line
    addr_parts = [biz_address]
    city_line = ", ".join(p for p in [biz_city, biz_province, biz_postal] if p)
    if city_line:
        addr_parts.append(city_line)
    full_address = " | ".join(p for p in addr_parts if p and p != NOT_SET) or NOT_SET

    # Client fields
    client_biz  = user.get("business_name") or NOT_SET
    client_name = user.get("contact_name") or NOT_SET
    client_email= user.get("email") or NOT_SET

    # Warn if incomplete
    incomplete_fields = [
        k for k, v in {
            "Business Name": biz_name,
            "Business Address": biz_address,
            "Contact Name": biz_contact,
            "Business Email": biz_email,
            "Business Phone": biz_phone,
        }.items() if v == NOT_SET
    ]
    incomplete_notice = ""
    if incomplete_fields:
        fields_list = ", ".join(incomplete_fields)
        incomplete_notice = (
            f"\n⚠️  NOTICE: The following fields are not yet configured and must be "
            f"completed before this agreement is legally binding:\n"
            f"   {fields_list}\n"
            f"   Update these in Admin Panel → Settings → Business Info.\n"
        )

    return f"""
NON-DISCLOSURE AND SERVICE AGREEMENT

Effective Date: {today}
{incomplete_notice}
PARTIES:

Service Provider: {biz_name}
Address: {full_address}
Contact: {biz_contact}
Email: {biz_email}
Phone: {biz_phone}

Client (User): {client_biz}
Contact: {client_name}
Email: {client_email}

RECITALS

WHEREAS, the Service Provider operates an AI-powered construction business management 
platform ("the Platform") that provides financial management, compliance tracking, 
project management, and AI-assisted communication services;

WHEREAS, the Client wishes to use the Platform and may share confidential business 
information including financial records, client data, project details, and communications;

NOW, THEREFORE, in consideration of the mutual covenants contained herein, the parties 
agree as follows:

1. DEFINITIONS

1.1 "Confidential Information" means any and all information disclosed by either party 
to the other, including but not limited to: business plans, financial data, client lists, 
project details, trade secrets, email communications, documents, and any other proprietary 
information.

1.2 "Platform Services" means the AI assistant, financial management, compliance tracking, 
email management, and Google Drive integration services provided through the Platform.

2. CONFIDENTIALITY OBLIGATIONS

2.1 The Service Provider agrees to:
   (a) Keep all Client Confidential Information strictly confidential
   (b) Not disclose Client information to any third party without written consent
   (c) Use Client information only to provide the Platform Services
   (d) Implement reasonable security measures to protect Client data
   (e) Notify Client promptly of any unauthorized disclosure

2.2 The Client agrees to:
   (a) Keep all Service Provider proprietary information confidential
   (b) Not reverse engineer, copy, or redistribute the Platform
   (c) Use the Platform only for lawful business purposes
   (d) Maintain the security of their login credentials

3. DATA ACCESS AND PERMISSIONS

3.1 Email Access: By granting email access permission, the Client authorizes the Platform to:
   (a) Read incoming emails to categorize and prioritize them
   (b) Generate and send automated replies on behalf of the Client
   (c) Schedule and send follow-up emails
   (d) Extract and save email attachments to Google Drive
   (e) Analyze email content to improve AI responses

3.2 Google Drive Access: By granting Google Drive access permission, the Client authorizes 
the Platform to:
   (a) Create organized folder structures for business documents
   (b) Upload and save email attachments automatically
   (c) Read existing files to provide context to the AI assistant
   (d) Organize documents by category (Financial, Compliance, Projects, etc.)

3.3 The Client may revoke any permission at any time through the Platform settings.

4. DATA SECURITY AND PRIVACY

4.1 The Service Provider will:
   (a) Encrypt all data in transit and at rest
   (b) Never sell or share Client data with third parties
   (c) Comply with applicable Canadian privacy laws (PIPEDA)
   (d) Retain data only as long as necessary for service provision
   (e) Delete all Client data within 30 days of account termination

4.2 The Client acknowledges that:
   (a) No system is 100% secure
   (b) They are responsible for maintaining secure login credentials
   (c) They should not share sensitive information beyond what is necessary

5. INTELLECTUAL PROPERTY

5.1 The Platform and all its components remain the exclusive property of the Service Provider.
5.2 Client data remains the exclusive property of the Client.
5.3 AI-generated content created using Client data is owned by the Client.

6. LIMITATION OF LIABILITY

6.1 The Service Provider's liability is limited to the amount paid for Platform services 
in the preceding 3 months.
6.2 The Service Provider is not liable for indirect, consequential, or incidental damages.
6.3 The Client is responsible for verifying AI-generated content before use.

7. TERM AND TERMINATION

7.1 This Agreement is effective upon acceptance and continues until terminated.
7.2 Either party may terminate with 30 days written notice.
7.3 Upon termination, all Confidential Information must be returned or destroyed.

8. GOVERNING LAW

This Agreement is governed by the laws of the Province of Alberta, Canada.

9. ENTIRE AGREEMENT

This Agreement constitutes the entire agreement between the parties regarding 
confidentiality and supersedes all prior agreements.

10. ACCEPTANCE

By clicking "I Accept" or using the Platform Services, the Client acknowledges that 
they have read, understood, and agree to be bound by this Agreement.

---

Service Provider: {business_config.get('business_name', '[BUSINESS NAME]')}
Date: {today}

Client Signature: ________________________________
Client Name: {user.get('contact_name', '[CLIENT NAME]')}
Business: {user.get('business_name', '[CLIENT BUSINESS NAME]')}
Date: ________________________________

© {year} {business_config.get('business_name', '[BUSINESS NAME]')}. All rights reserved.
"""


def generate_email_permission_request(user: Dict, business_config: Dict) -> Dict:
    """Generate email access permission request"""
    return {
        "title": "Email Access Permission",
        "icon": "📧",
        "description": f"Allow {business_config.get('business_name', 'the Platform')} to access your email account",
        "permissions_requested": [
            {
                "name": "Read Emails",
                "description": "Read incoming emails to categorize and prioritize them",
                "icon": "👁️",
                "required": True
            },
            {
                "name": "Send Emails",
                "description": "Send automated replies and follow-ups on your behalf",
                "icon": "📤",
                "required": True
            },
            {
                "name": "Manage Labels/Folders",
                "description": "Organize emails into categories automatically",
                "icon": "🏷️",
                "required": False
            }
        ],
        "what_we_do": [
            "✅ Automatically reply to new leads within minutes",
            "✅ Send follow-up emails to potential clients",
            "✅ Categorize emails by priority (Urgent/High/Medium/Low)",
            "✅ Extract and save attachments to Google Drive",
            "✅ Generate project detail questionnaires automatically"
        ],
        "what_we_dont_do": [
            "❌ Never read personal emails unrelated to business",
            "❌ Never share your email data with third parties",
            "❌ Never send emails without your configured templates",
            "❌ Never delete your emails"
        ],
        "revoke_instructions": "You can revoke this permission at any time in Settings → Permissions",
        "legal_note": "This permission is governed by our NDA and Privacy Policy"
    }


def generate_gdrive_permission_request(user: Dict, business_config: Dict) -> Dict:
    """Generate Google Drive access permission request"""
    return {
        "title": "Google Drive Access Permission",
        "icon": "📁",
        "description": f"Allow {business_config.get('business_name', 'the Platform')} to access your Google Drive",
        "permissions_requested": [
            {
                "name": "Create Folders",
                "description": "Create organized folder structure for your business documents",
                "icon": "📂",
                "required": True
            },
            {
                "name": "Upload Files",
                "description": "Save email attachments and generated documents automatically",
                "icon": "⬆️",
                "required": True
            },
            {
                "name": "Read Files",
                "description": "Read existing files to provide context to the AI assistant",
                "icon": "📖",
                "required": False
            }
        ],
        "folder_structure": {
            "root": f"{business_config.get('business_name', 'My Business')} - AI Assistant",
            "subfolders": [
                "📁 Financial (Invoices, Receipts, Tax Documents)",
                "📁 Projects (Plans, Photos, Contracts)",
                "📁 Compliance (WCB, Permits, Safety Records)",
                "📁 Leads (New Client Inquiries)",
                "📁 Quotes (Estimates and Proposals)",
                "📁 Complaints (Issue Tracking)",
                "📁 General (Other Documents)"
            ]
        },
        "what_we_do": [
            "✅ Automatically save email attachments to the right folder",
            "✅ Create organized folder structure for your business",
            "✅ Save generated invoices and reports",
            "✅ Keep all your business documents in one place"
        ],
        "what_we_dont_do": [
            "❌ Never access personal files outside the business folder",
            "❌ Never delete your files",
            "❌ Never share your files with third parties",
            "❌ Never modify files without your permission"
        ],
        "revoke_instructions": "You can revoke this permission at any time in Settings → Permissions",
        "legal_note": "This permission is governed by our NDA and Privacy Policy"
    }