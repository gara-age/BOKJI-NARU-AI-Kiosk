# Navi MuseTalk Adapter

Run `run-adapter.cmd` after the MuseTalk runtime is installed. It exposes a local queue at `http://127.0.0.1:8001` and uses `D:\MuseTalk\assets\navi-reference.mp4` as the synthetic public-guide source.

The adapter starts one MuseTalk 1.5 GPU worker and prepares the `navi-guide` avatar once. Requests are processed in a single queue and reuse the loaded models and prepared avatar, rather than launching MuseTalk for every sentence. The first launch after a restart can take longer while the models and avatar cache load. Each completed MP4 contains the same TTS audio used for inference, so the kiosk should play the video instead of separately playing the original audio.

Set `MUSETALK_API_URL=http://127.0.0.1:8001` and `NAVI_API_PUBLIC_URL=http://127.0.0.1:8000` before starting the Navi backend. The Navi backend must be accessible locally so the adapter can download its temporary TTS audio. Generated videos are served from `D:\MuseTalk\navi-output` and should not be committed. Use `GET /downloads/{filename}` to download a generated video; this endpoint intentionally returns an attachment response and does not support `HEAD`.
