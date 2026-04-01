# Brain Tumor HITL Segmentation Architecture Design

**Date**: 2026-04-01
**Topic**: Brain Tumor Localization and Anatomical Reasoning

## 1. Overview
The goal is to develop a highly polished, competition-ready "Human-In-The-Loop" (HITL) module for Brain Tumor MRI recognition. The system must support irregular polygonal segmentation masks (rather than simple bounding boxes) for high visual fidelity and clinical accuracy, followed by a VLM-generated anatomical report.

## 2. Dual-Engine Architecture 

### Engine A: Localization & Segmentation (YOLOv8-Seg)
- **Model**: YOLOv8-Seg (Ultralytics Instance Segmentation Model fine-tuned on BraTS or similar Brain Tumor datasets).
- **Why**: Addresses the user's primary concern regarding **Segmentation Accuracy** and speed. Unlike traditional U-Net which outputs heavy dense pixel masks, YOLO-seg outputs incredibly accurate and mathematically precise polygon coordinates natively (`[x1, y1, x2, y2...]`).
- **Speed**: < 50ms per clinical slice on normal hardware.

### Engine B: Anatomical Reasoning (Qwen-VL via SiliconFlow API)
- **Model**: Qwen2.5-VL-7B/72B Instruct.
- **Why**: Replaces YOLO's inability to express anatomical relationships. The VLM acts as the "radiologist assessor", taking the segmented image as context and generating natural language insights (e.g., "Left temporal lobe Glioma, causing midline shift").

## 3. Workflow & Data Flow

1. **Upload & Gateway**: User uploads single/multiple 2D MRI slices (`vision_gateway` categorizes as `brain_mri`).
2. **MCP Segmentation**: `brain_mcp.py` routes the image to the remote YOLOv8-seg microservice. The service returns an array of normalized SVG polygon coordinates.
3. **Frontend Rendering (`<MaskCanvas>`)**: The frontend React app receives the polygon arrays. It draws semi-transparent breathing overlays exactly matching the brain tumor boundaries.
4. **Editable HITL (Human-in-the-Loop)**: The doctor reviews the mask. They can delete false positives or drag the polygon vertices to correct boundaries.
5. **VLM Synthesis**: Once the doctor approves, the validated polygon crop + original image + label are sent to Qwen-VL. A comprehensive narrative diagnostic report is generated in the LLM chat window.

## 4. Components to Build
- **Frontend**: Update UI to support SVG Path overlay via a new `<MaskCanvas>` subcomponent in `ImagingViewer`.
- **Backend Orchestrator**: Implement `brain_tumor_analyzer.py` hooked into the pluggable registry.
- **External MCP Server**: A localized python SDK wrapping `ultralytics YOLO('yolov8n-seg.pt')` exposed as an MCP tool `analyze_brain_mri`.
