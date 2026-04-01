"""Parallel execution engine for handling multiple uploaded files."""

import asyncio
import logging
import os
from typing import Callable, Sequence, Awaitable

from .analyzer_registry import AnalysisResult, get_analyzers_for

logger = logging.getLogger(__name__)

# [ADR-025] Constraint: 8GB VRAM environment -> Run GPU-intensive tasks sequentially
# Configurable via .env file depending on the deployment hardware
_gpu_concurrency = int(os.getenv("MAX_GPU_CONCURRENCY", "1"))
_gpu_semaphore = asyncio.Semaphore(_gpu_concurrency)


async def analyze_single_file(
    file_path: str,
    thread_id: str,
    filename: str,
) -> AnalysisResult:
    """Run the complete vision pipeline for a single file."""
    try:
        from app.gateway.services.vision_gateway import classify_image
        classification = await classify_image(file_path)
        category = classification["category"]
        confidence = classification["confidence"]
    except Exception as e:
        logger.error(f"Classification failed for {filename}: {e}", exc_info=True)
        return AnalysisResult(
            filename=filename, category="unknown", confidence=0.0,
            analyzer_name="none", evidence_type="note",
            evidence_title=filename, error=str(e),
        )

    analyzers = get_analyzers_for(category, confidence)

    if not analyzers:
        return AnalysisResult(
            filename=filename, category=category, confidence=confidence,
            analyzer_name="none", evidence_type="note",
            evidence_title=filename,
        )

    # Use the first matched analyzer (highest priority)
    spec = analyzers[0]
    
    logger.info(f"Dispatching {filename} ({category}, conf={confidence:.2f}) to {spec.name}")

    async def _run():
        if spec.gpu_bound:
            async with _gpu_semaphore:
                return await spec.handler(file_path, thread_id, filename)
        else:
            # CPU/Network bound tasks can run freely
            return await spec.handler(file_path, thread_id, filename)

    try:
        result = await _run()
        # Overlay standard metadata
        result.filename = filename
        result.category = category
        result.confidence = confidence
        result.analyzer_name = spec.name
        return result
    except Exception as e:
        logger.error(f"Analyzer {spec.name} failed on {filename}: {e}", exc_info=True)
        return AnalysisResult(
            filename=filename, category=category, confidence=confidence,
            analyzer_name=spec.name, evidence_type="note",
            evidence_title=filename, error=str(e),
        )


async def analyze_batch(
    files: Sequence[dict],
    thread_id: str,
    on_progress: Callable[[AnalysisResult], Awaitable[None]] | None = None,
) -> list[AnalysisResult]:
    """Process multiple files in parallel and optionally notify on progress."""

    async def _analyze_and_notify(file_info: dict) -> AnalysisResult:
        result = await analyze_single_file(
            file_info["host_path"], thread_id, file_info["filename"]
        )
        if on_progress:
            await on_progress(result)
        return result

    tasks = [_analyze_and_notify(f) for f in files]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Filter exceptions bubble up
    valid_results = []
    for f, r in zip(files, results):
        if isinstance(r, Exception):
            logger.error(f"Batch analysis task crashed for {f['filename']}: {r}", exc_info=True)
            valid_results.append(
                AnalysisResult(
                    filename=f["filename"], category="unknown", confidence=0.0,
                    analyzer_name="none", evidence_type="note", evidence_title=f["filename"],
                    error=str(r)
                )
            )
        else:
            valid_results.append(r)
            
    return valid_results
