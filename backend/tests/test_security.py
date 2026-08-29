from app.security import mask_sensitive_text


def test_masks_sensitive_values() -> None:
    result = mask_sensitive_text("주민번호는 900101-1234567 이고 전화는 010-1234-5678입니다.")
    assert "900101" not in result
    assert "010-1234" not in result


def test_keeps_general_question() -> None:
    assert mask_sensitive_text("생활이 어려워서 도움을 받고 싶어요") == "생활이 어려워서 도움을 받고 싶어요"
