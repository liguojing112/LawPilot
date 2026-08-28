"""隐私脱敏服务"""
import re
from typing import TypedDict

PrivacyMap = dict[str, str]


class MaskResult(TypedDict):
    masked_text: str
    mapping: dict[str, str]
    count: int


# 默认正则模式
DEFAULT_PATTERNS: dict[str, str] = {
    "身份证号": r"\b\d{17}[\dXx]\b|\b\d{15}\b",
    "手机号": r"\b1[3-9]\d{9}\b",
    "银行账号": r"\b\d{16,19}\b",
    "电子邮箱": r"\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b",
    "统一社会信用代码": r"\b[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}\b",
}

# 占位符模板
PLACEHOLDER_TEMPLATE = "[{type}_{index}]"


def mask_text(
    text: str, level: str = "standard", custom_patterns: dict[str, str] | None = None
) -> MaskResult:
    """对文本进行脱敏处理

    Args:
        text: 原始文本
        level: 脱敏级别 "standard"
        custom_patterns: 自定义正则模式 {名称: 正则}

    Returns:
        { masked_text, mapping, count }
    """
    patterns = dict(DEFAULT_PATTERNS)

    if custom_patterns:
        patterns.update(custom_patterns)

    mapping: dict[str, str] = {}
    masked_text = text
    count = 0

    for category, pattern in patterns.items():
        regex = re.compile(pattern)
        matches = list(regex.finditer(masked_text))

        # 从后往前替换，避免索引偏移
        for match in reversed(matches):
            original = match.group(0)
            placeholder = PLACEHOLDER_TEMPLATE.format(type=category, index=count + 1)
            count += 1
            mapping[placeholder] = original
            masked_text = (
                masked_text[: match.start()] + placeholder + masked_text[match.end():]
            )

    return MaskResult(masked_text=masked_text, mapping=mapping, count=count)


def restore_masked(text: str, mapping: dict[str, str]) -> str:
    """将脱敏后的文本恢复为原文"""
    result = text
    for placeholder, original in sorted(
        mapping.items(), key=lambda x: len(x[1]), reverse=True
    ):
        result = result.replace(placeholder, original)
    return result


def preview_mask(text: str, level: str = "standard") -> list[dict]:
    """预览脱敏结果：返回 (原始片段, 占位符, 类型) 列表"""
    result = mask_text(text, level)
    preview = []
    for placeholder, original in result["mapping"].items():
        preview.append({"original": original, "placeholder": placeholder})
    return preview
