import os

PYTHON_PORT = int(os.getenv("LAWPILOT_PYTHON_PORT", "18920"))
MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
VECTOR_DIR = os.path.join(DATA_DIR, "vectors")
