from app.routers.ocr import router as ocr_router
from app.routers.classify import router as classify_router
from app.routers.export import router as export_router

__all__ = ["ocr_router", "classify_router", "export_router"]
