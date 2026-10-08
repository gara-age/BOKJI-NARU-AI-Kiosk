from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Callable, Protocol
from xml.etree import ElementTree

import httpx

from .schemas import AdminProgramReview, Recommendation, Source
from .store import Store

if TYPE_CHECKING:
    from .config import Settings


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
    requires_initial_review: bool = False


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
        "elder-customized-care", "elder", "노인맞춤돌봄서비스 상담", "노인맞춤돌봄서비스 준비 상담",
        "일상생활에 어려움이 있는 어르신은 노인맞춤돌봄서비스의 제공 내용과 지역 수행기관을 상담할 수 있습니다.",
        ("신분증", "필요한 돌봄 내용을 적은 메모"),
        ("연령과 일상생활의 어려움", "가족 돌봄 상황", "거주 지역의 수행기관"), "주민센터 또는 노인맞춤돌봄 수행기관",
        "복지로", "https://www.bokjiro.go.kr", True,
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
    SeedProgram(
        "housing-support", "housing", "주거·주택 지원 상담", "주거비와 주택 관련 지원 상담",
        "월세, 전세, 임대주택 등 주거 문제로 어려움이 있을 때 지원 제도와 신청 경로를 상담할 수 있습니다.",
        ("신분증", "임대차 계약 관련 자료가 있으면 함께 준비"),
        ("거주 지역", "가구 구성과 소득", "현재 주거 형태", "신청 기간"), "주민센터 주거복지 상담 창구",
        "복지로", "https://www.bokjiro.go.kr",
    ),
    SeedProgram(
        "employment-support", "employment", "취업·자활·직업훈련 상담", "일자리와 직업훈련 지원 상담",
        "취업 준비, 일자리, 자활 또는 직업훈련과 관련한 지원 제도를 상담할 수 있습니다.",
        ("신분증", "현재 구직 또는 근로 상황을 설명할 수 있는 자료"),
        ("나이와 거주 지역", "고용 상태", "소득과 가구 상황", "희망 직종"), "주민센터 또는 고용·자활 상담 창구",
        "고용24", "https://www.work24.go.kr",
    ),
    SeedProgram(
        "pregnancy-childbirth", "pregnancy", "임신·출산 지원 상담", "임신과 출산 관련 지원 상담",
        "임신과 출산 과정에서 필요한 의료비, 돌봄, 양육 시작 지원을 상담할 수 있습니다.",
        ("신분증", "임신 또는 출산 관련 확인 자료가 있으면 함께 준비"),
        ("임신·출산 시기", "거주 지역", "가구 상황", "다른 지원 이용 여부"), "주민센터 또는 보건소 상담 창구",
        "정부24", "https://www.gov.kr",
    ),
    SeedProgram(
        "child-youth", "child", "아동·청소년 지원 상담", "아동과 청소년의 돌봄·생활 지원 상담",
        "아동과 청소년의 돌봄, 생활, 방과 후 지원에 관한 제도를 상담할 수 있습니다.",
        ("보호자 신분증", "아동 또는 청소년의 기본 정보를 확인할 수 있는 자료"),
        ("나이와 학년", "보호자와 가구 상황", "거주 지역", "돌봄 필요 시간"), "주민센터 아동·청소년 상담 창구",
        "복지로", "https://www.bokjiro.go.kr",
    ),
    SeedProgram(
        "education-scholarship", "education", "교육·장학 지원 상담", "학업과 교육비 지원 상담",
        "교육비, 장학금, 학자금 등 학업을 위한 지원 제도를 상담할 수 있습니다.",
        ("신분증", "재학 또는 입학 관련 자료가 있으면 함께 준비"),
        ("학교와 학년", "가구 소득", "거주 지역", "신청 시기"), "주민센터 또는 교육·장학 상담 창구",
        "한국장학재단", "https://www.kosaf.go.kr",
    ),
    SeedProgram(
        "health-medical", "health", "건강·의료비 지원 상담", "의료비와 건강 지원 상담",
        "치료와 의료비 부담, 건강관리와 관련한 공공 지원 제도를 상담할 수 있습니다.",
        ("신분증", "진료 또는 치료 관련 자료가 있으면 함께 준비"),
        ("치료와 건강 상태", "의료비 부담", "소득과 재산", "다른 의료 지원 이용 여부"), "주민센터 또는 보건소 상담 창구",
        "복지로", "https://www.bokjiro.go.kr",
    ),
    SeedProgram(
        "mental-health", "mental", "정신건강·중독 지원 상담", "마음건강과 중독 관련 상담",
        "마음건강, 중독, 위기 상황에서 필요한 공공 상담과 지역 지원기관을 안내할 수 있습니다.",
        ("신분증", "현재 어려움을 간단히 적은 메모"),
        ("긴급한 위험 여부", "거주 지역", "필요한 상담 종류", "기존 치료·상담 여부"), "정신건강복지센터 또는 주민센터 상담 창구",
        "국립정신건강센터", "https://www.mentalhealth.go.kr",
    ),
    SeedProgram(
        "family-multicultural", "family", "한부모·다문화·가족 지원 상담", "가족과 다문화 생활 지원 상담",
        "한부모, 다문화, 가족 돌봄과 양육비 관련 지원 제도를 상담할 수 있습니다.",
        ("신분증", "가족 관계와 상황을 확인할 수 있는 기본 자료"),
        ("가족 구성", "거주 지역", "양육·돌봄 상황", "소득과 재산"), "주민센터 가족복지 상담 창구",
        "복지로", "https://www.bokjiro.go.kr",
    ),
    SeedProgram(
        "veteran-settlement", "veteran", "보훈·정착 지원 상담", "보훈과 정착 관련 지원 상담",
        "국가유공자, 제대군인, 북한이탈주민 등 대상별 정착과 생활 지원 제도를 상담할 수 있습니다.",
        ("신분증", "대상 확인 관련 자료가 있으면 함께 준비"),
        ("대상 구분", "거주 지역", "기존 지원 이용 여부", "개별 등록 상태"), "주민센터 또는 보훈·정착 상담 창구",
        "국가보훈부", "https://www.mpva.go.kr",
    ),
    SeedProgram(
        "veteran-merit", "veteran", "국가보훈대상자 지원 상담", "국가유공자와 보훈대상자 지원 상담",
        "국가보훈대상자별 생활·의료·교육·취업 지원은 등록 상태와 대상 구분에 따라 달라 담당 창구에서 상담할 수 있습니다.",
        ("신분증", "보훈대상자 등록 또는 신청 관련 자료가 있으면 함께 준비"),
        ("보훈대상자 구분", "등록·신청 상태", "거주 지역과 담당 보훈관서"), "보훈(지)청 또는 주민센터 복지 상담 창구",
        "국가보훈부", "https://www.mpva.go.kr", True,
    ),
    SeedProgram(
        "local-community", "local", "지역 특화 복지 상담", "우리 지역의 생활 지원 상담",
        "지역에서 운영하는 생활 지원, 복지관 프로그램, 특화 복지서비스를 상담할 수 있습니다.",
        ("신분증", "거주 지역을 확인할 수 있는 기본 자료"),
        ("시·도와 시·군·구", "가구 상황", "필요한 도움의 종류", "지역별 운영 여부"), "주민센터 또는 지역 복지관 상담 창구",
        "정부24", "https://www.gov.kr",
    ),
    SeedProgram(
        "local-welfare-directory", "local", "지역 복지서비스·복지관 상담", "우리 지역 복지관과 생활지원 프로그램 상담",
        "지역별 복지관 프로그램과 생활지원은 운영 기관과 시기에 따라 다르므로, 선택된 지역의 공식 정보와 담당 창구를 함께 확인합니다.",
        ("신분증", "거주 지역을 확인할 수 있는 기본 자료"),
        ("시·도와 시·군·구", "운영 중인 지역 서비스", "이용 대상과 신청 방법"), "주민센터 또는 지역 복지관 상담 창구",
        "공공데이터포털", "https://www.data.go.kr", True,
    ),
)


class SeedOfficialInfoProvider:
    def __init__(self, store: Store | None = None) -> None:
        self.store = store
        if store:
            store.ensure_program_reviews([
                (item.program_id, "needs_review" if item.requires_initial_review else "approved",
                 "관리자 검토 대기" if item.requires_initial_review else "초기 시드 정보 검토")
                for item in PROGRAMS
            ])

    def _review(self, program_id: str) -> dict[str, object] | None:
        if not self.store:
            return None
        return self.store.program_reviews().get(program_id)

    def search(self, category: str) -> list[Recommendation]:
        matches = [item for item in PROGRAMS if item.category == category]
        if not matches:
            return []
        return [
            Recommendation(
                program_id=item.program_id,
                name=item.name,
                plain_name=item.plain_name,
                status="일부 확인됨" if not self._review(item.program_id) or self._review(item.program_id)["review_status"] == "approved" else "담당자 확인 필요",
                guidance=item.guidance,
                preparation_items=list(item.preparation_items),
                needs_confirmation=list(item.needs_confirmation),
                office_hint=item.office_hint,
                source=Source(
                    name=item.source_name,
                    url=item.source_url,
                    checked_at=self._checked_at(item.program_id),
                ),
            )
            for item in matches
        ]

    def approved_count(self) -> int:
        if not self.store:
            return len(PROGRAMS)
        return sum(review["review_status"] == "approved" for review in self.store.program_reviews().values())

    def names_for(self, program_ids: list[str]) -> list[str]:
        by_id = {item.program_id: item.plain_name for item in PROGRAMS}
        return [by_id[item] for item in program_ids if item in by_id]

    def admin_programs(self) -> list[AdminProgramReview]:
        reviews = self.store.program_reviews() if self.store else {}
        result: list[AdminProgramReview] = []
        for item in PROGRAMS:
            review = reviews.get(item.program_id, {})
            reviewed_at = review.get("reviewed_at")
            result.append(AdminProgramReview(
                program_id=item.program_id,
                name=item.name,
                plain_name=item.plain_name,
                category=item.category,
                review_status=str(review.get("review_status", "approved")),
                reviewed_at=datetime.fromisoformat(str(reviewed_at)) if reviewed_at else None,
                reviewed_by=str(review["reviewed_by"]) if review.get("reviewed_by") else None,
                note=str(review.get("note", "")) or None,
                origin="seed",
                source=Source(name=item.source_name, url=item.source_url, checked_at=self._checked_at(item.program_id)),
            ))
        return result

    def _checked_at(self, program_id: str) -> str:
        review = self._review(program_id)
        if review and review.get("reviewed_at"):
            return datetime.fromisoformat(str(review["reviewed_at"])).date().isoformat()
        return "2026-08-29"


class PublicDataOfficialInfoProvider:
    """Read verified welfare records from the public-data API without web scraping."""

    national_list_url = "https://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001"
    national_detail_url = "https://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfaredetailedV001"
    local_list_url = "https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist"
    local_detail_url = "https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfaredetailed"
    source_portal_url = "https://www.data.go.kr/data/15090532/openapi.do"
    local_source_portal_url = "https://www.data.go.kr"
    category_terms = {
        "basic": ("기초생활", "생계급여", "주거급여", "의료급여", "저소득"),
        "emergency": ("긴급복지", "긴급 지원", "위기"),
        "elder": ("노인", "어르신", "노인맞춤", "돌봄"),
        "disability": ("장애인 활동지원", "장애인", "활동 지원"),
        "youth": ("청년", "청년 월세", "청년 주거"),
        "housing": ("주거", "임대", "전세", "월세", "주택"),
        "employment": ("취업", "고용", "직업훈련", "일자리", "자활"),
        "pregnancy": ("임신", "출산", "산모", "영아", "첫만남"),
        "child": ("아동", "청소년", "보육", "돌봄", "양육"),
        "education": ("교육", "장학", "학자금", "학습", "학교"),
        "health": ("의료비", "건강", "질환", "치료", "건강보험"),
        "mental": ("정신건강", "중독", "자살", "심리", "우울"),
        "family": ("한부모", "다문화", "가족", "양육비", "이주"),
        "veteran": ("보훈", "국가유공자", "북한이탈", "제대군인"),
        "local": ("지역복지", "마을", "주민센터", "생활지원", "복지관"),
    }
    # These fields have broad, overlapping API records. Prefer exact program terms
    # before using broad terms so the first recommendation stays recognizable.
    category_query_terms = {
        "elder": ("노인맞춤돌봄서비스", "노인돌봄"),
        "veteran": ("국가유공자", "보훈"),
    }

    def __init__(
        self,
        api_key: str,
        fallback: SeedOfficialInfoProvider,
        timeout_seconds: float = 5.0,
        cache_minutes: int = 360,
        max_pages: int = 20,
        local_sido: str | None = None,
        local_sigungu: str | None = None,
        client_factory: Callable[[], httpx.Client] | None = None,
    ) -> None:
        self.api_key = api_key
        self.fallback = fallback
        self.timeout_seconds = timeout_seconds
        self.cache_minutes = cache_minutes
        self.max_pages = max_pages
        self.local_sido = local_sido
        self.local_sigungu = local_sigungu
        self.client_factory = client_factory or (lambda: httpx.Client(timeout=self.timeout_seconds, follow_redirects=True))
        self._catalog_by_category: dict[str, tuple[list[dict[str, str]], datetime]] = {}
        self._recommendation_names: dict[str, str] = {}
        self.last_error: str | None = None
        self.source_errors: dict[str, str] = {}

    def search(self, category: str) -> list[Recommendation]:
        try:
            matches = self._best_matches(self._catalog_records(category), category)
            recommendations = [self._to_recommendation(item, category) for item in matches]
            recommendations = [item for item in recommendations if item is not None]
            if recommendations:
                self.last_error = None
                return recommendations
            self.last_error = "해당 분야의 공식 API 결과가 없습니다."
        except (httpx.HTTPError, ElementTree.ParseError, ValueError) as exc:
            # Do not expose service keys or raw upstream response text to kiosk users.
            self.last_error = f"공공데이터 API 조회 실패: {type(exc).__name__}"
        return self.fallback.search(category)

    def approved_count(self) -> int:
        return self.fallback.store.approved_program_count() if self.fallback.store else self.fallback.approved_count()

    def names_for(self, program_ids: list[str]) -> list[str]:
        names = []
        for program_id in program_ids:
            if program_id in self._recommendation_names:
                names.append(self._recommendation_names[program_id])
            else:
                names.extend(self.fallback.names_for([program_id]))
        return names

    def admin_programs(self) -> list[AdminProgramReview]:
        programs = self.fallback.admin_programs()
        if not self.fallback.store:
            return programs
        for review in self.fallback.store.external_program_reviews().values():
            reviewed_at = review.get("reviewed_at")
            programs.append(AdminProgramReview(
                program_id=str(review["program_id"]), name=str(review["name"]), plain_name=str(review["plain_name"]),
                category=str(review["category"]), review_status=str(review["review_status"]),
                reviewed_at=datetime.fromisoformat(str(reviewed_at)) if reviewed_at else None,
                reviewed_by=str(review["reviewed_by"]) if review.get("reviewed_by") else None,
                note=str(review.get("note", "")) or None, origin="public-data",
                source=Source(name=str(review["source_name"]), url=str(review["source_url"]), checked_at=str(review["source_checked_at"])),
            ))
        return programs

    def set_local_area(self, sido: str | None, sigungu: str | None) -> None:
        self.local_sido = (sido or "").strip() or None
        self.local_sigungu = (sigungu or "").strip() or None
        self._catalog_by_category.clear()

    def status(self) -> dict[str, object]:
        return {
            "mode": "public-data",
            "configured": True,
            "cached": any(expires_at > datetime.now() for _, expires_at in self._catalog_by_category.values()),
            "last_error": self.last_error,
            "source_errors": self.source_errors,
            "local_area": {"sido": self.local_sido, "sigungu": self.local_sigungu},
        }

    def _catalog_records(self, category: str) -> list[dict[str, str]]:
        cached = self._catalog_by_category.get(category)
        if cached and cached[1] > datetime.now():
            return cached[0]
        records: list[dict[str, str]] = []
        source_errors: dict[str, str] = {}
        sources = [] if category == "local" else [("national", self.national_list_url)]
        # Local catalogs include every municipality. Only an administrator may
        # choose the pilot area; kiosk visitors never choose a region themselves.
        if self.local_sido:
            sources.append(("local", self.local_list_url))
        for source, url in sources:
            try:
                records.extend(self._fetch_catalog(url, source, category))
            except (httpx.HTTPError, ElementTree.ParseError, ValueError) as exc:
                source_errors[source] = type(exc).__name__
        self.source_errors = source_errors
        if not records:
            raise ValueError("Public-data catalog returned no records")
        self._catalog_by_category[category] = (records, datetime.now() + timedelta(minutes=self.cache_minutes))
        return records

    def _fetch_catalog(self, url: str, source: str, category: str = "") -> list[dict[str, str]]:
        records: list[dict[str, str]] = []
        # The central API supports category searches; exact terms are tried first
        # for ambiguous areas such as elder care and veteran support.
        # Local data is paged fully only after a pilot area has been configured.
        page_limit = 1 if source == "national" or not self.local_sido else self.max_pages
        with self.client_factory() as client:
            query_terms = self.category_query_terms.get(category) or (self.category_terms.get(category, ("",))[0],)
            for query_term in query_terms if source == "national" else (None,):
                for page in range(1, page_limit + 1):
                    params = {"serviceKey": self.api_key, "callTp": "L", "pageNo": page, "numOfRows": 100}
                    if source == "national":
                        params["srchKeyCode"] = "003"
                        if query_term:
                            params["searchWrd"] = query_term
                    if source == "local" and self.local_sido:
                        params["ctpvNm"] = self.local_sido
                    if source == "local" and self.local_sigungu:
                        params["sggNm"] = self.local_sigungu
                    response = client.get(url, params=params)
                    response.raise_for_status()
                    page_records = self._records_from_xml(response.content, "servList")
                    if not page_records:
                        break
                    records.extend([{**record, "_source": source} for record in page_records])
                    if len(page_records) < 100:
                        break
        return records

    def _best_matches(self, catalog: list[dict[str, str]], category: str) -> list[dict[str, str]]:
        terms = self.category_terms.get(category, ())
        scored: list[tuple[int, dict[str, str]]] = []
        seen: set[tuple[str, str]] = set()
        for item in catalog:
            title = item.get("servNm", "").replace(" ", "")
            haystack = " ".join(item.values()).replace(" ", "")
            # Catalog summaries often mention other benefit programs. A direct
            # service-name hit is much more trustworthy than a summary-only hit.
            score = sum(term.replace(" ", "") in haystack for term in terms)
            score += sum(10 for term in terms if term.replace(" ", "") in title)
            if terms and terms[0].replace(" ", "") in title:
                score += 40
            key = (item.get("_source", "national"), item.get("servId", ""))
            if score and key not in seen:
                scored.append((score, item))
                seen.add(key)
        scored.sort(key=lambda value: (value[0], value[1].get("servNm", "")), reverse=True)
        return [item for _, item in scored[:2]]

    def _to_recommendation(self, catalog_item: dict[str, str], category: str) -> Recommendation | None:
        service_id = catalog_item.get("servId")
        if not service_id:
            return None
        source_kind = catalog_item.get("_source", "national")
        detail = self._detail_record(service_id, source_kind)
        merged = {**catalog_item, **detail}
        name = merged.get("servNm") or catalog_item.get("servNm")
        if not name:
            return None
        guidance = self._clean(merged.get("servDgst") or merged.get("wlfareInfoOutlCn") or merged.get("alwServCn"))
        guidance = guidance or "공식 복지서비스 정보를 확인했습니다."
        preparation = self._items(merged.get("aplyMtdCn") or merged.get("_application_guidance"))
        preparation = preparation or ["신청 방법과 제출 서류는 담당 창구에서 확인해 주세요."]
        confirmation = (
            self._items(merged.get("sprtTrgtCn"))
            + self._items(merged.get("tgtrDtlCn"))
            + self._items(merged.get("slctCritCn"))
        )
        if not confirmation:
            confirmation = ["개별 지원 대상과 선정 기준"]
        program_id = f"public-{source_kind}-{service_id}"
        self._recommendation_names[program_id] = name
        source_name = "공공데이터포털 · 지자체 복지서비스" if source_kind == "local" else "공공데이터포털 · 복지로"
        source_url = next(
            (value for value in (merged.get("servDtlLink"), merged.get("servSeDetailLink")) if value and value.startswith(("https://", "http://"))),
            None,
        )
        if not source_url:
            source_url = self.local_source_portal_url if source_kind == "local" else self.source_portal_url
        review_status = "approved"
        if self.fallback.store:
            review = self.fallback.store.observe_external_program(
                program_id=program_id, name=name, category=category, source_name=source_name,
                source_url=source_url, source_checked_at=datetime.now().date().isoformat(),
            )
            review_status = str(review["review_status"])
        return Recommendation(
            program_id=program_id, name=name, plain_name=name,
            status="일부 확인됨" if review_status == "approved" else "담당자 확인 필요", guidance=guidance,
            preparation_items=preparation[:4], needs_confirmation=confirmation[:4],
            office_hint=self._clean(merged.get("bizChrDeptNm") or merged.get("jurMnofNm")) or "주민센터 복지 상담 창구",
            source=Source(
                name=source_name,
                url=source_url,
                checked_at=datetime.now().date().isoformat(),
            ),
        )

    def _detail_record(self, service_id: str, source_kind: str) -> dict[str, str]:
        detail_url = self.local_detail_url if source_kind == "local" else self.national_detail_url
        with self.client_factory() as client:
            response = client.get(detail_url, params={
                "serviceKey": self.api_key, "callTp": "D", "servId": service_id,
            })
            response.raise_for_status()
        record_tags = ("wantedDtl", "wantedSvcList", "servList") if source_kind == "national" else ("wantedSvcList", "servList")
        records: list[dict[str, str]] = []
        for record_tag in record_tags:
            records = self._records_from_xml(response.content, record_tag)
            if records:
                break
        if not records:
            return {}
        detail = records[0]
        if source_kind == "national":
            application_guidance = self._nested_values(response.content, "applmetList", "servSeDetailLink")
            if application_guidance:
                detail["_application_guidance"] = "\n".join(application_guidance)
        return detail

    @staticmethod
    def _records_from_xml(payload: bytes, record_tag: str) -> list[dict[str, str]]:
        root = ElementTree.fromstring(payload)
        error = next((node.text for node in root.iter() if node.tag.rsplit("}", 1)[-1] in {"errMsg", "returnAuthMsg"} and node.text), None)
        if error:
            raise ValueError("Public-data API returned an error")
        result_code = next((node.text for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "resultCode" and node.text), None)
        if result_code and result_code.strip() not in {"0", "00"}:
            raise ValueError("Public-data API returned a non-success result code")
        records: list[dict[str, str]] = []
        for element in root.iter():
            if element.tag.rsplit("}", 1)[-1] != record_tag:
                continue
            record = {
                child.tag.rsplit("}", 1)[-1]: (child.text or "").strip()
                for child in element.iter()
                if child is not element and len(child) == 0 and (child.text or "").strip()
            }
            if record:
                records.append(record)
        return records

    @staticmethod
    def _nested_values(payload: bytes, parent_tag: str, child_tag: str) -> list[str]:
        root = ElementTree.fromstring(payload)
        values: list[str] = []
        for parent in root.iter():
            if parent.tag.rsplit("}", 1)[-1] != parent_tag:
                continue
            for child in parent.iter():
                if child.tag.rsplit("}", 1)[-1] == child_tag and child.text:
                    value = child.text.strip()
                    if value and value not in values:
                        values.append(value)
        return values

    @staticmethod
    def _clean(value: str | None) -> str:
        return " ".join((value or "").split())

    @classmethod
    def _items(cls, value: str | None) -> list[str]:
        cleaned = cls._clean(value)
        if not cleaned:
            return []
        parts = [cls._clean(item) for item in cleaned.replace("\n", "|").replace("•", "|").split("|")]
        return [item[:180] for item in parts if item][:4]


def build_official_info_provider(settings: "Settings", store: Store) -> SeedOfficialInfoProvider | PublicDataOfficialInfoProvider:
    seed = SeedOfficialInfoProvider(store)
    if settings.public_data_mode == "seed" or not settings.public_data_api_key:
        return seed
    return PublicDataOfficialInfoProvider(
        settings.public_data_api_key, fallback=seed, timeout_seconds=settings.public_data_timeout_seconds,
        cache_minutes=settings.public_data_cache_minutes, max_pages=settings.public_data_max_pages,
        # The pilot area is a runtime administrator setting, not kiosk input.
        local_sido=None, local_sigungu=None,
    )
