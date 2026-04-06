"""轻量级分布后台任务状态管理器 (基于 SQLite)。

用于 3D NIfTI 肿瘤流水线等高耗时任务。
支持分布式（多 Uvicorn Worker）下的前端轮询并发读取。
"""

import sqlite3
import json
from typing import Dict, Any
from datetime import datetime
from app.core.config.paths import get_paths

def _get_db_conn():
    data_dir = get_paths().data_dir
    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "tasks.db"
    conn = sqlite3.connect(db_path)
    
    # 幂等建表
    conn.execute('''
        CREATE TABLE IF NOT EXISTS async_tasks (
            task_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            result TEXT,
            error TEXT,
            created_at TEXT NOT NULL
        )
    ''')
    conn.commit()
    return conn

def create_task(task_id: str) -> None:
    conn = _get_db_conn()
    try:
        now_str = datetime.now().isoformat()
        conn.execute(
            "INSERT INTO async_tasks (task_id, status, created_at) VALUES (?, ?, ?)",
            (task_id, "processing", now_str)
        )
        conn.commit()
    finally:
        conn.close()

def update_task_status(task_id: str, status: str, result: Any = None, error: str = None) -> None:
    conn = _get_db_conn()
    try:
        result_str = json.dumps(result, ensure_ascii=False) if result is not None else None
        
        updates = ["status = ?"]
        params = [status]
        
        if result_str is not None:
            updates.append("result = ?")
            params.append(result_str)
            
        if error is not None:
            updates.append("error = ?")
            params.append(error)
            
        params.append(task_id)
        
        query = f"UPDATE async_tasks SET {', '.join(updates)} WHERE task_id = ?"
        conn.execute(query, tuple(params))
        conn.commit()
    finally:
        conn.close()

def get_task(task_id: str) -> Dict[str, Any] | None:
    conn = _get_db_conn()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT status, result, error, created_at FROM async_tasks WHERE task_id = ?", (task_id,))
        row = cursor.fetchone()
        
        if not row:
            return None
            
        status, result_str, error, created_at = row
        return {
            "status": status,
            "result": json.loads(result_str) if result_str else None,
            "error": error,
            "created_at": created_at
        }
    finally:
        conn.close()
