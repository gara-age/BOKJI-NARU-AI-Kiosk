import assert from 'node:assert/strict'
import test from 'node:test'
import { ActiveUserTracker } from '../src/vision/activeUser.ts'

const face = (x = .5, y = .45, width = .2, height = .25) => ({ x, y, width, height, eyeY: y - .05, confidence: .95 })
const acquire = (tracker, person = face()) => {
  tracker.update([person], 0)
  assert.equal(tracker.update([person], 450).event?.type, 'acquired')
}

test('a missing frame or posture change does not replace the active user', () => {
  const tracker = new ActiveUserTracker()
  acquire(tracker)
  assert.equal(tracker.update([], 500).event, null)
  assert.equal(tracker.update([face(.52, .56, .23, .28)], 600).event, null)
  assert.equal(tracker.update([face(.54, .58, .24, .29)], 1000).event, null)
})

test('a stable replacement is confirmed only after 400ms', () => {
  const tracker = new ActiveUserTracker()
  acquire(tracker, face(.25))
  tracker.update([], 500)
  assert.equal(tracker.update([face(.75)], 600).event, null)
  assert.equal(tracker.update([face(.75)], 900).event, null)
  assert.equal(tracker.update([face(.75)], 1000).event?.type, 'changed')
})

test('a helper appearing off center cannot take over', () => {
  const tracker = new ActiveUserTracker()
  acquire(tracker)
  for (const time of [550, 950, 1400, 1900]) {
    assert.equal(tracker.update([face(.5), face(.84, .45, .16, .2)], time).event, null)
  }
})

test('a dominant face can take over while the old face remains', () => {
  const tracker = new ActiveUserTracker()
  acquire(tracker, face(.3, .45, .17, .2))
  const next = face(.55, .45, .38, .43)
  assert.equal(tracker.update([next, face(.3, .45, .17, .2)], 600).event, null)
  assert.equal(tracker.update([next, face(.3, .45, .17, .2)], 1400).event?.type, 'changed')
  assert.equal(tracker.update([next, face(.3, .45, .17, .2)], 1500).event, null)
})

test('the previous active face can return after a true handover', () => {
  const tracker = new ActiveUserTracker()
  acquire(tracker, face(.25))
  tracker.update([face(.75)], 600)
  tracker.update([face(.75)], 1000)
  assert.equal(tracker.update([face(.75), face(.25)], 1100).event, null)
  assert.equal(tracker.update([face(.75), face(.25)], 1500).event?.type, 'returned')
})
