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

## 연동 설정

- STT: VisionNavi의 `AudioTranscriptionService`를 별도 워커로 실행한 뒤 `/api/transcriptions`에 연결합니다.
- TTS: Edge TTS가 기본이며, VisionNavi VoiceBox는 `TTS_PROVIDER`로 전환할 수 있습니다.
- MuseTalk: 별도 GPU 서비스 주소를 `MUSETALK_API_URL`에 설정합니다. 미설정 시 합성 아바타와 브라우저 음성으로 대체합니다.
- Ollama: 별도 PC의 URL을 `OLLAMA_BASE_URL`에 설정하고 `OLLAMA_ENABLED=true`로 활성화합니다.
