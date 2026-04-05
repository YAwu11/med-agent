from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from deerflow.config.paths import Paths, get_paths

REQUIRED_FIELDS: tuple[tuple[str, str], ...] = (
    ("name", "姓名"),
    ("age", "年龄"),
    ("sex", "性别"),
    ("chief_complaint", "主诉"),
)

DISPLAY_FIELDS: tuple[tuple[str, str], ...] = (
    ("name", "姓名"),
    ("age", "年龄"),
    ("sex", "性别"),
    ("chief_complaint", "主诉"),
    ("present_illness", "现病史"),
    ("medical_history", "既往史"),
    ("allergies", "过敏与用药"),
    ("temperature", "体温"),
    ("heart_rate", "心率"),
    ("blood_pressure", "血压"),
    ("spo2", "血氧"),
)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp", ".gif", ".dcm"}
DOCUMENT_EXTENSIONS = {".pdf", ".doc", ".docx", ".txt", ".md", ".csv", ".xls", ".xlsx"}


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _has_value(value: Any) -> bool:
    return bool(_normalize_text(value))


def _is_nifti(filename: str) -> bool:
    lower = filename.lower()
    return lower.endswith(".nii") or lower.endswith(".nii.gz")


def _is_visible_upload(path: Path) -> bool:
    name = path.name.lower()
    if name.endswith(".ocr.md") or name.endswith(".meta.json"):
        return False
    return path.is_file()


def _is_image_like(filename: str, image_type: str | None) -> bool:
    suffix = Path(filename).suffix.lower()
    return suffix in IMAGE_EXTENSIONS or _is_nifti(filename) or bool(image_type and image_type != "document")


def _extract_markdown_title(lines: list[str], fallback: str) -> str:
    for line in lines:
        stripped = line.strip().lstrip("#").strip()
        if stripped:
            return stripped
    return fallback


def _summarize_markdown(text: str, *, max_lines: int = 4) -> tuple[str, str]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    title = _extract_markdown_title(lines, "化验单")
    return title, "\n".join(lines[:max_lines])


def _summarize_findings(findings: Any) -> str:
    if not isinstance(findings, list):
        return ""
    labels: list[str] = []
    for item in findings[:5]:
        if isinstance(item, dict):
            label = str(item.get("label") or item.get("class") or item.get("disease") or "").strip()
        else:
            label = str(item).strip()
        if label:
            labels.append(label)
    return "; ".join(label for label in labels if label)


def _extract_report_findings(report_data: dict[str, Any]) -> list[Any]:
    ai_result = report_data.get("ai_result") if isinstance(report_data.get("ai_result"), dict) else {}
    if isinstance(ai_result, dict):
        findings = ai_result.get("findings")
        if isinstance(findings, list):
            return findings
    findings = report_data.get("findings")
    return findings if isinstance(findings, list) else []


def _extract_brain_title(filename: str, report_data: dict[str, Any]) -> str:
    viewer_kind = _normalize_text(report_data.get("viewer_kind"))
    pipeline = _normalize_text(report_data.get("pipeline"))
    modality = _normalize_text(report_data.get("modality"))
    if viewer_kind == "brain_spatial_review" or pipeline == "brain_nifti_v1" or modality.startswith("brain_mri"):
        return f"脑 MRI 3D 分析: {filename}"
    return f"影像分析: {filename}"


def _extract_review_status(report_data: dict[str, Any]) -> str:
    raw_status = _normalize_text(report_data.get("status")) or "completed"
    return raw_status.lower()


def _project_brain_report_fields(report_data: dict[str, Any]) -> dict[str, Any]:
    projected: dict[str, Any] = {}
    for key in (
        "report_id",
        "viewer_kind",
        "pipeline",
        "modality",
        "slice_png_path",
        "spatial_info",
        "source_upload_filename",
        "report_text",
    ):
        value = report_data.get(key)
        if value not in (None, "", [], {}):
            projected[key] = value
    projected["review_status"] = _extract_review_status(report_data)
    return projected


def _map_report_status(raw_status: str | None) -> str:
    normalized = (raw_status or "completed").strip().lower()
    if normalized in {"failed", "error"}:
        return "failed"
    if normalized in {"processing", "queued", "running"}:
        return "processing"
    return "completed"


def _load_patient_info(paths: Paths, thread_id: str) -> dict[str, Any]:
    intake_file = paths.sandbox_user_data_dir(thread_id) / "patient_intake.json"
    return _read_json(intake_file) or {}


def _build_guidance(patient_info: dict[str, Any], uploaded_items: list[dict[str, Any]]) -> dict[str, Any]:
    missing_required_fields = [label for key, label in REQUIRED_FIELDS if not _has_value(patient_info.get(key))]
    pending_files = [item["filename"] for item in uploaded_items if item["status"] == "processing"]
    failed_files = [item["filename"] for item in uploaded_items if item["status"] == "failed"]

    if missing_required_fields:
        stage = "collecting_info"
        next_action = f"请先补充：{'、'.join(missing_required_fields)}。"
        status_text = "基础信息尚未补齐，暂不建议做综合判断。"
    elif pending_files:
        stage = "processing_uploads"
        next_action = f"请等待这些资料解析完成：{'、'.join(pending_files)}。"
        status_text = "检查资料仍在处理中，暂不建议做综合判断。"
    elif failed_files:
        stage = "review_failed_uploads"
        next_action = f"请重新上传或人工确认这些资料：{'、'.join(failed_files)}。"
        status_text = "存在解析失败的资料，建议先处理后再做综合判断。"
    else:
        stage = "ready"
        next_action = "当前资料已基本齐全，可以继续咨询 AI 或提交给医生。"
        status_text = "当前记录已具备综合判断条件。"

    blocking_reasons = [*(f"缺少{field}" for field in missing_required_fields), *(f"待解析资料：{filename}" for filename in pending_files), *(f"解析失败资料：{filename}" for filename in failed_files)]

    return {
        "stage": stage,
        "ready_for_ai_summary": not blocking_reasons,
        "missing_required_fields": missing_required_fields,
        "pending_files": pending_files,
        "failed_files": failed_files,
        "next_action": next_action,
        "status_text": status_text,
        "blocking_reasons": blocking_reasons,
    }


def build_patient_record_snapshot(thread_id: str, *, paths: Paths | None = None) -> dict[str, Any]:
    resolved_paths = paths or get_paths()
    patient_info = _load_patient_info(resolved_paths, thread_id)

    uploads_dir = resolved_paths.sandbox_uploads_dir(thread_id)
    reports_dir = resolved_paths.sandbox_user_data_dir(thread_id) / "imaging-reports"

    reports_by_filename: dict[str, dict[str, Any]] = {}
    if reports_dir.exists():
        for report_file in sorted(reports_dir.glob("*.json")):
            report_data = _read_json(report_file)
            if not report_data:
                continue
            source_upload_filename = _normalize_text(report_data.get("source_upload_filename"))
            image_path = _normalize_text(report_data.get("image_path"))
            filename = source_upload_filename or (Path(image_path).name if image_path else "")
            if filename:
                reports_by_filename[filename] = report_data

    uploaded_items: list[dict[str, Any]] = []
    evidence_items: list[dict[str, Any]] = []

    if uploads_dir.exists():
        for upload_file in sorted(path for path in uploads_dir.iterdir() if _is_visible_upload(path)):
            meta = _read_json(uploads_dir / f"{upload_file.name}.meta.json") or {}
            report_data = reports_by_filename.get(upload_file.name)
            image_type = _normalize_text(meta.get("image_type")) or ""
            confidence = meta.get("image_confidence")
            report_status = _map_report_status(_normalize_text((report_data or {}).get("status"))) if report_data else None
            ocr_file = uploads_dir / f"{upload_file.name}.ocr.md"

            uploaded_item: dict[str, Any] = {
                "filename": upload_file.name,
                "image_type": image_type or ("document" if upload_file.suffix.lower() in DOCUMENT_EXTENSIONS else "unknown"),
                "status": "completed",
            }
            if confidence is not None:
                uploaded_item["image_confidence"] = confidence

            if ocr_file.exists():
                ocr_text = ocr_file.read_text(encoding="utf-8")
                title, ocr_summary = _summarize_markdown(ocr_text)
                uploaded_item["status"] = "completed"
                uploaded_item["analysis_summary"] = ocr_summary
                evidence_items.append(
                    {
                        "id": f"lab_{upload_file.name}",
                        "type": "lab_report",
                        "title": title or f"化验单: {upload_file.name}",
                        "filename": upload_file.name,
                        "status": "completed",
                        "is_abnormal": False,
                        "ocr_summary": ocr_summary,
                        "image_type": uploaded_item["image_type"],
                    }
                )
            elif report_data:
                findings = _extract_report_findings(report_data)
                findings_brief = _summarize_findings(findings)
                status = report_status or "completed"
                uploaded_item["status"] = status
                uploaded_item["analysis_summary"] = findings_brief
                evidence_item = {
                    "id": _normalize_text(report_data.get("report_id")) or upload_file.stem,
                    "type": "imaging",
                    "title": _extract_brain_title(upload_file.name, report_data),
                    "filename": upload_file.name,
                    "status": status,
                    "is_abnormal": bool(findings),
                    "findings_brief": findings_brief,
                    "findings_count": len(findings),
                    "image_type": uploaded_item["image_type"],
                    **_project_brain_report_fields(report_data),
                }
                evidence_items.append(evidence_item)
            elif _is_image_like(upload_file.name, image_type):
                uploaded_item["status"] = "processing"
                evidence_items.append(
                    {
                        "id": f"pending_{upload_file.name}",
                        "type": "pending",
                        "title": f"处理中: {upload_file.name}",
                        "filename": upload_file.name,
                        "status": "processing",
                        "is_abnormal": False,
                        "image_type": uploaded_item["image_type"],
                    }
                )
            else:
                uploaded_item["status"] = "completed"

            uploaded_items.append(uploaded_item)

    guidance = _build_guidance(patient_info, uploaded_items)

    return {
        "thread_id": thread_id,
        "patient_info": patient_info,
        "evidence_items": evidence_items,
        "uploaded_items": uploaded_items,
        "guidance": guidance,
    }


def has_patient_record_content(snapshot: dict[str, Any]) -> bool:
    patient_info = snapshot.get("patient_info") or {}
    uploaded_items = snapshot.get("uploaded_items") or []
    return any(_has_value(value) for value in patient_info.values()) or bool(uploaded_items)


def format_patient_record_block(snapshot: dict[str, Any]) -> str:
    if not has_patient_record_content(snapshot):
        return ""

    patient_info = snapshot.get("patient_info") or {}
    uploaded_items = snapshot.get("uploaded_items") or []
    guidance = snapshot.get("guidance") or {}

    lines = ["<patient_record>", "当前患者记录快照：", ""]
    lines.append("患者表单信息：")
    for key, label in DISPLAY_FIELDS:
        value = _normalize_text(patient_info.get(key))
        if value:
            lines.append(f"- {label}: {value}")
    if lines[-1] == "患者表单信息：":
        lines.append("- 暂无已保存的表单信息")

    if uploaded_items:
        lines.extend(["", "上传资料摘要："])
        for item in uploaded_items:
            lines.append(f"- 文件: {item['filename']}")
            lines.append(f"  图片类型: {_normalize_text(item.get('image_type')) or 'unknown'}")
            lines.append(f"  处理状态: {_normalize_text(item.get('status')) or 'unknown'}")
            summary = _normalize_text(item.get("analysis_summary"))
            if summary:
                lines.append(f"  摘要: {summary}")

    lines.extend(
        [
            "",
            f"综合判断状态: {'ready' if guidance.get('ready_for_ai_summary') else 'pending'}",
            f"状态说明: {_normalize_text(guidance.get('status_text'))}",
        ]
    )

    missing_fields = guidance.get("missing_required_fields") or []
    if missing_fields:
        lines.append(f"缺失关键信息: {'、'.join(missing_fields)}")

    pending_files = guidance.get("pending_files") or []
    if pending_files:
        lines.append(f"待解析资料: {'、'.join(pending_files)}")

    next_action = _normalize_text(guidance.get("next_action"))
    if next_action:
        lines.append(f"下一步建议: {next_action}")

    lines.append("</patient_record>")
    return "\n".join(lines)