import type { CursorPoint } from './touchless.types'

const selector = '[data-touchless="true"]'

function usable(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.isConnected &&
    !element.matches(':disabled, [aria-disabled="true"]') && element.getClientRects().length > 0
}

export function findTouchlessTarget(point: CursorPoint, snapRadiusPx = 0): HTMLElement | null {
  const hit = document.elementFromPoint(point.x, point.y)
  const direct = hit?.closest(selector) ?? null
  if (usable(direct)) return direct
  if (snapRadiusPx <= 0 || !hit) return null

  let nearest: HTMLElement | null = null
  let distance = snapRadiusPx
  for (const element of document.querySelectorAll(selector)) {
    if (!usable(element)) continue
    const rect = element.getBoundingClientRect()
    const dx = Math.max(rect.left - point.x, 0, point.x - rect.right)
    const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom)
    const candidateDistance = Math.hypot(dx, dy)
    if (candidateDistance < distance && document.elementFromPoint(Math.min(Math.max(point.x, rect.left), rect.right), Math.min(Math.max(point.y, rect.top), rect.bottom))?.closest(selector) === element) {
      distance = candidateDistance
      nearest = element
    }
  }
  return nearest
}

export function isNearVisibleTarget(target: HTMLElement, point: CursorPoint, tolerancePx: number): boolean {
  if (!usable(target)) return false
  const rect = target.getBoundingClientRect()
  const dx = Math.max(rect.left - point.x, 0, point.x - rect.right)
  const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom)
  if (Math.hypot(dx, dy) > tolerancePx) return false
  const x = Math.min(Math.max(point.x, rect.left + 1), rect.right - 1)
  const y = Math.min(Math.max(point.y, rect.top + 1), rect.bottom - 1)
  return document.elementFromPoint(x, y)?.closest(selector) === target
}

export class TargetDetector {
  private candidate: HTMLElement | null = null
  private candidateSince = 0
  private current: HTMLElement | null = null
  private dwellMs: number
  private snapRadiusPx: number

  constructor(dwellMs: number, snapRadiusPx: number) {
    this.dwellMs = dwellMs
    this.snapRadiusPx = snapRadiusPx
  }

  get currentTarget(): HTMLElement | null { return this.current }

  update(point: CursorPoint, now: number): HTMLElement | null {
    const next = findTouchlessTarget(point, this.snapRadiusPx)
    if (next !== this.candidate) {
      this.candidate = next
      this.candidateSince = now
      this.setCurrent(null)
    } else if (next && now - this.candidateSince >= this.dwellMs) {
      this.setCurrent(next)
    }
    return this.current
  }

  reset(): void {
    this.candidate = null
    this.candidateSince = 0
    this.setCurrent(null)
  }

  private setCurrent(next: HTMLElement | null): void {
    if (this.current === next) return
    this.current?.classList.remove('touchless-hover')
    this.current = next
    this.current?.classList.add('touchless-hover')
  }
}
