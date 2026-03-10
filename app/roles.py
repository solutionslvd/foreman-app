"""
Role-Based Access Control (RBAC) System
Defines what each role can and cannot do
"""

from enum import Enum
from typing import Dict, List, Set

class UserRole(str, Enum):
    ADMIN = "admin"          # Full access - business owner
    MANAGER = "manager"      # Project/team management, limited settings
    WORKER = "worker"        # Field worker - time tracking, basic info only
    CLIENT = "client"        # External client - view their projects/invoices only

# ============================================================
# PERMISSION DEFINITIONS
# ============================================================
class Permission(str, Enum):
    # Admin/Settings
    MANAGE_SETTINGS = "manage_settings"
    MANAGE_USERS = "manage_users"
    MANAGE_BILLING = "manage_billing"
    VIEW_ADMIN_PANEL = "view_admin_panel"
    CHANGE_BRANDING = "change_branding"
    CHANGE_AI_SETTINGS = "change_ai_settings"
    CHANGE_FINANCIAL_SETTINGS = "change_financial_settings"
    CHANGE_COMPLIANCE_SETTINGS = "change_compliance_settings"
    
    # Financial
    VIEW_FINANCIALS = "view_financials"
    CREATE_INVOICE = "create_invoice"
    EDIT_INVOICE = "edit_invoice"
    DELETE_INVOICE = "delete_invoice"
    VIEW_ALL_INVOICES = "view_all_invoices"
    VIEW_OWN_INVOICES = "view_own_invoices"
    MANAGE_EXPENSES = "manage_expenses"
    VIEW_REPORTS = "view_reports"
    EXPORT_FINANCIAL_DATA = "export_financial_data"
    MANAGE_PAYROLL = "manage_payroll"
    
    # Projects
    CREATE_PROJECT = "create_project"
    EDIT_PROJECT = "edit_project"
    DELETE_PROJECT = "delete_project"
    VIEW_ALL_PROJECTS = "view_all_projects"
    VIEW_OWN_PROJECTS = "view_own_projects"
    ASSIGN_WORKERS = "assign_workers"
    
    # Compliance
    VIEW_COMPLIANCE = "view_compliance"
    MANAGE_COMPLIANCE = "manage_compliance"
    VIEW_SAFETY_DOCS = "view_safety_docs"
    SUBMIT_INCIDENT = "submit_incident"
    
    # AI Assistant
    USE_AI_CHAT = "use_ai_chat"
    VIEW_AI_HISTORY = "view_ai_history"
    
    # Time Tracking
    LOG_TIME = "log_time"
    VIEW_ALL_TIME = "view_all_time"
    APPROVE_TIME = "approve_time"
    
    # Documents
    UPLOAD_DOCUMENTS = "upload_documents"
    VIEW_ALL_DOCUMENTS = "view_all_documents"
    VIEW_OWN_DOCUMENTS = "view_own_documents"
    
    # Profile
    EDIT_OWN_PROFILE = "edit_own_profile"
    EDIT_NOTIFICATION_PREFS = "edit_notification_prefs"

# ============================================================
# ROLE PERMISSION MAPPINGS
# ============================================================
ROLE_PERMISSIONS: Dict[UserRole, Set[Permission]] = {
    
    UserRole.ADMIN: {
        # Full access to everything
        Permission.MANAGE_SETTINGS,
        Permission.MANAGE_USERS,
        Permission.MANAGE_BILLING,
        Permission.VIEW_ADMIN_PANEL,
        Permission.CHANGE_BRANDING,
        Permission.CHANGE_AI_SETTINGS,
        Permission.CHANGE_FINANCIAL_SETTINGS,
        Permission.CHANGE_COMPLIANCE_SETTINGS,
        Permission.VIEW_FINANCIALS,
        Permission.CREATE_INVOICE,
        Permission.EDIT_INVOICE,
        Permission.DELETE_INVOICE,
        Permission.VIEW_ALL_INVOICES,
        Permission.MANAGE_EXPENSES,
        Permission.VIEW_REPORTS,
        Permission.EXPORT_FINANCIAL_DATA,
        Permission.MANAGE_PAYROLL,
        Permission.CREATE_PROJECT,
        Permission.EDIT_PROJECT,
        Permission.DELETE_PROJECT,
        Permission.VIEW_ALL_PROJECTS,
        Permission.ASSIGN_WORKERS,
        Permission.VIEW_COMPLIANCE,
        Permission.MANAGE_COMPLIANCE,
        Permission.VIEW_SAFETY_DOCS,
        Permission.SUBMIT_INCIDENT,
        Permission.USE_AI_CHAT,
        Permission.VIEW_AI_HISTORY,
        Permission.LOG_TIME,
        Permission.VIEW_ALL_TIME,
        Permission.APPROVE_TIME,
        Permission.UPLOAD_DOCUMENTS,
        Permission.VIEW_ALL_DOCUMENTS,
        Permission.EDIT_OWN_PROFILE,
        Permission.EDIT_NOTIFICATION_PREFS,
    },
    
    UserRole.MANAGER: {
        # Can manage projects, workers, view financials - NO settings changes
        Permission.VIEW_FINANCIALS,
        Permission.CREATE_INVOICE,
        Permission.EDIT_INVOICE,
        Permission.VIEW_ALL_INVOICES,
        Permission.MANAGE_EXPENSES,
        Permission.VIEW_REPORTS,
        Permission.CREATE_PROJECT,
        Permission.EDIT_PROJECT,
        Permission.VIEW_ALL_PROJECTS,
        Permission.ASSIGN_WORKERS,
        Permission.VIEW_COMPLIANCE,
        Permission.VIEW_SAFETY_DOCS,
        Permission.SUBMIT_INCIDENT,
        Permission.USE_AI_CHAT,
        Permission.VIEW_AI_HISTORY,
        Permission.LOG_TIME,
        Permission.VIEW_ALL_TIME,
        Permission.APPROVE_TIME,
        Permission.UPLOAD_DOCUMENTS,
        Permission.VIEW_ALL_DOCUMENTS,
        Permission.EDIT_OWN_PROFILE,
        Permission.EDIT_NOTIFICATION_PREFS,
    },
    
    UserRole.WORKER: {
        # Field worker - basic access only
        Permission.VIEW_OWN_PROJECTS,
        Permission.VIEW_SAFETY_DOCS,
        Permission.SUBMIT_INCIDENT,
        Permission.USE_AI_CHAT,
        Permission.LOG_TIME,
        Permission.UPLOAD_DOCUMENTS,
        Permission.VIEW_OWN_DOCUMENTS,
        Permission.EDIT_OWN_PROFILE,
        Permission.EDIT_NOTIFICATION_PREFS,
    },
    
    UserRole.CLIENT: {
        # External client - view only their own data
        Permission.VIEW_OWN_PROJECTS,
        Permission.VIEW_OWN_INVOICES,
        Permission.VIEW_OWN_DOCUMENTS,
        Permission.EDIT_OWN_PROFILE,
        Permission.EDIT_NOTIFICATION_PREFS,
    },
}

def has_permission(role: UserRole, permission: Permission) -> bool:
    """Check if a role has a specific permission"""
    return permission in ROLE_PERMISSIONS.get(role, set())

def get_role_permissions(role: UserRole) -> List[str]:
    """Get all permissions for a role"""
    return [p.value for p in ROLE_PERMISSIONS.get(role, set())]

def get_restricted_settings_for_role(role: UserRole) -> Dict:
    """Return what settings a role CAN and CANNOT change"""
    can_change = []
    cannot_change = []
    
    admin_only = [
        Permission.MANAGE_SETTINGS,
        Permission.CHANGE_BRANDING,
        Permission.CHANGE_AI_SETTINGS,
        Permission.CHANGE_FINANCIAL_SETTINGS,
        Permission.CHANGE_COMPLIANCE_SETTINGS,
        Permission.MANAGE_BILLING,
        Permission.MANAGE_USERS,
    ]
    
    for perm in admin_only:
        if has_permission(role, perm):
            can_change.append(perm.value)
        else:
            cannot_change.append(perm.value)
    
    return {
        "role": role.value,
        "can_change": can_change,
        "cannot_change": cannot_change,
        "profile_settings": [
            "display_name", "phone", "notification_preferences",
            "language", "timezone", "password"
        ],
        "restricted_settings": [
            "business_name", "pricing", "gst_rate", "wcb_rates",
            "invoice_prefix", "ai_name", "branding_colors",
            "subscription_plan", "user_management"
        ] if role != UserRole.ADMIN else []
    }