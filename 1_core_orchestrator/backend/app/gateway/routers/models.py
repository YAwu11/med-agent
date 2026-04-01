from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from ruamel.yaml import YAML

from app.core.config import get_app_config
from app.core.config.app_config import AppConfig

router = APIRouter(prefix="/api", tags=["models"])


# ============================================================================
# Response / Request Models
# ============================================================================


class ModelResponse(BaseModel):
    """Response model for model information."""

    name: str = Field(..., description="Unique identifier for the model")
    model: str = Field(..., description="Actual provider model identifier")
    display_name: str | None = Field(None, description="Human-readable name")
    description: str | None = Field(None, description="Model description")
    supports_thinking: bool = Field(default=False, description="Whether model supports thinking mode")
    supports_reasoning_effort: bool = Field(default=False, description="Whether model supports reasoning effort")
    supports_vision: bool = Field(default=False, description="Whether model supports vision/image inputs")
    base_url: str | None = Field(default=None, description="API endpoint URL")
    has_api_key: bool = Field(default=False, description="Whether an API key is configured (never exposes actual key)")


class ModelsListResponse(BaseModel):
    """Response model for listing all models."""

    models: list[ModelResponse]


class ModelCreateRequest(BaseModel):
    """Request body for creating or updating a model provider."""

    name: str = Field(..., description="Unique model identifier (e.g. my-deepseek)")
    display_name: str = Field(..., description="Human-readable display name")
    model: str = Field(..., description="Provider model ID (e.g. deepseek-chat)")
    use: str = Field(default="langchain_openai:ChatOpenAI", description="LangChain adapter class path")
    base_url: str = Field(..., description="API endpoint URL (e.g. https://api.siliconflow.cn/v1)")
    api_key: str | None = Field(default=None, description="API key (leave empty on update to keep existing)")
    max_tokens: int = Field(default=8192, description="Maximum tokens per request")
    temperature: float = Field(default=0.7, description="Sampling temperature")
    supports_thinking: bool = Field(default=False, description="Whether model supports thinking/reasoning mode")
    supports_vision: bool = Field(default=False, description="Whether model supports vision/image inputs")


# ============================================================================
# Config File Helpers (ruamel.yaml Round-Trip for comment preservation)
# ============================================================================


def _get_config_path() -> Path:
    """Get the resolved config.yaml path using DeerFlow's built-in resolver."""
    return AppConfig.resolve_config_path()


def _read_config() -> tuple:
    """Read config.yaml with ruamel.yaml Round-Trip mode (preserves comments/formatting).

    Returns:
        Tuple of (YAML instance, parsed config data).
    """
    yaml = YAML()
    yaml.preserve_quotes = True
    with open(_get_config_path(), "r", encoding="utf-8") as f:
        return yaml, yaml.load(f)


def _write_config(yaml_instance, config_data) -> None:
    """Write config data back to config.yaml, preserving comments and formatting."""
    with open(_get_config_path(), "w", encoding="utf-8") as f:
        yaml_instance.dump(config_data, f)


def _check_model_references(config_data, model_name: str) -> list[str]:
    """Check if a model name is referenced by other config sections.

    Returns:
        List of config paths that reference this model (e.g. ['title.model_name']).
    """
    refs = []
    title_cfg = config_data.get("title", {})
    if title_cfg and title_cfg.get("model_name") == model_name:
        refs.append("title.model_name")
    summ_cfg = config_data.get("summarization", {})
    if summ_cfg and summ_cfg.get("model_name") == model_name:
        refs.append("summarization.model_name")
    # Check subagent model_name references
    subagents_cfg = config_data.get("subagents", {})
    agents_cfg = subagents_cfg.get("agents", {}) if subagents_cfg else {}
    for agent_name, agent_conf in agents_cfg.items():
        if agent_conf and agent_conf.get("model_name") == model_name:
            refs.append(f"subagents.agents.{agent_name}.model_name")
    return refs


def _build_model_response(model) -> ModelResponse:
    """Build a ModelResponse from a ModelConfig, with sensitive field masking."""
    return ModelResponse(
        name=model.name,
        model=model.model,
        display_name=model.display_name,
        description=model.description,
        supports_thinking=model.supports_thinking,
        supports_reasoning_effort=model.supports_reasoning_effort,
        supports_vision=model.supports_vision,
        base_url=getattr(model, "base_url", None),
        has_api_key=bool(getattr(model, "api_key", None)),
    )


# ============================================================================
# GET Endpoints (existing, extended)
# ============================================================================


@router.get(
    "/models",
    response_model=ModelsListResponse,
    summary="List All Models",
    description="Retrieve a list of all available AI models configured in the system.",
)
async def list_models() -> ModelsListResponse:
    """List all available models from configuration.

    Returns model information suitable for frontend display,
    excluding sensitive fields like API keys.
    """
    config = get_app_config()
    models = [_build_model_response(model) for model in config.models]
    return ModelsListResponse(models=models)


@router.get(
    "/models/{model_name}",
    response_model=ModelResponse,
    summary="Get Model Details",
    description="Retrieve detailed information about a specific AI model by its name.",
)
async def get_model(model_name: str) -> ModelResponse:
    """Get a specific model by name.

    Args:
        model_name: The unique name of the model to retrieve.

    Returns:
        Model information if found.

    Raises:
        HTTPException: 404 if model not found.
    """
    config = get_app_config()
    model = config.get_model_config(model_name)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")
    return _build_model_response(model)


# ============================================================================
# POST / PUT / DELETE Endpoints (new)
# ============================================================================


@router.post(
    "/models",
    summary="Add Model Provider",
    description="Add a new AI model provider configuration. The model will be appended to config.yaml.",
)
async def add_model(request: ModelCreateRequest):
    """Add a new model provider to the configuration.

    The new model is appended to the `models` list in config.yaml.
    DeerFlow's hot-reload mechanism will pick up the change automatically.

    Raises:
        HTTPException: 400 if a model with the same name already exists.
    """
    yaml, config_data = _read_config()

    if "models" not in config_data:
        config_data["models"] = []

    # Check for duplicate name
    if any(m.get("name") == request.name for m in config_data["models"]):
        raise HTTPException(status_code=400, detail=f"Model '{request.name}' already exists")

    # Build new model entry (exclude None values to keep YAML clean)
    new_model = request.model_dump(exclude_none=True)
    config_data["models"].append(new_model)

    _write_config(yaml, config_data)
    return {"success": True, "message": f"Model '{request.name}' added successfully"}


@router.put(
    "/models/{model_name}",
    summary="Update Model Provider",
    description="Update an existing model provider configuration. Preserves existing API key if not provided.",
)
async def update_model(model_name: str, request: ModelCreateRequest):
    """Update an existing model provider in the configuration.

    The `name` field cannot be changed — only the URL path `model_name` is used for lookup.
    If `api_key` is None or empty, the existing key is preserved.

    Raises:
        HTTPException: 404 if model not found.
    """
    yaml, config_data = _read_config()

    if "models" not in config_data:
        raise HTTPException(status_code=404, detail="No models configured")

    for m in config_data["models"]:
        if m.get("name") == model_name:
            update_data = request.model_dump(exclude_none=True)
            # Preserve existing api_key if not provided in request
            if not update_data.get("api_key"):
                update_data.pop("api_key", None)
            for key, value in update_data.items():
                m[key] = value
            _write_config(yaml, config_data)
            return {"success": True, "message": f"Model '{model_name}' updated successfully"}

    raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")


@router.delete(
    "/models/{model_name}",
    summary="Delete Model Provider",
    description="Delete a model provider configuration. Cannot delete the default (first) model or models referenced by other configs.",
)
async def delete_model(model_name: str):
    """Delete a model provider from the configuration.

    Protection rules:
    1. Cannot delete the first model (system default).
    2. Cannot delete models referenced by title/summarization/subagent configs.

    Raises:
        HTTPException: 400 if model is protected or referenced.
        HTTPException: 404 if model not found.
    """
    yaml, config_data = _read_config()

    if "models" not in config_data or len(config_data["models"]) == 0:
        raise HTTPException(status_code=404, detail="No models configured")

    # Protection rule 1: Cannot delete the default model (first in list)
    if config_data["models"][0].get("name") == model_name:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the default model (first in list). Change the default model first.",
        )

    # Protection rule 2: Check for config references
    refs = _check_model_references(config_data, model_name)
    if refs:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete model '{model_name}': referenced by {', '.join(refs)}",
        )

    # Find and remove the model
    original_len = len(config_data["models"])
    config_data["models"] = [m for m in config_data["models"] if m.get("name") != model_name]

    if len(config_data["models"]) == original_len:
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")

    _write_config(yaml, config_data)
    return {"success": True, "message": f"Model '{model_name}' deleted successfully"}
