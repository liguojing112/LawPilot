"""知识库管理路由 — 索引构建/状态/搜索"""
import threading

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.embedding_service import rebuild_index, get_index_status, search_similar, get_rebuild_state

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


class RebuildResponse(BaseModel):
    started: bool = False
    status: str = "idle"
    done: int = 0
    total: int = 0
    current: str = ""
    error: str | None = None


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
    """全量重建向量索引（后台线程执行，立即返回，进度走 /rebuild-progress）"""
    st = get_rebuild_state()
    if st["status"] == "running":
        return RebuildResponse(started=False, **{k: st[k] for k in ("status", "done", "total", "current", "error")})

    def _run():
        try:
            rebuild_index()
        except Exception:
            # rebuild_index 内部已把状态置为 error 并抛出，这里仅吞掉避免线程异常打印
            pass

    threading.Thread(target=_run, daemon=True).start()
    return RebuildResponse(started=True, status="running")


@router.get("/rebuild-progress")
async def rebuild_progress():
    """轮询重建进度"""
    return get_rebuild_state()


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
