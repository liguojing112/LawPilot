"""本地向量知识库 — BGE-small-zh + LanceDB 索引"""

import os
import json
import sqlite3
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
_lancedb_table = None


def _get_db_path() -> str:
    """查找 SQLite 数据库路径"""
    from pathlib import Path

    home = Path.home()
    candidates = list(home.glob("**/LawPilot/lawpilot.db"))
    if candidates:
        return str(candidates[0])
    return ""


def _get_model():
    """懒加载 BGE 嵌入模型"""
    global _embedding_model
    if _embedding_model is None:
        try:
            from sentence_transformers import SentenceTransformer

            _embedding_model = SentenceTransformer(
                "BAAI/bge-small-zh-v1.5",
                cache_folder=os.path.join(os.path.dirname(VECTOR_DIR), "models"),
            )
        except Exception as e:
            raise RuntimeError(f"无法加载嵌入模型: {e}") from e
    return _embedding_model


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

    return [
        {
            "id": f"law:{row[1]}:{row[2] or '0'}",
            "source_type": "law",
            "source_id": row[0],
            "title": row[4],
            "text": f"{row[2] or ''}: {row[3]}",
            "law_id": row[1],
            "article_id": row[0],
        }
        for row in rows
    ]


def _fetch_materials() -> list[dict]:
    """从 SQLite materials 表读取已完成 OCR 的材料"""
    db_path = _get_db_path()
    if not db_path:
        return []

    conn = sqlite3.connect(db_path)
    rows = conn.execute("""
        SELECT id, original_name, raw_text, category
        FROM materials WHERE ocr_status = 'done' AND raw_text IS NOT NULL AND raw_text != ''
    """).fetchall()
    conn.close()

    return [
        {
            "id": f"material:{row[0]}",
            "source_type": "material",
            "source_id": row[0],
            "title": f"{row[1]} ({row[3]})",
            "text": row[2][:1000],
            "law_id": None,
            "article_id": None,
        }
        for row in rows
    ]


def rebuild_index() -> dict:
    """全量重建向量索引"""
    table = _get_table()
    model = _get_model()

    # 收集所有数据源
    data_sources = _fetch_law_articles() + _fetch_materials()
    if not data_sources:
        return {"doc_count": 0, "message": "没有可索引的数据"}

    # 批量生成向量
    texts = [d["text"] for d in data_sources]
    embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)

    # 构建记录
    import time

    now = time.time()
    records = []
    for i, ds in enumerate(data_sources):
        records.append(
            {
                "id": ds["id"],
                "vector": embeddings[i].tolist(),
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

    return {
        "doc_count": len(records),
        "law_count": len([d for d in data_sources if d["source_type"] == "law"]),
        "material_count": len([d for d in data_sources if d["source_type"] == "material"]),
        "message": "索引重建完成",
    }


def search_similar(query: str, top_k: int = 5) -> list[SearchResult]:
    """向量语义检索"""
    table = _get_table()
    model = _get_model()

    # 嵌入查询
    query_vec = model.encode([query], normalize_embeddings=True, show_progress_bar=False)[0]

    # LanceDB search
    results = (
        table.search(query_vec.tolist())
        .metric("cosine")
        .limit(top_k)
        .select(["id", "source_type", "title", "text", "law_id", "article_id"])
        .to_list()
    )

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
