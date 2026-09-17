# MeloTTS 선택 설치

복지나루 API는 `TTS_PROVIDER=auto`일 때 MeloTTS를 먼저 시도하고, 로컬 Melo 엔진을 사용할 수 없거나 합성에 실패하면 Edge TTS로 자동 전환합니다. 따라서 MeloTTS 설치 실패가 키오스크 음성 안내를 중단시키지 않습니다.

Windows에서는 PyPI의 `melotts` 배포본이 패키지 메타데이터 오류로 설치되지 않을 수 있으므로, 핵심 `requirements.txt`에는 넣지 않습니다. MeloTTS는 공용 FastAPI와 분리된 Python 3.10 환경 또는 Docker에서 [공식 MeloTTS 설치 문서](https://github.com/myshell-ai/MeloTTS/blob/main/docs/install.md)를 따라 설치하는 방식을 권장합니다.

## 로컬 엔진 사용

1. Python 3.10 가상환경에 공식 소스의 MeloTTS와 해당 PyTorch 버전을 설치합니다.
2. 해당 환경에서 아래 명령으로 복지나루의 MeloTTS 어댑터를 실행합니다. `backend` 폴더를 `PYTHONPATH`에 포함하거나 그 폴더에서 실행합니다.

```powershell
uvicorn melo_tts_adapter:app --host 127.0.0.1 --port 8002
```

3. 주 API의 `backend/.env`에서 아래처럼 지정합니다.

```dotenv
TTS_PROVIDER=melo
TTS_MELO_DEVICE=cpu
TTS_MELO_SPEAKER_KO=KR
TTS_MELO_SPEED=1.0
TTS_MELO_API_URL=http://127.0.0.1:8002/synthesize
```

GPU를 MuseTalk에 우선 할당하는 현재 데모에서는 MeloTTS도 기본적으로 CPU를 사용합니다. `TTS_PROVIDER=auto`는 Melo 어댑터가 준비되지 않은 현재 상태에서도 Edge TTS를 계속 사용하므로, 현장 시연에는 이 값이 안전합니다.
