"""化验单/文字报告专用的图像压缩与锐化前置处理引擎。

架构决策 (ADR-032):
- 本模块只被 CLIP 标签为 "lab_report" / "document" 的分析管道调用，
  绝不触碰 X光/CT/MRI 等纹理敏感的医学影像。
- 原图始终保持无损落盘（在 uploads/ 目录），本模块产出的优化图
  存放在 outputs/ 临时沙盒中，用尽即弃。
- 压缩策略三板斧：灰度化(L模式) → 长边封顶2048 → Lanczos重采样+锐化
  可将 8MB 的 4K 化验单照片压制到 150KB~400KB，
  同时保持文字边缘锐度以保障 OCR 精度。

依赖：Pillow (已在项目依赖中)
"""

import logging
import os
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

logger = logging.getLogger(__name__)

# ── 可调参数 ────────────────────────────────────────────────
# 通过环境变量覆盖，方便不同部署环境微调
MAX_LONG_EDGE = int(os.getenv("LAB_IMG_MAX_EDGE", "2048"))
JPEG_QUALITY = int(os.getenv("LAB_IMG_JPEG_QUALITY", "85"))
SHARPEN_FACTOR = float(os.getenv("LAB_IMG_SHARPEN", "1.3"))
# 小于此字节数的图片直接跳过压缩（避免对已经很小的图片做无用功）
SKIP_THRESHOLD_BYTES = int(os.getenv("LAB_IMG_SKIP_BYTES", "500000"))  # 500KB


def optimize_lab_image(
    src_path: str,
    dst_path: str | None = None,
    *,
    grayscale: bool = True,
    max_edge: int = MAX_LONG_EDGE,
    quality: int = JPEG_QUALITY,
    sharpen: float = SHARPEN_FACTOR,
) -> str:
    """将化验单照片进行极限压缩优化，输出为标准化的 JPEG/WebP 文件。

    Args:
        src_path:   原图的绝对路径（不会被修改或删除）
        dst_path:   优化图的输出路径。为 None 时自动生成同级目录下的
                    `{stem}_ocr_opt.jpg` 文件。
        grayscale:  是否转为灰度图（化验单推荐 True）
        max_edge:   长边像素上限，超出则等比缩放
        quality:    JPEG 压缩质量 (1-100)
        sharpen:    锐化增益系数 (1.0=不锐化, 1.3=轻度, 2.0=强烈)

    Returns:
        优化后图片的绝对路径字符串

    Raises:
        FileNotFoundError: 原图不存在
        PIL.UnidentifiedImageError: 无法识别的图片格式
    """
    src = Path(src_path)
    if not src.exists():
        raise FileNotFoundError(f"原图不存在: {src_path}")

    file_size = src.stat().st_size

    # 短路逻辑：图片已经足够小，跳过压缩直接返回原路径
    if file_size <= SKIP_THRESHOLD_BYTES:
        logger.info(
            f"[ImageOptimizer] 跳过压缩 ({file_size / 1024:.0f}KB < "
            f"{SKIP_THRESHOLD_BYTES / 1024:.0f}KB 阈值): {src.name}"
        )
        return src_path

    # ── Step 1: 打开原图 ──────────────────────────────────
    img = Image.open(src_path)
    original_size = img.size  # (width, height)
    logger.info(
        f"[ImageOptimizer] 开始处理: {src.name} "
        f"({original_size[0]}x{original_size[1]}, {file_size / 1024:.0f}KB)"
    )

    # ── Step 2: 灰度化 ───────────────────────────────────
    # 化验单是黑白打印的，丢弃 RGB 三通道可以直接减去 2/3 的数据量
    if grayscale:
        img = img.convert("L")
    else:
        # 即使不灰度化，也要确保是 RGB（去掉 RGBA 的 alpha 通道）
        img = img.convert("RGB")

    # ── Step 3: 长边封顶等比缩放 ──────────────────────────
    w, h = img.size
    long_edge = max(w, h)
    if long_edge > max_edge:
        scale = max_edge / long_edge
        new_w = int(w * scale)
        new_h = int(h * scale)
        # Lanczos 是缩小图像时保留边缘锐度最优秀的插值算法
        img = img.resize((new_w, new_h), Image.LANCZOS)
        logger.info(
            f"[ImageOptimizer] 缩放: {w}x{h} → {new_w}x{new_h} "
            f"(Lanczos, scale={scale:.2f})"
        )

    # ── Step 4: 轻度锐化 ─────────────────────────────────
    # 缩放后文字边缘可能轻微模糊，锐化补偿确保
    # 小数点 '.' 逗号 ',' 和数字 '1' 'l' 不会被 OCR 混淆
    if sharpen > 1.0:
        enhancer = ImageEnhance.Sharpness(img)
        img = enhancer.enhance(sharpen)

    # ── Step 5: 输出压缩 ─────────────────────────────────
    if dst_path is None:
        dst_path = str(src.parent / f"{src.stem}_ocr_opt.jpg")

    dst = Path(dst_path)
    dst.parent.mkdir(parents=True, exist_ok=True)

    # 保存为 JPEG（灰度图也兼容）
    save_kwargs = {
        "quality": quality,
        "optimize": True,
    }
    # 灰度图不存在子采样问题，但 RGB 图需要关闭色度子采样以保留细节
    if not grayscale:
        save_kwargs["subsampling"] = 0  # 4:4:4 无损色度

    img.save(dst_path, format="JPEG", **save_kwargs)

    result_size = dst.stat().st_size
    ratio = (1 - result_size / file_size) * 100

    logger.info(
        f"[ImageOptimizer] 完成: {src.name} → {dst.name} "
        f"({file_size / 1024:.0f}KB → {result_size / 1024:.0f}KB, "
        f"压缩率 {ratio:.1f}%)"
    )

    return str(dst)
