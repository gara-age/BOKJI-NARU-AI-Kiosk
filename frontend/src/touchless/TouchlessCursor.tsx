import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pointer } from 'lucide-react'
import { TOUCHLESS_CONFIG } from './config'
import { startHandTracker } from './HandTracker'
import { TouchlessController } from './TouchlessController'
import type { TouchlessPhase } from './touchless.types'

export function TouchlessCursor({ enabled }: { enabled: boolean }) {
  const cursorRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<TouchlessPhase>('searching')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled || !cursorRef.current) return
    let cancelled = false
    let stop: (() => void) | undefined
    const controller = new TouchlessController(cursorRef.current, setPhase)
    controller.setMirrorX(TOUCHLESS_CONFIG.mirrorX)
    void startHandTracker({
      isCancelled: () => cancelled,
      onHands: (hands, width, height, now) => controller.onHands(hands, width, height, now),
      onMissing: (now) => controller.onMissing(now),
      onError: () => {
        if (!cancelled) {
          setError('손 인식이 중단됐어요. 카메라를 확인하고 다시 시작해 주세요.')
        }
      },
    }).then((cleanup) => {
      if (cancelled) cleanup()
      else stop = cleanup
    }).catch(() => {
      if (!cancelled) {
        setError('카메라를 열 수 없어요. 권한과 HTTPS 연결을 확인해 주세요.')
      }
    })

    return () => {
      cancelled = true
      stop?.()
      controller.dispose()
    }
    // Camera lifetime depends only on the explicit on/off switch.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  useEffect(() => {
    setError('')
    setPhase('searching')
  }, [enabled])

  return <div className="touchless-control">
    {error && <p className="touchless-error" role="alert">{error} 기존 터치와 직접 입력은 계속 사용할 수 있습니다.</p>}
    {createPortal(<div ref={cursorRef} className="touchless-cursor" data-phase={phase} hidden aria-hidden="true"><Pointer className="touchless-point" /><svg className="touchless-fist" viewBox="0 0 64 64" aria-hidden="true"><path d="M13 27v-5a6 6 0 0 1 10-4 6 6 0 0 1 10-2 6 6 0 0 1 10 1 6 6 0 0 1 10 5v15c0 10-7 17-17 17H28c-10 0-17-7-17-17v-6c0-2 1-3 2-4Z" /><path d="M24 54v5h20v-5" /></svg></div>, document.body)}
  </div>
}
