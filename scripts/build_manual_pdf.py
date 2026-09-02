"""
从 HelpDrawer.tsx 的 HELP_CONTENT 生成《LawPilot 用户手册》PDF。
内容单一来源：改帮助手册时 PDF 自动同步。
运行: python scripts/build_manual_pdf.py [输出路径]
默认输出: dist/LawPilot用户手册1.0.0.pdf
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "dist" / "LawPilot用户手册1.0.0.pdf"
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",   # 微软雅黑
    r"C:\Windows\Fonts\msyh.ttf",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
]


def extract_help_content() -> str:
    src = (ROOT / "src" / "components" / "HelpDrawer.tsx").read_text(encoding="utf-8")
    m = re.search(r"const HELP_CONTENT = `(.*?)`\n", src, re.S)
    if not m:
        raise SystemExit("未在 HelpDrawer.tsx 中找到 HELP_CONTENT")
    return m.group(1).strip()


def inline(text: str) -> str:
    """转义 XML 特殊字符并转换内联 Markdown（**加粗** / `代码` / *斜体*）"""
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`(.+?)`", r'<font color="#c7254e">\1</font>', text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", text)
    return text.strip()


def build_pdf(content: str, out_path: Path):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem, HRFlowable,
    )

    font_file = next((p for p in FONT_CANDIDATES if Path(p).exists()), None)
    if not font_file:
        raise SystemExit("未找到中文字体（msyh/simhei/simsun）")
    pdfmetrics.registerFont(TTFont("CJK", font_file, subfontIndex=0))

    F = "CJK"
    st_h1 = ParagraphStyle("h1", fontName=F, fontSize=20, leading=28, spaceAfter=6, textColor=colors.HexColor("#1a1a2e"))
    st_h2 = ParagraphStyle("h2", fontName=F, fontSize=15, leading=22, spaceBefore=14, spaceAfter=6, textColor=colors.HexColor("#1677ff"))
    st_h3 = ParagraphStyle("h3", fontName=F, fontSize=12, leading=18, spaceBefore=10, spaceAfter=4, textColor=colors.HexColor("#333333"))
    st_p = ParagraphStyle("p", fontName=F, fontSize=10, leading=16, spaceAfter=4)
    st_li = ParagraphStyle("li", fontName=F, fontSize=10, leading=16, leftIndent=4)

    doc = SimpleDocTemplate(
        str(out_path), pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
        title="LawPilot 用户手册", author="LawPilot",
    )

    story = []
    i, lines = 0, content.split("\n")
    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        if stripped.startswith("### "):
            story.append(Paragraph(inline(stripped[4:]), st_h3))
        elif stripped.startswith("## "):
            story.append(Paragraph(inline(stripped[3:]), st_h2))
        elif stripped.startswith("# "):
            story.append(Paragraph(inline(stripped[2:]), st_h1))
        elif stripped == "---":
            story.append(Spacer(1, 4))
            story.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#d9d9d9")))
            story.append(Spacer(1, 4))
        elif stripped.startswith("- "):
            items = []
            while i < len(lines) and lines[i].strip().startswith("- "):
                items.append(ListItem(Paragraph(inline(lines[i].strip()[2:]), st_li)))
                i += 1
            story.append(ListFlowable(items, bulletType="bullet", start="circle", leftIndent=12))
            continue
        elif re.match(r"^\d+\.\s", stripped):
            items = []
            while i < len(lines) and re.match(r"^\d+\.\s", lines[i].strip()):
                items.append(ListItem(Paragraph(inline(re.sub(r"^\d+\.\s", "", lines[i].strip())), st_li)))
                i += 1
            story.append(ListFlowable(items, bulletType="1", leftIndent=12))
            continue
        else:
            story.append(Paragraph(inline(stripped), st_p))
        i += 1

    doc.build(story)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    out.parent.mkdir(parents=True, exist_ok=True)
    content = extract_help_content()
    build_pdf(content, out)
    size = out.stat().st_size / 1024
    print(f"OK: {out} ({size:.0f} KB)")


if __name__ == "__main__":
    main()
