let cameraPromise: Promise<{ stream: MediaStream; video: HTMLVideoElement }> | null = null
let users = 0

export async function acquireCamera(): Promise<{ video: HTMLVideoElement; release: () => void }> {
  users += 1
  if (!cameraPromise) {
    cameraPromise = (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      })
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      try { await video.play() } catch (error) {
        stream.getTracks().forEach((track) => track.stop())
        throw error
      }
      return { stream, video }
    })()
  }
  const requested = cameraPromise
  let released = false
  const release = () => {
    if (released) return
    released = true
    users -= 1
    if (users === 0 && cameraPromise) {
      const pending = cameraPromise
      cameraPromise = null
      void pending.then(({ stream, video }) => {
        video.pause()
        video.srcObject = null
        stream.getTracks().forEach((track) => track.stop())
      }).catch(() => undefined)
    }
  }
  try {
    const { video } = await requested
    if (users === 0) throw new Error('Camera was released')
    return { video, release }
  } catch (error) {
    if (cameraPromise === requested) cameraPromise = null
    release()
    throw error
  }
}
