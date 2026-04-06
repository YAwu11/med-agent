import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from loguru import logger

from app.core.config.paths import get_paths
from app.gateway.services.analyzers.brain_tumor_reporter import generate_brain_report
from app.gateway.services.case_db import get_case, sync_report_from_file, update_evidence_data, update_report


router = APIRouter(prefix="/api/cases/{case_id}", tags=["brain-report"])

class BrainReportRequest(BaseModel):
    """医生审核确认后提交的空间数据（可能已被医生修正）。"""
    evidence_id: str
    spatial_info: dict      # 医生确认/修正后的空间数据
    slice_png_path: str     # Step 3 产出的切片图路径

@router.post("/brain-report")
async def generate_brain_report_endpoint(
    case_id: str,
    request: BrainReportRequest,
):
    """医生确认空间数据后，调用 Step 4 生成最终报告。"""
    logger.info(f"Generating brain report for case {case_id}, evidence {request.evidence_id}")
    
    try:
        case = get_case(case_id)
        if not case:
            raise HTTPException(status_code=404, detail=f"病例不存在: {case_id}")

        evidence_item = next((item for item in case.evidence if item.evidence_id == request.evidence_id), None)
        if not evidence_item:
            raise HTTPException(status_code=404, detail=f"证据不存在: {request.evidence_id}")

        existing_structured = evidence_item.structured_data if isinstance(evidence_item.structured_data, dict) else {}
        report_id = str(existing_structured.get("report_id") or request.evidence_id)

        report = await generate_brain_report(
            spatial_info=request.spatial_info,
            slice_png_path=request.slice_png_path,
        )

        report_result = {
            "status": "reviewed",
            "report_text": report["report_text"],
            "cross_check_passed": report["cross_check_passed"],
            "spatial_info": request.spatial_info,
            "slice_png_path": request.slice_png_path,
        }

        merged_structured_data = {
            **existing_structured,
            "pipeline": str(existing_structured.get("pipeline") or "brain_nifti_v1"),
            "modality": str(existing_structured.get("modality") or "brain_mri_3d"),
            "viewer_kind": str(existing_structured.get("viewer_kind") or "brain_spatial_review"),
            "report_id": report_id,
            "status": "reviewed",
            "slice_png_path": request.slice_png_path,
            "spatial_info": request.spatial_info,
            "cross_check_passed": report["cross_check_passed"],
            "report_text": report["report_text"],
        }
        
        # 更新 evidence 的 ai_analysis_text 为生成的报告
        update_evidence_data(case_id, request.evidence_id, {
            "ai_analysis": report["report_text"],
            "structured_data": merged_structured_data,
        })

        reports_dir = get_paths().sandbox_user_data_dir(case.patient_thread_id) / "imaging-reports"
        reports_dir.mkdir(parents=True, exist_ok=True)
        report_file = reports_dir / f"{report_id}.json"
        if report_file.exists():
            sync_report_from_file(case.patient_thread_id, report_file)

        report_file_data = {
            "report_id": report_id,
            "thread_id": case.patient_thread_id,
            "status": "reviewed",
            "image_path": request.slice_png_path or str(evidence_item.file_path or ""),
            "source_upload_filename": Path(str(evidence_item.file_path or "")).name,
            "modality": str(existing_structured.get("modality") or "brain_mri_3d"),
            "viewer_kind": str(existing_structured.get("viewer_kind") or "brain_spatial_review"),
            "ai_result": {},
            "doctor_result": report_result,
        }
        if report_file.exists():
            try:
                existing_file_data = json.loads(report_file.read_text(encoding="utf-8"))
                if isinstance(existing_file_data, dict):
                    report_file_data = {
                        **existing_file_data,
                        **report_file_data,
                        "doctor_result": report_result,
                        "status": "reviewed",
                    }
            except (OSError, json.JSONDecodeError):
                logger.warning(f"Failed to read existing brain report file: {report_file}")

        report_file.write_text(
            json.dumps(report_file_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        sync_report_from_file(case.patient_thread_id, report_file)
        update_report(report_id, report_result)
        
        return {"status": "ok", "report": report}
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        logger.error(f"Failed to generate brain report: {e}")
        raise HTTPException(status_code=500, detail=f"生成报告失败: {str(e)}")
