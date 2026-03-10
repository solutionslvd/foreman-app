"""
In-App Settings Manager
All customizable settings accessible from within the app
Admin-only settings vs client-allowed settings clearly separated
"""

import os
import json
import hashlib
from datetime import datetime
from typing import Dict, Any, Optional, List
from decimal import Decimal
import logging

logger = logging.getLogger(__name__)

# ============================================================
# LIVE SETTINGS STORE (persisted to settings.json)
# ============================================================
SETTINGS_FILE = os.environ.get("SETTINGS_FILE", os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "settings.json"))

DEFAULT_SETTINGS = {
    # --- BRANDING (Admin only) ---
    "branding": {
        "app_name": "The Foreman",
        "tagline": "Run Your Site. Run Your Business.",
        "logo_url": "",
        "primary_color": "#FF6B35",
        "secondary_color": "#1a1a2e",
        "accent_color": "#4CAF50",
        "font_family": "Inter",
        "dark_mode_default": True,
    },

    # --- BUSINESS INFO (Admin only) ---
    "business": {
        "business_name": "The Foreman",
        "business_type": "general_contracting",
        "trade_specialization": "framing",
        "address": "",
        "city": "Edmonton",
        "province": "Alberta",
        "postal_code": "",
        "phone": "",
        "email": "",
        "website": "",
        "business_number": "",
        "wcb_account": "",
        "gst_number": "",
        "logo_url": "",
    },

    # --- AI ASSISTANT (Admin only) ---
    "ai": {
        "assistant_name": "Foreman AI",
        "personality": "professional",  # professional, friendly, concise
        "trade_focus": "framing",
        "language": "en",
        "voice_enabled": True,
        "proactive_suggestions": True,
        "greeting_message": "Hi! I'm your construction AI assistant. How can I help you today?",
        "specializations": ["framing", "carpentry", "general_contracting"],
        "knowledge_level": "expert",  # basic, intermediate, expert
    },

    # --- FINANCIAL (Admin only) ---
    "financial": {
        "gst_rate": 0.05,
        "invoice_prefix": "INV",
        "invoice_next_number": 1001,
        "payment_terms": "Net 30",
        "late_fee_percentage": 2.0,
        "currency": "CAD",
        "fiscal_year_start": "01-01",  # MM-DD
        "wcb_rate_framing": 3.20,
        "wcb_rate_carpentry": 2.80,
        "wcb_rate_general": 2.50,
        "cpp_rate": 0.0595,
        "ei_rate": 0.0163,
        "default_labour_rate": 65.00,
        "default_markup_percentage": 20.0,
        "budget_warning_threshold": 80.0,
    },

    # --- COMPLIANCE (Admin only) ---
    "compliance": {
        "safety_inspection_frequency": "weekly",
        "required_training": ["WHMIS", "Fall Protection", "First Aid"],
        "permit_reminder_days": [30, 14, 7],
        "wcb_reminder_days": [14, 7, 3],
        "incident_reporting_required": True,
        "toolbox_talk_frequency": "weekly",
        "ppe_requirements": ["Hard Hat", "Safety Vest", "Steel Toe Boots", "Safety Glasses"],
    },

    # --- NOTIFICATIONS (Admin only) ---
    "notifications": {
        "email_enabled": False,
        "sms_enabled": False,
        "push_enabled": True,
        "notification_email": "",
        "gst_reminder_days": [7, 3, 1],
        "payroll_reminder_days": [3, 1],
        "invoice_overdue_days": 30,
        "daily_summary": True,
        "weekly_report": True,
    },

    # --- SUBSCRIPTION (Admin only) ---
    "subscription": {
        "plan": "starter",
        "max_users": 1,
        "max_projects": 5,
        "max_transactions": 100,
        "features": ["ai_chat", "invoicing", "basic_compliance"],
    },

    # --- USER PREFERENCES (Each user can change their own) ---
    "user_defaults": {
        "theme": "dark",
        "language": "en",
        "timezone": "America/Edmonton",
        "date_format": "YYYY-MM-DD",
        "currency_display": "CAD",
        "notifications_push": True,
        "notifications_email": True,
        "dashboard_widgets": ["revenue", "projects", "compliance", "ai_chat"],
        "default_view": "dashboard",
    },

    # --- INTEGRATIONS (Admin only) ---
    "integrations": {
        "quickbooks_enabled": False,
        "quickbooks_realm_id": "",
        "google_drive_enabled": False,
        "google_drive_folder_id": "",
        "email_provider": "none",  # gmail, outlook, none
        "email_address": "",
        "stripe_enabled": False,
        "stripe_publishable_key": "",
    },

    # --- SYSTEM (Admin only) ---
    "system": {
        "maintenance_mode": False,
        "allow_registration": True,
        "require_nda": True,
        "session_timeout_hours": 8,
        "max_file_size_mb": 10,
        "allowed_file_types": ["pdf", "jpg", "jpeg", "png", "doc", "docx", "xls", "xlsx"],
        "debug_mode": False,
        "version": "2.0.0",
        "last_updated": datetime.now().isoformat(),
    }
}

# Settings that CLIENTS/WORKERS cannot change (admin-only)
ADMIN_ONLY_SETTINGS = {
    "branding", "business", "ai", "financial",
    "compliance", "notifications", "subscription",
    "integrations", "system"
}

# Settings each user can change for themselves
USER_EDITABLE_SETTINGS = {
    "user_defaults"
}


class SettingsManager:
    def __init__(self):
        self._settings: Dict = {}
        self._load_settings()

    def _load_settings(self):
        """Load settings from file or use defaults"""
        os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
        if os.path.exists(SETTINGS_FILE):
            try:
                with open(SETTINGS_FILE, "r") as f:
                    saved = json.load(f)
                # Deep merge with defaults
                self._settings = self._deep_merge(DEFAULT_SETTINGS.copy(), saved)
                logger.info("Settings loaded from file")
            except Exception as e:
                logger.warning(f"Could not load settings file: {e}, using defaults")
                self._settings = DEFAULT_SETTINGS.copy()
        else:
            self._settings = DEFAULT_SETTINGS.copy()
            self._save_settings()

    def _save_settings(self):
        """Persist settings to file"""
        try:
            os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
            self._settings["system"]["last_updated"] = datetime.now().isoformat()
            with open(SETTINGS_FILE, "w") as f:
                json.dump(self._settings, f, indent=2, default=str)
            logger.info("Settings saved to file")
        except Exception as e:
            logger.error(f"Could not save settings: {e}")

    def _deep_merge(self, base: Dict, override: Dict) -> Dict:
        """Deep merge two dicts"""
        result = base.copy()
        for key, value in override.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._deep_merge(result[key], value)
            else:
                result[key] = value
        return result

    def get(self, section: str, key: str = None) -> Any:
        """Get a setting value"""
        section_data = self._settings.get(section, {})
        if key:
            return section_data.get(key)
        return section_data

    def get_all(self) -> Dict:
        """Get all settings"""
        return self._settings.copy()

    def get_public_settings(self) -> Dict:
        """Get settings safe to expose to all users (branding, AI name, etc.)"""
        return {
            "app_name": self._settings["branding"]["app_name"],
            "tagline": self._settings["branding"]["tagline"],
            "logo_url": self._settings["branding"]["logo_url"],
            "primary_color": self._settings["branding"]["primary_color"],
            "secondary_color": self._settings["branding"]["secondary_color"],
            "accent_color": self._settings["branding"]["accent_color"],
            "font_family": self._settings["branding"]["font_family"],
            "assistant_name": self._settings["ai"]["assistant_name"],
            "greeting_message": self._settings["ai"]["greeting_message"],
            "voice_enabled": self._settings["ai"]["voice_enabled"],
            "business_name": self._settings["business"]["business_name"],
            "business_type": self._settings["business"]["business_type"],
            "currency": self._settings["financial"]["currency"],
            "date_format": self._settings["user_defaults"]["date_format"],
            "timezone": self._settings["user_defaults"]["timezone"],
            "allow_registration": self._settings["system"]["allow_registration"],
            "require_nda": self._settings["system"]["require_nda"],
        }

    def update_section(self, section: str, data: Dict, is_admin: bool = False) -> Dict:
        """Update a settings section"""
        if section in ADMIN_ONLY_SETTINGS and not is_admin:
            raise PermissionError(f"Section '{section}' requires admin access")

        if section not in self._settings:
            raise ValueError(f"Unknown settings section: {section}")

        # Merge updates
        self._settings[section].update(data)
        self._save_settings()
        logger.info(f"Settings updated: {section}")
        return self._settings[section]

    def update_branding(self, data: Dict) -> Dict:
        return self.update_section("branding", data, is_admin=True)

    def update_business(self, data: Dict) -> Dict:
        return self.update_section("business", data, is_admin=True)

    def update_ai_settings(self, data: Dict) -> Dict:
        return self.update_section("ai", data, is_admin=True)

    def update_financial_settings(self, data: Dict) -> Dict:
        return self.update_section("financial", data, is_admin=True)

    def update_compliance_settings(self, data: Dict) -> Dict:
        return self.update_section("compliance", data, is_admin=True)

    def update_user_preferences(self, data: Dict) -> Dict:
        """Any user can update their own preferences"""
        return self.update_section("user_defaults", data, is_admin=False)

    def change_admin_password(self, new_password: str) -> str:
        """Change admin password, returns new hash"""
        new_hash = hashlib.sha256(new_password.encode()).hexdigest()
        # Update env-style (in production, update .env file)
        os.environ["ADMIN_PASSWORD_HASH"] = new_hash
        logger.info("Admin password changed")
        return new_hash

    def get_invoice_number(self) -> str:
        """Get next invoice number and increment"""
        prefix = self._settings["financial"]["invoice_prefix"]
        num = self._settings["financial"]["invoice_next_number"]
        self._settings["financial"]["invoice_next_number"] = num + 1
        self._save_settings()
        return f"{prefix}-{num:04d}"

    def get_plan_limits(self) -> Dict:
        return {
            "max_users": self._settings["subscription"]["max_users"],
            "max_projects": self._settings["subscription"]["max_projects"],
            "max_transactions": self._settings["subscription"]["max_transactions"],
            "features": self._settings["subscription"]["features"],
            "plan": self._settings["subscription"]["plan"],
        }

    def is_feature_enabled(self, feature: str) -> bool:
        return feature in self._settings["subscription"]["features"]


# Global settings instance
settings_manager = SettingsManager()