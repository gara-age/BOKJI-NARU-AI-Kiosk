import type { HandLandmarker } from '@mediapipe/tasks-vision'
import { TOUCHLESS_CONFIG } from './config'
import type { Landmark } from './touchless.types'
import { acquireCamera } from '../vision/camera'

type Callbacks = {
  isCancelled: () => boolean
  onHands: (landmarks: Landmark[][], width: number, height: number, now: number) => void
  onMissing: (now: number) => void
  onError: () => void
}

export async function startHandTracker(callbacks: Callbacks): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable')

  let releaseCamera: (() => void) | null = null
  let landmarker: HandLandmarker | null = null
  let frameId = 0
  let stopped = false
  let lastVideoTime = -1
  let lastInferenceAt = 0
  const stop = () => {
    if (stopped) return
    stopped = true
    window.cancelAnimationFrame(frameId)
    landmarker?.close()
    landmarker = null
    releaseCamera?.()
    releaseCamera = null
  }
  const cancelled = () => stopped || callbacks.isCancelled()

  try {
    const camera = await acquireCamera()
    if (cancelled()) { camera.release(); return stop }
    releaseCamera = camera.release
    const video = camera.video
    if (cancelled()) { stop(); return stop }

    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision')
    if (cancelled()) { stop(); return stop }
    const base = import.meta.env.BASE_URL
    const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe`)
    if (cancelled()) { stop(); return stop }
    landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    })
    if (cancelled()) { if (stopped) landmarker.close(); else stop(); return stop }

    const frame = (now: number) => {
      if (cancelled()) return
      try {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime && now - lastInferenceAt >= TOUCHLESS_CONFIG.frameIntervalMs) {
          lastVideoTime = video.currentTime
          lastInferenceAt = now
          const hands = landmarker?.detectForVideo(video, now).landmarks ?? []
          if (hands.length) callbacks.onHands(hands, video.videoWidth, video.videoHeight, now)
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
