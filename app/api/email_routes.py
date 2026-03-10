"""
Email AI API Routes
Auto-replies, follow-ups, priority categorization, file extraction
"""

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import logging

from app.email_ai import email_ai
from app.user_system import verify_user_token

logger = logging.getLogger(__name__)
router = APIRouter()


class ProcessEmailRequest(BaseModel):
    sender: str
    subject: str
    body: str
    attachments: Optional[List[Dict]] = []

class UpdateReplyRequest(BaseModel):
    reply_id: str
    body: str
    subject: Optional[str] = None

class EmailSettingsUpdateRequest(BaseModel):
    auto_reply_enabled: Optional[bool] = None
    follow_up_enabled: Optional[bool] = None
    priority_filter: Optional[bool] = None
    reply_delay_minutes: Optional[int] = None


def get_current_user(authorization: Optional[str]):
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization required")
    token = authorization.replace("Bearer ", "").strip()
    user = verify_user_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user

def get_business_config():
    from app.config import config
    return {
        "business_name": config.BUSINESS_NAME,
        "business_address": config.BUSINESS_ADDRESS,
        "business_phone": config.BUSINESS_PHONE,
        "business_email": config.BUSINESS_EMAIL,
        "contact_name": config.CONTACT_PERSON,
        "trade": config.BUSINESS_TYPE
    }


@router.post("/process")
async def process_email(
    request: ProcessEmailRequest,
    authorization: Optional[str] = Header(None)
):
    """Process an incoming email - categorize, generate reply, schedule follow-ups"""
    user = get_current_user(authorization)
    if not user.get("email_access_granted"):
        raise HTTPException(status_code=403, detail="Email access not granted. Please grant permission first.")

    config = get_business_config()
    result = email_ai.process_email(
        sender=request.sender,
        subject=request.subject,
        body=request.body,
        attachments=request.attachments or [],
        business_config=config
    )
    return result


@router.post("/categorize")
async def categorize_email(
    request: ProcessEmailRequest,
    authorization: Optional[str] = Header(None)
):
    """Categorize an email without processing (preview)"""
    get_current_user(authorization)
    result = email_ai.categorize_email(
        subject=request.subject,
        body=request.body,
        sender=request.sender
    )
    return result


@router.get("/inbox")
async def get_inbox(
    priority: Optional[str] = None,
    category: Optional[str] = None,
    authorization: Optional[str] = Header(None)
):
    """Get processed emails with optional filters"""
    get_current_user(authorization)
    emails = email_ai.processed_emails

    if priority:
        emails = [e for e in emails if e.get("priority") == priority]
    if category:
        emails = [e for e in emails if e.get("category") == category]

    # Sort by priority score descending
    emails = sorted(emails, key=lambda x: x.get("priority_score", 0), reverse=True)
    return {"emails": emails, "total": len(emails)}


@router.get("/replies/pending")
async def get_pending_replies(authorization: Optional[str] = Header(None)):
    """Get pending auto-replies"""
    get_current_user(authorization)
    return {
        "replies": email_ai.pending_replies,
        "total": len(email_ai.pending_replies)
    }


@router.post("/replies/{reply_id}/approve")
async def approve_reply(
    reply_id: str,
    authorization: Optional[str] = Header(None)
):
    """Approve a pending auto-reply to send"""
    get_current_user(authorization)
    for reply in email_ai.pending_replies:
        if reply.get("id") == reply_id or reply.get("to") == reply_id:
            reply["status"] = "approved"
            reply["approved_at"] = __import__("datetime").datetime.now().isoformat()
            return {"success": True, "message": "Reply approved for sending", "reply": reply}
    raise HTTPException(status_code=404, detail="Reply not found")


@router.get("/followups")
async def get_follow_ups(authorization: Optional[str] = Header(None)):
    """Get scheduled follow-up emails"""
    get_current_user(authorization)
    return {
        "follow_ups": email_ai.follow_up_queue,
        "total": len(email_ai.follow_up_queue)
    }


@router.get("/stats")
async def get_email_stats(authorization: Optional[str] = Header(None)):
    """Get email processing statistics"""
    get_current_user(authorization)
    return email_ai.get_email_stats()


@router.get("/templates")
async def get_reply_templates(authorization: Optional[str] = Header(None)):
    """Get all auto-reply templates"""
    get_current_user(authorization)
    from app.email_ai import AUTO_REPLY_TEMPLATES, FOLLOW_UP_TEMPLATES
    return {
        "auto_reply_templates": {
            k: {"subject": v["subject"], "body_preview": v["body"][:200] + "..."}
            for k, v in AUTO_REPLY_TEMPLATES.items()
        },
        "follow_up_templates": {
            k: {
                "subject": v["subject"],
                "delay_hours": v["delay_hours"],
                "body_preview": v["body"][:200] + "..."
            }
            for k, v in FOLLOW_UP_TEMPLATES.items()
        }
    }


@router.get("/priority-rules")
async def get_priority_rules(authorization: Optional[str] = Header(None)):
    """Get email priority categorization rules"""
    get_current_user(authorization)
    from app.email_ai import PRIORITY_RULES, EMAIL_CATEGORIES
    return {
        "priority_rules": {
            k: {"keywords": v["keywords"], "label": v["label"], "color": v["color"]}
            for k, v in PRIORITY_RULES.items()
        },
        "categories": {
            k: {"label": v["label"], "icon": v["icon"], "folder": v["folder"]}
            for k, v in EMAIL_CATEGORIES.items()
        }
    }


@router.get("/gdrive-files")
async def get_gdrive_pending_files(authorization: Optional[str] = Header(None)):
    """Get files pending upload to Google Drive"""
    user = get_current_user(authorization)
    if not user.get("gdrive_access_granted"):
        raise HTTPException(status_code=403, detail="Google Drive access not granted")

    # Collect all pending files from processed emails
    pending_files = []
    for email in email_ai.processed_emails:
        for att in email.get("attachments", []):
            pending_files.append({
                "email_id": email["id"],
                "email_subject": email["subject"],
                "filename": att.get("filename"),
                "folder": email.get("gdrive_folder"),
                "subfolder": att.get("subfolder", "Other"),
                "status": att.get("status", "pending_upload")
            })

    return {"files": pending_files, "total": len(pending_files)}