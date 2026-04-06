"""
医生端综合诊断 SSE 端点。

完全脱离 DeerFlow / LangGraph 框架，仅使用：
  - langchain_openai.ChatOpenAI（调用 SiliconFlow API）
  - aiohttp（调用 RAGFlow Lite）
  - FastAPI StreamingResponse（SSE 流式输出）

流程：
  1. 聚合病例信息生成结构化摘要
  2. 构造 system prompt + 病例摘要 → 发送给 LLM
  3. LLM 自主决策是否调用 rag_retrieve 工具
  4. 如果调用 → 执行 RAG 检索 → 结果喂回 LLM
  5. LLM 生成最终诊断报告 → SSE 流式返回
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import aiohttp
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI

from app.gateway.services import case_db

# 复用 cases.py 中的摘要构建逻辑
from app.gateway.routers.cases import _build_summary_readiness, _format_evidence_sections

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/doctor", tags=["doctor-synthesis"])

# ── 配置 ──────────────────────────────────────────────────────

RAGFLOW_URL = os.getenv("RAGFLOW_URL", "http://127.0.0.1:9380")

# RAG 工具的 JSON Schema，用于 bind_tools 让 LLM 自主决定是否调用
_RAG_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "rag_retrieve",
        "description": "从医学知识库中检索与问题相关的诊疗指南、药物信息、检验参考值等专业资料。当你需要查阅医学文献或指南来支撑诊断时使用此工具。",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "要检索的医学问题，应尽量具体",
                },
                "mode": {
                    "type": "string",
                    "enum": ["fast", "hybrid", "deep"],
                    "description": "检索模式：fast=低延迟, hybrid=含知识图谱(默认), deep=含CRAG纠错",
                },
                "top_k": {
                    "type": "integer",
                    "description": "返回结果数量，默认5",
                },
            },
            "required": ["query"],
        },
    },
}

DOCTOR_SYNTHESIS_PROMPT = """\
你是一位经验丰富的主治医师 AI 助手。你的任务是基于提供的完整病例资料，为主治医师出具一份结构化的综合诊断分析报告。

**重要**：你可以使用 `rag_retrieve` 工具查询医学知识库来辅助你的诊断分析。你应该根据病例情况自行决定是否需要检索、检索什么内容。例如：
- 对异常检验值的临床意义不确定时
- 需要查阅相关诊疗指南或最佳实践时
- 需要确认鉴别诊断的标准时

你可以多次调用工具，也可以完全不调用（如果病例信息已足够明确）。

报告格式要求：

## 综合诊断分析

### 1. 病情概要
（一段话总结患者基本信息、主诉和关键检查发现）

### 2. 诊断意见
- **主诊断**：
- **鉴别诊断**：（列出需排除的其他可能诊断）

### 3. 依据分析
（逐条列出支持诊断的关键依据，标注来源：病史/化验/影像/知识库）

### 4. 建议进一步检查
（如有需要）

### 5. 初步治疗方案建议

### 6. 注意事项与风险提示

---
⚠️ 本报告由 AI 生成，仅供临床参考，最终诊断请以主治医师判断为准。
"""

# ── 辅助函数 ───────────────────────────────────────────────────


def _build_case_summary(case) -> str:
    """将病例数据聚合为 Markdown 摘要文本（复用 cases.py 中的逻辑）。"""
    p = case.patient_info
    sections: list[str] = []

    # 1. 患者基本信息
    sections.append("## 患者基本信息")
    info_lines: list[str] = []
    if p.name:
        info_lines.append(f"- 姓名: {p.name}")
    if p.age:
        info_lines.append(f"- 年龄: {p.age}岁")
    if p.sex:
        info_lines.append(f"- 性别: {p.sex}")
    if p.height_cm:
        info_lines.append(f"- 身高: {p.height_cm}cm")
    if p.weight_kg:
        info_lines.append(f"- 体重: {p.weight_kg}kg")
    sections.append("\n".join(info_lines) if info_lines else "- 无基本信息")

    # 2. 生命体征
    vitals: list[str] = []
    if p.temperature:
        vitals.append(f"- 体温: {p.temperature}°C")
    if p.heart_rate:
        vitals.append(f"- 心率: {p.heart_rate} bpm")
    if p.blood_pressure:
        vitals.append(f"- 血压: {p.blood_pressure} mmHg")
    if p.spo2:
        vitals.append(f"- 血氧: {p.spo2}%")
    if vitals:
        sections.append("## 生命体征")
        sections.append("\n".join(vitals))

    # 3. 病史
    if p.chief_complaint:
        sections.append(f"## 主诉\n{p.chief_complaint}")
    if p.present_illness:
        sections.append(f"## 现病史\n{p.present_illness}")
    if p.medical_history:
        sections.append(f"## 既往史\n{p.medical_history}")
    if p.allergies:
        sections.append(f"## 过敏与用药\n{p.allergies}")

    # 4. 临床证据汇总
    if case.evidence:
        sections.append(f"## 临床证据 ({len(case.evidence)} 项)")
        for i, ev in enumerate(case.evidence, 1):
            ev_header = f"### {i}. [{ev.type.upper()}] {ev.title}"
            if ev.is_abnormal:
                ev_header += " ⚠️ 异常"
            sections.append(ev_header)
            sections.extend(_format_evidence_sections(ev))

    # 5. 已有诊断（如有）
    if case.diagnosis:
        sections.append("## 已有诊断结论")
        sections.append(f"- 主诊断: {case.diagnosis.primary_diagnosis}")
        if case.diagnosis.secondary_diagnoses:
            sections.append(f"- 次要诊断: {', '.join(case.diagnosis.secondary_diagnoses)}")
        if case.diagnosis.treatment_plan:
            sections.append(f"- 治疗方案: {case.diagnosis.treatment_plan}")

    return "\n\n".join(sections)


def _create_model() -> ChatOpenAI:
    """创建绑定了 RAG 工具的 ChatOpenAI 实例。"""
    api_key = os.getenv("SILICONFLOW_API_KEY")
    if not api_key:
        raise RuntimeError("SILICONFLOW_API_KEY 环境变量未设置")

    model = ChatOpenAI(
        model="Qwen/Qwen3.5-397B-A17B",
        api_key=api_key,
        base_url="https://api.siliconflow.cn/v1",
        max_tokens=8192,
        temperature=0.7,
        streaming=True,
    )
    # 绑定 RAG 工具 schema，让 LLM 自主决定是否调用
    return model.bind_tools([_RAG_TOOL_SCHEMA])


async def _execute_rag(args: dict[str, Any]) -> str:
    """直接 HTTP 调用 RAGFlow Lite，不经过 LangChain tool 包装。"""
    query = args.get("query", "").strip()
    if not query:
        return "请提供具体的检索问题。"

    mode = args.get("mode", "hybrid")
    if mode not in ("fast", "hybrid", "deep"):
        mode = "hybrid"
    top_k = args.get("top_k", 5)

    payload = {
        "query": query,
        "kb_ids": [],
        "mode": mode,
        "top_k": top_k,
        "folder": "",
        "enable_web_search": False,
    }

    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(f"{RAGFLOW_URL}/api/tool/retrieve", json=payload) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    logger.error(f"RAG retrieve HTTP {resp.status}: {text[:200]}")
                    return f"知识库检索失败 (HTTP {resp.status})。"
                data = await resp.json()

        answer_context = data.get("answer_context", "")
        if not answer_context or answer_context.strip() == "":
            return "知识库中未找到与该问题相关的内容。"

        # 附加检索元数据
        metadata = data.get("metadata", {})
        latency = metadata.get("latency_ms", 0)
        source_count = metadata.get("source_count", 0)
        footer = f"\n\n---\n检索模式: {mode} | 来源数: {source_count} | 耗时: {latency}ms"
        return answer_context + footer

    except TimeoutError:
        logger.warning(f"RAG retrieve timeout: {RAGFLOW_URL}")
        return "知识库检索超时，请稍后重试。"
    except aiohttp.ClientError as e:
        logger.error(f"RAG retrieve connection error: {e}")
        return f"知识库连接失败: {e}"
    except Exception as e:
        logger.error(f"RAG retrieve error: {e}", exc_info=True)
        return f"知识库检索内部错误: {e}"


def _sse_event(data: dict) -> str:
    """格式化一个 SSE data 行。"""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


# ── 核心端点 ───────────────────────────────────────────────────


@router.post("/synthesize")
async def synthesize(payload: dict):
    """医生端综合诊断 SSE 流式端点。

    请求体: { "case_id": "xxx" }

    SSE 事件格式:
      - {"type": "status", "text": "..."} — 进度状态
      - {"type": "tool_call", "name": "...", "query": "..."} — 工具调用通知
      - {"type": "token", "content": "..."} — LLM 输出 token
      - {"type": "done"} — 完成
      - {"type": "error", "message": "..."} — 错误
    """
    case_id = payload.get("case_id")
    if not case_id:
        raise HTTPException(status_code=400, detail="case_id is required")

    # 1. 获取病例数据
    case = case_db.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")

    # 2. 检查资料完整性
    readiness = _build_summary_readiness(case)
    if not readiness["ready_for_synthesis"]:
        raise HTTPException(status_code=409, detail=readiness["status_text"])

    async def event_stream():
        try:
            # 3. 构建病例摘要
            yield _sse_event({"type": "status", "text": "正在聚合病例资料..."})
            summary = _build_case_summary(case)

            # 4. 创建 LLM（带 RAG 工具绑定）
            model = _create_model()

            # 5. 构造初始消息
            messages: list = [
                SystemMessage(content=DOCTOR_SYNTHESIS_PROMPT),
                HumanMessage(content=f"请对以下病例进行综合诊断分析：\n\n{summary}"),
            ]

            yield _sse_event({"type": "status", "text": "AI 分析中..."})

            # 6. 极简 Agent 循环：最多 5 轮工具调用
            #    - 工具调用轮：用 ainvoke（非流式），快速拿到 tool_calls
            #    - 最终输出轮：直接用已有结果，避免重复推理
            max_tool_rounds = 5
            final_content = ""

            for round_idx in range(max_tool_rounds):
                response: AIMessage = await model.ainvoke(messages)

                if not response.tool_calls:
                    # 没有工具调用 → 这就是最终回答
                    final_content = response.content or ""
                    break

                # 有工具调用 → 执行工具并继续循环
                messages.append(response)
                for tc in response.tool_calls:
                    tool_name = tc.get("name", "unknown")
                    tool_args = tc.get("args", {})
                    tool_call_id = tc.get("id", "")

                    if tool_name == "rag_retrieve":
                        query = tool_args.get("query", "")
                        yield _sse_event({
                            "type": "tool_call",
                            "name": "rag_retrieve",
                            "query": query,
                        })
                        yield _sse_event({"type": "status", "text": f"正在检索知识库：{query[:50]}..."})

                        result = await _execute_rag(tool_args)
                        messages.append(ToolMessage(
                            content=result,
                            tool_call_id=tool_call_id,
                            name="rag_retrieve",
                        ))
                    else:
                        # 未知工具 → 返回提示
                        messages.append(ToolMessage(
                            content=f"未知工具: {tool_name}",
                            tool_call_id=tool_call_id,
                            name=tool_name,
                        ))

            # 7. 输出诊断报告
            yield _sse_event({"type": "status", "text": "正在生成诊断报告..."})

            if final_content:
                # ainvoke 已经拿到了完整结果，直接分块发送
                # 模拟流式效果：按行发送，避免一次性 dump 超大 JSON
                for line in final_content.split("\n"):
                    yield _sse_event({"type": "token", "content": line + "\n"})
            else:
                # 走到这里说明 5 轮工具调用都用完了但 LLM 没给出最终答案
                # 最后一轮流式调用（不绑定工具，强制生成文本）
                plain_model = ChatOpenAI(
                    model="Qwen/Qwen3.5-397B-A17B",
                    api_key=os.getenv("SILICONFLOW_API_KEY"),
                    base_url="https://api.siliconflow.cn/v1",
                    max_tokens=8192,
                    temperature=0.7,
                    streaming=True,
                )
                async for chunk in plain_model.astream(messages):
                    content = chunk.content
                    if content:
                        yield _sse_event({"type": "token", "content": content})

            yield _sse_event({"type": "done"})

        except Exception as e:
            logger.exception(f"Synthesis failed for case {case_id}")
            yield _sse_event({"type": "error", "message": str(e)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
