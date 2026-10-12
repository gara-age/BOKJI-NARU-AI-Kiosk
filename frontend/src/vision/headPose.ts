import type { Matrix } from '@mediapipe/tasks-vision'

// The sign depends on the camera transform; calibration establishes which direction means looking up.
export function headPitchDegrees(matrix: Matrix | undefined): number | null {
  if (!matrix || matrix.rows !== 4 || matrix.columns !== 4) return null
  const { data } = matrix
  if (data.length !== 16 || !data.every(Number.isFinite)) return null
  const pitch = Math.atan2(data[9], data[10]) * 180 / Math.PI
  return Number.isFinite(pitch) ? pitch : null
}
