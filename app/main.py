"""
Alberta Construction AI Assistant - Main Application v2.0
Full-featured with in-app admin settings, RBAC, QuickBooks-style financials
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from contextlib import asynccontextmanager
import logging
import os
import asyncio
import httpx
import json
import time
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

from app.config import config

app = FastAPI(
    title="Foreman - Construction Management Platform",
    description="AI-powered construction management. Run your site. Run your business.",
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Keep-Alive Background Task ────────────────────────────────────────────────
_keep_alive_task = None

async def keep_alive_ping():
    """
    Self-ping every 10 minutes to prevent Render free tier from sleeping.
    Render spins down after 15 min of inactivity — this keeps it awake 24/7.
    """
    await asyncio.sleep(30)  # Wait 30s after startup before first ping
    while True:
        try:
            port = os.environ.get("PORT", "8050")
            url = f"http://127.0.0.1:{port}/health"  # FIX BUG-017: use 127.0.0.1 not localhost
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url)
                logger.info(f"🏓 Keep-alive ping: {resp.status_code}")
        except Exception as e:
            logger.warning(f"Keep-alive ping failed: {e}")
        await asyncio.sleep(600)  # Ping every 10 minutes

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _keep_alive_task
    logger.info("🚀 Starting BuildAI Alberta v2.0...")
    from app.financial_system import financial_system
    from app.ai_engine import ai_engine
    from app.compliance_engine import compliance_engine
    from app.settings_manager import settings_manager
    financial_system.config = config
    ai_engine.config = config
    compliance_engine.config = config
    
    # Create default test user on startup (for in-memory storage)
    from app.user_system import users_db, create_user
    if "test@foreman.ca" not in users_db:
        try:
            create_user(
                email="test@foreman.ca",
                password="Test1234!",
                business_name="Test Construction Ltd.",
                trade="Framing",
                contact_name="Test User",
                phone="780-555-1234",
                plan="pro"
            )
            logger.info("Default test user created: test@foreman.ca / Test1234!")
        except Exception as e:
            logger.warning(f"Could not create default test user: {e}")

    # Start keep-alive background task
    _keep_alive_task = asyncio.create_task(keep_alive_ping())
    logger.info("✅ Application started successfully! Keep-alive task running.")
    yield
    # Cleanup
    if _keep_alive_task:
        _keep_alive_task.cancel()
        try:
            await _keep_alive_task
        except asyncio.CancelledError:
            pass
    logger.info("🛑 Shutting down...")

app.router.lifespan_context = lifespan

from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

web_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")
if os.path.exists(web_dir):
    app.mount("/static", StaticFiles(directory=web_dir), name="static")

# ── Health ──────────────────────────────────────────────────
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "BuildAI Alberta",
        "version": "2.0.0",
        "timestamp": int(time.time()),
        "uptime": "active"
    }

@app.get("/ping")
async def ping():
    """Lightweight ping endpoint for external uptime monitors (UptimeRobot, etc.)"""
    return {"pong": True, "ts": int(time.time())}

# ── Server-Sent Events (SSE) — Real-time data stream ────────────────────────
@app.get("/api/stream")
async def data_stream():
    """
    SSE endpoint for real-time data updates.
    Clients connect once and receive live updates without polling.
    Works on Render free tier — also acts as a keep-alive signal.
    """
    async def event_generator():
        # Send initial connection confirmation
        yield f"data: {json.dumps({'type': 'connected', 'ts': int(time.time()), 'message': 'Stream active'})}\n\n"
        
        heartbeat_count = 0
        while True:
            try:
                heartbeat_count += 1
                # Send heartbeat every 30 seconds to keep connection alive
                payload = {
                    "type": "heartbeat",
                    "ts": int(time.time()),
                    "count": heartbeat_count,
                    "status": "alive"
                }
                yield f"data: {json.dumps(payload)}\n\n"
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                break
            except Exception:
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        }
    )

# ── Page Routes ─────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def serve_landing():
    html_path = os.path.join(web_dir, "landing.html")
    if os.path.exists(html_path):
        with open(html_path, "r") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Landing page not found</h1>", status_code=404)

@app.get("/app", response_class=HTMLResponse, include_in_schema=False)
async def serve_app():
    html_path = os.path.join(web_dir, "app.html")
    if os.path.exists(html_path):
        with open(html_path, "r") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>App not found</h1>", status_code=404)

@app.get("/admin", response_class=HTMLResponse, include_in_schema=False)
async def serve_admin():
    html_path = os.path.join(web_dir, "admin.html")
    if os.path.exists(html_path):
        with open(html_path, "r") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Admin panel not found</h1>", status_code=404)

@app.get("/manifest.json")
async def serve_manifest():
    manifest_path = os.path.join(web_dir, "manifest.json")
    if os.path.exists(manifest_path):
        return FileResponse(manifest_path, media_type="application/json")
    return {"error": "manifest not found"}

@app.get("/sw.js")
async def serve_sw():
    sw_path = os.path.join(web_dir, "sw.js")
    if os.path.exists(sw_path):
        return FileResponse(sw_path, media_type="application/javascript")
    return HTMLResponse(content="// Service worker not found", status_code=404)

# ── API Routers ──────────────────────────────────────────────
from app.api import chat, financial, compliance, admin
from app.api import users, email_routes
from app.api import settings as settings_api
from app.api import ledger as ledger_api
from app.api import billing as billing_api
from app.api import projects as projects_api

app.include_router(chat.router,          prefix="/api/chat",       tags=["AI Chat"])
app.include_router(financial.router,     prefix="/api/financial",  tags=["Financial"])
app.include_router(compliance.router,    prefix="/api/compliance", tags=["Compliance"])
app.include_router(admin.router,         prefix="/api/admin",      tags=["Admin"])
app.include_router(users.router,         prefix="/api/users",      tags=["Users"])
app.include_router(email_routes.router,  prefix="/api/email",      tags=["Email AI"])
app.include_router(settings_api.router,  prefix="/api/settings",   tags=["Settings"])
app.include_router(ledger_api.router,    prefix="/api/ledger",     tags=["Ledger"])
app.include_router(billing_api.router,   prefix="/api/billing",    tags=["Billing"])
app.include_router(projects_api.router,  prefix="/api/projects",   tags=["Projects"])

# ── Dropdown Manager ──────────────────────────────────────────────────────────
from fastapi import Header as FHeader
from app.api.dropdown_manager import get_all_dropdowns, get_dropdown, update_dropdown, add_dropdown_item, remove_dropdown_item, create_dropdown
from typing import List as TList, Dict as TDict, Optional as TOpt

@app.get("/api/dropdowns", tags=["Dropdowns"])
async def get_all_dropdown_lists():
    return get_all_dropdowns()

@app.get("/api/dropdowns/{key}", tags=["Dropdowns"])
async def get_dropdown_list(key: str):
    items = get_dropdown(key)
    return {"key": key, "items": items}

@app.put("/api/dropdowns/{key}", tags=["Dropdowns"])
async def update_dropdown_list(key: str, body: dict, authorization: TOpt[str] = FHeader(None)):
    from app.admin_auth import verify_admin_token
    if not authorization:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Admin auth required")
    token = authorization.replace("Bearer ", "").strip()
    if not verify_admin_token(token):
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Invalid token")
    items = body.get("items", [])
    update_dropdown(key, items)
    return {"success": True, "key": key, "count": len(items)}

@app.post("/api/dropdowns/{key}/item", tags=["Dropdowns"])
async def add_item_to_dropdown(key: str, body: dict, authorization: TOpt[str] = FHeader(None)):
    from app.admin_auth import verify_admin_token
    if not authorization:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Admin auth required")
    token = authorization.replace("Bearer ", "").strip()
    if not verify_admin_token(token):
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Invalid token")
    add_dropdown_item(key, body)
    return {"success": True}

@app.delete("/api/dropdowns/{key}/item/{value}", tags=["Dropdowns"])
async def remove_item_from_dropdown(key: str, value: str, authorization: TOpt[str] = FHeader(None)):
    from app.admin_auth import verify_admin_token
    if not authorization:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Admin auth required")
    token = authorization.replace("Bearer ", "").strip()
    if not verify_admin_token(token):
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Invalid token")
    remove_dropdown_item(key, value)
    return {"success": True}

@app.post("/api/dropdowns", tags=["Dropdowns"])
async def create_new_dropdown(body: dict, authorization: TOpt[str] = FHeader(None)):
    from app.admin_auth import verify_admin_token
    if not authorization:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Admin auth required")
    token = authorization.replace("Bearer ", "").strip()
    if not verify_admin_token(token):
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Invalid token")
    key = body.get("key")
    items = body.get("items", [])
    create_dropdown(key, items)
    return {"success": True, "key": key}

# ── Compliance Summary ─────────────────────────────────────────────
@app.get("/api/compliance/summary", tags=["Compliance"])
async def compliance_summary():
    """Platform-wide compliance summary"""
    try:
        from app.compliance_engine import (
            safety_records, permit_records, inspection_records
        )
        return {
            "safety_forms": len(safety_records) if safety_records else 0,
            "permits": len(permit_records) if permit_records else 0,
            "inspections": len(inspection_records) if inspection_records else 0,
        }
    except Exception:
        return {"safety_forms": 0, "permits": 0, "inspections": 0}

# ── Financial Transactions ──────────────────────────────────────────
@app.get("/api/financial/transactions", tags=["Financial"])
async def all_financial_transactions():
    """All financial transactions platform-wide"""
    try:
        from app.financial_system import transactions_db
        txns = list(transactions_db.values()) if isinstance(transactions_db, dict) else transactions_db
        return {"transactions": txns}
    except Exception:
        return {"transactions": []}

# ── Projects Summary Overview ───────────────────────────────────────
@app.get("/api/projects/summary/overview", tags=["Projects"])
async def projects_summary_overview():
    """Platform-wide projects and invoices overview"""
    from app.api.projects import projects_db, estimates_db
    # projects_db is a flat list
    all_projects = list(projects_db) if projects_db else []
    all_invoices = []
    for p in all_projects:
        for inv in p.get("invoices", []):
            inv_copy = dict(inv)
            inv_copy["project_name"] = p.get("name", "")
            inv_copy["client_name"] = p.get("client_name", "")
            all_invoices.append(inv_copy)
    total_invoiced = sum(inv.get("total", 0) for inv in all_invoices)
    return {
        "projects": all_projects,
        "invoices": all_invoices,
        "estimates": list(estimates_db) if estimates_db else [],
        "total_projects": len(all_projects),
        "total_invoices": len(all_invoices),
        "total_invoiced": total_invoiced,
    }

# ── Marketing Hub ──────────────────────────────────────────────────

@app.get("/client-view/{link_id}", response_class=HTMLResponse, include_in_schema=False)
async def serve_client_view(link_id: str):
    """Serve the client-facing project view page."""
    html_path = os.path.join(web_dir, "client-view.html")
    if os.path.exists(html_path):
        with open(html_path, "r") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Client view not found</h1>", status_code=404)


@app.get("/api/client-view/{link_id}", tags=["Client View"])
async def get_client_view_data(link_id: str):
    """Return project data for a given client link ID (public endpoint)."""
    from app.user_system import users_db
    
    # Search all users for a project with this link_id
    for username, user_data in users_db.items():
        projects = user_data.get("store", {}).get("projects", [])
        for project in projects:
            if project.get("client_link_id") == link_id:
                # Return safe public data
                documents = user_data.get("store", {}).get("documents", [])
                # Only include documents linked to this project that are client-visible
                project_docs = [
                    {
                        "id": d.get("id"),
                        "name": d.get("name"),
                        "category": d.get("category"),
                        "description": d.get("description"),
                        "filename": d.get("file_name") or d.get("filename"),
                        "file_type": d.get("file_type"),
                        "file_size": d.get("file_size"),
                        "created_at": d.get("created_at"),
                        # Include data_url for images so client can view them
                        "data_url": d.get("data_url") if (d.get("file_type", "").startswith("image/")) else None,
                        "is_pdf": d.get("file_type") == "application/pdf"
                    }
                    for d in documents
                    if d.get("project_id") == project.get("id") 
                    and (d.get("client_visible") == True or d.get("client_visible") == "true")
                ]
                
                return {
                    "id": project.get("id"),
                    "name": project.get("name"),
                    "client_name": project.get("client_name"),
                    "client_email": project.get("client_email"),
                    "address": project.get("address") or project.get("client_address"),
                    "status": project.get("status"),
                    "project_type": project.get("project_type") or project.get("trade"),
                    "description": project.get("description"),
                    "start_date": project.get("start_date"),
                    "scheduled_finish_date": project.get("scheduled_finish_date"),
                    "scope_of_work": project.get("scope_of_work", []),
                    "documents": project_docs,
                    "created_at": project.get("created_at"),
                    "updated_at": project.get("updated_at") or project.get("created_at"),
                    "contractor_name": user_data.get("contact_name") or user_data.get("company_name") or username,
                    "contractor_company": user_data.get("company_name", ""),
                    "contractor_phone": user_data.get("phone", ""),
                    "contractor_email": user_data.get("email", "")
                }
    
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="Project not found")


@app.get("/privacy", response_class=HTMLResponse, include_in_schema=False)
async def serve_privacy():
    html_path = os.path.join(web_dir, "privacy.html")
    if os.path.exists(html_path):
        with open(html_path, "r") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Privacy Policy not found</h1>", status_code=404)


@app.get("/terms", response_class=HTMLResponse, include_in_schema=False)
async def serve_terms():
    html_path = os.path.join(web_dir, "terms.html")
    if os.path.exists(html_path):
        with open(html_path, "r") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Terms of Service not found</h1>", status_code=404)

@app.get("/marketing", response_class=HTMLResponse, include_in_schema=False)
async def serve_marketing():
    html_path = os.path.join(web_dir, "marketing.html")
    if os.path.exists(html_path):
        with open(html_path, "r") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Marketing hub not found</h1>", status_code=404)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8050)