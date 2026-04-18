"""
Email Sender Module for Foreman AI
Handles SMTP email sending for invoices, password resets, notifications.
Supports Gmail, SendGrid SMTP, or any SMTP provider.
"""

import os
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from typing import Optional, List
from datetime import datetime

logger = logging.getLogger(__name__)

# ── SMTP Configuration from Environment Variables ────────────────────────────
SMTP_HOST     = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER     = os.environ.get("SMTP_USER", "")
SMTP_PASS     = os.environ.get("SMTP_PASS", "")
SMTP_FROM     = os.environ.get("SMTP_FROM", SMTP_USER)
SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "The Foreman AI")
APP_BASE_URL  = os.environ.get("APP_BASE_URL", "https://foreman-app.onrender.com")

def _is_configured() -> bool:
    return bool(SMTP_USER and SMTP_PASS)


def send_email(
    to: str,
    subject: str,
    html_body: str,
    plain_body: str = "",
    attachments: Optional[List[dict]] = None
) -> bool:
    """
    Send an email via SMTP.
    attachments = [{"filename": "invoice.pdf", "data": bytes}]
    Returns True on success, False on failure.
    """
    if not _is_configured():
        logger.warning("SMTP not configured — skipping email send. Set SMTP_USER and SMTP_PASS.")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"{SMTP_FROM_NAME} <{SMTP_FROM}>"
        msg["To"]      = to

        if plain_body:
            msg.attach(MIMEText(plain_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        # Attachments
        if attachments:
            for att in attachments:
                part = MIMEBase("application", "octet-stream")
                part.set_payload(att["data"])
                encoders.encode_base64(part)
                part.add_header("Content-Disposition", f'attachment; filename="{att["filename"]}"')
                msg.attach(part)

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_FROM, [to], msg.as_string())

        logger.info(f"Email sent to {to}: {subject}")
        return True

    except Exception as e:
        logger.error(f"Failed to send email to {to}: {e}")
        return False


# ── Template: Password Reset ─────────────────────────────────────────────────
def send_password_reset(to_email: str, reset_token: str, contact_name: str = "") -> bool:
    reset_url = f"{APP_BASE_URL}/reset-password?token={reset_token}"
    name = contact_name or "there"
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:#1a1a2e;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:#ff6b35;margin:0;font-size:24px;">👷 The Foreman AI</h1>
        <p style="color:#aaa;margin:8px 0 0;">Password Reset Request</p>
      </div>
      <div style="background:#16213e;padding:32px;border-radius:0 0 12px 12px;color:#e0e0e0;">
        <p>Hi {name},</p>
        <p>We received a request to reset your password for The Foreman AI.</p>
        <p>Click the button below to reset your password. This link expires in <strong>1 hour</strong>.</p>
        <div style="text-align:center;margin:32px 0;">
          <a href="{reset_url}" style="background:#ff6b35;color:#fff;padding:14px 32px;border-radius:8px;
             text-decoration:none;font-weight:bold;font-size:16px;">Reset My Password</a>
        </div>
        <p style="color:#888;font-size:13px;">If you didn't request this, you can safely ignore this email.
        Your password will not change.</p>
        <p style="color:#888;font-size:12px;margin-top:24px;border-top:1px solid #333;padding-top:16px;">
          The Foreman AI · Alberta Construction Management Platform<br>
          <a href="{APP_BASE_URL}" style="color:#ff6b35;">{APP_BASE_URL}</a>
        </p>
      </div>
    </div>
    """
    plain = f"""Hi {name},

Password reset requested for The Foreman AI.

Reset your password here: {reset_url}

This link expires in 1 hour. If you didn't request this, ignore this email.

— The Foreman AI Team
"""
    return send_email(to_email, "Reset Your Foreman AI Password", html, plain)


# ── Template: Invoice Email ───────────────────────────────────────────────────
def send_invoice_email(
    to_email: str,
    client_name: str,
    invoice_number: str,
    invoice_total: str,
    due_date: str,
    business_name: str,
    invoice_html: str = "",
    pdf_bytes: Optional[bytes] = None
) -> bool:
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:#1a1a2e;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:#ff6b35;margin:0;font-size:24px;">👷 {business_name}</h1>
        <p style="color:#aaa;margin:8px 0 0;">Invoice {invoice_number}</p>
      </div>
      <div style="background:#16213e;padding:32px;border-radius:0 0 12px 12px;color:#e0e0e0;">
        <p>Hi {client_name},</p>
        <p>Please find your invoice details below:</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr style="background:#0f3460;">
            <td style="padding:12px;color:#aaa;">Invoice #</td>
            <td style="padding:12px;color:#fff;font-weight:bold;">{invoice_number}</td>
          </tr>
          <tr>
            <td style="padding:12px;color:#aaa;">Amount Due</td>
            <td style="padding:12px;color:#ff6b35;font-weight:bold;font-size:20px;">{invoice_total}</td>
          </tr>
          <tr style="background:#0f3460;">
            <td style="padding:12px;color:#aaa;">Due Date</td>
            <td style="padding:12px;color:#fff;">{due_date}</td>
          </tr>
        </table>
        {invoice_html}
        <p>Please contact us if you have any questions.</p>
        <p style="color:#888;font-size:12px;margin-top:24px;border-top:1px solid #333;padding-top:16px;">
          {business_name} · Powered by The Foreman AI
        </p>
      </div>
    </div>
    """
    attachments = []
    if pdf_bytes:
        attachments.append({"filename": f"Invoice_{invoice_number}.pdf", "data": pdf_bytes})

    return send_email(
        to_email,
        f"Invoice {invoice_number} from {business_name} — Due {due_date}",
        html,
        attachments=attachments if attachments else None
    )


# ── Template: Welcome Email ───────────────────────────────────────────────────
def send_welcome_email(to_email: str, contact_name: str, business_name: str, plan: str) -> bool:
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:#1a1a2e;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:#ff6b35;margin:0;font-size:28px;">👷 Welcome to The Foreman AI!</h1>
      </div>
      <div style="background:#16213e;padding:32px;border-radius:0 0 12px 12px;color:#e0e0e0;">
        <h2 style="color:#ff6b35;">Hi {contact_name}! 🎉</h2>
        <p>Welcome to <strong>The Foreman AI</strong> — your Alberta construction command centre.</p>
        <p>Your account for <strong>{business_name}</strong> is ready on the <strong>{plan.title()}</strong> plan.</p>
        <h3 style="color:#ff6b35;">Getting Started:</h3>
        <ul style="line-height:2;">
          <li>✅ Add your first project</li>
          <li>✅ Set up your business info in Settings</li>
          <li>✅ Create your first invoice or estimate</li>
          <li>✅ Try the AI assistant — ask it anything!</li>
        </ul>
        <div style="text-align:center;margin:32px 0;">
          <a href="{APP_BASE_URL}/app.html" style="background:#ff6b35;color:#fff;padding:14px 32px;
             border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;">Open The Foreman AI</a>
        </div>
        <p style="color:#888;font-size:12px;margin-top:24px;border-top:1px solid #333;padding-top:16px;">
          The Foreman AI · Alberta Construction Management Platform<br>
          <a href="{APP_BASE_URL}" style="color:#ff6b35;">{APP_BASE_URL}</a>
        </p>
      </div>
    </div>
    """
    return send_email(to_email, f"Welcome to The Foreman AI, {contact_name}!", html)


# ── Template: General Notification ───────────────────────────────────────────
def send_notification(to_email: str, subject: str, message: str, business_name: str = "The Foreman AI") -> bool:
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:#1a1a2e;padding:24px;border-radius:12px 12px 0 0;">
        <h2 style="color:#ff6b35;margin:0;">👷 {business_name}</h2>
      </div>
      <div style="background:#16213e;padding:32px;border-radius:0 0 12px 12px;color:#e0e0e0;">
        <p>{message}</p>
        <p style="color:#888;font-size:12px;margin-top:24px;border-top:1px solid #333;padding-top:16px;">
          Powered by The Foreman AI
        </p>
      </div>
    </div>
    """
    return send_email(to_email, subject, html, message)