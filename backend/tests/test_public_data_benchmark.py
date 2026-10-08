from app.public_data_benchmark import BENCHMARK_CASES, evaluate_case, markdown_report, run_benchmark
from app.schemas import Recommendation, Source


def recommendation(program_id: str = "public-national-WLF1") -> Recommendation:
    return Recommendation(
        program_id=program_id,
        name="국민기초생활 보장",
        plain_name="기초생활 지원",
        status="일부 확인됨",
        guidance="생활이 어려운 가구를 위한 공식 지원 안내입니다.",
        preparation_items=["신분증"],
        needs_confirmation=["소득과 재산 기준"],
        office_hint="주민센터 복지 상담 창구",
        source=Source(name="공공데이터포털 · 복지로", url="https://www.bokjiro.go.kr", checked_at="2026-09-23"),
    )


def test_benchmark_case_scores_complete_live_result() -> None:
    result = evaluate_case(BENCHMARK_CASES[0], [recommendation()])

    assert result["score"] == {"passed": 8, "total": 8, "percent": 100.0}
    assert result["issues"] == []


def test_benchmark_marks_seed_fallback_for_review() -> None:
    result = evaluate_case(BENCHMARK_CASES[0], [recommendation("basic-livelihood")])

    assert result["checks"]["live_public_record"] is False
    assert result["issues"] == ["live_public_record"]


def test_benchmark_report_contains_case_summary() -> None:
    class Provider:
        def search(self, category: str) -> list[Recommendation]:
            return [recommendation()] if category == "basic" else []

    report = run_benchmark(Provider(), {"mode": "public-data"})
    rendered = markdown_report(report)

    assert report["case_count"] == 15
    assert "공공데이터 안내 품질 벤치마크" in rendered
    assert "기초생활 지원" in rendered
