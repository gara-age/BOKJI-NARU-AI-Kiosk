from __future__ import annotations

import re


MASK_RULES = (
    (re.compile(r"(?<!\d)\d{6}-?[1-4]\d{6}(?!\d)"), "[주민등록번호 마스킹]"),
    (re.compile(r"(?<!\d)\d{2,3}-?\d{3,4}-?\d{4}(?!\d)"), "[전화번호 마스킹]"),
    (re.compile(r"(?<!\d)\d{2,6}-\d{2,6}-\d{2,6}(?!\d)"), "[계좌번호 마스킹]"),
    (re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[이메일 마스킹]"),
)


def mask_sensitive_text(value: str) -> str:
    masked = value
    for pattern, replacement in MASK_RULES:
        masked = pattern.sub(replacement, masked)
    return masked


def contains_sensitive_input(value: str) -> bool:
    return mask_sensitive_text(value) != value


def safe_staff_message() -> str:
    return "개인별 소득, 재산, 가구 상황과 예외 사항은 담당자와 함께 확인해 주세요."
