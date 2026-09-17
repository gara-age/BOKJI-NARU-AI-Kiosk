"""Local single-GPU MuseTalk adapter for the Navi demo."""

from __future__ import annotations

import asyncio
import os
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.request import urlretrieve

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl


ROOT = Path(os.getenv("MUSETALK_ROOT", r"D:\MuseTalk"))
REFERENCE_VIDEO = Path(os.getenv("MUSETALK_REFERENCE_VIDEO", str(ROOT / "assets" / "navi-reference.mp4")))
OUTPUT_DIR = ROOT / "navi-output"
WORK_DIR = ROOT / "navi-work"
LOG_DIR = ROOT / "navi-logs"
PUBLIC_URL = os.getenv("MUSETALK_PUBLIC_URL", "http://127.0.0.1:8001")
PYTHON = Path(os.getenv("MUSETALK_PYTHON", str(ROOT / ".official-cpython310-cuda118-venv" / "Scripts" / "python.exe")))


class JobRequest(BaseModel):
    text: str
    audio_url: HttpUrl


@dataclass
class Job:
    status: str = "queued"
    video_url: str | None = None
    download_url: str | None = None
    error: str | None = None


app = FastAPI(title="Navi MuseTalk Adapter")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
WORK_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")
jobs: dict[str, Job] = {}
queue: asyncio.Queue[tuple[str, JobRequest]] = asyncio.Queue()
worker_process: asyncio.subprocess.Process | None = None


async def run_job(job_id: str, request: JobRequest) -> None:
    job = jobs[job_id]
    job.status = "processing"
    work = WORK_DIR / job_id
    work.mkdir(parents=True, exist_ok=True)
    audio = work / "speech.mp3"
    result = OUTPUT_DIR / f"{job_id}.mp4"
    log_file = LOG_DIR / f"{job_id}.log"
    lines: list[bytes] = []
    try:
        await asyncio.to_thread(urlretrieve, str(request.audio_url), audio)
        if worker_process is None or worker_process.stdin is None or worker_process.stdout is None:
            raise RuntimeError("MuseTalk realtime worker is unavailable")
        worker_process.stdin.write((__import__("json").dumps({"id": job_id, "audio": str(audio), "output": str(result)}) + "\n").encode())
        await worker_process.stdin.drain()
        while True:
            line = await worker_process.stdout.readline()
            if not line:
                raise RuntimeError("MuseTalk realtime worker stopped unexpectedly")
            lines.append(line)
            try:
                event = __import__("json").loads(line)
            except __import__("json").JSONDecodeError:
                continue
            if not isinstance(event, dict):
                # MuseTalk emits progress counts such as `97` on stdout.
                continue
            if event.get("id") != job_id:
                continue
            if event.get("event") == "failed":
                raise RuntimeError(str(event.get("error", "MuseTalk inference failed")))
            if event.get("event") == "done":
                break
        log_file.write_bytes(b"".join(lines))
        if not result.exists():
            raise RuntimeError("MuseTalk realtime worker did not produce a video")
        job.status = "ready"
        job.video_url = f"{PUBLIC_URL.rstrip('/')}/outputs/{result.name}"
        job.download_url = f"{PUBLIC_URL.rstrip('/')}/downloads/{result.name}"
    except Exception as exc:
        job.status = "failed"
        job.error = str(exc)
        # Keep worker diagnostics even when a MuseTalk job cannot finish.
        log_file.write_bytes(b"".join(lines) + f"\nAdapter error: {exc}\n".encode())
    finally:
        shutil.rmtree(work, ignore_errors=True)


async def worker() -> None:
    while True:
        job_id, request = await queue.get()
        try:
            await run_job(job_id, request)
        finally:
            queue.task_done()


@app.on_event("startup")
async def startup() -> None:
    global worker_process
    if not PYTHON.exists() or not REFERENCE_VIDEO.exists():
        raise RuntimeError("MuseTalk runtime or reference video is missing")
    config = ROOT / "models" / "musetalkV15" / "musetalk.json"
    if not config.exists():
        raise RuntimeError("MuseTalk 1.5 UNet config is missing")
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(ROOT) + os.pathsep + environment.get("PYTHONPATH", "")
    worker_process = await asyncio.create_subprocess_exec(
        str(PYTHON), str(Path(__file__).with_name("realtime_worker.py")),
        cwd=ROOT,
        env=environment,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    asyncio.create_task(worker())


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "reference_video": REFERENCE_VIDEO.exists(), "queue_size": queue.qsize(), "worker_running": worker_process is not None and worker_process.returncode is None}


@app.post("/jobs")
async def create_job(request: JobRequest) -> dict[str, str]:
    job_id = uuid.uuid4().hex
    jobs[job_id] = Job()
    await queue.put((job_id, request))
    return {"id": job_id, "status": "queued"}


@app.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict[str, str | None]:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job")
    return {"id": job_id, "status": job.status, "video_url": job.video_url, "download_url": job.download_url, "error": job.error}


@app.get("/downloads/{filename}")
def download_video(filename: str) -> FileResponse:
    video = OUTPUT_DIR / Path(filename).name
    if video.suffix != ".mp4" or not video.is_file():
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(video, media_type="video/mp4", filename="navi-guide-video.mp4")
