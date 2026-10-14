import type { FaceObservation } from './activeUser'
import type { Landmark } from '../touchless/touchless.types'

type Snapshot = { faces: FaceObservation[]; active: FaceObservation | null; updatedAt: number }
let snapshot: Snapshot = { faces: [], active: null, updatedAt: 0 }
let generation = 0

export function updateInteractionOwner(faces: FaceObservation[], active: FaceObservation | null, now: number, changed = false): void {
  if (changed) generation += 1
  snapshot = { faces, active, updatedAt: now }
}

export function clearInteractionOwner(): void {
  generation += 1
  snapshot = { faces: [], active: null, updatedAt: 0 }
}

export function interactionOwnerGeneration(): number { return generation }

export function handAnchor(hand: Landmark[]): Landmark | null {
  const wrist = hand[0]
  const palm = hand[9]
  if (!wrist || !palm) return null
  return { x: (wrist.x + palm.x) / 2, y: (wrist.y + palm.y) / 2 }
}

function ownershipDistance(anchor: Landmark, face: FaceObservation): number {
  const horizontal = Math.abs(anchor.x - face.x)
  const vertical = Math.max(0, face.y - face.height * 0.5 - anchor.y) * 2
  return horizontal + vertical
}

export function selectActiveHand(hands: Landmark[][], now: number, previousAnchor: Landmark | null = null): Landmark[] | null {
  if (!hands.length) return null
  if (!snapshot.updatedAt || now - snapshot.updatedAt > 600 || !snapshot.faces.length) {
    const candidates = hands.flatMap((hand) => {
      const anchor = handAnchor(hand)
      return anchor ? [{ hand, anchor }] : []
    })
    candidates.sort((a, b) => previousAnchor
      ? Math.hypot(a.anchor.x - previousAnchor.x, a.anchor.y - previousAnchor.y) - Math.hypot(b.anchor.x - previousAnchor.x, b.anchor.y - previousAnchor.y)
      : Math.abs(a.anchor.x - 0.5) - Math.abs(b.anchor.x - 0.5))
    return candidates[0]?.hand ?? null
  }
  if (!snapshot.active) return null
  const candidates = hands.flatMap((hand) => {
    const anchor = handAnchor(hand)
    if (!anchor) return []
    const distance = ownershipDistance(anchor, snapshot.active!)
    if (distance > 0.36 || anchor.y > snapshot.active!.y + 0.65) return []
    const bystanderCloser = snapshot.faces.some((face) => face !== snapshot.active && ownershipDistance(anchor, face) + 0.06 < distance)
    return bystanderCloser ? [] : [{ hand, anchor, distance }]
  })
  candidates.sort((a, b) => {
    if (previousAnchor) {
      const previousA = Math.hypot(a.anchor.x - previousAnchor.x, a.anchor.y - previousAnchor.y)
      const previousB = Math.hypot(b.anchor.x - previousAnchor.x, b.anchor.y - previousAnchor.y)
      if (Math.min(previousA, previousB) < 0.17) return previousA - previousB
    }
    return a.distance - b.distance
  })
  return candidates[0]?.hand ?? null
}
