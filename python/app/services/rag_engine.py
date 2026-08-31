"""RAG 引擎 — 查询改写 / 混合检索 / Reranker / 上下文组装"""
import re
from typing import TypedDict


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
    """提取查询关键词：优先 jieba 分词，退化到连续汉字段"""
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
    return list(dict.fromkeys(re.findall(r'[\u4e00-\u9fa5]{2,}', question)))


def hybrid_search(question: str, top_k: int = 10) -> list[RagChunk]:
    """向量语义 + 关键词精确 + BM25 风格 rerank"""
    from app.services.embedding_service import search_similar

    # 1. 多查询检索（search_similar 已超量取回 4x，这里融合后取 top_k）
    queries = rewrite_query(question)
    all_results: dict[str, dict] = {}

    for q in queries:
        try:
            hits = search_similar(q, top_k=top_k)
            for h in hits:
                chunk_id = h.get("id", "")
                if not chunk_id:
                    continue
                if chunk_id not in all_results:
                    all_results[chunk_id] = h
                else:
                    # 多子查询命中同一块：保留最优（最小）distance，不丢失更佳相似度
                    if h.get("distance", 1.0) < all_results[chunk_id].get("distance", 1.0):
                        all_results[chunk_id] = h
        except Exception:
            continue

    if not all_results:
        return []

    # 2. 计算综合得分（向量相似度 + 分词关键词命中 + 条号精确加权）
    scored: list[RagChunk] = []
    keywords = _extract_keywords(question)

    for chunk in all_results.values():
        score = 0.0
        text = chunk.get("text", "")
        title = chunk.get("title", "")
        distance = chunk.get("distance", 1.0)

        # 向量相似度得分（distance 越小越好，转为 0-1）
        vector_score = max(0, 1.0 - distance)
        score += vector_score * 0.6

        # 关键词命中得分（jieba 分词后逐词匹配）
        text_lower = text.lower()
        title_lower = title.lower()
        keyword_hits = sum(1 for kw in keywords if kw.lower() in text_lower or kw.lower() in title_lower)
        keyword_score = min(1.0, keyword_hits / max(1, len(keywords)))
        score += keyword_score * 0.3

        # "第X条" 精确匹配加权
        article_match = re.search(r'第([一二三四五六七八九十百千零\d]+)条', question)
        if article_match:
            article_keyword = article_match.group(0)
            if article_keyword in text:
                score += 0.1

        scored.append({**chunk, "score": score})

    # 3. 排序 + 去重（同一文档的不同 chunk 取得分最高的）
    scored.sort(key=lambda x: x["score"], reverse=True)
    seen_titles: dict[str, float] = {}
    deduped: list[RagChunk] = []

    for chunk in scored:
        title = chunk.get("title", "")
        # 同一文档最多保留 3 个 chunk（长材料允许更多相关段落入选）
        if title in seen_titles and seen_titles[title] >= 3:
            continue
        seen_titles[title] = seen_titles.get(title, 0) + 1
        deduped.append(chunk)

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
