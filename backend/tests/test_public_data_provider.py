from app.official_info import PublicDataOfficialInfoProvider, SeedOfficialInfoProvider


CATALOG_XML = """<?xml version="1.0" encoding="UTF-8"?>
<response><body><items><servList><servId>WLF0001</servId><servNm>국민기초생활 보장</servNm><servDgst>생활이 어려운 가구를 위한 지원입니다.</servDgst></servList></items></body></response>""".encode()
DETAIL_XML = """<?xml version="1.0" encoding="UTF-8"?>
<response><body><wantedDtl><servNm>국민기초생활 보장</servNm><wlfareInfoOutlCn>생활이 어려운 가구를 위한 지원입니다.</wlfareInfoOutlCn><tgtrDtlCn>소득과 재산 기준을 확인합니다.</tgtrDtlCn><slctCritCn>가구 상황을 함께 심사합니다.</slctCritCn><jurMnofNm>보건복지부</jurMnofNm><servDtlLink>https://www.bokjiro.go.kr</servDtlLink><applmetList><servSeDetailLink>거주지 주민센터에서 신청합니다.</servSeDetailLink></applmetList></wantedDtl></body></response>""".encode()
ERROR_XML = """<?xml version="1.0" encoding="UTF-8"?>
<response><body><totalCount>0</totalCount><resultCode>10</resultCode><resultMessage>INVALID_REQUEST_PARAMETER_ERROR</resultMessage></body></response>""".encode()


class FakeResponse:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        return None


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def __enter__(self) -> "FakeClient":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def get(self, url: str, **kwargs: object) -> FakeResponse:
        self.calls.append({"url": url, **kwargs})
        return FakeResponse(DETAIL_XML if "detailed" in url else CATALOG_XML)


def test_public_data_provider_maps_official_detail_to_safe_recommendation() -> None:
    client = FakeClient()
    provider = PublicDataOfficialInfoProvider(
        "test-key", fallback=SeedOfficialInfoProvider(), client_factory=lambda: client,
    )

    result = provider.search("basic")

    assert len(result) == 1
    assert result[0].program_id == "public-national-WLF0001"
    assert result[0].source.name == "공공데이터포털 · 복지로"
    assert result[0].preparation_items == ["거주지 주민센터에서 신청합니다."]
    assert "소득과 재산 기준을 확인합니다." in result[0].needs_confirmation
    assert result[0].office_hint == "보건복지부"
    assert provider.names_for([result[0].program_id]) == ["국민기초생활 보장"]
    national_request = next(call for call in client.calls if "NationalWelfarelist" in str(call["url"]))
    assert national_request["params"] == {
        "serviceKey": "test-key", "callTp": "L", "pageNo": 1, "numOfRows": 100,
        "srchKeyCode": "003", "searchWrd": "기초생활",
    }
    assert not any("LcgvWelfarelist" in str(call["url"]) for call in client.calls)


def test_public_data_provider_rejects_a_non_success_api_result_code() -> None:
    try:
        PublicDataOfficialInfoProvider._records_from_xml(ERROR_XML, "wantedList")
    except ValueError:
        return
    raise AssertionError("A non-success public-data result code must not be treated as an empty result.")


def test_public_data_provider_prioritizes_service_name_over_summary_keywords() -> None:
    provider = PublicDataOfficialInfoProvider("test-key", fallback=SeedOfficialInfoProvider())
    catalog = [
        {"servId": "incidental", "servNm": "긴급복지 해산비지원", "servDgst": "기초생활이 어려운 가구"},
        {"servId": "direct", "servNm": "국민기초생활 보장", "servDgst": "소득이 낮은 가구 지원"},
    ]

    matches = provider._best_matches(catalog, "basic")

    assert matches[0]["servId"] == "direct"


def test_consultation_region_queries_local_without_changing_admin_default() -> None:
    client = FakeClient()
    provider = PublicDataOfficialInfoProvider(
        "test-key", fallback=SeedOfficialInfoProvider(), local_sido="서울특별시", client_factory=lambda: client,
    )

    result = provider.search_region("basic", "인천광역시", "부평구")

    assert {item.source.name for item in result} == {"공공데이터포털 · 복지로", "공공데이터포털 · 지자체 복지서비스"}
    local_request = next(call for call in client.calls if "LcgvWelfarelist" in str(call["url"]))
    assert local_request["params"]["ctpvNm"] == "인천광역시"
    assert local_request["params"]["sggNm"] == "부평구"
    assert provider.local_sido == "서울특별시"
