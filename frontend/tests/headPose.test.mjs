import assert from 'node:assert/strict'
import test from 'node:test'
import { headPitchDegrees } from '../src/vision/headPose.ts'

test('extracts relative pitch from a valid face transform', () => {
  const identity = { rows: 4, columns: 4, data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }
  assert.equal(headPitchDegrees(identity), 0)
  assert.equal(Math.round(headPitchDegrees({ ...identity, data: [1, 0, 0, 0, 0, .866, .5, 0, 0, -.5, .866, 0, 0, 0, 0, 1] })), -30)
  assert.equal(headPitchDegrees(undefined), null)
  assert.equal(headPitchDegrees({ ...identity, data: [Number.NaN, ...identity.data.slice(1)] }), null)
})
