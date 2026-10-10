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

export class PinchGate {
  private closed = false
  private armed = false
  private startRatio: number
  private releaseRatio: number

  constructor(startRatio: number, releaseRatio: number) {
    this.startRatio = startRatio
    this.releaseRatio = releaseRatio
  }

  get isPinching(): boolean { return this.closed }

  update(ratio: number | null): boolean {
    if (ratio === null || !Number.isFinite(ratio)) return false
    if (this.closed) {
      if (ratio > this.releaseRatio) {
        this.closed = false
        this.armed = true
      }
      return false
    }
    if (ratio > this.releaseRatio) this.armed = true
    if (this.armed && ratio < this.startRatio) {
      this.closed = true
      return true
    }
    return false
  }

  reset(): void {
    this.closed = false
    this.armed = false
  }
}
