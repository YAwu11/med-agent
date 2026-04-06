from app.core.config.paths import get_paths
import sqlite3

def clear():
    db_path = get_paths().app_data_dir / "cases.db"
    if db_path.exists():
        print(f"Found at {db_path}")
        conn = sqlite3.connect(str(db_path))
        tables = [t[0] for t in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        if 'reports' in tables:
            conn.execute("DELETE FROM reports")
            conn.commit()
            print("Deleted reports")
        else:
            print("No reports")
    else:
        print("Not cases.db")

    db2 = get_paths().app_data_dir / "tasks.db"
    if db2.exists():
        print(f"Found {db2}")

if __name__ == "__main__":
    clear()
