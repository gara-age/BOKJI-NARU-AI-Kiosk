import type { CursorPoint, Landmark } from './touchless.types'

const clamp = (value: number) => Math.min(1, Math.max(0, value))

export function mapIndexToViewport(index: Landmark, width: number, height: number, mirrorX: boolean): CursorPoint {
  return {
    x: clamp(mirrorX ? 1 - index.x : index.x) * width,
    y: clamp(index.y) * height,
  }
}

export function smoothCursor(previous: CursorPoint | null, current: CursorPoint, alpha: number): CursorPoint {
  if (!previous) return current
  return {
    x: previous.x + (current.x - previous.x) * alpha,
    y: previous.y + (current.y - previous.y) * alpha,
  }
}
