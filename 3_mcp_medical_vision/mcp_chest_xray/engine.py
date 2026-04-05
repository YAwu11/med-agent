#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
MCP Vision Service — V3 Pipeline Engine
Refactored from pipeline_v3.py as importable module.
All functions return dicts/lists instead of writing files.
"""

import os
import sys
import json
import numpy as np
import cv2
import torch
import torch.nn.functional as F
import torchvision
import torchxrayvision as xrv

from ultralytics import YOLO
from vision_config import (
    DEVICE, YOLO_WEIGHTS, MEDSAM_CHECKPOINT, OUTPUT_DIR,
    SOLID_LESIONS, CARDIAC_LESIONS, PLEURAL_LESIONS,
    MERGE_IOU_THRESHOLD, PATHOLOGY_CN
)

import logging
_logger = logging.getLogger("mcp-engine")


# ============================================================
# Model Singletons (P0 Speed Optimization)
# Models are loaded ONCE and stay resident in memory.
# ============================================================
_yolo_model = None
_pspnet_model = None
_pspnet_targets = None
_densenet_model = None
_medsam_predictor = None
_warmed_up = False


def _get_yolo():
    """Lazy-load YOLOv8 model (singleton)."""
    global _yolo_model
    if _yolo_model is None:
        if not os.path.exists(YOLO_WEIGHTS):
            raise FileNotFoundError(f"YOLO weights not found: {YOLO_WEIGHTS}")
        _logger.info("[P0] Loading YOLO model (one-time)...")
        _yolo_model = YOLO(YOLO_WEIGHTS)
        _logger.info("[P0] YOLO model loaded.")
    return _yolo_model


def _get_pspnet():
    """Lazy-load PSPNet model (singleton). Returns (model, targets_list)."""
    global _pspnet_model, _pspnet_targets
    if _pspnet_model is None:
        _logger.info("[P0] Loading PSPNet model (one-time)...")
        _pspnet_model = xrv.baseline_models.chestx_det.PSPNet().to(DEVICE)
        _pspnet_model.eval()
        _pspnet_targets = list(_pspnet_model.targets)
        _logger.info("[P0] PSPNet model loaded.")
    return _pspnet_model, _pspnet_targets


def _get_densenet():
    """Lazy-load DenseNet121 model (singleton)."""
    global _densenet_model
    if _densenet_model is None:
        _logger.info("[P0] Loading DenseNet121 model (one-time)...")
        _densenet_model = xrv.models.DenseNet(weights="densenet121-res224-all").to(DEVICE)
        _densenet_model.eval()
        _logger.info("[P0] DenseNet121 model loaded.")
    return _densenet_model


def _get_medsam():
    """Lazy-load MedSAM predictor (singleton). Returns SamPredictor or None."""
    global _medsam_predictor
    if _medsam_predictor is None:
        if not os.path.exists(MEDSAM_CHECKPOINT):
            _logger.warning("[P0] MedSAM checkpoint not found, skipping.")
            _medsam_predictor = False  # Sentinel: tried and unavailable
            return None
        try:
            from segment_anything import sam_model_registry, SamPredictor
            _logger.info("[P0] Loading MedSAM model (one-time)...")
            medsam = sam_model_registry["vit_b"]()
            state = torch.load(MEDSAM_CHECKPOINT, map_location=DEVICE, weights_only=True)
            medsam.load_state_dict(state)
            medsam = medsam.to(DEVICE).eval()
            _medsam_predictor = SamPredictor(medsam)
            _logger.info("[P0] MedSAM model loaded.")
        except Exception as e:
            _logger.error(f"[P0] Failed to load MedSAM: {e}")
            _medsam_predictor = False  # Sentinel: tried and failed
            return None
    return _medsam_predictor if _medsam_predictor is not False else None


def warmup_models():
    """Load all models now to avoid later bottlenecks."""
    global _warmed_up
    if globals().get("_warmed_up", False):
        return
    _logger.info("[P0] ========== Warming up all models ==========")
    _get_yolo()
    _get_pspnet()
    _get_densenet()
    # Skip _get_medsam() to save VRAM/RAM for devices with tight memory constraints
    _warmed_up = True
    _logger.info("[P0] ========== All models ready ==========")


# ============================================================
# Data Classes
# ============================================================
class Finding:
    def __init__(self, class_id, class_name, confidence, bbox):
        self.class_id = class_id
        self.class_name = class_name
        self.confidence = float(confidence)
        self.bbox = [float(x) for x in bbox]
        self.location = "Unknown"
        self.location_cn = ""
        self.contour = None
        self.description = ""
        self.is_solid = self.class_name in SOLID_LESIONS
        self.verified = False

    def to_dict(self):
        return {
            "class_name": self.class_name,
            "confidence": round(self.confidence, 3),
            "bbox": [round(x, 1) for x in self.bbox],
            "location": self.location,
            "location_cn": self.location_cn,
            "is_solid": self.is_solid,
            "has_contour": self.contour is not None
        }


def _resize_closest(mask_tensor, target_h, target_w):
    mask_4d = mask_tensor.unsqueeze(0).unsqueeze(0).float()
    resized = F.interpolate(mask_4d, size=(target_h, target_w), mode='nearest')
    return (resized.squeeze() > 0.5).cpu().numpy().astype(np.uint8)


# ============================================================
# Phase 1: YOLOv8 + PSPNet Parallel Inference
# ============================================================
def phase1_inference(img_path):
    """Run YOLO detection + PSPNet anatomy segmentation (using cached models)."""
    img_bgr = cv2.imdecode(np.fromfile(img_path, dtype=np.uint8), cv2.IMREAD_COLOR)
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    img_h, img_w = img_rgb.shape[:2]

    # YOLO (singleton)
    yolo_model = _get_yolo()
    yolo_results = yolo_model.predict(img_rgb, conf=0.25, iou=0.4, imgsz=640, verbose=False)
    raw_detections = []
    if len(yolo_results) > 0:
        boxes = yolo_results[0].boxes
        for box in boxes:
            cls_id = int(box.cls[0])
            cls_name = yolo_model.names[cls_id]
            conf = float(box.conf[0])
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            raw_detections.append(Finding(cls_id, cls_name, conf, [x1, y1, x2, y2]))

    # PSPNet (singleton)
    seg_model, targets = _get_pspnet()
    img_xrv = xrv.utils.load_image(img_path)
    transform_512 = torchvision.transforms.Compose([
        xrv.datasets.XRayCenterCrop(), xrv.datasets.XRayResizer(512)
    ])
    img_512 = transform_512(img_xrv)
    img_512_t = torch.from_numpy(img_512).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        seg_output = seg_model(img_512_t)[0]
    left_mask = _resize_closest(seg_output[targets.index('Left Lung')], img_h, img_w)
    right_mask = _resize_closest(seg_output[targets.index('Right Lung')], img_h, img_w)
    heart_mask = _resize_closest(seg_output[targets.index('Heart')], img_h, img_w)
    torch.cuda.empty_cache()

    return img_rgb, raw_detections, left_mask, right_mask, heart_mask


# ============================================================
# Phase 2: IoB Spatial Validation & Anatomical Localization
# ============================================================
def filter_and_localize(detections, left_mask, right_mask, heart_mask):
    """Validate detections against anatomy masks and assign location."""
    img_h, img_w = left_mask.shape
    lung_mask = np.logical_or(left_mask, right_mask)
    valid_findings, rejected_findings = [], []

    ys = np.where(lung_mask.any(axis=1))[0]
    if len(ys) < (img_h * 0.1):
        global_y_min = int(img_h * 0.15)
        lung_height = int(img_h * 0.65)
    else:
        global_y_min = int(ys.min())
        lung_height = max(1, int(ys.max()) - global_y_min)

    for det in detections:
        x1, y1, x2, y2 = int(det.bbox[0]), int(det.bbox[1]), int(det.bbox[2]), int(det.bbox[3])
        box_area = max(1, (x2 - x1) * (y2 - y1))

        # Cardiac lesions
        if det.class_name in CARDIAC_LESIONS:
            iob = np.sum(heart_mask[y1:y2, x1:x2]) / box_area
            if iob < 0.10:
                rejected_findings.append((det, f"Outside heart (IoB={iob:.2%})"))
                continue
            det.location = "Heart/Mediastinum"
            det.location_cn = "心脏/纵隔"
            det.verified = True
            heart_xs = np.where(heart_mask.any(axis=0))[0]
            thor_xs = np.where(lung_mask.any(axis=0))[0]
            if len(heart_xs) > 0 and len(thor_xs) > 0:
                ctr = (heart_xs.max() - heart_xs.min()) / (thor_xs.max() - thor_xs.min() + 1e-5)
                det.description = f"{det.class_name} (CTR={ctr:.2f})"
                if ctr <= 0.5:
                    det.confidence *= 0.5
            valid_findings.append(det)
            continue

        # Lung overlap
        overlap_l = np.sum(left_mask[y1:y2, x1:x2])
        overlap_r = np.sum(right_mask[y1:y2, x1:x2])
        overlap_total = overlap_l + overlap_r
        iob_lung = overlap_total / box_area

        if det.class_name in PLEURAL_LESIONS:
            if iob_lung < 0.05:
                cy = (y1 + y2) / 2
                if det.class_name in ('Pleural_effusion', 'Pleural effusion') and cy > (img_h * 0.5) and iob_lung >= 0.02:
                    pass
                else:
                    rejected_findings.append((det, f"Outside lung (IoB={iob_lung:.2%})"))
                    continue
        else:
            if iob_lung < 0.15:
                rejected_findings.append((det, f"Outside lung (IoB={iob_lung:.2%})"))
                continue

        # Anatomical localization
        side = "L" if overlap_l > overlap_r else "R"
        side_en = "Left" if side == "L" else "Right"
        side_cn = "左" if side == "L" else "右"

        cy_rel = ((y1 + y2) / 2 - global_y_min) / lung_height
        if cy_rel < 0.33:
            zone_en, zone_cn = "upper lobe", "上叶"
        elif cy_rel < 0.66:
            zone_en, zone_cn = "middle zone", "中野"
        else:
            zone_en, zone_cn = "lower lobe", "下叶"

        cx = (x1 + x2) / 2
        side_mask = left_mask if side == "L" else right_mask
        side_xs = np.where(side_mask.any(axis=0))[0]
        horiz_en, horiz_cn = "", ""
        if len(side_xs) > 2:
            lung_left_edge = side_xs.min()
            lung_width = side_xs.max() - lung_left_edge
            cx_rel = (cx - lung_left_edge) / max(lung_width, 1)
            if cy_rel > 0.80:
                horiz_en, horiz_cn = "costophrenic angle", "肋膈角区"
            elif cx_rel < 0.30 or cx_rel > 0.70:
                horiz_en, horiz_cn = "lateral zone", "外带"
            elif 0.35 < cx_rel < 0.65 and cy_rel < 0.50:
                horiz_en, horiz_cn = "perihilar region", "肺门区"
            else:
                horiz_en, horiz_cn = "central zone", "中带"

        if horiz_en:
            det.location = f"{side_en} {zone_en}, {horiz_en}"
            det.location_cn = f"{side_cn}肺{zone_cn}{horiz_cn}"
        else:
            det.location = f"{side_en} {zone_en}"
            det.location_cn = f"{side_cn}肺{zone_cn}"
        det.verified = True
        det.description = f"{det.class_name} @ {det.location} ({det.confidence:.1%})"
        valid_findings.append(det)

    return valid_findings, rejected_findings



# ============================================================
# Phase 3: MedSAM Segmentation (Optional)
# ============================================================
def process_segmentation(valid_findings, img_rgb):
    """Run MedSAM on solid lesions for precise contour (using cached model)."""
    img_h, img_w = img_rgb.shape[:2]
    solid = [f for f in valid_findings if f.is_solid]
    if not solid:
        return

    predictor = _get_medsam()
    if predictor is None:
        return

    predictor.set_image(img_rgb)

    for finding in solid:
        try:
            x1, y1, x2, y2 = finding.bbox
            pw, ph = int((x2 - x1) * 0.10), int((y2 - y1) * 0.10)
            padded = [max(0, x1 - pw), max(0, y1 - ph), min(img_w, x2 + pw), min(img_h, y2 + ph)]
            box_np = np.array(padded)
            masks, _, _ = predictor.predict(box=box_np, multimask_output=False)
            if masks is not None and masks.shape[0] > 0:
                finding.contour = masks[0].astype(np.uint8)
        except Exception:
            pass

    torch.cuda.empty_cache()


# ============================================================
# DenseNet Classification
# ============================================================
def get_densenet_probs(img_path):
    """Get DenseNet121 classification probabilities (using cached model)."""
    model = _get_densenet()
    img_xrv = xrv.utils.load_image(img_path)
    transform = torchvision.transforms.Compose([
        xrv.datasets.XRayCenterCrop(), xrv.datasets.XRayResizer(224)
    ])
    img_224 = transform(img_xrv)
    with torch.no_grad():
        preds = model(torch.from_numpy(img_224).unsqueeze(0).to(DEVICE))
    all_probs = dict(zip(model.pathologies, preds[0].cpu().numpy()))
    top_probs = {k: round(float(v), 3) for k, v in
                 sorted(all_probs.items(), key=lambda x: -x[1]) if float(v) > 0.1}
    torch.cuda.empty_cache()
    return top_probs


# ============================================================
# Report Builder
# ============================================================
import uuid

def build_report(valid_findings, rejected_findings, top_probs=None):
    """Build structured report dict from analysis results."""
    # Bilateral detection
    disease_sides, disease_counts = {}, {}
    for f in valid_findings:
        cls = f.class_name
        loc = getattr(f, 'location', '')
        side = 'L' if 'Left' in loc else ('R' if 'Right' in loc else 'C')
        disease_sides.setdefault(cls, set()).add(side)
        disease_counts[cls] = disease_counts.get(cls, 0) + 1

    summary = {
        "total_findings": len(valid_findings),
        "bilateral_diseases": [],
        "disease_breakdown": {}
    }
    for cls, sides in disease_sides.items():
        is_bilateral = 'L' in sides and 'R' in sides
        count = disease_counts[cls]
        if is_bilateral:
            summary["bilateral_diseases"].append(cls)
            dist_str = f"bilateral ({count} foci)"
            dist_cn = f"双肺多发 ({count}处)"
        else:
            side_label = "left" if 'L' in sides else ("right" if 'R' in sides else "central")
            side_cn = "左侧" if 'L' in sides else ("右侧" if 'R' in sides else "中央")
            dist_str = f"{side_label} ({count} foci)" if count > 1 else side_label
            dist_cn = f"{side_cn} ({count}处)" if count > 1 else side_cn
        summary["disease_breakdown"][cls] = {
            "count": count, "bilateral": is_bilateral,
            "distribution": dist_str, "distribution_cn": dist_cn
        }

    report = {
        "pipeline": "Pipeline V3 (MCP Service)",
        "summary": summary,
        "findings": [],
        "rejected": [],
        "densenet_probs": top_probs or {},
        "disclaimer": "For research only, not for clinical use"
    }

    for f in valid_findings:
        finding_id = str(uuid.uuid4())[:8]  # Simple ID for frontend CRUD
        report["findings"].append({
            "id": finding_id,
            "disease": f.class_name,
            "confidence": round(f.confidence, 3),
            "location": f.location,
            "location_cn": getattr(f, 'location_cn', ''),
            "bbox": [round(x, 1) for x in f.bbox],
            "is_solid": f.is_solid,
            "has_contour": f.contour is not None
        })

    for det, reason in rejected_findings:
        report["rejected"].append({
            "disease": det.class_name,
            "confidence": round(det.confidence, 3),
            "reason": reason
        })

    return report


# ============================================================
# Main Pipeline Entry
# ============================================================
def analyze(img_path, enable_sam=True):
    """
    Full V3 pipeline analysis. Returns structured report dict.
    This is the primary function called by the MCP server.
    """
    if not os.path.exists(img_path):
        return {"error": f"Image not found: {img_path}"}

    # Phase 1: Detection + Anatomy
    img_rgb, raw_dets, left_m, right_m, heart_m = phase1_inference(img_path)

    # DenseNet classification
    top_probs = get_densenet_probs(img_path)

    if not raw_dets:
        return build_report([], [], top_probs)

    # Phase 2: Spatial validation
    valid_f, rej_f = filter_and_localize(raw_dets, left_m, right_m, heart_m)

    # Phase 3: SAM segmentation
    if enable_sam:
        process_segmentation(valid_f, img_rgb)

    # Build report
    return build_report(valid_f, rej_f, top_probs)
