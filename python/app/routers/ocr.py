"""OCR 文本提取服务 — PaddleOCR + pdfplumber + python-docx"""
import os

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/ocr", tags=["ocr"])


class ExtractRequest(BaseModel):
    file_path: str
    file_type: str  # pdf / png / jpg / jpeg / doc / docx


class ExtractResponse(BaseModel):
    text: str
    page_count: int = 1


def _extract_image(file_path: str) -> tuple[str, int]:
    """使用 PaddleOCR 提取图片文本"""
    try:
        from paddleocr import PaddleOCR

        ocr = PaddleOCR(lang="ch", show_log=False)
        result = ocr.ocr(file_path)
        if not result or not result[0]:
            return "", 1

        lines = []
        for line in result[0]:
            if line and len(line) >= 2:
                text = line[1][0] if isinstance(line[1], (list, tuple)) else str(line[1])
                lines.append(text)
        return "\n".join(lines), 1
    except ImportError:
        return "[PaddleOCR 未安装，请运行 pip install paddleocr paddlepaddle]", 1
    except Exception as e:
        raise RuntimeError(f"OCR 处理失败: {e}") from e


def _extract_pdf(file_path: str) -> tuple[str, int]:
    """使用 pdfplumber 提取 PDF 文本"""
    try:
        import pdfplumber

        with pdfplumber.open(file_path) as pdf:
            pages = []
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    pages.append(text)
            text = "\n\n".join(pages)

            # 如果没有提取到文本，可能是扫描件，降级使用 OCR
            if not text.strip():
                # 将 PDF 第一页转图片后 OCR（简单降级方案）
                return _extract_image(file_path)

            return text, len(pdf.pages)
    except ImportError:
        return "[pdfplumber 未安装]", 1
    except Exception as e:
        raise RuntimeError(f"PDF 提取失败: {e}") from e


def _extract_docx(file_path: str) -> tuple[str, int]:
    """使用 python-docx 提取 Word 文档文本"""
    try:
        from docx import Document

        doc = Document(file_path)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n".join(paragraphs), 1
    except ImportError:
        return "[python-docx 未安装]", 1
    except Exception as e:
        raise RuntimeError(f"Word 文档提取失败: {e}") from e


@router.post("/extract", response_model=ExtractResponse)
async def extract_text(req: ExtractRequest):
    """从文件中提取文本"""
    if not os.path.exists(req.file_path):
        return ExtractResponse(text="", page_count=0)

    file_type = req.file_type.lower()

    if file_type in ("png", "jpg", "jpeg", "tiff", "tif"):
        text, page_count = _extract_image(req.file_path)
    elif file_type == "pdf":
        text, page_count = _extract_pdf(req.file_path)
    elif file_type in ("doc", "docx"):
        text, page_count = _extract_docx(req.file_path)
    else:
        # 尝试作为文本文件直接读取
        with open(req.file_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
        page_count = 1

    return ExtractResponse(text=text, page_count=page_count)
