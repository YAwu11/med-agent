"""VLM Fallback analyzer for unrecognized clinical photos or general documents."""

import base64
from loguru import logger
import os

import httpx

from app.gateway.services.analyzer_registry import AnalysisResult


SILICONFLOW_API_URL = "https://api.siliconflow.cn/v1/chat/completions"
# Using Qwen2.5-VL-72B for general robust instruction following and visual understanding.
MODEL_NAME = os.getenv("SILICONFLOW_VLM_MODEL", "Qwen/Qwen2.5-VL-72B-Instruct")

class VLMFallbackAnalyzer:
    """Uses a foundation Vision-Language Model to provide open-ended descriptions for unrecognized clinical photos."""
    
    PROMPT = (
        "你是一位医学临床专家助理。请仔细观察这张图片，判断它是否包含医学相关内容"
        "（如皮肤病变、外伤照片、不规则报告单、处方单、药物外包装等）。\n"
        "如果包含医学内容，请以专业严谨的口吻详细描述你看到的关键医学信息、异常表征或文本细节。\n"
        "如果不是医学内容，请简要说明图片内容（例如：'这是一张普通的风景照'）。\n\n"
        "请直接输出你的观察结论，使用 Markdown 格式排版，确保结构清晰易读。"
    )

    def _encode_image(self, image_path: str) -> str:
        """Read and Base64-encode the image file."""
        with open(image_path, "rb") as image_file:
            encoded_string = base64.b64encode(image_file.read()).decode("utf-8")
        return encoded_string

    async def analyze(self, image_path: str, thread_id: str, original_filename: str) -> AnalysisResult:
        api_key = os.getenv("SILICONFLOW_API_KEY", "")
        if not api_key:
            return AnalysisResult(
                filename=original_filename, category="", confidence=0.0,
                analyzer_name="", evidence_type="note", evidence_title=original_filename,
                error="VLM fallback skipped: SILICONFLOW_API_KEY not configured"
            )

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        try:
            base64_image = self._encode_image(image_path)
        except Exception as e:
            logger.error(f"Failed to read image for VLM: {e}")
            return AnalysisResult(
                filename=original_filename, category="", confidence=0.0,
                analyzer_name="", evidence_type="note", evidence_title=original_filename,
                error=f"File read error: {e}"
            )

        # Image MIME type guess based on extension, fallback to jpeg
        mime_type = "image/jpeg"
        if image_path.lower().endswith(".png"):
            mime_type = "image/png"
        elif image_path.lower().endswith(".webp"):
            mime_type = "image/webp"

        image_url = f"data:{mime_type};base64,{base64_image}"

        payload = {
            "model": MODEL_NAME,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": image_url
                            }
                        },
                        {
                            "type": "text",
                            "text": self.PROMPT
                        }
                    ]
                }
            ],
            # Standard params for deterministic and safe description
            "temperature": 0.2,
            "max_tokens": 1024,
        }

        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                response = await client.post(SILICONFLOW_API_URL, json=payload, headers=headers)
                response.raise_for_status()

                data = response.json()
                content = data["choices"][0]["message"]["content"]
                
                logger.info(f"VLM Fallback completed for {original_filename}, response length: {len(content)}")

                return AnalysisResult(
                    filename=original_filename,
                    category="", # Overwritten by registry dispatcher
                    confidence=0.0,
                    analyzer_name="",
                    evidence_type="note",
                    evidence_title=f"图片描述 ({original_filename})",
                    ai_analysis_text=content,
                    is_abnormal=False # Let doctor decide for notes
                )

        except httpx.HTTPStatusError as e:
            logger.error(f"SiliconFlow HTTP Error {e.response.status_code}: {e.response.text}")
            return AnalysisResult(
                filename=original_filename, category="", confidence=0.0,
                analyzer_name="", evidence_type="note", evidence_title=original_filename,
                error=f"API Error: {e.response.status_code}"
            )
        except Exception as e:
            logger.error(f"VLM Fallback failed for {original_filename}: {e}", exc_info=True)
            return AnalysisResult(
                filename=original_filename, category="", confidence=0.0,
                analyzer_name="", evidence_type="note", evidence_title=original_filename,
                error=str(e)
            )
