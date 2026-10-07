import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Directory containing this file (backend/). Used so SQLite/.env are not tied to the shell cwd.
_BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(_BACKEND_DIR / ".env")


def _normalize_database_url(url: str) -> str:
    """Neon/Render give postgres://; SQLAlchemy + psycopg3 needs postgresql+psycopg://."""
    url = url.strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    if "neon.tech" in url and "sslmode=" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return url


# Preferred: PostgreSQL URL (Neon) in env.
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
if DATABASE_URL:
    DATABASE_URL = _normalize_database_url(DATABASE_URL)
else:
    # Render must use Neon; a local sqlite file would reset on every deploy.
    if os.getenv("RENDER"):
        raise RuntimeError(
            "DATABASE_URL is required on Render. Use your Neon connection string "
            "(postgresql://... with sslmode=require)."
        )
    env_sqlite = os.getenv("SQLITE_URL", "").strip()
    if env_sqlite:
        DATABASE_URL = env_sqlite
    else:
        _db_path = (_BACKEND_DIR / "pricewise.db").resolve()
        DATABASE_URL = "sqlite:///" + _db_path.as_posix()

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    future=True,
    connect_args=connect_args,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
Base = declarative_base()
