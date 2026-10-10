import { TOUCHLESS_CONFIG } from './config'
import { mapIndexToViewport } from './CoordinateMapper'
import { CursorFilter } from './CursorFilter'
import { pinchRatio, PinchGate } from './GestureDetector'
import { isNearVisibleTarget, TargetDetector } from './TargetDetector'
import type { Landmark, TouchlessPhase } from './touchless.types'

export class TouchlessController {
  private cursor: HTMLElement
  private onPhase: (phase: TouchlessPhase) => void
  private filter = new CursorFilter()
  private lastSeenAt = 0
  private phase: TouchlessPhase = 'searching'
  private mirrorX: boolean = TOUCHLESS_CONFIG.mirrorX
  private pinch = new PinchGate(TOUCHLESS_CONFIG.pinchStartRatio, TOUCHLESS_CONFIG.pinchReleaseRatio)
  private targets = new TargetDetector(TOUCHLESS_CONFIG.hoverDwellMs, TOUCHLESS_CONFIG.snapRadiusPx)

  constructor(cursor: HTMLElement, onPhase: (phase: TouchlessPhase) => void) {
    this.cursor = cursor
    this.onPhase = onPhase
  }

  setMirrorX(mirrorX: boolean): void {
    this.mirrorX = mirrorX
    this.filter.reset()
    this.lastSeenAt = 0
    this.cursor.hidden = true
    this.targets.reset()
    this.pinch.reset()
    this.setPhase('searching')
  }

  onHand(landmarks: Landmark[], width: number, height: number, now: number): void {
    if (!landmarks[8] || width <= 0 || height <= 0) { this.onMissing(now); return }
    const next = mapIndexToViewport(landmarks[8], window.innerWidth, window.innerHeight, this.mirrorX)
    const { point, accepted } = this.filter.update(next, window.innerWidth, window.innerHeight)
    this.lastSeenAt = now
    if (!point || !accepted) return
    this.cursor.hidden = false
    this.cursor.style.left = `${point.x}px`
    this.cursor.style.top = `${point.y}px`

    const previousTarget = this.targets.currentTarget
    const target = this.targets.update(point, now)
    const started = this.pinch.update(pinchRatio(landmarks, width, height))
    const phase = this.pinch.isPinching ? 'pinch' : target ? 'hover' : 'tracking'
    this.cursor.dataset.phase = phase
    this.setPhase(phase)
    const selection = target ?? (started && previousTarget && !findOtherTarget(point, previousTarget) && isNearVisibleTarget(previousTarget, point, TOUCHLESS_CONFIG.pinchTargetTolerancePx) ? previousTarget : null)
    if (started && selection?.isConnected) {
      this.targets.reset()
      selection.click()
    }
  }

  onMissing(now: number): void {
    if (this.lastSeenAt && now - this.lastSeenAt < TOUCHLESS_CONFIG.trackingLostMs) return
    this.filter.reset()
    this.lastSeenAt = 0
    this.cursor.hidden = true
    this.targets.reset()
    this.pinch.reset()
    this.setPhase('searching')
  }

  dispose(): void {
    this.targets.reset()
    this.pinch.reset()
    this.filter.reset()
    this.cursor.hidden = true
  }

  private setPhase(next: TouchlessPhase): void {
    if (this.phase === next) return
    this.phase = next
    this.onPhase(next)
  }
}

function findOtherTarget(point: { x: number; y: number }, previousTarget: HTMLElement): boolean {
  const hit = document.elementFromPoint(point.x, point.y)?.closest('[data-touchless="true"]')
  return hit !== null && hit !== undefined && hit !== previousTarget
}
