"""Run a non-destructive quality benchmark against configured public welfare APIs."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.config import Settings
from app.official_info import PublicDataOfficialInfoProvider, build_official_info_provider
from app.public_data_benchmark import markdown_report, run_benchmark
from app.store import Store


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark public welfare information quality without storing personal data.")
    parser.add_argument("--output-dir", type=Path, default=PROJECT_ROOT / "runtime" / "benchmarks")
    parser.add_argument("--allow-seed", action="store_true", help="Allow a seed-only benchmark when a public API key is not configured.")
    args = parser.parse_args()

    settings = Settings()
    if not settings.public_data_api_key and not args.allow_seed:
        print("PUBLIC_DATA_API_KEY is not configured. Refusing to benchmark seed data as live public data.", file=sys.stderr)
        return 2

    args.output_dir.mkdir(parents=True, exist_ok=True)
    store = Store(args.output_dir / "benchmark.sqlite3")
    provider = build_official_info_provider(settings, store)
    provider_status = provider.status() if hasattr(provider, "status") else {
        "mode": "seed", "configured": False,
    }
    report = run_benchmark(provider, provider_status)
    report["provider_kind"] = "public-data" if isinstance(provider, PublicDataOfficialInfoProvider) else "seed"
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    json_path = args.output_dir / f"public-data-benchmark-{stamp}.json"
    markdown_path = args.output_dir / f"public-data-benchmark-{stamp}.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    markdown_path.write_text(markdown_report(report), encoding="utf-8")
    score = report["overall_score"]
    print(f"Benchmark complete: {score['passed']}/{score['total']} ({score['percent']}%)")
    print(f"Live public API cases: {report['live_public_records']}/{report['case_count']}")
    print(f"JSON: {json_path}")
    print(f"Markdown: {markdown_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
