"""百度医疗报告 OCR 异步客户端

调用百度 AI 开放平台的 medical_report_detection 接口，
将增强后的化验单图片识别为结构化 JSON。

设计决策：
- Token 内存缓存（有效期 30 天，提前 5 分钟刷新）
- 不加 asyncio.Lock：并发 refresh 是幂等的，最坏情况多一次 HTTP 请求
- tenacity 2 次自动重试 + 指数退避，应对网络抖动
"""

import base64
from loguru import logger
import os
import time

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential


_token_cache: dict = {"token": None, "expires_at": 0}

BAIDU_TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"
BAIDU_OCR_URL = (
    "https://aip.baidubce.com/rest/2.0/ocr/v1/medical_report_detection"
)

async def _get_access_token() -> str:
    """获取百度 Access Token（带内存缓存）"""
    if _token_cache["token"] and time.time() < _token_cache["expires_at"]:
        return _token_cache["token"]

    api_key = os.getenv("BAIDU_OCR_API_KEY")
    secret_key = os.getenv("BAIDU_OCR_SECRET_KEY")
    if not api_key or not secret_key:
        raise ValueError(
            "BAIDU_OCR_API_KEY / BAIDU_OCR_SECRET_KEY 未配置。"
            "请在 .env 文件中设置。"
        )

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            BAIDU_TOKEN_URL,
            params={
                "grant_type": "client_credentials",
                "client_id": api_key,
                "client_secret": secret_key,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    _token_cache["token"] = data["access_token"]
    # 提前 5 分钟刷新（默认有效期 30 天 = 2592000 秒）
    _token_cache["expires_at"] = (
        time.time() + data.get("expires_in", 2592000) - 300
    )
    logger.info("百度 OCR Access Token 已刷新")
    return _token_cache["token"]

@retry(
    stop=stop_after_attempt(2),
    wait=wait_exponential(min=1, max=5),
    reraise=True,
)
async def fetch_medical_report_ocr(image_path: str) -> dict | None:
    """调用百度医疗报告 OCR 识别图片

    Args:
        image_path: 增强后的图片本地路径

    Returns:
        百度 OCR 返回的 JSON dict，失败返回 None
    """
    token = await _get_access_token()

    with open(image_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{BAIDU_OCR_URL}?access_token={token}",
            data={"image": img_b64},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        result = resp.json()

    if "error_code" in result:
        logger.error(
            "百度 OCR 错误: %s - %s",
            result["error_code"],
            result.get("error_msg"),
        )
        return None

    return result
