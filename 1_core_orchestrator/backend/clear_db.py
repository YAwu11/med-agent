import sqlite3
from pathlib import Path

def clear_db():
    p1 = Path(r"e:\Dev_Workspace\01_Projects\Special\med-agent\1_core_orchestrator\backend\.deer-flow\data\cases.db")
    p2 = Path(r"e:\Dev_Workspace\01_Projects\Special\med-agent\1_core_orchestrator\backend\.deer-flow\data\tasks.db")
    
    for db in [p1, p2]:
        if db.exists():
            print(f"Opening {db}")
            conn = sqlite3.connect(str(db))
            tables = [t[0] for t in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
            if 'reports' in tables:
                conn.execute("DELETE FROM reports")
                conn.commit()
                print(f"Deleted all rows from reports in {db.name}")
            else:
                print(f"No reports table in {db.name}")

if __name__ == "__main__":
    clear_db()
