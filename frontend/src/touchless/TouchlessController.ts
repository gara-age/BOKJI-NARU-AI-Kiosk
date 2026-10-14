import { TOUCHLESS_CONFIG } from './config'
import { mapIndexToViewport } from './CoordinateMapper'
import { CursorFilter } from './CursorFilter'
import { indexExtended, pinchRatio, PinchGate } from './GestureDetector'
import { findTouchlessTarget, isNearVisibleTarget, TargetDetector } from './TargetDetector'
import type { Landmark, TouchlessPhase } from './touchless.types'
import { handAnchor, interactionOwnerGeneration, selectActiveHand } from '../vision/interactionOwner'

export class TouchlessController {
  private cursor: HTMLElement
  private onPhase: (phase: TouchlessPhase) => void
  private filter = new CursorFilter()
  private lastSeenAt = 0
  private phase: TouchlessPhase = 'searching'
  private mirrorX: boolean = TOUCHLESS_CONFIG.mirrorX
  private pinch = new PinchGate(TOUCHLESS_CONFIG.pinchStartRatio, TOUCHLESS_CONFIG.pinchReleaseRatio)
  private targets = new TargetDetector(TOUCHLESS_CONFIG.hoverDwellMs, TOUCHLESS_CONFIG.snapRadiusPx)
  private candidateAnchor: Landmark | null = null
  private candidateSince = 0
  private confirmedAnchor: Landmark | null = null
  private ownerGeneration = interactionOwnerGeneration()
  private scrollTarget: HTMLElement | null = null
  private scrollY = 0

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
    this.scrollTarget = null
    this.setPhase('searching')
    this.candidateAnchor = null
    this.confirmedAnchor = null
  }

  onHands(hands: Landmark[][], width: number, height: number, now: number): void {
    const generation = interactionOwnerGeneration()
    if (generation !== this.ownerGeneration) {
      this.ownerGeneration = generation
      this.candidateAnchor = null
      this.confirmedAnchor = null
      this.resetInput()
    }
    const hand = selectActiveHand(hands, now, this.confirmedAnchor ?? this.candidateAnchor)
    const anchor = hand ? handAnchor(hand) : null
    if (!hand || !anchor) {
      this.candidateAnchor = null
      this.confirmedAnchor = null
      this.onMissing(now)
      return
    }
    if (this.confirmedAnchor && Math.hypot(anchor.x - this.confirmedAnchor.x, anchor.y - this.confirmedAnchor.y) < 0.17) {
      this.confirmedAnchor = anchor
      this.onHand(hand, width, height, now)
      return
    }
    if (this.confirmedAnchor) this.resetInput()
    this.confirmedAnchor = null
    if (!this.candidateAnchor || Math.hypot(anchor.x - this.candidateAnchor.x, anchor.y - this.candidateAnchor.y) >= 0.12) {
      this.candidateAnchor = anchor
      this.candidateSince = now
      return
    }
    this.candidateAnchor = anchor
    if (now - this.candidateSince < TOUCHLESS_CONFIG.handAcquisitionMs) return
    this.confirmedAnchor = anchor
    this.onHand(hand, width, height, now)
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
    const started = this.pinch.update(pinchRatio(landmarks, width, height), indexExtended(landmarks, width, height))
    if (!this.pinch.isPinching) this.scrollTarget = null
    const phase = this.pinch.isPinching ? 'pinch' : target ? 'hover' : 'tracking'
    this.cursor.dataset.phase = phase
    this.cursor.dataset.gesture = this.scrollTarget ? 'scroll' : 'select'
    this.setPhase(phase)
    const selection = target ?? (started && previousTarget && !findOtherTarget(point, previousTarget) && isNearVisibleTarget(previousTarget, point, TOUCHLESS_CONFIG.pinchTargetTolerancePx) ? previousTarget : null)
    if (started && selection?.isConnected) {
      this.targets.reset()
      selection.click()
    } else if (started && !findTouchlessTarget(point, TOUCHLESS_CONFIG.pinchTargetTolerancePx)) {
      this.scrollTarget = scrollableAt(point.x, point.y)
      this.scrollY = point.y
      this.cursor.dataset.gesture = 'scroll'
      this.targets.reset()
    } else if (this.pinch.isPinching && this.scrollTarget) {
      const delta = this.scrollY - point.y
      if (Math.abs(delta) >= 2) this.scrollTarget.scrollTop += delta * 1.5
      this.scrollY = point.y
    }
  }

  onMissing(now: number): void {
    if (this.lastSeenAt && now - this.lastSeenAt < TOUCHLESS_CONFIG.trackingLostMs) return
    this.resetInput()
  }

  private resetInput(): void {
    this.filter.reset()
    this.lastSeenAt = 0
    this.cursor.hidden = true
    this.targets.reset()
    this.pinch.reset()
    this.scrollTarget = null
    this.setPhase('searching')
  }

  dispose(): void {
    this.candidateAnchor = null
    this.confirmedAnchor = null
    this.targets.reset()
    this.pinch.reset()
    this.scrollTarget = null
    this.filter.reset()
    this.cursor.hidden = true
  }

  private setPhase(next: TouchlessPhase): void {
    if (this.phase === next) return
    this.phase = next
    this.onPhase(next)
  }
}

function scrollableAt(x: number, y: number): HTMLElement {
  let element = document.elementFromPoint(x, y) as HTMLElement | null
  while (element && element !== document.body) {
    const overflow = getComputedStyle(element).overflowY
    if (/(auto|scroll)/.test(overflow) && element.scrollHeight > element.clientHeight) return element
    element = element.parentElement
  }
  return document.scrollingElement as HTMLElement || document.documentElement
}

function findOtherTarget(point: { x: number; y: number }, previousTarget: HTMLElement): boolean {
  const hit = document.elementFromPoint(point.x, point.y)?.closest('[data-touchless="true"]')
  return hit !== null && hit !== undefined && hit !== previousTarget
}
