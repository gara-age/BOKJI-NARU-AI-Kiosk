import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyAdaptiveHeight, classifyHeight, loadCalibration, saveCalibration } from '../src/vision/calibration.ts'

const entries = new Map()
globalThis.localStorage = {
  getItem: (key) => entries.get(key) ?? null,
  setItem: (key, value) => entries.set(key, value),
}
const face = (eyeY) => ({ x: .5, y: eyeY + .05, width: .2, height: .25, eyeY, confidence: .9 })

test('uncalibrated devices remain MID and stored thresholds are per browser', () => {
  entries.clear()
  assert.equal(classifyHeight(face(.7), loadCalibration()), 'MID')
  saveCalibration({ HIGH: .25, MID: .45, LOW: .65 })
  assert.deepEqual(loadCalibration(), { HIGH: .25, MID: .45, LOW: .65 })
  assert.equal(classifyHeight(face(.29), loadCalibration()), 'HIGH')
  assert.equal(classifyHeight(face(.49), loadCalibration()), 'MID')
  assert.equal(classifyHeight(face(.62), loadCalibration()), 'LOW')
})

test('overlapping references cannot be saved', () => {
  assert.throws(() => saveCalibration({ HIGH: .4, MID: .42, LOW: .6 }))
})

test('low eyes and upward head pose reinforce LOW; conflicting signals keep the layout', () => {
  const calibration = { HIGH: .25, MID: .45, LOW: .65, pitch: { HIGH: 0, MID: 2, LOW: 18 } }
  assert.deepEqual(classifyAdaptiveHeight({ ...face(.58), pitch: 14 }, calibration), { level: 'LOW', reason: 'height-and-pose' })
  assert.deepEqual(classifyAdaptiveHeight({ ...face(.58), pitch: -10 }, calibration), { level: null, reason: 'conflict' })
  assert.deepEqual(classifyAdaptiveHeight({ ...face(.58), pitch: 2 }, calibration), { level: null, reason: 'uncertain' })
  assert.deepEqual(classifyAdaptiveHeight({ ...face(.66), pitch: 2 }, calibration), { level: 'LOW', reason: 'strong-height' })
  assert.deepEqual(classifyAdaptiveHeight({ ...face(.45), pitch: 18 }, calibration), { level: null, reason: 'conflict' })
})

test('pose direction is learned from calibration rather than assumed', () => {
  const calibration = { HIGH: .25, MID: .45, LOW: .65, pitch: { HIGH: 0, MID: -2, LOW: -18 } }
  assert.equal(classifyAdaptiveHeight({ ...face(.58), pitch: -14 }, calibration).level, 'LOW')
  assert.equal(classifyAdaptiveHeight({ ...face(.58), pitch: 10 }, calibration).level, null)
  assert.throws(() => saveCalibration({ ...calibration, pitch: { HIGH: 0, MID: 1, LOW: 3 } }))
})

test('an upward pose can confirm LOW just above the eye-height boundary', () => {
  const calibration = { HIGH: .25, MID: .45, LOW: .65, pitch: { HIGH: 0, MID: 2, LOW: 18 } }
  assert.deepEqual(classifyAdaptiveHeight({ ...face(.53), pitch: 14 }, calibration), { level: 'LOW', reason: 'near-low-and-pose' })
  assert.equal(classifyAdaptiveHeight({ ...face(.53), pitch: 2 }, calibration).level, 'MID')
  assert.equal(classifyAdaptiveHeight({ ...face(.45), pitch: 14 }, calibration).level, null)
})
