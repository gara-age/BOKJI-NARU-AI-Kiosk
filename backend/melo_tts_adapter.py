"""Optional MeloTTS sidecar. Run this in the dedicated MeloTTS environment."""

import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field


class SynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1_000)
    speed: float = Field(default=1.0, ge=0.7, le=1.4)


app = FastAPI(title="Navi MeloTTS adapter")
engine = None


def get_engine():
    global engine
    if engine is None:
        try:
            from melo.api import TTS
        except ImportError as exc:
            raise RuntimeError("MeloTTS is not installed in this environment.") from exc
        engine = TTS(language="KR", device=os.getenv("TTS_MELO_DEVICE", "cpu"))
    return engine


@app.post("/synthesize", response_class=Response)
def synthesize(request: SynthesisRequest):
    output: Path | None = None
    try:
        model = get_engine()
        speaker_ids = model.hps.data.spk2id
        speaker_id = speaker_ids.get(os.getenv("TTS_MELO_SPEAKER_KO", "KR"), next(iter(speaker_ids.values())))
        handle = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        handle.close()
        output = Path(handle.name)
        model.tts_to_file(request.text, speaker_id, str(output), speed=request.speed)
        return Response(output.read_bytes(), media_type="audio/wav")
    except Exception as exc:
        raise HTTPException(status_code=503, detail="MeloTTS 합성 서비스를 사용할 수 없습니다.") from exc
    finally:
        if output is not None:
            output.unlink(missing_ok=True)
