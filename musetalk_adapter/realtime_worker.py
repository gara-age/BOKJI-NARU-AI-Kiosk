"""Persistent MuseTalk 1.5 worker for one prepared Navi avatar."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import traceback
from pathlib import Path

import torch
from transformers import WhisperModel


ROOT = Path(os.getenv("MUSETALK_ROOT", r"D:\MuseTalk"))
REFERENCE_VIDEO = Path(os.getenv("MUSETALK_REFERENCE_VIDEO", str(ROOT / "assets" / "navi-reference.mp4")))


def emit(payload: dict[str, object]) -> None:
    print(json.dumps(payload), flush=True)


def main() -> None:
    os.chdir(ROOT)
    sys.path.insert(0, str(ROOT))
    import scripts.realtime_inference as realtime
    from musetalk.utils.utils import load_all_model

    realtime.args = argparse.Namespace(
        version="v15", gpu_id=0, vae_type="sd-vae", extra_margin=10,
        parsing_mode="jaw", left_cheek_width=90, right_cheek_width=90,
        audio_padding_length_left=2, audio_padding_length_right=2,
        skip_save_images=False,
    )
    realtime.device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    if realtime.device.type != "cuda":
        raise RuntimeError("CUDA GPU is required for the Navi MuseTalk worker")
    realtime.vae, realtime.unet, realtime.pe = load_all_model(
        unet_model_path="./models/musetalkV15/unet.pth",
        unet_config="./models/musetalkV15/musetalk.json",
        vae_type="sd-vae",
        device=realtime.device,
    )
    realtime.timesteps = torch.tensor([0], device=realtime.device)
    realtime.pe = realtime.pe.half().to(realtime.device)
    realtime.vae.vae = realtime.vae.vae.half().to(realtime.device)
    realtime.unet.model = realtime.unet.model.half().to(realtime.device)
    realtime.audio_processor = realtime.AudioProcessor(feature_extractor_path="./models/whisper")
    realtime.weight_dtype = realtime.unet.model.dtype
    realtime.whisper = WhisperModel.from_pretrained("./models/whisper").to(device=realtime.device, dtype=realtime.weight_dtype).eval()
    realtime.whisper.requires_grad_(False)
    realtime.fp = realtime.FaceParsing(left_cheek_width=90, right_cheek_width=90)

    prepared = ROOT / "results" / "v15" / "avatars" / "navi-guide"
    # MuseTalk's realtime implementation expects a batch rather than a single frame.
    avatar = realtime.Avatar("navi-guide", str(REFERENCE_VIDEO), 0, 20, preparation=not prepared.exists())
    emit({"event": "ready"})
    for line in sys.stdin:
        request = json.loads(line)
        job_id = str(request["id"])
        output = Path(str(request["output"]))
        try:
            avatar.inference(str(request["audio"]), job_id, 25, False)
            rendered = prepared / "vid_output" / f"{job_id}.mp4"
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(rendered, output)
            emit({"event": "done", "id": job_id})
        except Exception as exc:
            emit({"event": "failed", "id": job_id, "error": traceback.format_exc()})


if __name__ == "__main__":
    main()
