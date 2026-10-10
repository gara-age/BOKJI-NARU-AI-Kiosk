import { TOUCHLESS_CONFIG } from './config'
import { smoothCursor } from './CoordinateMapper'
import type { CursorPoint } from './touchless.types'

type FilterResult = { point: CursorPoint | null; accepted: boolean }

const distance = (a: CursorPoint, b: CursorPoint) => Math.hypot(a.x - b.x, a.y - b.y)
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

export class CursorFilter {
  private point: CursorPoint | null = null
  private acquisition: CursorPoint | null = null
  private pendingJump: CursorPoint | null = null
  private samples: CursorPoint[] = []

  update(raw: CursorPoint, width: number, height: number): FilterResult {
    if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return { point: this.point, accepted: false }
    const diagonal = Math.hypot(width, height)
    if (!this.point) {
      if (!this.acquisition || distance(raw, this.acquisition) > diagonal * TOUCHLESS_CONFIG.acquisitionRadiusRatio) {
        this.acquisition = raw
        return { point: null, accepted: false }
      }
      this.point = { x: (raw.x + this.acquisition.x) / 2, y: (raw.y + this.acquisition.y) / 2 }
      this.samples = [this.point]
      this.acquisition = null
      return { point: this.point, accepted: true }
    }

    if (distance(raw, this.point) > diagonal * TOUCHLESS_CONFIG.maxFrameJumpRatio) {
      if (!this.pendingJump || distance(raw, this.pendingJump) > diagonal * TOUCHLESS_CONFIG.confirmedJumpRadiusRatio) {
        this.pendingJump = raw
        return { point: this.point, accepted: false }
      }
      this.samples = []
    }
    this.pendingJump = null
    this.samples.push(raw)
    if (this.samples.length > 3) this.samples.shift()
    const stable = this.samples.length < 3
      ? raw
      : { x: median(this.samples.map((sample) => sample.x)), y: median(this.samples.map((sample) => sample.y)) }
    const movement = distance(stable, this.point)
    if (movement >= TOUCHLESS_CONFIG.cursorDeadZonePx) {
      const alpha = Math.min(TOUCHLESS_CONFIG.smoothingMaxAlpha, TOUCHLESS_CONFIG.smoothingMinAlpha + movement / diagonal * 2)
      const smoothed = smoothCursor(this.point, stable, alpha)
      const step = distance(smoothed, this.point)
      const maxStep = diagonal * TOUCHLESS_CONFIG.maxCursorStepRatio
      this.point = step > maxStep
        ? { x: this.point.x + (smoothed.x - this.point.x) * maxStep / step, y: this.point.y + (smoothed.y - this.point.y) * maxStep / step }
        : smoothed
    }
    return { point: this.point, accepted: true }
  }

  reset(): void {
    this.point = null
    this.acquisition = null
    this.pendingJump = null
    this.samples = []
  }
}
