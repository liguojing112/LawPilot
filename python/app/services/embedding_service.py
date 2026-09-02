"""本地向量知识库 — BGE-small-zh + LanceDB 索引"""

import hashlib
import os
import json
import sqlite3
import numpy as np
from typing import TypedDict

from app.config import VECTOR_DIR

os.makedirs(VECTOR_DIR, exist_ok=True)


class SearchResult(TypedDict):
    id: str
    source_type: str
    title: str
    text: str
    law_id: str | None
    article_id: str | None
    distance: float


# 全局缓存
_embedding_model = None
_reranker_model = None
_lancedb_table = None


def _get_db_path() -> str:
    """查找 SQLite 数据库路径（与 llm.py 保持一致，避免递归遍历 home 目录）"""
    candidates = [
        # 生产模式：Electron 注入 LAWPILOT_DATA_DIR（= userData/LawPilot）
        os.path.join(os.getenv("LAWPILOT_DATA_DIR", ""), "lawpilot.db"),
        os.path.join(os.getenv("APPDATA", ""), "lawpilot", "LawPilot", "lawpilot.db"),
        os.path.join(os.getenv("APPDATA", ""), "LawPilot", "lawpilot.db"),
        os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "LawPilot", "lawpilot.db"),
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return ""


def _get_model():
    """懒加载 BGE 嵌入模型（本地缓存优先，路径由 config.MODEL_CACHE_DIR 决定）"""
    global _embedding_model
    if _embedding_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            from app.config import MODEL_CACHE_DIR

            _embedding_model = SentenceTransformer(
                "BAAI/bge-small-zh-v1.5",
                cache_folder=MODEL_CACHE_DIR,
            )
        except Exception as e:
            raise RuntimeError(f"无法加载嵌入模型: {e}") from e
    return _embedding_model


def _get_reranker():
    """懒加载 BGE Cross-Encoder 重排模型（精排阶段，联合打分 query↔doc）

    bge-reranker-base 约 2.8 亿参数 / 1.1GB，本地单机的质量-速度最优点。
    模型随安装包内置（config.MODEL_CACHE_DIR）；加载失败时由调用方捕获并
    回退到向量+关键词排序。
    """
    global _reranker_model
    if _reranker_model is None:
        from sentence_transformers import CrossEncoder
        from app.config import MODEL_CACHE_DIR

        _reranker_model = CrossEncoder(
            "BAAI/bge-reranker-base",
            max_length=512,
            cache_folder=MODEL_CACHE_DIR,
        )
    return _reranker_model


def _get_table():
    """懒加载 LanceDB 表"""
    global _lancedb_table
    if _lancedb_table is None:
        try:
            import lancedb

            db = lancedb.connect(VECTOR_DIR)
            if "knowledge_base" in db.table_names():
                _lancedb_table = db.open_table("knowledge_base")
            else:
                # 创建空表（512 维向量）
                import pyarrow as pa

                schema = pa.schema(
                    [
                        pa.field("id", pa.string()),
                        pa.field("vector", pa.list_(pa.float32(), 512)),
                        pa.field("text", pa.string()),
                        pa.field("source_type", pa.string()),
                        pa.field("source_id", pa.string()),
                        pa.field("title", pa.string()),
                        pa.field("law_id", pa.string()),
                        pa.field("article_id", pa.string()),
                        pa.field("created_at", pa.float64()),
                    ]
                )
                _lancedb_table = db.create_table("knowledge_base", schema=schema)
        except Exception as e:
            raise RuntimeError(f"无法连接 LanceDB: {e}") from e
    return _lancedb_table


def _fetch_law_articles() -> list[dict]:
    """从 SQLite laws/articles 表读取法规条款"""
    db_path = _get_db_path()
    if not db_path:
        return []

    conn = sqlite3.connect(db_path)
    rows = conn.execute("""
        SELECT a.id, a.law_id, a.article_num, a.content, l.title AS law_title
        FROM articles a JOIN laws l ON a.law_id = l.id
        WHERE a.content IS NOT NULL AND a.content != ''
    """).fetchall()
    conn.close()

    results = []
    for row in rows:
        article_id, law_id, article_num, content, law_title = row[0], row[1], row[2] or '', row[3], row[4]
        prefix = f"《{law_title}》{article_num}"
        base_id = f"law:{law_id}:{article_num or '0'}"

        # 长条文分块：BGE 嵌入窗口 512 token(≈700 汉字)，超窗会被截断→尾部永久漏检。
        # 每块保留《法名》第X条前缀，使各块可独立召回且可归属到条文。
        if len(content) > 450:
            chunks = _split_text(content, chunk_size=400, overlap=80)
            for i, ch in enumerate(chunks):
                suffix = f":chunk{i}" if len(chunks) > 1 else ""
                results.append({
                    "id": f"{base_id}{suffix}",
                    "source_type": "law",
                    "source_id": article_id,
                    "title": law_title,
                    "text": f"{prefix}: {ch}",
                    "law_id": law_id,
                    "article_id": article_id,
                })
        else:
            results.append({
                "id": base_id,
                "source_type": "law",
                "source_id": article_id,
                "title": law_title,
                # 标题+条号进索引文本：跨法规同名条文可区分，法名查询可召回
                "text": f"{prefix}: {content}",
                "law_id": law_id,
                "article_id": article_id,
            })
    return results


# BGE v1.5 官方查询指令（仅查询侧使用，文档侧不加）
BGE_QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章："

# 380 字 ≈ 380-520 BPE token，确保不超出 bge-small-zh-v1.5 的 512 token 窗口
CHUNK_SIZE = 380
CHUNK_OVERLAP = 80


def _split_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """按段落和条款边界智能分块：句子内不截断、块间带 overlap、超长句强制切分"""
    import re

    if len(text) <= chunk_size:
        return [text]

    def _hard_split(long_text: str) -> list[str]:
        """把超过 chunk_size 的不可再分文本按固定窗口强制切分"""
        return [long_text[i:i + chunk_size] for i in range(0, len(long_text), chunk_size - overlap)]

    # 第一步：按空行/双换行拆成段落
    paragraphs = re.split(r'\n\s*\n', text)

    chunks: list[str] = []
    current = ''

    def _close_chunk():
        """关闭当前块；把尾部 overlap 文字带入下一块（按句子边界回退）"""
        nonlocal current
        if not current.strip():
            current = ''
            return
        chunks.append(current.strip())
        if overlap > 0 and len(current) > overlap:
            tail = current[-overlap:]
            # 从 tail 中找句子边界，避免 overlap 从句中开始
            m = re.search(r'[。；;！？\n]', tail)
            if m and m.end() < len(tail) - 10:
                tail = tail[m.end():]
            current = tail.strip()
        else:
            current = ''

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        # 段落本身超过 chunk_size，按条款/句子进一步拆分
        if len(para) > chunk_size:
            if current:
                _close_chunk()

            # 按"第X条"、句号、分号等拆分
            parts = re.split(r'(?=(?:第[一二三四五六七八九十百千零\d]+条[^\S\n]*|[；;。]))', para)
            for part in parts:
                part = part.strip()
                if not part:
                    continue
                # 单句仍超长：强制切分，直接成块
                if len(part) > chunk_size:
                    if current.strip():
                        _close_chunk()
                    for piece in _hard_split(part):
                        chunks.append(piece.strip())
                    current = ''
                    continue
                if len(current) + len(part) + 1 <= chunk_size:
                    current = (current + '\n' + part).strip() if current else part
                else:
                    _close_chunk()
                    current = part
        else:
            # 当前段落能放进现有 chunk 就合并
            if len(current) + len(para) + 1 <= chunk_size:
                current = (current + '\n\n' + para).strip() if current else para
            else:
                _close_chunk()
                current = para

    if current.strip():
        # 剩余内容太短且已有块时并入上一块
        if chunks and len(current.strip()) < overlap // 2:
            chunks[-1] = (chunks[-1] + '\n' + current.strip()).strip()
        else:
            chunks.append(current.strip())

    return chunks if chunks else [text[:chunk_size]]


def _fetch_materials() -> list[dict]:
    """从 SQLite materials 表读取已完成 OCR 的材料，长文本自动分块"""
    db_path = _get_db_path()
    if not db_path:
        return []

    conn = sqlite3.connect(db_path)
    rows = conn.execute("""
        SELECT id, original_name, raw_text, category
        FROM materials WHERE ocr_status = 'done' AND raw_text IS NOT NULL AND raw_text != ''
    """).fetchall()
    conn.close()

    results = []
    for row in rows:
        material_id = row[0]
        title = f"{row[1]} ({row[3]})"
        chunks = _split_text(row[2])
        for i, chunk in enumerate(chunks):
            suffix = f":chunk{i}" if len(chunks) > 1 else ""
            results.append({
                "id": f"material:{material_id}{suffix}",
                "source_type": "material",
                "source_id": material_id,
                "title": title,
                "text": chunk,
                "law_id": None,
                "article_id": None,
            })
    return results


# 重建进度状态（供 /knowledge/rebuild-progress 轮询）
_rebuild_state: dict = {
    "status": "idle",   # idle | running | done | error
    "done": 0,
    "total": 0,
    "current": "",
    "error": None,
    "result": None,
}


def get_rebuild_state() -> dict:
    return dict(_rebuild_state)


def rebuild_index() -> dict:
    """全量重建向量索引（进度写入 _rebuild_state，可被后台线程调用）"""
    global _rebuild_state
    _rebuild_state = {"status": "running", "done": 0, "total": 0, "current": "正在收集数据…", "error": None, "result": None}
    try:
        table = _get_table()
        model = _get_model()

        # 收集所有数据源
        data_sources = _fetch_law_articles() + _fetch_materials()
        if not data_sources:
            _rebuild_state.update(status="done", current="完成", result={"doc_count": 0, "message": "没有可索引的数据"})
            return {"doc_count": 0, "message": "没有可索引的数据"}

        # 同一文件重复上传会产生 id 不同但内容相同的块，按文本去重只索引一份
        _seen_text: set[str] = set()
        unique_sources = []
        for d in data_sources:
            tk = hashlib.md5(d["text"].strip().encode("utf-8")).hexdigest()
            if tk in _seen_text:
                continue
            _seen_text.add(tk)
            unique_sources.append(d)
        data_sources = unique_sources

        # 分块生成向量，报告进度
        _rebuild_state.update(total=len(data_sources), current="正在生成向量…")
        texts = [d["text"] for d in data_sources]
        embeddings_list = []
        batch_size = 64
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            embeddings_list.extend(model.encode(batch, normalize_embeddings=True, show_progress_bar=False))
            _rebuild_state["done"] = min(i + len(batch), len(texts))

        # 构建记录
        import time

        now = time.time()
        _rebuild_state["current"] = "正在写入索引…"
        records = []
        for i, ds in enumerate(data_sources):
            records.append(
                {
                    "id": ds["id"],
                    "vector": embeddings_list[i].tolist(),
                    "text": ds["text"],
                    "source_type": ds["source_type"],
                    "source_id": ds["source_id"],
                    "title": ds["title"],
                    "law_id": ds["law_id"] or "",
                    "article_id": ds["article_id"] or "",
                    "created_at": now,
                }
            )

        # 写入 LanceDB
        # 如果是已有数据，先删除旧表再重建
        try:
            import lancedb

            db = lancedb.connect(VECTOR_DIR)
            if "knowledge_base" in db.table_names():
                db.drop_table("knowledge_base")

            import pyarrow as pa

            schema = pa.schema(
                [
                    pa.field("id", pa.string()),
                    pa.field("vector", pa.list_(pa.float32(), 512)),
                    pa.field("text", pa.string()),
                    pa.field("source_type", pa.string()),
                    pa.field("source_id", pa.string()),
                    pa.field("title", pa.string()),
                    pa.field("law_id", pa.string()),
                    pa.field("article_id", pa.string()),
                    pa.field("created_at", pa.float64()),
                ]
            )
            new_table = db.create_table("knowledge_base", schema=schema)
            new_table.add(records)

            global _lancedb_table
            _lancedb_table = new_table
        except Exception:
            # Fallback: 直接 add
            table.add(records)

        result = {
            "doc_count": len(records),
            "law_count": len([d for d in data_sources if d["source_type"] == "law"]),
            "material_count": len([d for d in data_sources if d["source_type"] == "material"]),
            "message": "索引重建完成",
        }
        _rebuild_state.update(status="done", done=_rebuild_state["total"], current="完成", result=result)
        return result
    except Exception as e:
        _rebuild_state.update(status="error", error=str(e))
        raise


def search_similar(query: str, top_k: int = 10) -> list[SearchResult]:
    """混合检索：向量语义（超量取回）+ 有界关键词精确回退"""
    import re

    table = _get_table()
    model = _get_model()

    # 向量语义检索：超量取回 4 倍候选，供上层融合排序（避免排名边缘的相关块被截断）
    # BGE 官方建议：查询侧加指令前缀可显著提升短查询召回
    fetch_k = max(top_k * 4, 20)
    query_text = BGE_QUERY_PREFIX + query
    query_vec = model.encode([query_text], normalize_embeddings=True, show_progress_bar=False)[0]
    results = (
        table.search(query_vec.tolist())
        .metric("cosine")
        .limit(fetch_k)
        .select(["id", "source_type", "title", "text", "law_id", "article_id"])
        .to_list()
    )

    # 如果查询包含"第X条"，额外做关键词精确匹配（有界：最多补 8 条，避免淹没语义结果）
    article_match = re.search(r'第([一二三四五六七八九十百千零\d]+)条', query)
    if article_match:
        article_keyword = article_match.group(0)
        df = table.to_pandas()
        keyword_hits = df[df['text'].str.contains(article_keyword, na=False)].head(8)
        existing_ids = {r.get('id') for r in results}
        for _, row in keyword_hits.iterrows():
            if row['id'] not in existing_ids:
                results.append({
                    'id': row['id'],
                    'source_type': row['source_type'],
                    'title': row['title'],
                    'text': row['text'],
                    'law_id': row.get('law_id', ''),
                    'article_id': row.get('article_id', ''),
                    # 固定小 distance（相似度 0.9），精确命中优先但不至于完全压过语义结果
                    '_distance': 0.1,
                })

    return [
        SearchResult(
            id=r.get("id", ""),
            source_type=r.get("source_type", ""),
            title=r.get("title", ""),
            text=r.get("text", ""),
            law_id=r.get("law_id", "") if r.get("law_id") else None,
            article_id=r.get("article_id", "") if r.get("article_id") else None,
            distance=r.get("_distance", 0),
        )
        for r in results
    ]


def rerank(query: str, candidates: list[SearchResult], top_n: int = 10) -> list[SearchResult]:
    """Cross-Encoder 精排：对 (query, doc) 联合打分，语义理解远强于独立编码的向量。

    candidates 为召回池（向量+关键词的并集）。按重排分降序取 top_n。
    重排模型不可用（未下载/加载失败）时原样返回 candidates，优雅降级。
    """
    if not candidates:
        return candidates
    try:
        model = _get_reranker()
    except Exception:
        return candidates

    pairs = [[query, (c.get("text") or "")[:400]] for c in candidates]
    try:
        scores = model.predict(pairs, show_progress_bar=False)
    except Exception:
        return candidates

    # 按重排分降序取 top_n，把分数附到块上（供上层做相关性阈值过滤）
    order = sorted(range(len(candidates)), key=lambda i: scores[i], reverse=True)
    out = []
    for i in order[:top_n]:
        c = dict(candidates[i])
        c["rerank_score"] = round(float(scores[i]), 4)
        out.append(c)
    return out


def keyword_recall(keywords: list[str], top_k: int = 20) -> list[SearchResult]:
    """关键词召回通道：全文匹配含关键词的块，补足向量语义漏召。

    法规条文措辞密集，查询与原文词汇重叠时此通道可把相关块拉进召回池，
    交给重排器精排。本地数据量小（数千条），全表过滤开销可接受。
    """
    if not keywords:
        return []
    table = _get_table()
    try:
        df = table.to_pandas()
    except Exception:
        return []
    if df.empty:
        return []

    text = df["text"].fillna("")
    title = df["title"].fillna("")
    # 命中关键词数越多越相关
    hit_counts = np.zeros(len(df))
    for kw in keywords:
        k = kw.lower()
        if len(k) < 2:
            continue
        hit_counts += text.str.lower().str.contains(k, regex=False).to_numpy() + \
            title.str.lower().str.contains(k, regex=False).to_numpy()

    mask = hit_counts > 0
    if not mask.any():
        return []
    idx = np.argsort(-hit_counts, kind="stable")[:top_k]
    idx = [i for i in idx if mask[i]]

    return [
        SearchResult(
            id=df["id"].iloc[i],
            source_type=df["source_type"].iloc[i],
            title=df["title"].iloc[i],
            text=df["text"].iloc[i],
            law_id=df["law_id"].iloc[i] if df["law_id"].iloc[i] else None,
            article_id=df["article_id"].iloc[i] if df["article_id"].iloc[i] else None,
            # 归一化：命中数越多 distance 越小（相关度越高）
            distance=round(1.0 - hit_counts[i] / max(hit_counts.max(), 1), 4),
        )
        for i in idx
    ]


def get_index_status() -> dict:
    """获取索引统计信息"""
    try:
        table = _get_table()
        count = table.count_rows()
        return {"doc_count": count, "ok": True}
    except Exception as e:
        return {"doc_count": 0, "ok": False, "error": str(e)}


def upsert_document(
    doc_id: str,
    text: str,
    source_type: str,
    source_id: str,
    title: str = "",
    law_id: str = "",
    article_id: str = "",
) -> bool:
    """追加或更新单条文档索引"""
    try:
        table = _get_table()
        model = _get_model()
        vec = model.encode([text], normalize_embeddings=True, show_progress_bar=False)[0]
        import time

        table.add(
            [
                {
                    "id": doc_id,
                    "vector": vec.tolist(),
                    "text": text,
                    "source_type": source_type,
                    "source_id": source_id,
                    "title": title,
                    "law_id": law_id,
                    "article_id": article_id,
                    "created_at": time.time(),
                }
            ]
        )
        return True
    except Exception:
        return False
