import type { HandLandmarker } from '@mediapipe/tasks-vision'
import { TOUCHLESS_CONFIG } from './config'
import type { Landmark } from './touchless.types'

type Callbacks = {
  isCancelled: () => boolean
  onHand: (landmarks: Landmark[], width: number, height: number, now: number) => void
  onMissing: (now: number) => void
  onError: () => void
}

export async function startHandTracker(callbacks: Callbacks): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable')

  let stream: MediaStream | null = null
  let landmarker: HandLandmarker | null = null
  let frameId = 0
  let stopped = false
  let lastVideoTime = -1
  let lastInferenceAt = 0
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true

  const stop = () => {
    if (stopped) return
    stopped = true
    window.cancelAnimationFrame(frameId)
    landmarker?.close()
    landmarker = null
    video.pause()
    video.srcObject = null
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
  }
  const cancelled = () => stopped || callbacks.isCancelled()

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    })
    if (cancelled()) { stop(); return stop }
    video.srcObject = stream
    await video.play()
    if (cancelled()) { stop(); return stop }

    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision')
    if (cancelled()) { stop(); return stop }
    const base = import.meta.env.BASE_URL
    const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe`)
    if (cancelled()) { stop(); return stop }
    landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    })
    if (cancelled()) { stop(); return stop }

    const frame = (now: number) => {
      if (cancelled()) return
      try {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime && now - lastInferenceAt >= TOUCHLESS_CONFIG.frameIntervalMs) {
          lastVideoTime = video.currentTime
          lastInferenceAt = now
          const hand = landmarker?.detectForVideo(video, now).landmarks[0]
          if (hand) callbacks.onHand(hand, video.videoWidth, video.videoHeight, now)
          else callbacks.onMissing(now)
        }
      } catch {
        stop()
        callbacks.onError()
        return
      }
      frameId = window.requestAnimationFrame(frame)
    }
    frameId = window.requestAnimationFrame(frame)
    return stop
  } catch (error) {
    stop()
    throw error
  }
}
