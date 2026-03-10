"""
Dropdown List Manager - Admin can edit all dropdown values platform-wide
"""
from typing import Dict, List, Any
import logging

logger = logging.getLogger(__name__)

# ─── Master Dropdown Registry ────────────────────────────────────────────────
# All dropdown lists used across the platform - admin can edit these

DROPDOWN_REGISTRY: Dict[str, List[Dict]] = {

    "project_types": [
        {"value": "residential_framing", "label": "Residential Framing"},
        {"value": "commercial_framing", "label": "Commercial Framing"},
        {"value": "carpentry", "label": "Carpentry & Millwork"},
        {"value": "general_contracting", "label": "General Contracting"},
        {"value": "electrical", "label": "Electrical"},
        {"value": "plumbing", "label": "Plumbing & Gas Fitting"},
        {"value": "hvac", "label": "HVAC / Sheet Metal"},
        {"value": "roofing", "label": "Roofing"},
        {"value": "concrete", "label": "Concrete & Foundations"},
        {"value": "drywall", "label": "Drywall & Plastering"},
        {"value": "painting", "label": "Painting & Decorating"},
        {"value": "flooring", "label": "Flooring Installation"},
        {"value": "insulation", "label": "Insulation"},
        {"value": "masonry", "label": "Masonry & Bricklaying"},
        {"value": "tile_setting", "label": "Tile Setting"},
        {"value": "glazing", "label": "Glazing & Window Installation"},
        {"value": "ironwork", "label": "Ironwork & Structural Steel"},
        {"value": "welding", "label": "Welding"},
        {"value": "pipefitting", "label": "Pipefitting & Steamfitting"},
        {"value": "refrigeration", "label": "Refrigeration & Air Conditioning"},
        {"value": "elevator", "label": "Elevator Construction"},
        {"value": "sprinkler", "label": "Sprinkler Systems"},
        {"value": "landscaping", "label": "Landscaping & Grading"},
        {"value": "excavation", "label": "Excavation & Earthworks"},
        {"value": "demolition", "label": "Demolition"},
        {"value": "renovation", "label": "Renovation & Remodeling"},
        {"value": "cabinet_making", "label": "Cabinet Making"},
        {"value": "surveying", "label": "Surveying"},
        {"value": "crane_operation", "label": "Crane Operation"},
        {"value": "heavy_equipment", "label": "Heavy Equipment Operation"},
        {"value": "boilermaking", "label": "Boilermaking"},
        {"value": "instrumentation", "label": "Instrumentation & Control"},
        {"value": "industrial_mechanic", "label": "Industrial Mechanic (Millwright)"},
        {"value": "powerline", "label": "Powerline Technician"},
        {"value": "telecommunications", "label": "Telecommunications"},
        {"value": "other", "label": "Other Trade"},
    ],

    "project_statuses": [
        {"value": "estimate", "label": "Estimate / Quote"},
        {"value": "pending", "label": "Pending Approval"},
        {"value": "approved", "label": "Approved"},
        {"value": "in_progress", "label": "In Progress"},
        {"value": "on_hold", "label": "On Hold"},
        {"value": "inspection", "label": "Awaiting Inspection"},
        {"value": "punch_list", "label": "Punch List"},
        {"value": "completed", "label": "Completed"},
        {"value": "invoiced", "label": "Invoiced"},
        {"value": "paid", "label": "Paid"},
        {"value": "cancelled", "label": "Cancelled"},
    ],

    "invoice_statuses": [
        {"value": "draft", "label": "Draft"},
        {"value": "sent", "label": "Sent"},
        {"value": "viewed", "label": "Viewed"},
        {"value": "partial", "label": "Partially Paid"},
        {"value": "paid", "label": "Paid"},
        {"value": "overdue", "label": "Overdue"},
        {"value": "cancelled", "label": "Cancelled"},
        {"value": "void", "label": "Void"},
    ],

    "payment_terms": [
        {"value": "due_on_receipt", "label": "Due on Receipt"},
        {"value": "net_7", "label": "Net 7 Days"},
        {"value": "net_15", "label": "Net 15 Days"},
        {"value": "net_30", "label": "Net 30 Days"},
        {"value": "net_45", "label": "Net 45 Days"},
        {"value": "net_60", "label": "Net 60 Days"},
        {"value": "50_50", "label": "50% Deposit / 50% on Completion"},
        {"value": "progress", "label": "Progress Billing"},
        {"value": "custom", "label": "Custom Terms"},
    ],

    "expense_categories": [
        {"value": "materials", "label": "Materials & Supplies"},
        {"value": "labor", "label": "Labour"},
        {"value": "subcontractor", "label": "Subcontractor"},
        {"value": "equipment", "label": "Equipment Rental"},
        {"value": "equipment_purchase", "label": "Equipment Purchase"},
        {"value": "vehicle", "label": "Vehicle & Transportation"},
        {"value": "fuel", "label": "Fuel"},
        {"value": "tools", "label": "Tools & Small Equipment"},
        {"value": "insurance", "label": "Insurance"},
        {"value": "wcb", "label": "WCB Premiums"},
        {"value": "licenses_permits", "label": "Licenses & Permits"},
        {"value": "utilities", "label": "Utilities"},
        {"value": "rent", "label": "Rent / Lease"},
        {"value": "marketing", "label": "Marketing & Advertising"},
        {"value": "professional_services", "label": "Professional Services"},
        {"value": "meals", "label": "Meals & Entertainment"},
        {"value": "home_office", "label": "Home Office"},
        {"value": "training", "label": "Training & Education"},
        {"value": "safety", "label": "Safety Equipment"},
        {"value": "waste_disposal", "label": "Waste Disposal"},
        {"value": "other", "label": "Other"},
    ],

    "subscription_plans": [
        {"value": "starter", "label": "Starter", "price": 49, "description": "1 user, basic features"},
        {"value": "professional", "label": "Professional", "price": 99, "description": "3 users, all features"},
        {"value": "business", "label": "Business", "price": 199, "description": "Unlimited users, priority support"},
        {"value": "enterprise", "label": "Enterprise", "price": 499, "description": "Custom, white-label"},
    ],

    "user_roles": [
        {"value": "owner", "label": "Owner / Admin"},
        {"value": "manager", "label": "Project Manager"},
        {"value": "foreman", "label": "Foreman"},
        {"value": "estimator", "label": "Estimator"},
        {"value": "bookkeeper", "label": "Bookkeeper"},
        {"value": "worker", "label": "Worker"},
        {"value": "readonly", "label": "Read Only"},
    ],

    "permit_types": [
        {"value": "building", "label": "Building Permit"},
        {"value": "electrical", "label": "Electrical Permit"},
        {"value": "plumbing", "label": "Plumbing Permit"},
        {"value": "hvac", "label": "HVAC / Mechanical Permit"},
        {"value": "demolition", "label": "Demolition Permit"},
        {"value": "renovation", "label": "Renovation Permit"},
        {"value": "development", "label": "Development Permit"},
        {"value": "occupancy", "label": "Occupancy Permit"},
        {"value": "gas", "label": "Gas Permit"},
        {"value": "fire", "label": "Fire Safety Permit"},
        {"value": "hoarding", "label": "Hoarding / Encroachment Permit"},
        {"value": "other", "label": "Other Permit"},
    ],

    "safety_training": [
        {"value": "whmis", "label": "WHMIS 2015"},
        {"value": "fall_protection", "label": "Fall Protection"},
        {"value": "first_aid", "label": "First Aid / CPR"},
        {"value": "confined_space", "label": "Confined Space Entry"},
        {"value": "lockout_tagout", "label": "Lockout / Tagout"},
        {"value": "equipment_operation", "label": "Equipment Operation"},
        {"value": "fire_safety", "label": "Fire Safety"},
        {"value": "h2s_alive", "label": "H2S Alive"},
        {"value": "ground_disturbance", "label": "Ground Disturbance"},
        {"value": "traffic_control", "label": "Traffic Control"},
        {"value": "asbestos_awareness", "label": "Asbestos Awareness"},
        {"value": "lead_awareness", "label": "Lead Awareness"},
        {"value": "mewp", "label": "MEWP / Aerial Work Platform"},
        {"value": "forklift", "label": "Forklift Operation"},
        {"value": "rigging_signaling", "label": "Rigging & Signaling"},
    ],

    "inspection_types": [
        {"value": "foundation", "label": "Foundation"},
        {"value": "framing", "label": "Framing"},
        {"value": "rough_in", "label": "Rough-In (Electrical/Plumbing)"},
        {"value": "insulation", "label": "Insulation"},
        {"value": "drywall", "label": "Drywall"},
        {"value": "final", "label": "Final Inspection"},
        {"value": "occupancy", "label": "Occupancy"},
        {"value": "safety", "label": "Safety Inspection"},
        {"value": "fire", "label": "Fire Inspection"},
        {"value": "other", "label": "Other"},
    ],

    "provinces": [
        {"value": "AB", "label": "Alberta"},
        {"value": "BC", "label": "British Columbia"},
        {"value": "SK", "label": "Saskatchewan"},
        {"value": "MB", "label": "Manitoba"},
        {"value": "ON", "label": "Ontario"},
        {"value": "QC", "label": "Quebec"},
        {"value": "NB", "label": "New Brunswick"},
        {"value": "NS", "label": "Nova Scotia"},
        {"value": "PE", "label": "Prince Edward Island"},
        {"value": "NL", "label": "Newfoundland & Labrador"},
        {"value": "NT", "label": "Northwest Territories"},
        {"value": "YT", "label": "Yukon"},
        {"value": "NU", "label": "Nunavut"},
    ],

    "invoice_line_units": [
        {"value": "hr", "label": "Hour (hr)"},
        {"value": "day", "label": "Day"},
        {"value": "sqft", "label": "Square Foot (sq ft)"},
        {"value": "sqm", "label": "Square Metre (sq m)"},
        {"value": "lf", "label": "Linear Foot (lf)"},
        {"value": "lm", "label": "Linear Metre (lm)"},
        {"value": "ea", "label": "Each (ea)"},
        {"value": "lot", "label": "Lot"},
        {"value": "ls", "label": "Lump Sum (ls)"},
        {"value": "ton", "label": "Ton"},
        {"value": "lb", "label": "Pound (lb)"},
        {"value": "bag", "label": "Bag"},
        {"value": "sheet", "label": "Sheet"},
        {"value": "bundle", "label": "Bundle"},
        {"value": "load", "label": "Load"},
    ],

    "app_colors": [
        {"value": "#FF6B35", "label": "Construction Orange (Default)"},
        {"value": "#1a237e", "label": "Deep Blue"},
        {"value": "#2e7d32", "label": "Forest Green"},
        {"value": "#c62828", "label": "Red"},
        {"value": "#6a1b9a", "label": "Purple"},
        {"value": "#00838f", "label": "Teal"},
        {"value": "#f57f17", "label": "Amber"},
        {"value": "#37474f", "label": "Steel Grey"},
        {"value": "#000000", "label": "Black"},
    ],
}


def get_dropdown(key: str) -> List[Dict]:
    return DROPDOWN_REGISTRY.get(key, [])


def get_all_dropdowns() -> Dict[str, List[Dict]]:
    return DROPDOWN_REGISTRY


def update_dropdown(key: str, items: List[Dict]) -> bool:
    DROPDOWN_REGISTRY[key] = items
    logger.info(f"Dropdown '{key}' updated with {len(items)} items")
    return True


def add_dropdown_item(key: str, item: Dict) -> bool:
    if key not in DROPDOWN_REGISTRY:
        DROPDOWN_REGISTRY[key] = []
    DROPDOWN_REGISTRY[key].append(item)
    return True


def remove_dropdown_item(key: str, value: str) -> bool:
    if key in DROPDOWN_REGISTRY:
        DROPDOWN_REGISTRY[key] = [i for i in DROPDOWN_REGISTRY[key] if i.get("value") != value]
        return True
    return False


def create_dropdown(key: str, items: List[Dict]) -> bool:
    DROPDOWN_REGISTRY[key] = items
    return True