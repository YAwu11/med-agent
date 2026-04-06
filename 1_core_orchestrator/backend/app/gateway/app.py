from loguru import logger
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.gateway.config import get_gateway_config
from app.gateway.routers import (
    appointment,
    artifacts,
    cases,
    doctor_synthesis,
    imaging_reports,
    mcp,
    models,
    settings_api,
    skills,
    suggestions,
    thread_events,
    threads,
    uploads,
    knowledge_proxy,
    brain_report,
    tasks,
)
from app.core.config.app_config import get_app_config
from app.core.logging.logger import setup_logging
from app.gateway.middlewares.logging_middleware import loguru_requests_middleware
from loguru import logger
from asgi_correlation_id import CorrelationIdMiddleware

# Configure logging
setup_logging()

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan handler."""

    # Load config and check necessary environment variables at startup
    try:
        get_app_config()
        logger.info("Configuration loaded successfully")
    except Exception as e:
        error_msg = f"Failed to load configuration during gateway startup: {e}"
        logger.exception(error_msg)
        raise RuntimeError(error_msg) from e

    # ── P2: 视觉管道预热（仅 vision.enabled: true 时执行） ──
    vision_cfg = getattr(get_app_config(), "vision", None) or {}
    if vision_cfg.get("enabled", False):
        try:
            from app.gateway.services.vision_gateway import warmup
            from app.gateway.services.analyzers import register_all
            
            warmup()
            register_all()
            logger.info("Analyzer registry initialized")
            
            from app.gateway.services.mcp_vision_client import check_health
            if not await check_health():
                logger.warning("⚠️ MCP Vision service (port 8002) is not reachable. X-ray analysis will fail until the service is started.")
            else:
                logger.info("MCP Vision service is online and healthy.")
        except Exception:
            logger.exception("Chinese-CLIP 模型或分析器注册失败，视觉管道将不可用")

    config = get_gateway_config()
    logger.info(f"Starting API Gateway on {config.host}:{config.port}")

    # NOTE: MCP tools initialization is NOT done here because:
    # 1. Gateway doesn't use MCP tools - they are used by Agents in the LangGraph Server
    # 2. Gateway and LangGraph Server are separate processes with independent caches
    # MCP tools are lazily initialized in LangGraph Server when first needed

    # IM channel logic was removed for medical isolation

    # Auto-seed sample cases on first run
    try:
        from app.gateway.services.seed_data import ensure_seed_cases
        ensure_seed_cases()
    except Exception:
        logger.exception("Failed to seed cases")

    yield
    logger.info("Shutting down API Gateway")

def create_app() -> FastAPI:
    """Create and configure the FastAPI application.

    Returns:
        Configured FastAPI application instance.
    """

    app = FastAPI(
        title="DeerFlow API Gateway",
        description="""
## DeerFlow API Gateway

API Gateway for DeerFlow - A LangGraph-based AI agent backend with sandbox execution capabilities.

### Features

- **Models Management**: Query and retrieve available AI models
- **MCP Configuration**: Manage Model Context Protocol (MCP) server configurations
- **Memory Management**: Access and manage global memory data for personalized conversations
- **Skills Management**: Query and manage skills and their enabled status
- **Artifacts**: Access thread artifacts and generated files
- **Health Monitoring**: System health check endpoints

### Architecture

LangGraph requests are handled by nginx reverse proxy.
This gateway provides custom endpoints for models, MCP configuration, skills, and artifacts.
        """,
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        openapi_tags=[
            {
                "name": "models",
                "description": "Operations for querying available AI models and their configurations",
            },
            {
                "name": "mcp",
                "description": "Manage Model Context Protocol (MCP) server configurations",
            },
            {
                "name": "memory",
                "description": "Access and manage global memory data for personalized conversations",
            },
            {
                "name": "skills",
                "description": "Manage skills and their configurations",
            },
            {
                "name": "artifacts",
                "description": "Access and download thread artifacts and generated files",
            },
            {
                "name": "uploads",
                "description": "Upload and manage user files for threads",
            },
            {
                "name": "threads",
                "description": "Manage DeerFlow thread-local filesystem data",
            },
            {
                "name": "agents",
                "description": "Create and manage custom agents with per-agent config and prompts",
            },
            {
                "name": "suggestions",
                "description": "Generate follow-up question suggestions for conversations",
            },
            {
                "name": "channels",
                "description": "Manage IM channel integrations (Feishu, Slack, Telegram)",
            },
            {
                "name": "health",
                "description": "Health check and system status endpoints",
            },
        ],
    )

    # CORS is handled by nginx - no need for FastAPI middleware
    
    app.add_middleware(CorrelationIdMiddleware)
    app.middleware("http")(loguru_requests_middleware)

    # Include routers
    # Models API is mounted at /api/models
    app.include_router(models.router)

    # MCP API is mounted at /api/mcp
    app.include_router(mcp.router)

    # Included routers: models, mcp, skills, artifacts, uploads, threads, suggestions
    app.include_router(skills.router)
    app.include_router(artifacts.router)
    app.include_router(uploads.router)
    app.include_router(threads.router)
    app.include_router(thread_events.router)
    app.include_router(suggestions.router)
    app.include_router(cases.router)
    app.include_router(doctor_synthesis.router)
    app.include_router(imaging_reports.router)
    app.include_router(settings_api.router)
    app.include_router(knowledge_proxy.router)
    app.include_router(appointment.router)
    app.include_router(brain_report.router)
    app.include_router(tasks.router)

    @app.get("/health", tags=["health"])
    async def health_check() -> dict:
        """Health check endpoint.

        Returns:
            Service health status information.
        """
        return {"status": "healthy", "service": "deer-flow-gateway"}

    return app

# Create app instance for uvicorn
app = create_app()
