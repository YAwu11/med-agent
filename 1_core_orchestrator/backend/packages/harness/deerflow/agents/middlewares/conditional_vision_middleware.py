"""Middleware to conditionally inject Base64 images for clinical photos and unrecognized images."""

import base64
import logging
from pathlib import Path

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage
from langgraph.runtime import Runtime

from deerflow.config.app_config import get_app_config
from deerflow.config.paths import get_paths

logger = logging.getLogger(__name__)


class ConditionalVisionMiddleware(AgentMiddleware[AgentState]):
    """Middleware to inject Base64 image data into the HumanMessage for clinical photos and unrecognized images."""

    state_schema = AgentState

    def before_model(self, state: AgentState, runtime: Runtime) -> dict | None:
        """Inject Base64 image data into the last HumanMessage if it contains clinical photos."""
        vision_cfg = getattr(get_app_config(), "vision", None) or {}
        if not vision_cfg.get("enabled", False) or not vision_cfg.get("conditional_vision", {}).get("enabled", False):
            return None

        messages = state.get("messages", [])
        if not messages:
            return None

        # Look for the last human message
        last_human_idx = -1
        for i in range(len(messages) - 1, -1, -1):
            if isinstance(messages[i], HumanMessage):
                last_human_idx = i
                break

        if last_human_idx == -1:
            return None

        last_human_msg = messages[last_human_idx]
        files = (last_human_msg.additional_kwargs or {}).get("files", [])
        if not files:
            return None

        thread_id = runtime.context.thread_id
        if not thread_id:
            return None

        uploads_dir = get_paths().sandbox_uploads_dir(thread_id)

        # Identify images that need Base64 injection:
        # - clinical_photo: clinical pathology photos for visual analysis
        # - other: unrecognized images, let the LLM see and decide
        INJECT_TYPES = {"clinical_photo", "other"}
        vision_images = []
        for f in files:
            if not isinstance(f, dict):
                continue
            if f.get("image_type") in INJECT_TYPES:
                filename = f.get("filename")
                if not filename or Path(filename).name != filename:
                    continue
                file_path = uploads_dir / filename
                if file_path.is_file():
                    vision_images.append(file_path)

        if not vision_images:
            return None

        # Check if the message content is already formatted as a list with image_urls
        # to avoid double injection if this middleware runs multiple times in a loop
        if isinstance(last_human_msg.content, list):
            for block in last_human_msg.content:
                if isinstance(block, dict) and block.get("type") == "image_url":
                    return None  # Already injected

        logger.info(f"Injecting {len(vision_images)} images (clinical/other) as Base64 into the HumanMessage.")

        # Construct the new multipart content
        new_content = []
        if isinstance(last_human_msg.content, str):
            new_content.append({"type": "text", "text": last_human_msg.content})
        elif isinstance(last_human_msg.content, list):
            new_content.extend(last_human_msg.content)

        # Append Base64 blocks
        for path in vision_images:
            try:
                ext = path.suffix.lower().lstrip(".")
                mime_type = "jpeg" if ext in ("jpg", "jpeg") else ext
                b64_data = base64.b64encode(path.read_bytes()).decode("utf-8")
                new_content.append(
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/{mime_type};base64,{b64_data}",
                            "detail": "auto"
                        }
                    }
                )
            except Exception as e:
                logger.error(f"Failed to encode image {path}: {e}")

        # Create a modified HumanMessage keeping the SAME ID so the reducer replaces it
        new_msg = HumanMessage(
            content=new_content,
            additional_kwargs=last_human_msg.additional_kwargs,
            id=last_human_msg.id,
            name=last_human_msg.name
        )

        return {"messages": [new_msg]}
