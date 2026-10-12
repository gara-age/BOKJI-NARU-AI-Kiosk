import { useEffect, useRef, useState } from 'react'
import { type FaceLevel, type FaceObservation } from './activeUser'
import { loadCalibration, saveCalibration, type HeightCalibration } from './calibration'
import { startFaceCamera } from './faceCamera'

const levels: FaceLevel[] = ['HIGH', 'MID', 'LOW']
const labels: Record<FaceLevel, string> = { HIGH: '높은 시점', MID: '일반 시점', LOW: '낮은 시점' }

export function CalibrationPanel() {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(() => loadCalibration())
  const [draft, setDraft] = useState<Partial<HeightCalibration>>({})
  const [pitchDraft, setPitchDraft] = useState<Partial<Record<FaceLevel, number>>>({})
  const [faceCount, setFaceCount] = useState(0)
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null)
  const [previewRatio, setPreviewRatio] = useState('4 / 3')
  const [previewFace, setPreviewFace] = useState<FaceObservation | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const latest = useRef<FaceObservation | null>(null)
  const samples = useRef<Array<{ at: number; eyeY: number; pitch: number }>>([])
  const stopCalibration = () => { setRunning(false); setPreviewStream(null); setPreviewFace(null); setFaceCount(0) }

  useEffect(() => {
    const preview = previewRef.current
    if (!running || !preview || !previewStream) return
    preview.srcObject = previewStream
    void preview.play().catch(() => undefined)
    return () => { preview.pause(); preview.srcObject = null }
  }, [running, previewStream])

  useEffect(() => {
    if (!running) return
    let cancelled = false
    let stop: (() => void) | undefined
    void startFaceCamera({
      isCancelled: () => cancelled,
      onCameraReady: (video) => {
        if (cancelled) return
        setPreviewStream(video?.srcObject instanceof MediaStream ? video.srcObject : null)
        if (video?.videoWidth && video.videoHeight) setPreviewRatio(`${video.videoWidth} / ${video.videoHeight}`)
      },
      onFaces: (faces, now) => {
        setFaceCount(faces.length)
        latest.current = faces.length === 1 ? faces[0] : null
        setPreviewFace(latest.current)
        if (latest.current?.pitch !== undefined) samples.current.push({ at: now, eyeY: latest.current.eyeY, pitch: latest.current.pitch })
        else samples.current = []
        samples.current = samples.current.filter((sample) => now - sample.at <= 900)
      },
      onError: () => { if (!cancelled) { setError('카메라를 확인해 주세요.'); stopCalibration() } },
    }).then((cleanup) => { if (cancelled) cleanup(); else stop = cleanup }).catch(() => {
      if (!cancelled) { setError('카메라 권한 또는 HTTPS 연결을 확인해 주세요.'); stopCalibration() }
    })
    return () => { cancelled = true; stop?.(); latest.current = null; samples.current = [] }
  }, [running])

  const capture = (level: FaceLevel) => {
    if (!latest.current || faceCount !== 1) { setError('한 사람의 얼굴만 카메라에 보이게 한 뒤 다시 측정해 주세요.'); return }
    const values = samples.current.map((sample) => sample.eyeY).sort((a, b) => a - b)
    if (values.length < 5 || values.at(-1)! - values[0] > .035) { setError('얼굴을 잠시 고정한 뒤 다시 측정해 주세요.'); return }
    const angles = samples.current.map((sample) => sample.pitch).sort((a, b) => a - b)
    if (angles.at(-1)! - angles[0] > 8) { setError('고개 각도를 잠시 고정한 뒤 다시 측정해 주세요.'); return }
    setError('')
    setDraft((current) => ({ ...current, [level]: values[Math.floor(values.length / 2)] }))
    setPitchDraft((current) => ({ ...current, [level]: angles[Math.floor(angles.length / 2)] }))
  }
  const save = () => {
    if (!levels.every((level) => draft[level] !== undefined)) return
    try {
      const value: HeightCalibration = { ...(draft as Record<FaceLevel, number>), pitch: pitchDraft as Record<FaceLevel, number> }
      saveCalibration(value)
      setSaved(value)
      stopCalibration()
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '보정값을 저장하지 못했습니다.') }
  }

  return <section className="summary-list calibration-panel">
    <h2>이 기기의 시점 높이 보정</h2>
    <p>카메라가 장착된 실제 키오스크에서 진행하세요. 높은·일반 시점에서는 화면을 자연스럽게 보고, 낮은 시점에서는 앉은 자세로 화면을 올려다보며 측정합니다. 영상은 저장하지 않고 눈 위치와 고개 각도 기준값만 이 브라우저에 저장합니다.</p>
    {saved && <p>저장된 기준: 높은 {saved.HIGH.toFixed(2)} · 일반 {saved.MID.toFixed(2)} · 낮은 {saved.LOW.toFixed(2)}{saved.pitch ? ' · 고개 각도 보정 적용' : ' · 이전 눈높이 보정만 적용'}</p>}
    {!running ? <button type="button" className="primary-button" onClick={() => { setDraft({}); setPitchDraft({}); setError(''); setPreviewStream(null); setPreviewFace(null); setRunning(true) }}>카메라 보정 시작</button> : <>
      <div className="calibration-camera">
        <div className="calibration-preview-stage" style={{ aspectRatio: previewRatio }}>
          {previewStream ? <video ref={previewRef} autoPlay muted playsInline aria-label="관리자 시점 보정 카메라" onLoadedMetadata={(event) => { const video = event.currentTarget; if (video.videoWidth && video.videoHeight) setPreviewRatio(`${video.videoWidth} / ${video.videoHeight}`) }} /> : <span className="calibration-preview-empty">카메라 화면을 연결하고 있어요</span>}
          {previewFace && previewStream && <><span className="calibration-face-outline" style={{ left: `${(previewFace.x - previewFace.width / 2) * 100}%`, top: `${(previewFace.y - previewFace.height / 2) * 100}%`, width: `${previewFace.width * 100}%`, height: `${previewFace.height * 100}%` }} /><span className="calibration-eye-line" style={{ top: `${previewFace.eyeY * 100}%` }} /></>}
        </div>
        <p>파란 테두리에 얼굴을 맞추고 자세를 잠시 유지하세요. 눈 위치 Y {previewFace?.eyeY.toFixed(3) ?? '측정 대기'} · 고개 상하 각도 {previewFace?.pitch === undefined ? '측정 대기' : `${previewFace.pitch.toFixed(1)}°`}</p>
      </div>
      <p>{faceCount === 1 ? '얼굴 한 개가 보입니다. 해당 높이의 측정 버튼을 누르세요.' : `감지된 얼굴 ${faceCount}개 · 한 사람만 화면 중앙에 위치해 주세요.`}</p>
      <div className="calibration-actions">{levels.map((level) => <button type="button" key={level} onClick={() => capture(level)}>{labels[level]} 측정 {draft[level] === undefined ? '' : '✓'}</button>)}</div>
      <div className="calibration-actions"><button type="button" className="primary-button" disabled={!levels.every((level) => draft[level] !== undefined && pitchDraft[level] !== undefined)} onClick={save}>기준 저장</button><button type="button" onClick={stopCalibration}>취소</button></div>
    </>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>
}
