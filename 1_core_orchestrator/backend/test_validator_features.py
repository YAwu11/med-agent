import asyncio
import json
from app.gateway.services.lab_value_validator import validate_lab_values

def run_test():
    # 模拟 Qwen 生成的包含各种结构化污染的 Markdown
    # 污染点 1: 白细胞 5.O (受到 'O' 字母污染)
    # 污染点 2: 淋巴细胞 17.5 应该有 ↓ 但是这里没有 (需要提示缺失箭头)
    # 污染点 3: 血小板 1OO (受到 'O' 字母污染，同时超高却未被大模型标箭头，复合错误)
    # 全局通信: 末尾追加了一列 "数据类型"
    mock_qwen_markdown = """# 血常规检验报告

| 序号 | 检验项目 | 英文 | 结果 | 参考区间 | 单位 | 数据类型 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 白细胞计数 | WBC | 5.O | 3.5-9.5 | ×10⁹/L | 数值 |
| 2 | 红细胞计数 | RBC | 4.5 | 4.3-5.8 | ×10¹²/L | 数值 |
| 3 | 淋巴细胞百分数 | LY% | 17.5 | 20-50 | % | 数值 |
| 4 | 血小板计数 | PLT | 1OO | 125-350 | ×10⁹/L | 数值 |
| 5 | 乙肝表面抗体 | 抗-HBs | 强阳性 | 阴性 | IU/L | 文本 |
"""

    # 模拟 PaddleOCR 原始数值包（用于双源对账）
    # 在真实 OCR 中，5.0 可能被正确识别，或者血小板被提取为 100
    mock_ocr_raw_numbers = ["5.0", "4.5", "17.5", "100"]

    print("===========================================")
    print("🚀 开始进行实验室纠错防伪功能测试...")
    print("===========================================")
    
    print("\n[原文输入]:")
    print("----")
    print(mock_qwen_markdown.strip())
    print("----")
    
    # 执行校验器
    final_markdown, warnings = validate_lab_values(mock_qwen_markdown, mock_ocr_raw_numbers)
    
    print("\n[清洗且剥离后的 Markdown] (注意观察“数据类型”列是否被斩断):")
    print("----")
    print(final_markdown.strip())
    print("----")

    print(f"\n[触发报警总数]: {len(warnings)} 项")
    
    for i, w in enumerate(warnings, 1):
        print(f"\n⚠️ 报警 {i}: [{w['warning_type'].upper()}] - 危险级: {w['severity']}")
        print(f"描述: {w['message']}")
        print("细节暴露给前端的数据集可以驱动 UI 交互:")
        print(json.dumps(w['details'], indent=2, ensure_ascii=False))

if __name__ == "__main__":
    run_test()
