# “나루야” 웨이크워드

복지나루는 브라우저 마이크의 16 kHz PCM을 로컬 FastAPI WebSocket으로 전달하고, OpenWakeWord가 메모리에서만 분석합니다. 원본 음성은 파일·데이터베이스·상담 로그에 저장하지 않습니다.

## 준비

1. OpenWakeWord의 공식 자동 학습 노트북으로 “나루야”용 ONNX 모델을 학습합니다. 단순히 한두 개의 녹음 파일을 넣는 방식만으로는 현장 소음·다양한 화자에 안정적으로 동작하지 않습니다.
2. 산출물을 `backend/models/naruya.onnx`로 저장합니다. 이 파일은 용량과 라이선스 관리 때문에 Git에 커밋하지 않습니다.
3. `backend/.env`에 아래 값을 설정합니다.

```dotenv
WAKE_WORD_ENABLED=true
WAKE_WORD_MODEL_PATH=./models/naruya.onnx
WAKE_WORD_THRESHOLD=0.5
```

4. 서버를 재시작한 뒤 `GET /api/wake-word/status`에서 `ready: true`인지 확인합니다.

## Candidate training

`backend/scripts/start_naruya_v3_training.cmd` creates a larger `naruya_v3.onnx` candidate under `D:\NaviWakeWord\output-v3` and copies it to `backend/models/naruya_v3.onnx`. It never replaces the active `backend/models/naruya.onnx` automatically.

Before promotion, compare the candidate with the active model using recordings made on the intended kiosk microphone: multiple speakers, 0.5-2 m distance, nearby conversations, announcements, and 30 minutes or more of negative background audio. Promote only after confirming fewer false activations and acceptable missed detections.

## 현장 검증

긍정 샘플(“나루야”)과 부정 샘플(일상 대화, TV 음성, 비슷한 발음)을 각각 16 kHz·모노·16-bit PCM WAV로 준비합니다. 화자, 거리, 마이크, 주민센터 소음 조건을 다양하게 포함합니다.

```powershell
cd backend
.\.venv\Scripts\python.exe scripts\verify_naru_wakeword.py .\samples\naruya-positive.wav
.\.venv\Scripts\python.exe scripts\verify_naru_wakeword.py .\samples\negative.wav
```

초기 임계값은 `0.5`이며, 오작동이 많으면 올리고 놓침이 많으면 낮춥니다. 상태 표현은 색상만으로 하지 않고 화면의 “나루야 감지 중” 문구와 아이콘을 함께 사용합니다.

## 학습 참고

- OpenWakeWord 공식 저장소의 자동 모델 학습 노트북을 사용합니다: https://github.com/dscripka/openWakeWord/tree/main/notebooks
- 특정 설치 장소·장비에서 오작동이 계속되면, 공식 문서의 custom verifier도 보조적으로 검토합니다. verifier는 웨이크워드 자체 모델이 아니라 특정 화자 판별을 보완하는 도구입니다.
