from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.health import router as health_router
from app.routers.ocr import router as ocr_router
from app.routers.classify import router as classify_router
from app.routers.export import router as export_router
from app.routers.llm import router as llm_router
from app.routers.knowledge import router as knowledge_router

app = FastAPI(
    title="LawPilot Python Service",
    version="0.1.0",
    description="LawPilot 本地 AI 微服务 — OCR、NER、向量检索",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(ocr_router)
app.include_router(classify_router)
app.include_router(export_router)
app.include_router(llm_router)
app.include_router(knowledge_router)


@app.on_event("startup")
async def startup():
    pass


@app.on_event("shutdown")
async def shutdown():
    pass
