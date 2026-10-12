export type FaceObservation = { x: number; y: number; width: number; height: number; eyeY: number; pitch?: number; confidence: number }
export type FaceLevel = 'LOW' | 'MID' | 'HIGH'
export type UserEvent = { type: 'acquired' | 'changed' | 'returned' | 'lost'; face?: FaceObservation }

type Track = { id: number; face: FaceObservation; seenAt: number; firstSeenAt: number }

const centerDistance = (a: FaceObservation, b: FaceObservation) => Math.hypot(a.x - b.x, a.y - b.y)
const importance = (face: FaceObservation) => face.width * face.height * 2 - Math.abs(face.x - 0.5) * 0.35

export class ActiveUserTracker {
  private tracks: Track[] = []
  private nextId = 1
  private activeId: number | null = null
  private previousId: number | null = null
  private candidateId: number | null = null
  private candidateSince = 0
  private lostNotified = false
  private missingSince = 0
  private previousUntil = 0
  private returnSince = 0

  update(faces: FaceObservation[], now: number): { face: FaceObservation | null; event: UserEvent | null } {
    const retained = (track: Track) => now - track.seenAt < 1200 || (track.id === this.previousId && now < this.previousUntil)
    const available = [...this.tracks.filter(retained)]
    const validFaces = faces.filter((item) => item.confidence >= 0.55)
    const assignments: Array<{ faceIndex: number; track: Track; cost: number }> = []
    for (let faceIndex = 0; faceIndex < validFaces.length; faceIndex += 1) {
      const face = validFaces[faceIndex]
      for (const track of available) {
        const distance = centerDistance(face, track.face)
        const sizeRatio = Math.max(face.height / track.face.height, track.face.height / face.height)
        const cost = distance / Math.max(face.width, track.face.width, 0.12) + Math.abs(Math.log(sizeRatio)) * 0.45
        if (distance < 0.19 && sizeRatio < 1.65) assignments.push({ faceIndex, track, cost })
      }
    }
    assignments.sort((a, b) => a.cost - b.cost)
    const matchedFaces = new Set<number>()
    const matchedTracks = new Set<number>()
    const seen: Track[] = []
    for (const { faceIndex, track } of assignments) {
      if (matchedFaces.has(faceIndex) || matchedTracks.has(track.id)) continue
      track.face = validFaces[faceIndex]
      track.seenAt = now
      matchedFaces.add(faceIndex)
      matchedTracks.add(track.id)
      seen.push(track)
    }
    for (let index = 0; index < validFaces.length; index += 1) {
      if (matchedFaces.has(index)) continue
      const created = { id: this.nextId++, face: validFaces[index], seenAt: now, firstSeenAt: now }
      available.push(created)
      seen.push(created)
    }
    this.tracks = available.filter(retained)
    const active = seen.find((track) => track.id === this.activeId)
    const prior = now < this.previousUntil ? seen.find((track) => track.id === this.previousId) : undefined
    if (!prior) this.returnSince = 0
    if (prior && this.previousId !== null) {
      if (!this.returnSince) this.returnSince = now
      if (now - this.returnSince < 400) return { face: active?.face ?? null, event: null }
      this.activeId = prior.id
      this.previousId = null
      this.returnSince = 0
      this.candidateId = null
      this.lostNotified = false
      this.missingSince = 0
      return { face: prior.face, event: { type: 'returned', face: prior.face } }
    }
    if (active) {
      this.lostNotified = false
      this.missingSince = 0
      const challenger = seen.filter((track) => track.id !== active.id).sort((a, b) => importance(b.face) - importance(a.face))[0]
      if (challenger && importance(challenger.face) > importance(active.face) + 0.12 && Math.abs(challenger.face.x - 0.5) < 0.24) {
        if (this.candidateId !== challenger.id) { this.candidateId = challenger.id; this.candidateSince = now }
        if (now - this.candidateSince >= 800 && now - challenger.firstSeenAt >= 800) {
          this.previousId = null
          this.activeId = challenger.id
          this.candidateId = null
          return { face: challenger.face, event: { type: 'changed', face: challenger.face } }
        }
      } else this.candidateId = null
      return { face: active.face, event: null }
    }
    const challenger = seen.sort((a, b) => importance(b.face) - importance(a.face))[0]
    if (!challenger) {
      this.candidateId = null
      if (!this.missingSince) this.missingSince = now
      if (this.activeId !== null && !this.lostNotified && now - this.missingSince >= 700) {
        this.lostNotified = true
        return { face: null, event: { type: 'lost' } }
      }
      return { face: null, event: null }
    }
    this.missingSince = 0
    if (this.candidateId !== challenger.id) {
      this.candidateId = challenger.id
      this.candidateSince = now
    }
    // A newcomer must survive the full interval, not merely appear for one frame.
    if (now - this.candidateSince < 400 || now - challenger.firstSeenAt < 400) return { face: null, event: null }
    const changed = this.activeId !== null
    this.previousId = changed ? this.activeId : null
    this.previousUntil = now + 8000
    this.activeId = challenger.id
    this.candidateId = null
    this.lostNotified = false
    return { face: challenger.face, event: { type: changed ? 'changed' : 'acquired', face: challenger.face } }
  }

  get activeFace(): FaceObservation | null {
    return this.tracks.find((track) => track.id === this.activeId)?.face ?? null
  }

  clearPrevious() { this.previousId = null }
}
