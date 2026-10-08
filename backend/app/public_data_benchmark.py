from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from .schemas import Recommendation


@dataclass(frozen=True)
class BenchmarkCase:
    category: str
    label: str
    expected_terms: tuple[str, ...]
    primary_terms: tuple[str, ...]
    representative_terms: tuple[str, ...]


BENCHMARK_CASES = (
    BenchmarkCase("basic", "기초생활 지원", ("기초", "생계", "주거", "의료", "저소득", "생활"), ("국민기초생활", "기초생활보장", "생계급여", "주거급여", "의료급여"), ("국민기초생활보장",)),
    BenchmarkCase("emergency", "긴급복지", ("긴급", "위기", "실직", "재난"), ("긴급복지", "긴급지원"), ("긴급복지지원",)),
    BenchmarkCase("elder", "노인 돌봄", ("노인", "어르신", "돌봄"), ("노인맞춤돌봄", "노인돌봄"), ("노인맞춤돌봄서비스",)),
    BenchmarkCase("disability", "장애인 활동 지원", ("장애", "활동"), ("장애인활동지원",), ("장애인활동지원",)),
    BenchmarkCase("youth", "청년 월세", ("청년", "월세", "주거", "임대"), ("청년월세", "청년주거"), ("청년월세지원사업",)),
    BenchmarkCase("housing", "주거·주택", ("주거", "임대", "전세", "월세", "주택"), ("주거", "임대", "주택"), ("주거", "임대주택")),
    BenchmarkCase("employment", "취업·자활", ("취업", "고용", "직업", "일자리", "자활"), ("취업", "고용", "자활"), ("국민취업지원", "자활근로")),
    BenchmarkCase("pregnancy", "임신·출산", ("임신", "출산", "산모", "영아", "첫만남"), ("임신", "출산", "첫만남"), ("첫만남이용권", "부모급여")),
    BenchmarkCase("child", "아동·청소년", ("아동", "청소년", "보육", "돌봄", "양육"), ("아동", "청소년", "보육"), ("아동수당", "아이돌봄")),
    BenchmarkCase("education", "교육·장학", ("교육", "장학", "학자금", "학습", "학교"), ("교육", "장학", "학자금"), ("국가장학", "교육급여")),
    BenchmarkCase("health", "건강·의료비", ("의료", "건강", "질환", "치료", "건강보험"), ("의료", "건강", "치료"), ("의료급여", "재난적의료비")),
    BenchmarkCase("mental", "정신건강·중독", ("정신", "중독", "자살", "심리", "우울"), ("정신", "중독", "심리"), ("정신건강",)),
    BenchmarkCase("family", "한부모·다문화·가족", ("한부모", "다문화", "가족", "양육비", "이주"), ("한부모", "다문화", "가족"), ("한부모가족", "다문화가족")),
    BenchmarkCase("veteran", "보훈·정착", ("보훈", "국가유공자", "북한이탈", "제대", "정착"), ("보훈", "국가유공자", "북한이탈"), ("국가유공자", "북한이탈주민")),
    BenchmarkCase("local", "지역 특화 복지", ("지역", "마을", "주민", "생활", "복지"), ("지역", "생활", "복지"), ("지역사회", "주민센터")),
)


class BenchmarkProvider(Protocol):
    def search(self, category: str) -> list[Recommendation]: ...


def _recommendation_text(recommendation: Recommendation) -> str:
    return " ".join((
        recommendation.name,
        recommendation.plain_name,
        recommendation.guidance,
        " ".join(recommendation.preparation_items),
        " ".join(recommendation.needs_confirmation),
        recommendation.office_hint,
    )).replace(" ", "")


def evaluate_case(case: BenchmarkCase, recommendations: list[Recommendation]) -> dict[str, Any]:
    text = " ".join(_recommendation_text(item) for item in recommendations)
    names = " ".join(item.name for item in recommendations).replace(" ", "")
    expected_terms = [term for term in case.expected_terms if term.replace(" ", "") in text]
    checks = {
        "retrieved": bool(recommendations),
        "category_match": bool(expected_terms),
        "primary_service_match": any(term.replace(" ", "") in names for term in case.primary_terms),
        "representative_program_match": any(term.replace(" ", "") in names for term in case.representative_terms),
        "live_public_record": bool(recommendations) and all(item.program_id.startswith("public-") for item in recommendations),
        "source_complete": bool(recommendations) and all(
            item.source.name and item.source.url.startswith(("https://", "http://")) and bool(item.source.checked_at)
            for item in recommendations
        ),
        "content_complete": bool(recommendations) and all(
            item.guidance and item.preparation_items and item.needs_confirmation and item.office_hint
            for item in recommendations
        ),
        "safe_handoff": bool(recommendations) and all(item.status in {"확인됨", "일부 확인됨", "담당자 확인 필요"} for item in recommendations),
    }
    passed = sum(checks.values())
    return {
        "category": case.category,
        "label": case.label,
        "expected_terms": list(case.expected_terms),
        "primary_terms": list(case.primary_terms),
        "representative_terms": list(case.representative_terms),
        "matched_terms": expected_terms,
        "recommendations": [
            {
                "program_id": item.program_id,
                "name": item.name,
                "status": item.status,
                "source_name": item.source.name,
                "source_url": item.source.url,
                "checked_at": item.source.checked_at,
            }
            for item in recommendations
        ],
        "checks": checks,
        "score": {"passed": passed, "total": len(checks), "percent": round(passed / len(checks) * 100, 1)},
        "issues": [name for name, successful in checks.items() if not successful],
    }


def run_benchmark(provider: BenchmarkProvider, provider_status: dict[str, Any] | None = None) -> dict[str, Any]:
    cases = [evaluate_case(case, provider.search(case.category)) for case in BENCHMARK_CASES]
    passed = sum(item["score"]["passed"] for item in cases)
    total = sum(item["score"]["total"] for item in cases)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "provider_status": provider_status or {},
        "overall_score": {"passed": passed, "total": total, "percent": round(passed / total * 100, 1)},
        "live_public_records": sum(bool(item["checks"]["live_public_record"]) for item in cases),
        "case_count": len(cases),
        "cases": cases,
    }


def markdown_report(report: dict[str, Any]) -> str:
    score = report["overall_score"]
    lines = [
        "# 공공데이터 안내 품질 벤치마크",
        "",
        f"- 생성 시각(UTC): {report['generated_at']}",
        f"- 종합 점수: {score['passed']} / {score['total']} ({score['percent']}%)",
        f"- 실시간 공공 API 레코드 사용 분야: {report['live_public_records']} / {report['case_count']}",
        "",
        "| 분야 | 점수 | 실시간 API | 핵심 계열 | 대표 제도 | 주요 결과 | 개선 필요 |",
        "| --- | ---: | --- | --- | --- | --- |",
    ]
    for item in report["cases"]:
        names = ", ".join(result["name"] for result in item["recommendations"]) or "결과 없음"
        issues = ", ".join(item["issues"]) or "없음"
        lines.append(
            f"| {item['label']} | {item['score']['passed']}/{item['score']['total']} | "
            f"{'예' if item['checks']['live_public_record'] else '아니오'} | "
            f"{'일치' if item['checks']['primary_service_match'] else '미일치'} | "
            f"{'일치' if item['checks']['representative_program_match'] else '미일치'} | "
            f"{names} | {issues} |"
        )
    lines.extend((
        "",
        "## 판정 기준",
        "",
        "- `retrieved`: 최소 한 건의 안내 결과가 반환됐습니다.",
        "- `category_match`: 결과에 해당 민원 분야의 대표 용어가 포함됩니다.",
        "- `primary_service_match`: 결과 제도명에 해당 분야의 핵심 제도명이 포함됩니다.",
        "- `representative_program_match`: 결과 제도명에 대표 제도가 직접 포함됩니다. 세부 지원만 반환되는 경우 개선 대상으로 표시됩니다.",
        "- `live_public_record`: 시드 정보가 아닌 공공데이터 API 레코드입니다.",
        "- `source_complete`: 공식 출처명, URL, 확인일이 있습니다.",
        "- `content_complete`: 기본 안내, 준비사항, 개별 확인 항목, 담당 창구가 있습니다.",
        "- `safe_handoff`: 결과 상태가 안전 정책의 세 상태 중 하나입니다.",
    ))
    return "\n".join(lines) + "\n"
