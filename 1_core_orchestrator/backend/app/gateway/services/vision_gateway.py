"""Chinese-CLIP 分类 + OpenCV 增强

使用达摩院 Chinese-CLIP (OFA-Sys/chinese-clip-vit-base-patch16) 实现
中文医疗图片零样本分类，以及 OpenCV 图像增强（化验单二值化、影像 CLAHE）。

设计决策：
- @lru_cache 单例加载模型，Gateway 启动时通过 warmup() 预热
- classify_image 用 asyncio.to_thread 避免阻塞事件循环
- enhance 函数为同步，由调用方决定是否用 to_thread 包装
- 使用 numpy.fromfile + cv2.imdecode 代替 cv2.imread，
  解决 Windows 上 OpenCV 无法读取中文路径的问题
"""

import asyncio
import os
import cv2
from loguru import logger
import numpy as np
from functools import lru_cache
from pathlib import Path


# 中文分类标签（Chinese-CLIP 原生支持中文）
# 提高区分度，防止胸片被误判为临床照片
LABELS = ["化验单检验报告", "X光CT超声医学影像", "脑部核磁共振MRI图像", "临床病理部位照片", "其他无关日常图片"]
CATEGORY_MAP = {
    "化验单检验报告": "lab_report",
    "X光CT超声医学影像": "medical_imaging",
    "脑部核磁共振MRI图像": "brain_mri",
    "临床病理部位照片": "clinical_photo",
    "其他无关日常图片": "other",
}

def _imread_unicode(path: str) -> np.ndarray | None:
    """读取图片（兼容中文路径）"""
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_GRAYSCALE)

def _imwrite_unicode(path: str, img: np.ndarray) -> bool:
    """写入图片（兼容中文路径）"""
    ext = Path(path).suffix  # e.g. ".jpg", ".png"
    success, buf = cv2.imencode(ext, img)
    if success:
        buf.tofile(path)
    return success

@lru_cache(maxsize=1)
def _load_classifier():
    """加载 Chinese-CLIP 模型（启动时预热，运行时直接命中缓存）"""
    # 注入国内镜像加速与防断连策略
    os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    from transformers import pipeline

    return pipeline(
        "zero-shot-image-classification",
        model="OFA-Sys/chinese-clip-vit-base-patch16",
    )

def warmup():
    """Gateway 启动时调用，预热模型（避免首次上传卡顿）"""
    logger.info("正在预热 Chinese-CLIP 模型...")
    _load_classifier()
    logger.info("Chinese-CLIP 模型预热完成")

def _classify_sync(image_path: str) -> dict:
    """同步分类（在线程池中执行）"""
    clf = _load_classifier()
    results = clf(image_path, candidate_labels=LABELS)
    top_label = results[0]["label"]
    return {
        "category": CATEGORY_MAP.get(top_label, "other"),  # fallback to other instead of clinical_photo to be safe
        "confidence": round(float(results[0]["score"]), 3),
    }

async def classify_image(path: str) -> dict:
    """异步分类（线程池隔离，不阻塞事件循环）"""
    return await asyncio.to_thread(_classify_sync, path)

def enhance_lab_report(src: str, dst: str) -> str:
    """化验单增强：去噪 + 自适应二值化 → 清晰黑白扫描件"""
    img = _imread_unicode(src)
    if img is None:
        raise FileNotFoundError(f"图片不存在或无法读取: {src}")
    denoised = cv2.GaussianBlur(img, (3, 3), 0)
    binary = cv2.adaptiveThreshold(
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, 8
    )
    _imwrite_unicode(dst, binary)
    return dst

def enhance_medical_imaging(src: str, dst: str) -> str:
    """医学影像增强：CLAHE 锐化"""
    img = _imread_unicode(src)
    if img is None:
        raise FileNotFoundError(f"图片不存在或无法读取: {src}")
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    _imwrite_unicode(dst, clahe.apply(img))
    return dst
