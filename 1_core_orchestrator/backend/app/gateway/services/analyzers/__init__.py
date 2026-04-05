"""Initialize and register all analyzer specs."""

from app.gateway.services.analyzer_registry import AnalyzerSpec, register

def register_all():
    """Register all available analyzers on startup."""
    from .lab_ocr import LabOCRAnalyzer
    from .brain_image_notice import BrainImageNoticeAnalyzer
    from .xray_mcp import XrayMCPAnalyzer
    from .vlm_fallback import VLMFallbackAnalyzer

    register(AnalyzerSpec(
        name="paddle_ocr",
        categories=["lab_report"],
        handler=LabOCRAnalyzer().analyze,
        min_confidence=0.5,
        gpu_bound=False,  
    ))
    
    register(AnalyzerSpec(
        name="mcp_xray",
        categories=["medical_imaging"],
        handler=XrayMCPAnalyzer().analyze,
        min_confidence=0.75,
        gpu_bound=True,   
    ))

    register(AnalyzerSpec(
        name="brain_mri_notice",
        categories=["brain_mri"],
        handler=BrainImageNoticeAnalyzer().analyze,
        min_confidence=0.6,
        gpu_bound=False,
    ))
    
    register(AnalyzerSpec(
        name="vlm_fallback",
        categories=["other", "clinical_photo"],
        handler=VLMFallbackAnalyzer().analyze,
        is_fallback=True,
        gpu_bound=False,  
    ))
