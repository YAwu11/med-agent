from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from app.gateway.services.task_store import get_task

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

@router.get("/{task_id}/status")
async def get_task_status(task_id: str) -> Dict[str, Any]:
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    return {
        "task_id": task_id,
        "status": task["status"],
        "result": task["result"],
        "error": task["error"]
    }
