import os

PYTHON_PORT = int(os.getenv("LAWPILOT_PYTHON_PORT", "18920"))
MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
# 数据目录：开发模式=项目根/data（含模型缓存），生产模式由 Electron 注入
# LAWPILOT_DATA_DIR 指向用户目录（%APPDATA%/lawpilot/LawPilot，可写）
DATA_DIR = os.getenv("LAWPILOT_DATA_DIR") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data"
)
VECTOR_DIR = os.path.join(DATA_DIR, "vectors")
# 模型目录：生产模式由 Electron 注入（resources/data/models，只读）
MODEL_CACHE_DIR = os.getenv("LAWPILOT_MODEL_DIR") or os.path.join(DATA_DIR, "models")
