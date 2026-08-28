# LawPilot 开发记录

## 2026-08-28

### 问题：隐私脱敏严格模式导致 AI 无法读取知识库内容

**现象：**
- 尽职调查页面导入 txt 文件后，AI 无法根据文件内容回答
- 知识库搜索结果无法被 AI 正确引用

**原因分析：**
隐私脱敏的"严格模式"会将中文内容（2-4个汉字）替换为占位符：
- `中华人民共和国民法典` → `[中文姓名_1]`
- `全国人民代表大会常务委员会` → `[中文姓名_2][中文姓名_3]`
- `北京市第一中级人民法院` → `[地址_1][中文姓名_4]`

这导致：
1. 用户上传的法律文档内容被脱敏，AI 看不到原文
2. 知识库搜索到的法条内容也被脱敏，AI 无法正确引用

**解决方案：**
删除隐私脱敏的"严格模式"，只保留"标准模式"。

标准模式脱敏内容（合理）：
- 身份证号
- 手机号
- 银行账号
- 电子邮箱
- 统一社会信用代码

**修改文件：**
1. `python/app/services/privacy.py` - 删除 STRICT_PATTERNS 和相关逻辑
2. `src/pages/Settings/SettingsPage.tsx` - 移除严格模式选项
3. `src/components/WelcomeWizard.tsx` - 移除严格模式选项

**结论：**
对于法律 AI 助手，隐私脱敏应该只保护个人敏感信息（身份证、手机号等），不应该影响法律内容的完整性。标准模式足以满足隐私保护需求。

---

### 问题：AI 无法找到材料中的完整信息

**现象：**
用户上传法律文档后，AI 回答"无法确定"具体处罚金额，即使文档中明确写有相关内容。

**原因分析：**
1. 材料文本被截断到 1000 字符（`embedding_service.py`）
2. 每条来源只发送 500 字符给 AI（`llm.py`）
3. 用户的文档超过 1000 字，相关条款被截掉

**解决方案：**
1. 材料索引文本上限：1000 → 4000 字符
2. RAG 来源文本上限：500 → 2000 字符

**修改文件：**
1. `python/app/services/embedding_service.py` - 增加材料索引文本长度
2. `python/app/routers/llm.py` - 增加 RAG 来源文本长度

**其他修改：**
1. `src/components/AiPanel.tsx` - 添加复制和编辑按钮

---

### 知识库索引模型下载问题

**现象：**
知识库重建索引时，无法从 HuggingFace 下载 `BAAI/bge-small-zh-v1.5` 模型（连接超时）

**解决方案：**
使用 ModelScope 国内镜像下载模型到本地：
```bash
pip install modelscope
python -c "from modelscope import snapshot_download; snapshot_download('BAAI/bge-small-zh-v1.5', cache_dir='E:/xo1/LawPilot/python/data/models')"
```

修改 `embedding_service.py` 使用本地模型路径，避免从 HuggingFace 下载。
