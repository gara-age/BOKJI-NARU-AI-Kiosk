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

    assert len(result) == 2
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


def test_public_data_provider_rejects_a_non_success_api_result_code() -> None:
    try:
        PublicDataOfficialInfoProvider._records_from_xml(ERROR_XML, "wantedList")
    except ValueError:
        return
    raise AssertionError("A non-success public-data result code must not be treated as an empty result.")
