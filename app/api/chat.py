"""
Chat API endpoints for AI Assistant - Full context-aware implementation
"""

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
import logging

from ..ai_engine import ai_engine

logger = logging.getLogger(__name__)

router = APIRouter()


class ChatMessage(BaseModel):
    message: str
    context: Optional[str] = None          # current page
    user_context: Optional[Dict[str, Any]] = {}
    trade_specialization: Optional[str] = None
    app_data: Optional[Dict[str, Any]] = None   # full store data from frontend


class ChatResponse(BaseModel):
    response: str
    suggestions: List[str]
    actions: List[Dict[str, str]]
    confidence: float
    timestamp: datetime


@router.post("/message", response_model=ChatResponse)
async def send_message(
    chat_message: ChatMessage,
    authorization: Optional[str] = Header(None)
):
    """
    Send a message to the AI assistant and get a context-aware response.
    The frontend sends the full app store data so the AI can reference real data.
    """
    try:
        logger.info(f"Processing message: {chat_message.message[:100]}...")

        # Get user info from auth token if available
        user_context = chat_message.user_context or {}
        if authorization and authorization.startswith("Bearer "):
            try:
                from ..user_system import users_db
                token = authorization.replace("Bearer ", "")
                # Find user by token (simple lookup)
                for email, user_data in users_db.items():
                    if user_data.get("token") == token:
                        user_context = {
                            "email": email,
                            "contact_name": user_data.get("contact_name", ""),
                            "business_name": user_data.get("business_name", ""),
                            "trade": user_data.get("trade", ""),
                            "plan": user_data.get("plan", "free")
                        }
                        # Also get stored app data if not provided by frontend
                        if not chat_message.app_data:
                            chat_message.app_data = user_data.get("store", {})
                        break
            except Exception as e:
                logger.warning(f"Could not resolve user from token: {e}")

        # Add current page context to message if provided
        message = chat_message.message
        if chat_message.context and chat_message.context not in ("ai-chat", ""):
            message = f"[User is on the {chat_message.context} page] {message}"

        result = await ai_engine.process_message(
            message=message,
            user_context=user_context,
            trade_specialization=chat_message.trade_specialization or user_context.get("trade"),
            app_data=chat_message.app_data
        )

        return ChatResponse(
            response=result["response"],
            suggestions=result["suggestions"],
            actions=result["actions"],
            confidence=result["confidence"],
            timestamp=datetime.now()
        )

    except Exception as e:
        logger.error(f"Error processing message: {e}")
        raise HTTPException(status_code=500, detail="Failed to process message")


@router.get("/suggestions")
async def get_suggestions(authorization: Optional[str] = Header(None)):
    """Get proactive suggestions based on user's app data"""
    try:
        app_data = {}
        user_context = {}

        if authorization and authorization.startswith("Bearer "):
            try:
                from ..user_system import users_db
                token = authorization.replace("Bearer ", "")
                for email, user_data in users_db.items():
                    if user_data.get("token") == token:
                        app_data = user_data.get("store", {})
                        user_context = {
                            "email": email,
                            "business_name": user_data.get("business_name", ""),
                            "trade": user_data.get("trade", "")
                        }
                        break
            except Exception as e:
                logger.warning(f"Could not resolve user: {e}")

        suggestions = ai_engine._get_suggestions("", app_data)
        return {"suggestions": suggestions, "timestamp": datetime.now()}

    except Exception as e:
        logger.error(f"Error getting suggestions: {e}")
        raise HTTPException(status_code=500, detail="Failed to get suggestions")