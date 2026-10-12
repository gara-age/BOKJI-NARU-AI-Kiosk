import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, CameraOff } from 'lucide-react'
import { ActiveUserTracker, type FaceLevel, type FaceObservation } from './activeUser'
import { classifyAdaptiveHeight, loadCalibration, type HeightDecision } from './calibration'
import { startFaceCamera } from './faceCamera'

type Props = {
  onLevel: (level: FaceLevel) => void
  onHandover: () => void
  onReturn: () => void
  onAbsence: () => void
  detectedLevel: FaceLevel
  appliedLevel: FaceLevel
  manualOverride: boolean
}

export function AdaptiveVision({ onLevel, onHandover, onReturn, onAbsence, detectedLevel, appliedLevel, manualOverride }: Props) {
  const callbacks = useRef({ onLevel, onHandover, onReturn, onAbsence })
  useEffect(() => { callbacks.current = { onLevel, onHandover, onReturn, onAbsence } }, [onLevel, onHandover, onReturn, onAbsence])
  const [retry, setRetry] = useState(0)
  const [visible, setVisible] = useState(!document.hidden)
  const [status, setStatus] = useState<'starting' | 'ready' | 'error'>('starting')
  const [tracking, setTracking] = useState<'searching' | 'active' | 'recalibrating'>('searching')
  const [debugOpen, setDebugOpen] = useState(false)
  const debugOpenRef = useRef(false)
  const previewRef = useRef<HTMLVideoElement>(null)
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null)
  const [previewRatio, setPreviewRatio] = useState('4 / 3')
  const [savedCalibration] = useState(() => loadCalibration())
  const calibrated = Boolean(savedCalibration)
  const poseCalibrated = Boolean(savedCalibration?.pitch)
  const [debugFaces, setDebugFaces] = useState<FaceObservation[]>([])
  const [activeFace, setActiveFace] = useState<FaceObservation | null>(null)
  const [debugDecision, setDebugDecision] = useState<HeightDecision | null>(null)

  useEffect(() => { debugOpenRef.current = debugOpen }, [debugOpen])

  useEffect(() => {
    const preview = previewRef.current
    if (!debugOpen || !preview || !previewStream) return
    preview.srcObject = previewStream
    void preview.play().catch(() => undefined)
    return () => { preview.pause(); preview.srcObject = null }
  }, [debugOpen, previewStream])

  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let stop: (() => void) | undefined
    const tracker = new ActiveUserTracker()
    const calibration = loadCalibration()
    let pendingLevel: FaceLevel | null = null
    let levelSince = 0
    let lastLevel: FaceLevel = 'MID'
    let recalibrating = false
    const fail = () => {
      if (cancelled) return
      setStatus('error')
      setTracking('searching')
      setPreviewStream(null)
      setDebugFaces([])
      setActiveFace(null)
      setDebugDecision(null)
      callbacks.current.onLevel('MID')
    }
    void startFaceCamera({
      isCancelled: () => cancelled,
      onError: fail,
      onCameraReady: (video) => {
        if (cancelled) return
        setPreviewStream(video?.srcObject instanceof MediaStream ? video.srcObject : null)
        if (video?.videoWidth && video.videoHeight) setPreviewRatio(`${video.videoWidth} / ${video.videoHeight}`)
      },
      onFaces: (faces, now) => {
        const { face, event } = tracker.update(faces, now)
        const decision = face ? classifyAdaptiveHeight(face, calibration) : null
        if (debugOpenRef.current) { setDebugFaces(faces); setActiveFace(face); setDebugDecision(decision) }
        if (event?.type === 'changed') { recalibrating = true; setTracking('recalibrating'); callbacks.current.onHandover(); pendingLevel = null }
        if (event?.type === 'returned') { recalibrating = true; callbacks.current.onReturn(); pendingLevel = null }
        if (event?.type === 'lost') { setTracking('searching'); callbacks.current.onAbsence() }
        if (!face) return
        const next = decision!.level
        if (!next) { pendingLevel = null; return }
        if (next !== pendingLevel) { pendingLevel = next; levelSince = now }
        if (now - levelSince >= 800 && (next !== lastLevel || recalibrating)) {
          lastLevel = next
          recalibrating = false
          callbacks.current.onLevel(next)
          setTracking('active')
        }
        if (event?.type === 'acquired') setTracking('active')
      },
    }).then((cleanup) => {
      if (cancelled) cleanup()
      else { stop = cleanup; setStatus('ready') }
    }).catch(fail)
    return () => { cancelled = true; stop?.(); setPreviewStream(null); setDebugFaces([]); setActiveFace(null); setDebugDecision(null) }
  }, [retry, visible])

  return <><div className="adaptive-vision-status" role="status">
    {status === 'error' ? <><CameraOff aria-hidden="true" /><span>카메라를 사용할 수 없어 기본 화면을 표시합니다.</span><button type="button" onClick={() => { setStatus('starting'); setRetry((value) => value + 1) }}>다시 시도</button></>
      : <><Camera aria-hidden="true" /><span>{status === 'starting' ? '시점 조정 카메라를 준비하고 있어요' : !calibrated ? '높이 보정이 없어 기본 화면(MID)을 표시합니다' : tracking === 'recalibrating' ? '새 사용자 시점을 확인하고 있어요' : tracking === 'active' ? '시점에 맞춰 화면을 조정했어요' : '이용자 시점을 확인하고 있어요'} · 영상은 저장·전송하지 않습니다.</span></>}
    <button type="button" aria-expanded={debugOpen} aria-controls="vision-debug-panel" onClick={() => { setDebugOpen((open) => !open); setDebugFaces([]); setActiveFace(null); setDebugDecision(null) }}>{debugOpen ? '디버그 닫기' : '카메라 디버그 보기'}</button>
  </div>
  {debugOpen && createPortal(<aside id="vision-debug-panel" className="vision-debug-panel" role="region" aria-label="시점 판정 디버그">
    <div className="vision-debug-heading"><strong>카메라 · 시점 판정</strong><button type="button" onClick={() => setDebugOpen(false)} aria-label="카메라 디버그 닫기">닫기</button></div>
    <div className="vision-debug-preview" style={{ aspectRatio: previewRatio }}>
      {previewStream && visible && <video ref={previewRef} muted playsInline autoPlay aria-label="실시간 카메라 미리보기" onLoadedMetadata={(event) => { const video = event.currentTarget; if (video.videoWidth && video.videoHeight) setPreviewRatio(`${video.videoWidth} / ${video.videoHeight}`) }} />}
      {previewStream && visible && debugFaces.map((face, index) => <span key={index} className={'vision-debug-face' + (face === activeFace ? ' active' : '')} style={{ left: `${(face.x - face.width / 2) * 100}%`, top: `${(face.y - face.height / 2) * 100}%`, width: `${face.width * 100}%`, height: `${face.height * 100}%` }} />)}
      {(!previewStream || !visible) && <span className="vision-debug-empty">{status === 'error' ? '카메라를 사용할 수 없습니다' : '카메라 연결을 기다리는 중'}</span>}
    </div>
    <div className="vision-debug-levels"><div><span>카메라 판정</span><strong data-testid="vision-detected-level">{detectedLevel}</strong></div><div><span>현재 화면</span><strong data-testid="vision-applied-level">{appliedLevel}</strong></div></div>
    {!calibrated && <p className="vision-debug-warning">이 브라우저에는 높이 보정값이 없어 자동 분류가 불가능합니다. 같은 기기·브라우저·주소에서 <a href="/admin">관리자 보정</a>을 완료해 주세요.</p>}
    <p className="vision-debug-detail">{manualOverride ? '수동 배치 사용 중 · 자동 판정은 화면에 적용되지 않음' : tracking === 'recalibrating' ? '새 사용자 높이를 다시 판정 중' : tracking === 'active' ? '얼굴 추적 중' : '얼굴을 찾는 중'} · {calibrated ? poseCalibrated ? '눈높이·고개 각도 보정 적용' : '이전 눈높이 보정만 적용' : '높이 보정 없음: MID 유지'} · 얼굴 {debugFaces.length}개</p>
    <p className="vision-debug-detail">눈 위치 Y: {activeFace ? activeFace.eyeY.toFixed(3) : '측정 대기'}{savedCalibration && ` · HIGH/MID ${((savedCalibration.HIGH + savedCalibration.MID) / 2).toFixed(3)} · MID/LOW ${((savedCalibration.MID + savedCalibration.LOW) / 2).toFixed(3)}`}</p>
    <p className="vision-debug-detail">고개 상하 각도: {activeFace?.pitch === undefined ? '측정 대기' : `${activeFace.pitch.toFixed(1)}°`} · 판정 근거: {debugDecision?.reason === 'height-and-pose' ? '눈높이·각도 일치' : debugDecision?.reason === 'near-low-and-pose' ? '낮은 경계 근처·올려다봄' : debugDecision?.reason === 'strong-height' ? '뚜렷하게 낮은 눈높이' : debugDecision?.reason === 'conflict' ? '신호 불일치: 현재 배치 유지' : debugDecision?.reason === 'uncertain' ? '경계 구간: 현재 배치 유지' : debugDecision?.reason === 'height' ? '눈높이만 적용' : '판정 대기'}</p>
    <small>파란 테두리: 현재 조작자 · 영상은 저장하거나 전송하지 않습니다.</small>
  </aside>, document.body)}
  </>
}
