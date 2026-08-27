"""导出服务 — PDF 生成 (reportlab)"""
import os
from datetime import datetime
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/export", tags=["export"])


class PdfMaterial(BaseModel):
    """材料数据"""
    original_name: str
    category: str = ""
    raw_text: str | None = None


class PdfExportRequest(BaseModel):
    case_id: str
    case_number: str | None = None
    title: str = "案件"
    court: str | None = None
    filing_date: str | None = None
    save_path: str
    materials: list[PdfMaterial] = []


class PdfExportResponse(BaseModel):
    success: bool
    path: str
    error: str | None = None


def _generate_pdf(req: PdfExportRequest):
    """生成真实内容的 PDF 卷宗"""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    )
    from reportlab.lib import colors

    doc = SimpleDocTemplate(
        req.save_path,
        pagesize=A4,
        rightMargin=2.5 * cm,
        leftMargin=2.5 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title_CN", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=22
    )
    heading_style = ParagraphStyle(
        "Heading_CN", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=14
    )
    toc_style = ParagraphStyle(
        "TOC_CN", parent=styles["Normal"], fontName="Helvetica", fontSize=11, leading=20,
        leftIndent=1 * cm,
    )
    body_style = ParagraphStyle(
        "Body_CN", parent=styles["Normal"], fontName="Helvetica", fontSize=11, leading=18
    )

    story = []

    # ----- 封面 -----
    story.append(Spacer(1, 4 * cm))
    story.append(Paragraph("电子卷宗", title_style))
    story.append(Spacer(1, 1.5 * cm))

    case_info = [
        ["案号", req.case_number or "-"],
        ["案由", req.title],
        ["管辖法院", req.court or "-"],
        ["立案日期", req.filing_date or "-"],
        ["材料数量", f"{len(req.materials)} 份"],
        ["生成日期", datetime.now().strftime("%Y年%m月%d日")],
    ]

    info_table = Table(case_info, colWidths=[4 * cm, 10 * cm])
    info_table.setStyle(
        TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 12),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#555555")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#f9f9f9")]),
        ])
    )
    story.append(info_table)
    story.append(PageBreak())

    # ----- 目录（从材料列表生成） -----
    story.append(Paragraph("目　录", heading_style))
    story.append(Spacer(1, 0.5 * cm))

    for i, m in enumerate(req.materials):
        label = f"[{m.category}] " if m.category else ""
        story.append(Paragraph(
            f"{i + 1}. {label}{m.original_name}",
            toc_style,
        ))

    story.append(PageBreak())

    # ----- 正文（每份材料的内容） -----
    for i, m in enumerate(req.materials):
        story.append(Paragraph(f"材料 {i + 1}：{m.original_name}", heading_style))
        story.append(Spacer(1, 0.3 * cm))
        if m.category:
            story.append(Paragraph(f"分类：{m.category}", body_style))

        if m.raw_text:
            # 将文本按段落分割，每段一个 Paragraph
            paragraphs = m.raw_text.split("\n")
            for p_text in paragraphs:
                p_text = p_text.strip()
                if p_text:
                    # 转义 HTML 特殊字符
                    p_text = p_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    story.append(Paragraph(p_text, body_style))
                    story.append(Spacer(1, 0.15 * cm))
        else:
            story.append(Paragraph("（无文本内容）", body_style))

        if i < len(req.materials) - 1:
            story.append(PageBreak())

    doc.build(story)


@router.post("/pdf", response_model=PdfExportResponse)
async def export_pdf(req: PdfExportRequest):
    """生成案件卷宗 PDF（封面 + 目录 + 正文）"""
    try:
        _generate_pdf(req)
        return PdfExportResponse(success=True, path=req.save_path)

    except ImportError as e:
        # reportlab 未安装，降级为纯文本
        try:
            content = (
                f"电子卷宗\n\n"
                f"案号: {req.case_number or '-'}\n"
                f"案由: {req.title}\n"
                f"管辖法院: {req.court or '-'}\n"
                f"立案日期: {req.filing_date or '-'}\n\n"
                f"=== 材料列表 ({len(req.materials)} 份) ===\n\n"
            )
            for i, m in enumerate(req.materials):
                content += f"[{i + 1}] {m.original_name} ({m.category})\n"
                if m.raw_text:
                    content += f"{m.raw_text[:800]}\n\n"

            os.makedirs(os.path.dirname(req.save_path) or ".", exist_ok=True)
            with open(req.save_path, "w", encoding="utf-8") as f:
                f.write(content)
            return PdfExportResponse(success=True, path=req.save_path)
        except Exception as ex:
            return PdfExportResponse(success=False, path=req.save_path, error=str(ex))
    except Exception as e:
        return PdfExportResponse(success=False, path=req.save_path, error=str(e))
