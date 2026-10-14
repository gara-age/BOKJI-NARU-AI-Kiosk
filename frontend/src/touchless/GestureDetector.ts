import type { Landmark } from './touchless.types'

function distance(a: Landmark, b: Landmark, width: number, height: number): number {
  return Math.hypot((a.x - b.x) * width, (a.y - b.y) * height)
}

export function pinchRatio(landmarks: Landmark[], width: number, height: number): number | null {
  if (landmarks.length < 18) return null
  const palmWidth = distance(landmarks[5], landmarks[17], width, height)
  if (palmWidth < 12) return null
  return distance(landmarks[4], landmarks[8], width, height) / palmWidth
}

export function indexExtended(landmarks: Landmark[], width: number, height: number): boolean {
  if (landmarks.length < 9) return false
  const base = distance(landmarks[5], landmarks[6], width, height)
  const reach = distance(landmarks[5], landmarks[8], width, height)
  return base >= 5 && reach >= base * 1.25
}

export class PinchGate {
  private closed = false
  private armed = false
  private closeFrames = 0
  private releaseFrames = 0
  private startRatio: number
  private releaseRatio: number

  constructor(startRatio: number, releaseRatio: number) {
    this.startRatio = startRatio
    this.releaseRatio = releaseRatio
  }

  get isPinching(): boolean { return this.closed }

  update(ratio: number | null, eligible = true): boolean {
    if (ratio === null || !Number.isFinite(ratio)) {
      this.closeFrames = 0
      return false
    }
    if (this.closed) {
      this.releaseFrames = ratio > this.releaseRatio || !eligible ? this.releaseFrames + 1 : 0
      if (this.releaseFrames >= 2) {
        this.closed = false
        this.armed = ratio > this.releaseRatio
        this.releaseFrames = 0
      }
      return false
    }
    if (ratio > this.releaseRatio) {
      this.armed = true
      this.closeFrames = 0
    } else if (!eligible) {
      this.closeFrames = 0
    }
    if (this.armed && eligible && ratio < this.startRatio) this.closeFrames += 1
    else this.closeFrames = 0
    if (this.closeFrames >= 2) {
      this.closed = true
      this.armed = false
      this.closeFrames = 0
      return true
    }
    return false
  }

  reset(): void {
    this.closed = false
    this.armed = false
    this.closeFrames = 0
    this.releaseFrames = 0
  }
}
