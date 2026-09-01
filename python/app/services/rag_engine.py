"""RAG 引擎 — 查询改写 / 混合检索 / Reranker / 上下文组装"""
import hashlib
import re
from typing import TypedDict

# 重排相关性阈值：低于此分的块判为不相关，不进上下文、不显示在引用来源。
# 实测：相关块 ≥0.93、无关块 ≤0.43（案卷策略文本）、基本无关 ≤0.09。
# 取 0.5 落在间隔中部：宁可"根据现有资料无法回答"，不显示误导性引用。
RERANK_MIN_SCORE = 0.5


class RagChunk(TypedDict):
    id: str
    source_type: str
    title: str
    text: str
    law_id: str | None
    article_id: str | None
    distance: float
    score: float  # 综合得分（越高越好）


class RagResult(TypedDict):
    answer: str
    sources: list[dict]
    query_used: str
    chunks_used: int


# ─── 查询改写 ────────────────────────────────────────────────

def rewrite_query(question: str) -> list[str]:
    """将用户问题改写为多个检索子查询"""
    queries = [question]

    # "第X条"不做独立子查询：检索服务内部已对含该模式的问题做精确匹配通道，
    # 单独的"第X条"语义查询只会召回各法规中无关的同号条文

    # 提取法律名称
    law_match = re.search(r'《(.+?)》', question)
    if law_match:
        queries.append(law_match.group(1))

    # 如果问题较短，补充语义扩展
    if len(question) < 15:
        queries.append(f"{question} 相关规定")

    return list(dict.fromkeys(queries))  # 去重保序


# ─── 混合检索 + Reranker ─────────────────────────────────────

def _extract_keywords(question: str) -> list[str]:
    """提取查询关键词：优先 jieba 分词，退化到整段+二元滑窗（保证中文词组可召回）"""
    question = question.strip()
    if not question:
        return []
    try:
        import jieba

        words = [w.strip() for w in jieba.lcut(question) if len(w.strip()) >= 2]
        if words:
            return list(dict.fromkeys(words))
    except ImportError:
        pass
    # 无 jieba：整段 + 二元滑窗，避免"整段当一个词"导致关键词通道失效
    runs = re.findall(r'[\u4e00-\u9fa5]{2,}', question)
    kws: list[str] = []
    for run in runs:
        kws.append(run)
        for i in range(len(run) - 1):
            kws.append(run[i:i + 2])
    return list(dict.fromkeys(kws))


def hybrid_search(question: str, top_k: int = 10) -> list[RagChunk]:
    """两段式检索：召回（向量+关键词并集）→ 精排（Cross-Encoder）→ 去重 top_k

    - 召回：多查询向量检索（超量取回）+ 关键词召回通道，取并集扩大候选池，
      降低单一信号（尤其是小向量模型语义召回弱）造成的漏检。
    - 精排：对候选池用 bge-reranker 联合打分 (query, doc)，重排器语义能力远强于
      独立编码的 embedding，直接提升最终入选块的相关性。
    - 重排器不可用时优雅降级为召回池原有顺序。
    """
    from app.services.embedding_service import search_similar, keyword_recall, rerank

    # 1. 召回池：多查询向量 + 关键词通道，按 id 去重（保留最优 distance）
    #    另按文本哈希去重：同一文件被重复上传时会产生多个 id 不同但内容相同的块，
    #    不去重会让 top_k 被同一文本的拷贝占满（实测 4 份副本挤占 3 席）
    pool: dict[str, dict] = {}
    seen_texts: set[str] = set()

    def _add(hits):
        for h in hits:
            cid = h.get("id", "")
            if not cid:
                continue
            text = (h.get("text") or "").strip()
            tkey = hashlib.md5(text.encode("utf-8")).hexdigest() if text else ""
            if tkey and tkey in seen_texts:
                continue
            if cid not in pool:
                if tkey:
                    seen_texts.add(tkey)
                pool[cid] = h
            elif h.get("distance", 1.0) < pool[cid].get("distance", 1.0):
                pool[cid] = h

    for q in rewrite_query(question):
        try:
            _add(search_similar(q, top_k=30))
        except Exception:
            continue

    kw_hits: list = []
    try:
        kw_hits = keyword_recall(_extract_keywords(question), top_k=20)
        _add(kw_hits)
    except Exception:
        pass

    if not pool:
        return []

    # 召回池按 distance 升序（最相关在前），取前 50 喂给重排器（控制 CPU 开销）
    ranked = sorted(pool.values(), key=lambda c: c.get("distance", 1.0))
    candidates = ranked[:50]
    # 两通道 distance 量纲不可直接比较：关键词精确命中的块即使距离排名
    # 落在前 50 之外，也保证进精排池（法规查询中关键词命中通常最相关）
    have_ids = {c.get("id") for c in candidates}
    for h in kw_hits[:10]:
        if h.get("id") and h.get("id") not in have_ids:
            candidates.append(h)

    # 2. Cross-Encoder 精排：多取一些（top_k 的 3 倍）以经受住下面的过滤
    candidates = rerank(question, candidates, top_n=max(top_k * 3, 20))

    # 3. 相关性阈值：明显不相关的块不送进上下文、不显示在引用来源里。
    #    重排器不可用时块没有 rerank_score，默认放行（优雅降级）
    scored = [c for c in candidates if c.get("rerank_score", 1.0) >= RERANK_MIN_SCORE]
    if not scored:
        # 无达标块时如实返回空：由 LLM 按规则明确"根据现有资料无法回答"，
        # 而不是塞低相关块造成误导性引用
        return []

    # 4. 按文档去重（同一文档最多保留 3 块，长材料允许多段落入选）
    seen_titles: dict[str, int] = {}
    deduped: list[RagChunk] = []
    for rank, chunk in enumerate(scored):
        title = chunk.get("title", "")
        if title in seen_titles and seen_titles[title] >= 3:
            continue
        seen_titles[title] = seen_titles.get(title, 0) + 1
        deduped.append({
            **chunk,
            "score": round(chunk.get("rerank_score", 1.0 - rank / max(len(scored), 1)), 4),
        })

    return deduped[:top_k]


# ─── 上下文组装 ───────────────────────────────────────────────

def build_context(chunks: list[RagChunk], max_tokens: int = 6000) -> str:
    """将检索到的 chunk 组装为 LLM 上下文，控制总 token 数"""
    if not chunks:
        return "未找到相关法律资料。"

    parts = []
    total_chars = 0
    char_limit = max_tokens * 2  # 粗略估算 1 token ≈ 2 字符

    for i, chunk in enumerate(chunks):
        text = chunk.get("text", "").strip()
        title = chunk.get("title", "")
        source_type = chunk.get("source_type", "")

        # 标注来源
        label = f"[来源{i+1}] ({source_type}, {title})"

        # 控制单个 chunk 长度
        if len(text) > 2000:
            text = text[:2000] + "..."

        entry = f"{label}:\n{text}"
        if total_chars + len(entry) > char_limit:
            # 超预算时跳过该块继续尝试更小的块，而不是丢弃全部剩余
            continue

        parts.append(entry)
        total_chars += len(entry)

    return "\n\n---\n\n".join(parts)


# ─── Prompt 构建 ──────────────────────────────────────────────

RAG_SYSTEM_PROMPT = """你是专业法律助手。请严格根据下方提供的资料回答问题。

## 回答规则
1. **只使用资料中的内容回答**，不要编造或推测
2. **必须引用来源**，格式：在相关语句后标注 [来源N]
3. 如果资料中没有相关信息，明确告知"根据现有资料无法回答"
4. 回答要准确、完整，引用法条时写明条款编号
5. 如果问题涉及多个来源，综合分析后给出结论

## 引用格式
- 引用法条："[来源1] 第X条规定：..."
- 引用多个来源："[来源1][来源3] 均规定..."

## 资料
{context}"""


def build_rag_messages(question: str, chunks: list[RagChunk]) -> list[dict]:
    """构建 RAG 对话消息"""
    context = build_context(chunks)
    system_content = RAG_SYSTEM_PROMPT.format(context=context)

    return [
        {"role": "system", "content": system_content},
        {"role": "user", "content": question},
    ]


# ─── 引用来源摘要 ─────────────────────────────────────────────

def _window_around(text: str, pos: int, width: int = 200) -> str:
    """以 pos 为锚点取窗口（锚点前留 40 字上下文），两端超出则加省略号"""
    start = max(0, pos - 40)
    end = min(len(text), start + width)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return prefix + text[start:end] + suffix


_ART_NUM = r'[零一二两三四五六七八九十百千\d]+'
_ARTICLE_RE = re.compile(rf'第({_ART_NUM})条')
_CN_DIGITS = {'零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}
_CN_UNITS = {'十': 10, '百': 100, '千': 1000}


def _article_value(s: str) -> int | None:
    """条款号转数值：'四十二'/'42'/'十五' -> 42/42/15；无法解析返回 None"""
    if s.isdigit():
        return int(s)
    total, num = 0, 0
    for ch in s:
        if ch in _CN_DIGITS:
            num = _CN_DIGITS[ch]
        elif ch in _CN_UNITS:
            total += (num if num else 1) * _CN_UNITS[ch]
            num = 0
        else:
            return None
    return total + num


def _extract_articles(s: str) -> list[str]:
    """从文本提取条款号，兼容"第四条""第四、五条""第四条和第五条""第十二、十三条"等写法"""
    arts: list[str] = []
    for m in re.finditer(r'第([一二三四五六七八九十百千零\d、和及与]+?)条', s):
        inner = m.group(1)
        for part in re.split(r'[、和及与]', inner):
            part = part.strip()
            if part:
                full = f"第{part}条"
                if full not in arts:
                    arts.append(full)
    return arts


def _find_article_pos(text: str, num_str: str) -> int:
    """定位与 num_str 数值相同的"第X条"。LLM 可能写"第4条"而原文是"第四条"，
    必须按数值匹配，否则锚定失败退到关键词兜底、窗口落错位置"""
    target = _article_value(num_str)
    if target is None:
        return text.find(f'第{num_str}条')
    for m in _ARTICLE_RE.finditer(text):
        if _article_value(m.group(1)) == target:
            return m.start()
    return -1


def _marker_segments(answer: str) -> list[tuple[int, int, str]]:
    """每个 [来源N] 标记及其归属段落段 (source_index, marker_start, segment)。

    回看必须切断在上一段落换行（\\n\\n）处：编号列表的每项是独立段落，
    若只看固定 80 字，会把上一项的条款号带进本项标记的判定，
    导致把正确的引用改错（实测 [来源5] 第六条 被误改成 [来源1]）。
    """
    out: list[tuple[int, int, str]] = []
    for m in re.finditer(r'\[来源(\d+)\]', answer):
        start = max(m.start() - 80, answer.rfind('\n\n', 0, m.start()) + 1)
        out.append((int(m.group(1)), m.start(), answer[start: m.end() + 20]))
    return out


def make_snippet(text: str, question: str, answer: str, source_index: int, width: int = 200) -> str:
    """为参考来源生成摘要，优先对齐答案实际引用的条款。

    固定取前 200 字时，被引用的条款若不在块首，用户看到的预览就和引用对不上。
    优先级：答案中引用本来源的条款号(兼容合并写法) > 答案全文里确实存在于本块的条款
            > 问题关键词最后一次出现位置 > 块首。
    """
    if not text:
        return ""
    if len(text) <= width:
        return text.replace("\n", " ")

    # 1) 答案里引用了该来源的段落中出现过的条款号（兼容中文/阿拉伯数字、标记前置/后置）
    cited: list[str] = []
    for idx, _, seg in _marker_segments(answer):
        if idx != source_index:
            continue
        for a in _extract_articles(seg):
            if a not in cited:
                cited.append(a)
    # 2) 段落边界内没找到，则用"答案全文里确实出现在本块文本中的条款"兜底
    if not cited:
        for a in _extract_articles(answer):
            if a in text and a not in cited:
                cited.append(a)
    for a in cited:
        pos = _find_article_pos(text, a)
        if pos >= 0:
            return _window_around(text, pos, width).replace("\n", " ")

    # 3) 问题关键词（取块内最后一次出现，通常靠近块的相关段落）
    for kw in reversed(_extract_keywords(question)):
        if len(kw) < 2:
            continue
        pos = text.rfind(kw)
        if pos >= 0:
            return _window_around(text, pos, width).replace("\n", " ")

    # 4) 兜底
    return text[:width].replace("\n", " ")


def article_num_value(num_str: str) -> int | None:
    """'第十四条'/'第4条'/'十四' -> 14/4/14；无法解析返回 None"""
    m = _ARTICLE_RE.search(num_str or "")
    if m:
        return _article_value(m.group(1))
    return _article_value((num_str or "").strip())


def cited_article_values(answer: str, source_index: int) -> list[int]:
    """答案中与该来源标记同段出现的条款号数值列表（供材料来源关联法规跳转用）"""
    vals: list[int] = []
    for idx, _, seg in _marker_segments(answer):
        if idx != source_index:
            continue
        for a in _ARTICLE_RE.findall(seg):
            v = _article_value(a)
            if v is not None and v not in vals:
                vals.append(v)
    return vals


def fix_citation_attribution(answer: str, chunks: list[RagChunk]) -> str:
    """校验 [来源N] 与该处提及条款号的归属：条款不在 N 号块、但唯一存在于 M 号块时，
    把该标记改到 [来源M]。LLM 常把相邻块的条款错标到主引用块上（如第六条标给只含
    第四/五条的块1），不纠正会让用户核对时发现"来源里没有这条"。"""
    if not answer or not chunks:
        return answer
    edits: list[tuple[int, int, str]] = []
    for n, m_start, seg in _marker_segments(answer):
        if not (1 <= n <= len(chunks)):
            continue
        for a in _ARTICLE_RE.findall(seg):
            if _find_article_pos(chunks[n - 1].get("text") or "", a) >= 0:
                continue  # 该条款归属正确，继续检查段内其他条款
            holders = [
                (j + 1, c.get("score", 0)) for j, c in enumerate(chunks)
                if _find_article_pos(c.get("text") or "", a) >= 0
            ]
            # 多个块都含该条款时取精排分最高的（材料块与法规块重复收录同一法时常见）
            if holders:
                best = max(holders, key=lambda t: t[1])[0]
                if best != n:
                    edits.append((m_start, m_start + len(f"[来源{n}]"), f"[来源{best}]"))
            break  # 每个标记只做一次改判
    fixed = answer
    for start, end, repl in sorted(edits, reverse=True):
        fixed = fixed[:start] + repl + fixed[end:]
    # 相邻标记被改判到同一来源时合并（[来源5][来源5] -> [来源5]）
    fixed = re.sub(r'(\[来源\d+\])(?:\1)+', r'\1', fixed)
    return fixed


# ─── 引用后处理 ───────────────────────────────────────────────

def postprocess_citations(answer: str, chunks: list[RagChunk]) -> str:
    """后处理：确保引用标注与来源对应"""
    # 如果回答中没有 [来源N]，尝试自动添加
    if "[来源" not in answer and chunks:
        # 检查回答是否包含某个 chunk 的关键内容
        for i, chunk in enumerate(chunks):
            text = chunk.get("text", "")
            # 提取 chunk 中的条款编号
            article_matches = re.findall(r'第([一二三四五六七八九十百千零\d]+)条', text)
            for art in article_matches:
                art_full = f"第{art}条"
                if art_full in answer and f"[来源{i+1}]" not in answer:
                    # 在该条款首次出现位置后添加引用
                    pattern = f"({re.escape(art_full)}[^。]*。)"
                    match = re.search(pattern, answer)
                    if match:
                        answer = answer[:match.end()] + f" [来源{i+1}]" + answer[match.end():]
                        break

    return answer
