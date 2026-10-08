# Navi 주민센터 데모

음성 기반 민원·복지 상담 준비 키오스크 데모입니다. AI는 관련 분야와 준비사항을 안내하며, 개인별 자격·지원금·승인은 확정하지 않습니다.

## 실행

```powershell
cd backend
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

새 터미널에서 실행합니다.

```powershell
cd frontend
npm install
npm run dev
```

키오스크: `http://localhost:5173`  
관리자: `http://localhost:5173/admin`

기본 관리자 비밀번호는 `.env`에서 `ADMIN_PASSWORD`로 변경합니다. 데모의 기본값은 `navi-demo`입니다.

`.env`는 서버 시작 시 자동으로 읽습니다. 변경한 뒤에는 FastAPI 서버를 다시 시작해 주세요.

## 연동 설정

- STT: `/api/transcriptions`는 `faster-whisper`의 한국어 `medium` 모델을 사용합니다. 기본값은 MuseTalk GPU를 보호하는 CPU `int8`이며 `STT_DEVICE`, `STT_COMPUTE_TYPE`으로 조정할 수 있습니다.
- TTS: `TTS_PROVIDER=auto`는 로컬 Melo TTS를 먼저 시도하고 사용할 수 없으면 Edge TTS로 대체합니다. `edge`, `melo`로 고정할 수도 있으며, Windows용 MeloTTS 준비 방법은 [MeloTTS 선택 설치](docs/melo-tts.md)를 참고합니다.
- 웨이크워드: OpenWakeWord의 “나루야” ONNX 모델을 `backend/models/naruya.onnx`에 배치한 뒤 `WAKE_WORD_ENABLED=true`로 켭니다. 학습과 현장 검증은 [나루야 웨이크워드 안내](docs/naru-wakeword.md)를 참고합니다.
- MuseTalk: 별도 GPU 서비스 주소를 `MUSETALK_API_URL`에 설정합니다. 미설정 시 합성 아바타와 브라우저 음성으로 대체합니다.

## MuseTalk local demo

MuseTalk is installed outside the repository at `D:\MuseTalk`. After completing its model download, run `run-navi-local-demo.cmd` from the repository root. It starts the adapter, API, and Vite kiosk in separate CMD windows.

- Kiosk: `http://127.0.0.1:5173`
- Navi API: `http://127.0.0.1:8000/docs`
- MuseTalk adapter: `http://127.0.0.1:8001/health`

The adapter uses `D:\MuseTalk\assets\navi-reference.mp4`, queues only one GPU job at a time, and keeps the static synthetic avatar plus TTS active if video generation is delayed or fails. Generated videos stay in `D:\MuseTalk\navi-output` and are not saved in this repository.
- 외부 데모 고정 주소: ngrok 계정에서 무료 정적 도메인을 만든 뒤 `.env.ngrok.example`을 `.env.ngrok`으로 복사해 인증 토큰과 도메인을 설정합니다. 이후 루트의 `run-navi-ngrok.cmd`를 실행하면 키오스크만 `https://설정한-도메인`으로 공개됩니다. `.env.ngrok`은 Git에 포함되지 않습니다.
- Ollama: 별도 PC의 URL을 `OLLAMA_BASE_URL`에 설정하고 `OLLAMA_ENABLED=true`로 활성화합니다.
- 공공 복지정보: 공공데이터포털에서 [한국사회보장정보원_중앙부처복지서비스](https://www.data.go.kr/data/15090532/openapi.do)를 활용신청한 뒤 발급받은 **디코딩 서비스키**를 `PUBLIC_DATA_API_KEY`에 넣으세요. `PUBLIC_DATA_MODE=auto`에서는 키가 있으면 실시간 중앙부처 복지서비스 목록·상세 정보를 조회하고, 없거나 조회가 실패하면 검토된 시드 정보로만 안전하게 대체합니다. 서버를 재시작한 뒤 `/api/health`의 `public_data` 상태를 확인할 수 있습니다.
- 공공데이터 품질 벤치마크: 루트의 `run-public-data-benchmark.cmd`를 실행하면 15개 복지 분야에 대해 검색 성공, 분야 관련성, 실시간 API 사용 여부, 출처·확인일, 안내 완결성, 담당자 확인 안전 정책을 검사합니다. 결과는 `backend/runtime/benchmarks`에 JSON과 Markdown으로 저장됩니다. API 키가 없으면 시드 정보 벤치마크를 실시간 결과로 오인하지 않도록 실행을 중단합니다.
