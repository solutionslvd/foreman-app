"""
Foreman Data Persistence Layer
FIX BUG-005: Prevents data loss on server restart by writing all in-memory
data to JSON files on disk. This is the immediate fix before a proper
database (PostgreSQL) is implemented.
"""

import json
import os
import logging
from typing import Dict, List, Any
from datetime import datetime

logger = logging.getLogger(__name__)

# Data directory - use /tmp on Render (ephemeral but survives restarts within session)
# For true persistence, mount a disk on Render or use PostgreSQL
DATA_DIR = os.environ.get("DATA_DIR", "/tmp/foreman_data")

def ensure_data_dir():
    """Create data directory if it doesn't exist."""
    os.makedirs(DATA_DIR, exist_ok=True)

def _path(filename: str) -> str:
    return os.path.join(DATA_DIR, filename)

def save_json(filename: str, data: Any) -> bool:
    """Save data to a JSON file atomically."""
    ensure_data_dir()
    tmp_path = _path(filename + ".tmp")
    final_path = _path(filename)
    try:
        with open(tmp_path, 'w') as f:
            json.dump(data, f, indent=2, default=str)
        os.replace(tmp_path, final_path)
        return True
    except Exception as e:
        logger.error(f"Failed to save {filename}: {e}")
        return False

def load_json(filename: str, default: Any = None) -> Any:
    """Load data from a JSON file."""
    ensure_data_dir()
    path = _path(filename)
    if not os.path.exists(path):
        return default if default is not None else {}
    try:
        with open(path, 'r') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load {filename}: {e}")
        return default if default is not None else {}

# ─── Users ────────────────────────────────────────────────────────────────────
def save_users(users_db: Dict) -> bool:
    return save_json("users.json", users_db)

def load_users() -> Dict:
    return load_json("users.json", {})

# ─── Projects ─────────────────────────────────────────────────────────────────
def save_projects(projects_db: List) -> bool:
    return save_json("projects.json", projects_db)

def load_projects() -> List:
    return load_json("projects.json", [])

# ─── Estimates ────────────────────────────────────────────────────────────────
def save_estimates(estimates_db: List) -> bool:
    return save_json("estimates.json", estimates_db)

def load_estimates() -> List:
    return load_json("estimates.json", [])

# ─── Financial Transactions ───────────────────────────────────────────────────
def save_transactions(transactions_db: Any) -> bool:
    if isinstance(transactions_db, dict):
        data = list(transactions_db.values())
    else:
        data = list(transactions_db)
    return save_json("transactions.json", data)

def load_transactions() -> List:
    return load_json("transactions.json", [])

# ─── Ledger Entries ───────────────────────────────────────────────────────────
def save_ledger_entries(entries: List) -> bool:
    return save_json("ledger_entries.json", entries)

def load_ledger_entries() -> List:
    return load_json("ledger_entries.json", [])

# ─── Compliance Records ───────────────────────────────────────────────────────
def save_compliance(safety: List, permits: List, inspections: List,
                    incidents: List, training: List) -> bool:
    data = {
        "safety_records": safety,
        "permit_records": permits,
        "inspection_records": inspections,
        "incident_records": incidents,
        "training_records": training,
    }
    return save_json("compliance.json", data)

def load_compliance() -> Dict:
    return load_json("compliance.json", {
        "safety_records": [],
        "permit_records": [],
        "inspection_records": [],
        "incident_records": [],
        "training_records": [],
    })

# ─── Settings ─────────────────────────────────────────────────────────────────
def save_settings(settings: Dict) -> bool:
    return save_json("settings.json", settings)

def load_settings() -> Dict:
    return load_json("settings.json", {})

# ─── Billing / Subscriptions ──────────────────────────────────────────────────
def save_subscriptions(subs: Dict) -> bool:
    return save_json("subscriptions.json", subs)

def load_subscriptions() -> Dict:
    return load_json("subscriptions.json", {})

def save_payments(payments: List) -> bool:
    return save_json("payments.json", payments)

def load_payments() -> List:
    return load_json("payments.json", [])

# ─── Backup ───────────────────────────────────────────────────────────────────
def create_backup() -> str:
    """Create a timestamped backup of all data files."""
    ensure_data_dir()
    backup_dir = os.path.join(DATA_DIR, "backups")
    os.makedirs(backup_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(backup_dir, f"backup_{timestamp}.json")
    
    all_data = {}
    for filename in os.listdir(DATA_DIR):
        if filename.endswith(".json") and not filename.startswith("backup"):
            key = filename.replace(".json", "")
            all_data[key] = load_json(filename)
    
    try:
        with open(backup_path, 'w') as f:
            json.dump(all_data, f, indent=2, default=str)
        logger.info(f"Backup created: {backup_path}")
        return backup_path
    except Exception as e:
        logger.error(f"Backup failed: {e}")
        return ""

def get_data_stats() -> Dict:
    """Return stats about persisted data."""
    ensure_data_dir()
    stats = {"data_dir": DATA_DIR, "files": {}}
    for filename in os.listdir(DATA_DIR):
        if filename.endswith(".json"):
            path = _path(filename)
            size = os.path.getsize(path)
            stats["files"][filename] = {"size_bytes": size}
    return stats