"""法律文书分类服务 — 规则引擎"""
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/classify", tags=["classify"])


class ClassifyRequest(BaseModel):
    file_name: str
    text: str

class ClassifyResponse(BaseModel):
    category: str
    confidence: float

CATEGORY_RULES = {
    "起诉状": {
        "keywords": [
            "起诉状", "民事起诉状", "刑事自诉状", "行政起诉状",
            "具状人", "诉讼请求", "原告", "被告",
        ],
        "weight": 10,
    },
    "答辩状": {
        "keywords": ["答辩状", "民事答辩状", "答辩人", "辩称"],
        "weight": 10,
    },
    "证据": {
        "keywords": [
            "证据目录", "证据清单", "证据材料", "证据来源",
            "证明目的",
        ],
        "weight": 8,
    },
    "判决": {
        "keywords": [
            "判决书", "民事判决书", "刑事判决书", "行政判决书",
            "判决如下", "经审理查明", "本判决", "驳回",
            "人民法院", "合议庭",
        ],
        "weight": 10,
    },
    "裁定": {
        "keywords": ["裁定书", "民事裁定书", "裁定如下", "裁定驳回"],
        "weight": 10,
    },
    "合同": {
        "keywords": [
            "合同", "协议", "甲方", "乙方", "签订日期",
            "违约责任", "合同争议",
        ],
        "weight": 7,
    },
}


@router.post("", response_model=ClassifyResponse)
async def classify(req: ClassifyRequest):
    file_name_lower = req.file_name.lower()
    text_lower = req.text.lower()
    text_len = len(req.text)

    best_category = "其他"
    best_score = 0.0

    for category, rules in CATEGORY_RULES.items():
        score = 0.0

        # 文件名关键词匹配（权重 ×2）
        for kw in rules["keywords"]:
            if kw.lower() in file_name_lower:
                score += 2.0

        # 文本内容关键词匹配
        for kw in rules["keywords"]:
            if kw.lower() in text_lower:
                score += 1.0

        # 文本长度不足时降低置信度
        if text_len < 50:
            score = score * 0.6

        max_possible = len(rules["keywords"]) * 3
        normalized = score / max_possible if max_possible > 0 else 0

        if normalized > best_score:
            best_score = normalized
            best_category = category

    confidence = min(round(best_score, 2), 0.99)

    # 分数过低归为"其他"
    if confidence < 0.25:
        best_category = "其他"
        confidence = 0.3

    return ClassifyResponse(category=best_category, confidence=confidence)
