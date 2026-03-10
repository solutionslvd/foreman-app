"""
Compliance API endpoints
BUG-NEW-E FIX: Per-user compliance data with proper authentication.
Each user has their own ComplianceEngine instance stored in a registry.
"""

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import date, datetime
import logging

from ..compliance_engine import (
    ComplianceEngine,
    compliance_engine as _global_engine,  # kept for admin/legacy use
    PermitType,
    InspectionType
)

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Per-user compliance engine registry ──────────────────────────────────────
# Maps user email → ComplianceEngine instance
_user_engines: Dict[str, ComplianceEngine] = {}


def _get_engine(authorization: Optional[str]) -> ComplianceEngine:
    """Return the ComplianceEngine for the authenticated user."""
    from app.admin_auth import verify_admin_token
    from app.user_system import verify_user_token

    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")

    token = authorization.replace("Bearer ", "").strip()

    # Admin gets the global engine
    admin = verify_admin_token(token)
    if admin:
        return _global_engine

    # Regular user gets their own engine
    user = verify_user_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    email = user.get("email", "")
    if email not in _user_engines:
        _user_engines[email] = ComplianceEngine()
        logger.info(f"Created compliance engine for user: {email}")

    return _user_engines[email]


# ── Request Models ────────────────────────────────────────────────────────────

class WCBRegistration(BaseModel):
    account_number: str
    business_type: str = "construction_general"
    number_of_workers: int = 1


class PermitCreate(BaseModel):
    permit_type: str
    permit_number: str
    project_address: str
    issue_date: date
    expiry_date: Optional[date] = None
    issuing_authority: str = "City of Calgary"


class InspectionRecord(BaseModel):
    permit_id: int
    inspection_type: str
    inspection_date: date
    inspector_name: str
    result: str = "passed"
    findings: Optional[str] = None
    corrections_required: bool = False


class SafetyIncident(BaseModel):
    incident_date: date
    incident_type: str
    description: str
    location: str
    severity: str = "minor"
    injuries: Optional[List[str]] = None
    witnesses: Optional[List[str]] = None
    immediate_actions_taken: Optional[str] = None


class TrainingRecord(BaseModel):
    employee_name: str
    training_type: str
    training_date: date
    expiry_date: Optional[date] = None
    certificate_number: Optional[str] = None
    training_provider: str = "Internal"


# ── Write Endpoints ───────────────────────────────────────────────────────────

@router.post("/wcb/register")
async def register_wcb(
    registration: WCBRegistration,
    authorization: Optional[str] = Header(None)
):
    """Register WCB account for the authenticated user."""
    try:
        engine = _get_engine(authorization)
        result = engine.register_wcb_account(
            account_number=registration.account_number,
            business_type=registration.business_type,
            number_of_workers=registration.number_of_workers
        )
        return {"status": "success", "wcb_record": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error registering WCB: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/permits")
async def create_permit(
    permit: PermitCreate,
    authorization: Optional[str] = Header(None)
):
    """Create a new permit for the authenticated user."""
    try:
        engine = _get_engine(authorization)
        result = engine.add_permit(
            permit_type=PermitType(permit.permit_type),
            permit_number=permit.permit_number,
            project_address=permit.project_address,
            issue_date=permit.issue_date,
            expiry_date=permit.expiry_date,
            issuing_authority=permit.issuing_authority
        )
        return {"status": "success", "permit": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating permit: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/inspections")
async def record_inspection(
    inspection: InspectionRecord,
    authorization: Optional[str] = Header(None)
):
    """Record a construction inspection for the authenticated user."""
    try:
        engine = _get_engine(authorization)
        result = engine.record_inspection(
            permit_id=inspection.permit_id,
            inspection_type=inspection.inspection_type,
            inspection_date=inspection.inspection_date,
            inspector_name=inspection.inspector_name,
            result=inspection.result,
            findings=inspection.findings,
            corrections_required=inspection.corrections_required
        )
        return {"status": "success", "inspection": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error recording inspection: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/incidents")
async def record_incident(
    incident: SafetyIncident,
    authorization: Optional[str] = Header(None)
):
    """Record a workplace safety incident for the authenticated user."""
    try:
        engine = _get_engine(authorization)
        result = engine.record_safety_incident(
            incident_date=incident.incident_date,
            incident_type=incident.incident_type,
            description=incident.description,
            location=incident.location,
            severity=incident.severity,
            injuries=incident.injuries,
            witnesses=incident.witnesses,
            immediate_actions_taken=incident.immediate_actions_taken
        )
        return {"status": "success", "incident": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error recording incident: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/training")
async def add_training(
    training: TrainingRecord,
    authorization: Optional[str] = Header(None)
):
    """Add employee training record for the authenticated user."""
    try:
        engine = _get_engine(authorization)
        result = engine.add_training_record(
            employee_name=training.employee_name,
            training_type=training.training_type,
            training_date=training.training_date,
            expiry_date=training.expiry_date,
            certificate_number=training.certificate_number,
            training_provider=training.training_provider
        )
        return {"status": "success", "training": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding training: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Read Endpoints ────────────────────────────────────────────────────────────

@router.get("/status")
async def get_compliance_status(authorization: Optional[str] = Header(None)):
    """Get overall compliance status for the authenticated user."""
    try:
        engine = _get_engine(authorization)
        status = engine.get_compliance_status()
        return status
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting compliance status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/summary")
async def get_compliance_summary(authorization: Optional[str] = Header(None)):
    """Get a compact compliance summary for dashboard widgets."""
    try:
        engine = _get_engine(authorization)
        status = engine.get_compliance_status()
        return {
            "overall_status": status["overall_status"],
            "compliance_score": status["compliance_score"],
            "not_configured": status.get("not_configured", False),
            "action_count": len(status.get("action_items", [])),
            "wcb_status": status["wcb_status"].get("status"),
            "permit_count": len(engine.permits),
            "training_count": len(engine.training_records),
            "incident_count": len(engine.safety_records),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting compliance summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/safety-checklist")
async def get_safety_checklist(authorization: Optional[str] = Header(None)):
    """Generate weekly safety checklist."""
    try:
        engine = _get_engine(authorization)
        checklist = engine.generate_safety_checklist()
        return checklist
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating safety checklist: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/wcb")
async def get_wcb_status(authorization: Optional[str] = Header(None)):
    """Get WCB account status for the authenticated user."""
    try:
        engine = _get_engine(authorization)
        if not engine.wcb_records:
            return {"status": "not_registered", "message": "WCB account not registered"}
        return engine.wcb_records
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting WCB status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/permits")
async def list_permits(
    skip: int = 0,
    limit: int = 100,
    status: Optional[str] = None,
    authorization: Optional[str] = Header(None)
):
    """List permits for the authenticated user."""
    try:
        engine = _get_engine(authorization)
        permits = engine.permits

        if status:
            permits = [p for p in permits if p["status"] == status]

        return {
            "permits": permits[skip:skip + limit],
            "total": len(permits),
            "skip": skip,
            "limit": limit
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing permits: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/incidents")
async def list_incidents(
    skip: int = 0,
    limit: int = 100,
    status: Optional[str] = None,
    authorization: Optional[str] = Header(None)
):
    """List safety incidents for the authenticated user."""
    try:
        engine = _get_engine(authorization)
        incidents = engine.safety_records

        if status:
            incidents = [inc for inc in incidents if inc["status"] == status]

        return {
            "incidents": incidents[skip:skip + limit],
            "total": len(incidents),
            "skip": skip,
            "limit": limit
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing incidents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/training")
async def list_training(
    skip: int = 0,
    limit: int = 100,
    employee_name: Optional[str] = None,
    authorization: Optional[str] = Header(None)
):
    """List training records for the authenticated user."""
    try:
        engine = _get_engine(authorization)
        training = engine.training_records

        if employee_name:
            training = [t for t in training if t["employee_name"] == employee_name]

        return {
            "training_records": training[skip:skip + limit],
            "total": len(training),
            "skip": skip,
            "limit": limit
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing training: {e}")
        raise HTTPException(status_code=500, detail=str(e))