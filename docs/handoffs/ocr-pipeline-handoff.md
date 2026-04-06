# 医疗大模型辅助问诊：化验单识别与架构断层 问题交接文档

> **文档目的**：本项目当前处于“化验单智能识别与纠错”的攻坚阶段，由于遇到了模型幻觉和深层架构存储挂载的断层问题，特制订此交接文档，指明核心痛点及下一阶段的定点重构代码域。

---

## 1. 当前遭遇的核心问题清单

系统在处理医疗图像与病历文件时，遭遇了两张“皮”剥离和模型发散的严重Bug：

1. **底层存储与表现层断层 (Case vs Thread)**：LangGraph 框架依据 `Thread ID`（如 `seed-thread-004`）建立私有沙盒存储图片和解析日志；但医生工作台完全基于 `Case ID`（如 `a1b2c...`）呈现。更致命的是，医生端手工建档时，前端伪造了一个随机串充当 Thread，导致开发者和医生去本地物理硬盘里交叉对比化验单源文件与 OCR 结果时，如同大海捞针。
2. **大模型幻觉与提示词污染**：PaddleOCR 前端提取后，系统使用了一个非常宽泛的通用 Prompt 要求大模型转化为 Markdown。由于 Prompt 里硬编码了类似 `109 ↓` 这样的示范数据（Few-Shot 污染），导致处理模糊图片时，模型不顾原图，直接复制黏贴假数据幻觉。
3. **缺乏垂直领域的清洗结构 (无 Prompt 路由)**：不同化验单（肝功、血气、血常规）的排版逻辑完全不同，当前这种“一锅炖”的洗数据方式不可持续。

---

## 2. 🔍 阅读域（第一步：要看哪些文件来理解问题？）

接手者必须先阅读以下 4 个文件，这是搞懂所有痛点来龙去脉的最短路径：

| 文件路径 | 你需要去理解什么？ |
| :--- | :--- |
| `backend/app/gateway/models/case.py` <br> `backend/app/gateway/services/seed_data.py` | 看看 `Case` 对象的定义。你会发现里面同时存在 `case_id` 和 `patient_thread_id` 两个东西。去 `seed_data.py` 看看 Mock 数据里写死的 `seed-thread-004` 是它在硬盘里真实存在的文件夹名字。 |
| `frontend/src/app/doctor/queue/page.tsx` | 搜 `handleQuickCreateCase` 函数。看看前端是怎么生造并散装生成 `doc-[时间戳]` 作为假 Thread ID 扔给后端建档的。正是这段该死的代码导致你找不到沙盒！ |
| `backend/app/gateway/services/paddle_ocr.py` | 搜 `_reformat_to_markdown` 函数和顶部的 `PROMPT`。这里就是大爆发数字幻觉的罪魁祸首，去观察里面是怎样因为列定义过细而把模型绕晕的。 |
| `backend/app/gateway/services/analyzers/lab_ocr.py` | 搜 `.ocr.md`。这里控制着最终通过 OCR 的文件是如何通过 Sidecar 模式和原图片一起落盘的。理解它是怎么拼凑 `uploads_dir` （沙盒路径）的。 |

---

## 3. 🛠️ 修改域（第二步：去改哪些文件来解决问题？）

明确了痛点和代码位置后，你需要按照以下顺序破局，修改以下 3 个文件：

### 痛点 A：修复架构“找不到文件”的问题（透传与合一）
- **修改 1**：`frontend/src/app/doctor/queue/page.tsx`
  - **怎么改**：① 删除 `handleQuickCreateCase` 里偷偷生成 `doc-xxx` 的逻辑。② 在渲染右侧「患者概要」详情的地方，强行加一行 UI：**`📂 本地沙盒 (Thread): {selectedCase.patient_thread_id}`**，让你明确知道去硬盘哪个文件夹找图片。
- **修改 2**：`backend/app/gateway/services/case_db.py`
  - **怎么改**：在 `create_case` 方法中加拦截，如果是前端调用且未给出 `patient_thread_id`，强制在后端让 `patient_thread_id = case_id`。这样手动创建的空病例的储存物理路径就叫它的病例号，实现绝对的知行合一。

### 痛点 B：搭建零延迟 Prompt Router（消灭模版幻觉）
- **修改 3**：`backend/app/gateway/services/paddle_ocr.py`
  - **怎么改**：完全重写 `_reformat_to_markdown` 方法。在拿着 `raw_text` 交给大模型之前，先写几行正则去判断里头有没有高频词（如“肝功”、“白细胞”等）。
  - 如果是肝功：注入“肝功专属简单系统提示词”（禁止带有任何实际数字举例！用 `$VAR` 替代）。
  - 如果是血常规：注入“血常规提示词”。
  - 将 PaddleOCR 从一个“试图排版的神”阉割成“只吐出死文字的机器层”，让大语言模型单纯做版面清洗，杜绝它自作聪明填入假数字。
  
---
**验收标准 (Definition of Done)**：
1. 医生端页面点开任何一个病例（无论是老的 Mock 数据还是新的），屏幕上清清楚楚写着它的本地沙盒文件夹叫什么。
2. 上传一张全是干扰噪声的反光肝功单化验单，后端的 `.ocr.md` 缓存文件里，识别出来的数值和原图一字不差（哪怕空白也不能凭空产生字符 `109`）。
