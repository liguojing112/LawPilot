from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    """健康检查端点 — 供 Electron 主进程检测 Python 服务是否就绪"""
    return {"status": "ok", "version": "0.1.0"}
