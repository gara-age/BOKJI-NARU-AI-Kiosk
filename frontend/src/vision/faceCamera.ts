import type { FaceLandmarker } from '@mediapipe/tasks-vision'
import { acquireCamera } from './camera'
import type { FaceObservation } from './activeUser'
import { headPitchDegrees } from './headPose'

export async function startFaceCamera(callbacks: {
  isCancelled: () => boolean
  onFaces: (faces: FaceObservation[], now: number) => void
  onError: () => void
  onCameraReady?: (video: HTMLVideoElement | null) => void
}): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable')
  const camera = await acquireCamera()
  if (callbacks.isCancelled()) { camera.release(); return () => undefined }
  callbacks.onCameraReady?.(camera.video)
  let detector: FaceLandmarker | null = null
  let frameId = 0
  let stopped = false
  let lastInferenceAt = 0
  let lastVideoTime = -1
  const stop = () => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(frameId)
    detector?.close()
    callbacks.onCameraReady?.(null)
    camera.release()
  }
  try {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
    if (callbacks.isCancelled()) { stop(); return stop }
    const base = import.meta.env.BASE_URL
    const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe`)
    if (callbacks.isCancelled()) { stop(); return stop }
    detector = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}models/face_landmarker.task`, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numFaces: 3,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      outputFacialTransformationMatrixes: true,
    })
    if (callbacks.isCancelled()) { if (stopped) detector.close(); else stop(); return stop }
    const frame = (now: number) => {
      if (stopped || callbacks.isCancelled()) return
      try {
        const video = camera.video
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime && now - lastInferenceAt >= 150) {
          lastVideoTime = video.currentTime
          lastInferenceAt = now
          const result = detector!.detectForVideo(video, now)
          const faces = result.faceLandmarks.flatMap((landmarks, index) => {
            const leftEye = landmarks[33]
            const rightEye = landmarks[263]
            if (!leftEye || !rightEye) return []
            const xValues = landmarks.map((point) => point.x)
            const yValues = landmarks.map((point) => point.y)
            const left = Math.min(...xValues)
            const right = Math.max(...xValues)
            const top = Math.min(...yValues)
            const bottom = Math.max(...yValues)
            const pitch = headPitchDegrees(result.facialTransformationMatrixes[index])
            return [{
              x: (left + right) / 2,
              y: (top + bottom) / 2,
              width: right - left,
              height: bottom - top,
              eyeY: (leftEye.y + rightEye.y) / 2,
              pitch: pitch ?? undefined,
              confidence: 1,
            }]
          })
          callbacks.onFaces(faces, now)
        }
      } catch {
        stop()
        callbacks.onError()
        return
      }
      frameId = requestAnimationFrame(frame)
    }
    frameId = requestAnimationFrame(frame)
    return stop
  } catch (error) {
    stop()
    throw error
  }
}
