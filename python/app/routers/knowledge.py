"""知识库管理路由 — 索引构建/状态/搜索"""
from fastapi import APIRouter
from pydantic import BaseModel

from app.services.embedding_service import rebuild_index, get_index_status, search_similar

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


class RebuildResponse(BaseModel):
    doc_count: int = 0
    law_count: int = 0
    material_count: int = 0
    message: str = ""


class StatusResponse(BaseModel):
    doc_count: int = 0
    ok: bool = True
    error: str | None = None


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


class SearchResultItem(BaseModel):
    id: str
    source_type: str
    title: str
    text: str
    law_id: str | None = None
    article_id: str | None = None
    distance: float = 0.0


@router.post("/rebuild", response_model=RebuildResponse)
async def rebuild():
    """全量重建向量索引"""
    try:
        result = rebuild_index()
        return RebuildResponse(**result)
    except Exception as e:
        return RebuildResponse(message=str(e))


@router.get("/status", response_model=StatusResponse)
async def status():
    """获取索引状态"""
    try:
        result = get_index_status()
        return StatusResponse(**result)
    except Exception as e:
        return StatusResponse(ok=False, error=str(e))


@router.post("/search")
async def search(req: SearchRequest) -> list[SearchResultItem]:
    """向量语义搜索"""
    try:
        results = search_similar(req.query, req.top_k)
        return [SearchResultItem(**r) for r in results]
    except Exception:
        return []
