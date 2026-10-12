import type { FaceLevel, FaceObservation } from './activeUser'

const KEY = 'bokjinaru-face-height-calibration-v1'
export type HeightCalibration = Record<FaceLevel, number> & { pitch?: Record<FaceLevel, number> }
export type HeightDecision = { level: FaceLevel | null; reason: 'height' | 'height-and-pose' | 'near-low-and-pose' | 'strong-height' | 'conflict' | 'uncertain' | 'uncalibrated' }

export function loadCalibration(): HeightCalibration | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as HeightCalibration | null
    if (!value || !['HIGH', 'MID', 'LOW'].every((key) => Number.isFinite(value[key as FaceLevel]))) return null
    if (!(value.HIGH < value.MID && value.MID < value.LOW)) return null
    if (value.pitch && (!['HIGH', 'MID', 'LOW'].every((key) => Number.isFinite(value.pitch?.[key as FaceLevel])) || Math.abs(value.pitch.LOW - value.pitch.MID) < 6)) return null
    return value
  } catch { return null }
}

export function saveCalibration(value: HeightCalibration) {
  if (!(value.HIGH + 0.04 < value.MID && value.MID + 0.04 < value.LOW)) throw new Error('높이 기준 간격이 너무 좁습니다. 다시 측정해 주세요.')
  if (value.pitch && (!['HIGH', 'MID', 'LOW'].every((key) => Number.isFinite(value.pitch?.[key as FaceLevel])) || Math.abs(value.pitch.LOW - value.pitch.MID) < 6)) throw new Error('고개 각도 차이가 너무 작습니다. 낮은 시점에서 화면을 올려다보며 다시 측정해 주세요.')
  localStorage.setItem(KEY, JSON.stringify(value))
}

export function classifyHeight(face: FaceObservation, calibration: HeightCalibration | null): FaceLevel {
  if (!calibration) return 'MID'
  if (face.eyeY < (calibration.HIGH + calibration.MID) / 2) return 'HIGH'
  if (face.eyeY > (calibration.MID + calibration.LOW) / 2) return 'LOW'
  return 'MID'
}

export function classifyAdaptiveHeight(face: FaceObservation, calibration: HeightCalibration | null): HeightDecision {
  if (!calibration) return { level: 'MID', reason: 'uncalibrated' }
  const height = classifyHeight(face, calibration)
  if (!calibration.pitch || face.pitch === undefined) return { level: height, reason: 'height' }

  const lowPitchDifference = calibration.pitch.LOW - calibration.pitch.MID
  const towardUp = (face.pitch - calibration.pitch.MID) * Math.sign(lowPitchDifference)
  const upThreshold = Math.max(4, Math.abs(lowPitchDifference) * 0.45)
  const downThreshold = -Math.max(6, Math.abs(lowPitchDifference) * 0.5)
  const lookingUp = towardUp >= upThreshold
  const lookingDown = towardUp <= downThreshold
  const lowBoundary = (calibration.MID + calibration.LOW) / 2
  const nearLowBoundary = face.eyeY >= lowBoundary - Math.min(0.03, (calibration.LOW - calibration.MID) * 0.2)

  if (height === 'LOW') {
    if (lookingDown) return { level: null, reason: 'conflict' }
    if (lookingUp) return { level: 'LOW', reason: 'height-and-pose' }
    if (face.eyeY >= calibration.LOW - 0.02) return { level: 'LOW', reason: 'strong-height' }
    return { level: null, reason: 'uncertain' }
  }
  if (height === 'MID' && nearLowBoundary && lookingUp) return { level: 'LOW', reason: 'near-low-and-pose' }
  if (lookingUp) return { level: null, reason: 'conflict' }
  return { level: height, reason: 'height-and-pose' }
}
