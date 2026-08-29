from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .schemas import Recommendation, Source


class OfficialInfoProvider(Protocol):
    def search(self, category: str) -> list[Recommendation]: ...

    def approved_count(self) -> int: ...


@dataclass(frozen=True)
class SeedProgram:
    program_id: str
    category: str
    name: str
    plain_name: str
    guidance: str
    preparation_items: tuple[str, ...]
    needs_confirmation: tuple[str, ...]
    office_hint: str
    source_name: str
    source_url: str


PROGRAMS = (
    SeedProgram(
        "basic-livelihood", "basic", "국민기초생활 보장 상담", "생활이 어려울 때 받을 수 있는 지원 상담",
        "생활비와 주거비 등에 어려움이 있을 때 주민센터에서 지원 가능 여부를 상담할 수 있습니다.",
        ("신분증", "가구 상황을 확인할 수 있는 기본 자료"),
        ("가구의 소득과 재산", "부양 관계와 실제 거주 상황"), "주민센터 복지 상담 창구",
        "복지로", "https://www.bokjiro.go.kr",
    ),
    SeedProgram(
        "emergency-welfare", "emergency", "긴급복지 지원 상담", "갑작스러운 위기 상황 지원 상담",
        "실직, 질병, 주거 위기처럼 갑작스러운 어려움이 생긴 경우 긴급한 도움을 받을 수 있는지 상담할 수 있습니다.",
        ("신분증", "위기 상황을 설명할 수 있는 자료가 있으면 함께 준비"),
        ("위기 상황의 종류와 시점", "소득과 재산", "다른 지원을 받고 있는지"), "주민센터 복지 상담 창구 또는 긴급 상담",
        "복지로", "https://www.bokjiro.go.kr",
    ),
    SeedProgram(
        "elder-care", "elder", "노인 돌봄 서비스 상담", "어르신 일상생활 도움 상담",
        "일상생활에 도움이 필요한 어르신은 돌봄과 생활 지원 서비스를 상담할 수 있습니다.",
        ("신분증", "필요한 도움을 간단히 적은 메모"),
        ("연령과 건강·생활 상태", "가족 돌봄 상황", "거주 지역의 제공 기관"), "주민센터 또는 노인복지 상담 창구",
        "복지로", "https://www.bokjiro.go.kr",
    ),
    SeedProgram(
        "disability-activity", "disability", "장애인 활동지원 상담", "일상 활동을 돕는 서비스 상담",
        "일상생활과 사회활동에 도움이 필요한 경우 활동지원 관련 상담을 받을 수 있습니다.",
        ("신분증", "장애 등록 관련 기본 확인 자료"),
        ("장애 등록 상태", "필요한 활동 지원의 종류", "개인별 심사 결과"), "주민센터 장애인복지 상담 창구",
        "복지로", "https://www.bokjiro.go.kr",
    ),
    SeedProgram(
        "youth-rent", "youth", "청년 주거·월세 지원 상담", "청년의 주거비 도움 상담",
        "청년을 위한 주거비와 월세 지원은 지역과 시기에 따라 운영 내용이 다를 수 있어 상담으로 확인하는 것이 좋습니다.",
        ("신분증", "임대차 계약 관련 자료", "소득 관련 기본 자료"),
        ("나이와 거주 지역", "임대차 계약 상태", "소득과 가구 상황", "신청 기간"), "주민센터 청년·주거 상담 창구",
        "정부24", "https://www.gov.kr",
    ),
)


class SeedOfficialInfoProvider:
    def search(self, category: str) -> list[Recommendation]:
        matches = [item for item in PROGRAMS if item.category == category]
        if not matches:
            return []
        return [
            Recommendation(
                program_id=item.program_id,
                name=item.name,
                plain_name=item.plain_name,
                status="일부 확인됨",
                guidance=item.guidance,
                preparation_items=list(item.preparation_items),
                needs_confirmation=list(item.needs_confirmation),
                office_hint=item.office_hint,
                source=Source(name=item.source_name, url=item.source_url, checked_at="2026-08-29"),
            )
            for item in matches
        ]

    def approved_count(self) -> int:
        return len(PROGRAMS)

    def names_for(self, program_ids: list[str]) -> list[str]:
        by_id = {item.program_id: item.plain_name for item in PROGRAMS}
        return [by_id[item] for item in program_ids if item in by_id]


class PublicDataOfficialInfoProvider:
    """Reserved adapter for a verified public-data API; never falls back to web scraping."""

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def search(self, category: str) -> list[Recommendation]:
        raise NotImplementedError("Public-data API mapping is enabled after a verified API key and endpoint are configured.")

    def approved_count(self) -> int:
        return 0
