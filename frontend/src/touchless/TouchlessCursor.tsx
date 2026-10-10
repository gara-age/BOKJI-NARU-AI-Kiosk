import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Hand, VideoOff } from 'lucide-react'
import { TOUCHLESS_CONFIG } from './config'
import { startHandTracker } from './HandTracker'
import { TouchlessController } from './TouchlessController'
import type { TouchlessPhase } from './touchless.types'

const phaseLabels: Record<TouchlessPhase, string> = {
  searching: '손을 찾고 있어요',
  tracking: '검지로 버튼을 가리켜 주세요',
  hover: '엄지와 검지를 붙이면 선택돼요',
  pinch: '손가락을 다시 벌려 주세요',
}

export function TouchlessCursor() {
  const cursorRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<TouchlessController | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [mirrorX, setMirrorX] = useState<boolean>(TOUCHLESS_CONFIG.mirrorX)
  const [phase, setPhase] = useState<TouchlessPhase>('searching')
  const [status, setStatus] = useState<'off' | 'starting' | 'ready'>('off')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled || !cursorRef.current) return
    let cancelled = false
    let stop: (() => void) | undefined
    const controller = new TouchlessController(cursorRef.current, setPhase)
    controller.setMirrorX(mirrorX)
    controllerRef.current = controller
    const handleVisibility = () => {
      if (document.hidden) setEnabled(false)
    }
    document.addEventListener('visibilitychange', handleVisibility)

    void startHandTracker({
      isCancelled: () => cancelled,
      onHand: (hand, width, height, now) => controller.onHand(hand, width, height, now),
      onMissing: (now) => controller.onMissing(now),
      onError: () => {
        if (!cancelled) {
          setError('손 인식이 중단됐어요. 카메라를 확인하고 다시 시작해 주세요.')
          setEnabled(false)
        }
      },
    }).then((cleanup) => {
      if (cancelled) cleanup()
      else { stop = cleanup; setStatus('ready') }
    }).catch(() => {
      if (!cancelled) {
        setError('카메라를 열 수 없어요. 권한과 HTTPS 연결을 확인해 주세요.')
        setEnabled(false)
      }
    })

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibility)
      stop?.()
      controller.dispose()
      if (controllerRef.current === controller) controllerRef.current = null
    }
    // Camera lifetime depends only on the explicit on/off switch.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  const toggle = () => {
    if (enabled) {
      setEnabled(false)
      setStatus('off')
      setPhase('searching')
    } else {
      setError('')
      setStatus('starting')
      setEnabled(true)
    }
  }

  const toggleMirror = () => {
    const next = !mirrorX
    setMirrorX(next)
    controllerRef.current?.setMirrorX(next)
  }

  return <div className="touchless-control">
    <button type="button" className={'touchless-toggle' + (enabled ? ' active' : '')} onClick={toggle} data-touchless={enabled ? 'true' : undefined} aria-pressed={enabled}>
      {enabled ? <VideoOff aria-hidden="true" /> : <Camera aria-hidden="true" />}
      {enabled ? '비접촉 입력 끄기' : '비접촉 손동작 사용하기'}
    </button>
    {enabled && <div className="touchless-guide" aria-live="polite">
      <Hand aria-hidden="true" />
      <span><strong>{status === 'starting' ? '카메라를 시작하고 있어요' : phaseLabels[phase]}</strong><small>검지로 버튼을 가리킨 뒤 엄지와 검지를 붙여 선택하세요. 영상은 저장·전송하지 않습니다.</small></span>
      <button type="button" onClick={toggleMirror} aria-pressed={!mirrorX}>좌우 방향 바꾸기</button>
    </div>}
    {error && <p className="touchless-error" role="alert">{error} 기존 터치와 직접 입력은 계속 사용할 수 있습니다.</p>}
    {createPortal(<div ref={cursorRef} className="touchless-cursor" data-phase={phase} hidden aria-hidden="true" />, document.body)}
  </div>
}
