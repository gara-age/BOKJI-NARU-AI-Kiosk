"""Import shim for OpenWakeWord training when clips are supplied externally."""


def generate_samples(*_args, **_kwargs):
    raise RuntimeError("나루야 모델은 Korean Edge TTS 코퍼스를 사용하므로 Piper 생성 단계는 실행하지 않습니다.")
