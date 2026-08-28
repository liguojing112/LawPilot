"""LLM 云端大模型调用路由 — 聊天/RAG/报告/策略（轻量版）"""
import json
import os
import sqlite3
from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/llm", tags=["llm"])

# 延迟导入，避免启动就要求 openai 已安装
from app.services.privacy import mask_text, preview_mask


class ChatRequest(BaseModel):
    messages: list[dict]
    stream: bool = True
    temperature: float = 0.7
    max_tokens: int = 8192


class RagAskRequest(BaseModel):
    question: str
    top_k: int = 5


class ReportRequest(BaseModel):
    materials_text: str
    risk_points: str = ""
    report_type: str = "due_diligence"
    target_company: str = ""
    client: str = ""
    scope: str = ""


class StrategyRequest(BaseModel):
    facts_text: str


class TestConfigRequest(BaseModel):
    base_url: str
    api_key: str
    model: str


class ExtractEntitiesRequest(BaseModel):
    text: str


def _find_db_path() -> str:
    # 优先查已知路径，避免 glob 递归踩到系统目录报错
    for candidate in [
        os.path.join(os.getenv("APPDATA", ""), "lawpilot", "LawPilot", "lawpilot.db"),
        os.path.join(os.getenv("APPDATA", ""), "LawPilot", "lawpilot.db"),
        os.path.join(str(Path.home()), "AppData", "Roaming", "LawPilot", "lawpilot.db"),
    ]:
        if os.path.exists(candidate):
            return candidate
    return os.path.join(os.getenv("APPDATA", ""), "lawpilot", "LawPilot", "lawpilot.db")


def _get_ai_config() -> dict:
    db_path = _find_db_path()
    defaults = {
        "api_key": "", "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-v4-pro", "privacy_level": "standard",
    }
    if not os.path.exists(db_path):
        return defaults
    try:
        conn = sqlite3.connect(db_path)
        rows = conn.execute(
            "SELECT key, value FROM system_config WHERE key IN "
            "('ai.api_key', 'ai.base_url', 'ai.model', 'ai.privacy_level')"
        ).fetchall()
        conn.close()
        cfg = {}
        for k, v in rows:
            cfg[k.replace("ai.", "")] = v
        defaults.update(cfg)
        return defaults
    except Exception:
        return defaults


async def _call_llm(
    messages: list[dict],
    temperature: float = 0.7,
    max_tokens: int = 8192,
    return_usage: bool = False,
):
    """非流式 LLM 调用。return_usage=True 时返回 (content, usage_dict)"""
    config = _get_ai_config()
    if not config["api_key"]:
        empty_usage = {"prompt_tokens": 0, "completion_tokens": 0}
        msg = "请先在设置页面配置 API Key"
        return (msg, empty_usage) if return_usage else msg
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=config["api_key"], base_url=config["base_url"])
        resp = await client.chat.completions.create(
            model=config["model"],
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        content = resp.choices[0].message.content or ""
        if not return_usage:
            return content
        usage = getattr(resp, "usage", None)
        usage_dict = {
            "prompt_tokens": getattr(usage, "prompt_tokens", 0) or 0,
            "completion_tokens": getattr(usage, "completion_tokens", 0) or 0,
        } if usage else {"prompt_tokens": 0, "completion_tokens": 0}
        return content, usage_dict
    except ImportError:
        msg = "[错误] openai 库未安装，请运行 pip install openai"
        return (msg, {"prompt_tokens": 0, "completion_tokens": 0}) if return_usage else msg
    except Exception as e:
        msg = f"[错误] {_friendly_error(e)}"
        return (msg, {"prompt_tokens": 0, "completion_tokens": 0}) if return_usage else msg


async def _stream_llm(messages: list[dict], temperature: float = 0.7, max_tokens: int = 8192):
    """流式 LLM 调用 — SSE，done 事件附带 usage"""
    config = _get_ai_config()
    if not config["api_key"]:
        yield json.dumps({"content": "请先在设置页面配置 API Key", "done": True})
        return
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=config["api_key"], base_url=config["base_url"])
        # 实体提取用轻量模型，避免推理模型输出自然语言
        extract_model = "deepseek-v4-flash" if "deepseek" in config.get("base_url", "") else config["model"]
        resp = await client.chat.completions.create(
            model=extract_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
            stream_options={"include_usage": True},
        )
        usage = {"prompt_tokens": 0, "completion_tokens": 0}
        async for chunk in resp:
            if getattr(chunk, "usage", None):
                usage = {
                    "prompt_tokens": chunk.usage.prompt_tokens or 0,
                    "completion_tokens": chunk.usage.completion_tokens or 0,
                }
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                yield json.dumps({"content": delta.content, "done": False})
        yield json.dumps({"content": "", "done": True, "usage": usage})
    except ImportError:
        yield json.dumps({"content": "[错误] openai 库未安装", "done": True})
    except Exception as e:
        yield json.dumps({"content": f"[错误] {_friendly_error(e)}", "done": True})


@router.post("/chat")
async def chat_endpoint(req: ChatRequest):
    level = _get_ai_config().get("privacy_level", "standard")
    masked_msgs = []
    for msg in req.messages:
        r = mask_text(msg.get("content", ""), level=level)
        masked_msgs.append({**msg, "content": r["masked_text"]})

    async def gen():
        async for chunk in _stream_llm(masked_msgs, req.temperature, req.max_tokens):
            yield f"data: {chunk}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")


@router.post("/simple")
async def simple_chat(req: ChatRequest):
    level = _get_ai_config().get("privacy_level", "standard")
    masked_msgs = []
    for msg in req.messages:
        r = mask_text(msg.get("content", ""), level=level)
        masked_msgs.append({**msg, "content": r["masked_text"]})
    content = await _call_llm(masked_msgs, req.temperature, req.max_tokens)
    return {"content": content}


@router.post("/rag-ask")
async def rag_ask(req: RagAskRequest):
    question = req.question.strip()
    if not question:
        return {"answer": "请输入问题", "sources": [], "usage": {"prompt_tokens": 0, "completion_tokens": 0}}

    sources = []
    try:
        from app.services.embedding_service import search_similar
        sources = search_similar(question, top_k=req.top_k)
    except Exception:
        pass

    ctx_parts = []
    for i, s in enumerate(sources):
        ctx_parts.append(f"[来源{i+1}] ({s['source_type']}, {s.get('title','')}): {s['text'][:500]}")
    context_text = "\n\n".join(ctx_parts) if ctx_parts else "未找到相关法律资料。"

    messages = [
        {"role": "system", "content": (
            "你是专业法律助手。根据以下资料回答问题。" +
            "如果资料包含相关信息请在回答中引用[来源N]标注。" +
            "如果找不到请诚实告知不要编造。\n\n资料:\n" + context_text
        )},
        {"role": "user", "content": question},
    ]

    level = _get_ai_config().get("privacy_level", "standard")
    masked = []
    for msg in messages:
        r = mask_text(msg["content"], level=level)
        masked.append({**msg, "content": r["masked_text"]})

    answer, usage = await _call_llm(masked, 0.3, 8192, return_usage=True)
    return {
        "answer": answer,
        "sources": [
            {"id": s.get("id", ""), "source_type": s.get("source_type", ""),
             "title": s.get("title", ""), "snippet": s.get("text", "")[:200],
             "law_id": s.get("law_id"), "article_id": s.get("article_id")}
            for s in sources
        ],
        "usage": usage,
    }


@router.post("/report")
async def generate_report(req: ReportRequest):
    if not req.materials_text.strip():
        return {"content": "请先导入尽调资料"}

    project_info = ""
    if req.target_company or req.client or req.scope:
        project_info = (
            "\n项目信息:\n"
            f"- 目标公司: {req.target_company or '（未提供）'}\n"
            f"- 委托方: {req.client or '（未提供）'}\n"
            f"- 尽调范围: {req.scope or '（未提供）'}\n"
        )

    prompt = (
        "你是资深执业律师，请根据以下尽调资料生成一份《法律尽职调查报告》。\n\n"
        + project_info
        + "报告应包含:\n## 一、引言\n（目的、范围、方法）\n\n"
        "## 二、公司概况\n（基本信息、股权结构、历史沿革）\n\n"
        "## 三、业务资质\n（经营许可、行业准入、资质证书）\n\n"
        "## 四、资产与产权\n（不动产、知识产权、重大资产）\n\n"
        "## 五、重大合同\n（主要供应商/客户、借款/担保合同）\n\n"
        "## 六、诉讼与仲裁\n（涉案情况、执行、失信记录）\n\n"
        "## 七、风险评估\n（法律风险、合规风险、经营风险及等级）\n\n"
        "## 八、结论与建议\n（总体评价、建议措施）\n\n"
        f"尽调资料:\n{req.materials_text[:8000]}\n\n"
        f"关键风险点:\n{req.risk_points or '（无特别提示）'}\n\n"
        "请用中文 Markdown 格式输出完整报告。"
    )
    level = _get_ai_config().get("privacy_level", "standard")
    r = mask_text(prompt, level=level)
    content, usage = await _call_llm([{"role": "user", "content": r["masked_text"]}], 0.3, 32768, return_usage=True)
    return {"content": content, "usage": usage}


@router.post("/strategy")
async def strategy_endpoint(req: StrategyRequest):
    if not req.facts_text.strip():
        return {"error": "请输入案情描述"}

    # 检索法条
    related_laws = []
    try:
        from app.services.embedding_service import search_similar
        related_laws = search_similar(req.facts_text, top_k=5)
    except Exception:
        pass
    laws_text = "\n".join(
        f"- {l.get('title','')}: {l.get('text','')[:300]}" for l in related_laws
    ) if related_laws else "（未找到相关法条）"

    prompt = (
        "你是资深诉讼律师。请根据以下案情和法条进行诉讼策略推演。\n\n"
        '输出严格JSON格式:\n'
        '{"timelines":[{"date":"","event":"","importance":""}],'
        '"parties":[{"name":"","role":""}],'
        '"dispute_focus":[],'
        '"matched_laws":[{"title":"","article":"","relevance":""}],'
        '"strengths":[],"weaknesses":[],"opportunities":[],"threats":[],'
        '"analysis":"","suggestions":[]}\n\n'
        f"案情:\n{req.facts_text}\n\n相关法条:\n{laws_text}\n\n只输出JSON。"
    )
    level = _get_ai_config().get("privacy_level", "standard")
    r = mask_text(prompt, level=level)
    raw, usage = await _call_llm([{"role": "user", "content": r["masked_text"]}], 0.7, 16384, return_usage=True)

    try:
        text = raw
        for marker in ["```json", "```"]:
            if marker in text:
                text = text.split(marker)[1].split("```")[0].strip()
                break
        parsed = json.loads(text)
    except Exception:
        parsed = {"strengths": [], "weaknesses": [], "opportunities": [],
                   "threats": [], "analysis": raw, "timelines": [],
                   "matched_laws": [], "suggestions": [], "parties": [],
                   "dispute_focus": []}
    parsed["_related_laws"] = related_laws
    parsed["usage"] = usage
    return parsed


def _friendly_error(e: Exception) -> str:
    """将 OpenAI SDK 的原始异常翻译为用户友好的中文提示"""
    msg = str(e)
    # 401 — 密钥问题
    if "401" in msg or "authentication" in msg.lower() or "api key" in msg.lower() or "invalid_api_key" in msg.lower():
        return (
            "API 密钥认证失败（401）。请检查：\n"
            "1. API Key 是否正确、是否已过期\n"
            "2. API Base URL 是否与所选模型提供商匹配\n"
            "   例如：使用 DeepSeek 的 Key 时，Base URL 应为 https://api.deepseek.com/v1"
        )
    # 400 模型名错误
    if "400" in msg or "model" in msg.lower() and ("not found" in msg.lower() or "invalid" in msg.lower() or "supported" in msg.lower()):
        return f"模型名称无效（400），请确认模型名称与提供商支持的名称一致。\n详情: {msg}"
    # 连接/网络错误
    if "connection" in msg.lower() or "connect" in msg.lower() or "timeout" in msg.lower() or "refused" in msg.lower():
        return (
            "网络连接失败。请检查：\n"
            "1. API Base URL 是否填写正确\n"
            "2. 网络是否可以访问该地址"
        )
    # 其他错误
    return f"连接失败: {msg}"


@router.post("/test")
async def test_config(req: TestConfigRequest):
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=req.api_key, base_url=req.base_url)
        await client.chat.completions.create(
            model=req.model,
            messages=[{"role": "user", "content": "回复 OK"}],
            max_tokens=10,
        )
        return {"ok": True, "message": "连接成功"}
    except Exception as e:
        return {"ok": False, "message": _friendly_error(e)}


@router.post("/extract-entities")
async def extract_entities_endpoint(req: ExtractEntitiesRequest):
    """AI 提取法律文书中的实体（当事人、机构、日期、金额、案号）"""
    try:
        text = req.text.strip()
        if not text:
            return {"ok": False, "persons": [], "orgs": [], "dates": [], "amounts": [], "caseNumbers": [], "message": "文本为空"}

        config = _get_ai_config()
        if not config.get("api_key"):
            return {"ok": False, "persons": [], "orgs": [], "dates": [], "amounts": [], "caseNumbers": [], "message": f"未配置 API Key（数据库: {_find_db_path()}）"}

        # 按脱敏级别处理后再送云端，避免当事人姓名/证件号等原文外发
        level = config.get("privacy_level", "standard")
        masked = mask_text(text, level=level)["masked_text"]

        # 截断过长文本，控制 token 消耗
        max_chars = 6000
        if len(masked) > max_chars:
            masked = masked[:max_chars] + "..."

        prompt = (
        "你是一个法律文书信息提取助手。请从以下文本中提取关键实体。\n"
        "⚠️ 直接输出 JSON 对象，不要包含任何分析、推理、解释文字。只输出纯 JSON。\n\n"
        "JSON 格式：\n"
        '{"persons":["姓名"],"orgs":["机构名"],"dates":["日期"],"amounts":["金额"],"caseNumbers":["案号"]}\n\n'
        "提取规则：\n"
        "- persons: 当事人姓名，必须是真实的人名（不含通用称谓如原告被告）\n"
        "- orgs: 机构名称（法院、公司、律所、银行等）\n"
        "- dates: 日期（YYYY年MM月DD日格式）\n"
        "- amounts: 金额（含单位，如 50000元）\n"
        "- caseNumbers: 案号（如 (2024)京0105民初12345号）\n\n"
        "文本：\n" + masked + "\n\n"
        "只输出 JSON："
    )

        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=config["api_key"], base_url=config["base_url"])
        resp = await client.chat.completions.create(
            model=config["model"],
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=4096,
        )
        msg = resp.choices[0].message
        raw = msg.content or ""
        # DeepSeek V4 Pro 推理模型：回复在 reasoning_content 字段
        if not raw:
            raw = getattr(msg, 'reasoning_content', '') or ""
        if not raw:
            return {"ok": False, "persons": [], "orgs": [], "dates": [], "amounts": [], "caseNumbers": [], "message": "AI 返回空内容，请尝试更换模型（如 deepseek-v4-flash）"}

        # 1. 尝试提取 markdown 代码块中的 JSON
        for marker in ["```json", "```"]:
            if marker in raw:
                raw = raw.split(marker, 1)[1]
                if "```" in raw:
                    raw = raw.split("```", 1)[0]
                raw = raw.strip()
                break

        # 2. 如果还有多余文本，尝试提取最外层 {...} 或 [...]
        if raw and raw[0] not in ('{', '['):
            import re
            m = re.search(r'\{.*\}|\[.*\]', raw, re.DOTALL)
            if m:
                raw = m.group(0)

        parsed = json.loads(raw)
        return {
            "ok": True,
            "persons": parsed.get("persons", []),
            "orgs": parsed.get("orgs", []),
            "dates": parsed.get("dates", []),
            "amounts": parsed.get("amounts", []),
            "caseNumbers": parsed.get("caseNumbers", []),
            "message": "",
        }
    except json.JSONDecodeError:
        raw_val = str(locals().get('raw', ''))
        # 尝试从自然语言推理文本中提取实体
        try:
            import re as re3
            result = {"persons": [], "orgs": [], "dates": [], "amounts": [], "caseNumbers": []}

            # 按常见标签分段解析
            # persons: 匹配 "persons:" / "当事人:" / "人名:" 后面的中文名（用、，分隔）
            p = re3.search(r'(?:persons|当事人|人名)\s*[:：]\s*(.+?)(?:\n|$)', raw_val, re3.I)
            if p:
                names = re3.split(r'[、，,]\s*', p.group(1))
                result["persons"] = [n.strip() for n in names if n.strip() and len(n.strip()) >= 2]

            # orgs: 匹配 "orgs:" / "机构:" 后面的机构名
            o = re3.search(r'(?:orgs|机构|公司)\s*[:：]\s*(.+?)(?:\n|$)', raw_val, re3.I)
            if o:
                names = re3.split(r'[、，,]\s*', o.group(1))
                result["orgs"] = [n.strip() for n in names if n.strip() and len(n.strip()) >= 4]

            # dates
            d = re3.findall(r'\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日', raw_val)
            result["dates"] = list(set(d))[:10]

            # amounts
            a = re3.findall(r'\d[\d,.]*\s*(?:亿|万|千|百)?\s*元', raw_val)
            result["amounts"] = list(set(a))[:10]

            # caseNumbers
            c = re3.findall(r'[（(]\s*\d{4}\s*[）)][\u4e00-\u9fa5\d]{2,12}[民刑行执赔].*?号', raw_val)
            result["caseNumbers"] = list(set(c))[:5]

            if any(result.values()):
                return {"ok": True, **result, "message": "（从推理文本中提取）"}
        except Exception:
            pass
        debug = raw_val[:800].replace('\n', '\\n')
        return {"ok": False, "persons": [], "orgs": [], "dates": [], "amounts": [], "caseNumbers": [], "message": f"AI 返回格式解析失败。建议换用 deepseek-v4-flash（非推理模型）。原始返回: {debug}"}
    except ImportError:
        return {"ok": False, "persons": [], "orgs": [], "dates": [], "amounts": [], "caseNumbers": [], "message": "openai 库未安装"}
    except Exception as e:
        return {"ok": False, "persons": [], "orgs": [], "dates": [], "amounts": [], "caseNumbers": [], "message": _friendly_error(e)}


class PrivacyPreviewRequest(BaseModel):
    text: str
    level: str = "standard"


@router.post("/privacy/preview")
async def privacy_preview(req: PrivacyPreviewRequest):
    """预览脱敏结果"""
    try:
        result = preview_mask(req.text, req.level)
        return {"ok": True, "preview": result}
    except Exception as e:
        return {"ok": False, "message": _friendly_error(e)}
