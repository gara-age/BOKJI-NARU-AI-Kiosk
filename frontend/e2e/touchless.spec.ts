import { chromium, expect, test } from '@playwright/test'

test('pinch has one click per open-to-closed gesture', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { PinchGate } = await import('/src/touchless/GestureDetector.ts')
    const gate = new PinchGate(0.35, 0.55)
    return [0.8, 0.3, 0.2, 0.4, 0.7, 0.3, 0.2].map((ratio) => gate.update(ratio))
  })
  expect(result).toEqual([false, true, false, false, false, true, false])
})

test('cursor rejects a one-frame jump but follows a confirmed move', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { CursorFilter } = await import('/src/touchless/CursorFilter.ts')
    const filter = new CursorFilter()
    const first = filter.update({ x: 500, y: 500 }, 800, 600)
    const acquired = filter.update({ x: 502, y: 500 }, 800, 600)
    const spike = filter.update({ x: 900, y: 500 }, 800, 600)
    const recovered = filter.update({ x: 503, y: 500 }, 800, 600)
    filter.update({ x: 900, y: 500 }, 800, 600)
    const moved = filter.update({ x: 905, y: 500 }, 800, 600)
    return { first, acquired, spike, recovered, moved }
  })
  expect(result.first.point).toBeNull()
  expect(result.acquired.accepted).toBe(true)
  expect(result.spike.accepted).toBe(false)
  expect(result.spike.point?.x).toBe(result.acquired.point?.x)
  expect(result.recovered.point?.x).toBeLessThan(510)
  expect(result.moved.accepted).toBe(true)
  expect(result.moved.point?.x).toBeGreaterThan(550)
  expect(result.moved.point?.x).toBeLessThan(580)
})

test('controller dispatches one existing DOM click per pinch', async ({ page }) => {
  await page.goto('/')
  const clicks = await page.evaluate(async () => {
    const { TouchlessController } = await import('/src/touchless/TouchlessController.ts')
    const target = document.createElement('button')
    target.dataset.touchless = 'true'
    target.style.cssText = 'position:fixed;left:40vw;top:40vh;width:20vw;height:20vh;z-index:9999'
    document.body.append(target)
    const cursor = document.createElement('div')
    cursor.style.pointerEvents = 'none'
    document.body.append(cursor)
    let count = 0
    target.addEventListener('click', () => count++)
    const controller = new TouchlessController(cursor, () => {})
    const hand = (thumbX: number) => {
      const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }))
      landmarks[4] = { x: thumbX, y: 0.5 }
      landmarks[5] = { x: 0.4, y: 0.6 }
      landmarks[17] = { x: 0.6, y: 0.6 }
      return landmarks
    }
    controller.onHand(hand(0.8), 640, 480, 1000)
    controller.onHand(hand(0.8), 640, 480, 1140)
    controller.onHand(hand(0.8), 640, 480, 1280)
    controller.onHand(hand(0.51), 640, 480, 1320)
    controller.onHand(hand(0.51), 640, 480, 1360)
    const first = count
    controller.onHand(hand(0.8), 640, 480, 1400)
    controller.onHand(hand(0.8), 640, 480, 1540)
    controller.onHand(hand(0.51), 640, 480, 1580)
    const second = count
    controller.dispose()
    target.remove()
    cursor.remove()
    return [first, second]
  })
  expect(clicks).toEqual([1, 2])
})

test('touch input remains available without camera permission', async ({ page, context }) => {
  await context.clearPermissions()
  await page.goto('/')
  await page.getByRole('button', { name: '비접촉 손동작 사용하기' }).click()
  await expect(page.getByRole('alert')).toContainText('카메라를 열 수 없어요')
  await page.getByRole('button', { name: /직접 입력하기/ }).click()
  await expect(page.getByPlaceholder('도움이 필요한 상황을 적어 주세요.')).toBeVisible()
})

test('allowed targets are hit-tested without intercepting touch', async ({ page }) => {
  await page.goto('/')
  await page.locator('.kiosk-text-action').scrollIntoViewIfNeeded()
  const result = await page.evaluate(async () => {
    const { findTouchlessTarget } = await import('/src/touchless/TargetDetector.ts')
    const button = document.querySelector<HTMLButtonElement>('.kiosk-text-action')!
    const rect = button.getBoundingClientRect()
    const hit = findTouchlessTarget({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    return { matches: hit === button, pointerEvents: getComputedStyle(document.querySelector('.touchless-cursor')!).pointerEvents }
  })
  expect(result).toEqual({ matches: true, pointerEvents: 'none' })
})

test('visual cursor stays on the highlighted button when kiosk is transformed', async ({ page }) => {
  await page.goto('/')
  await page.locator('.kiosk-examples button').first().scrollIntoViewIfNeeded()
  const result = await page.evaluate(async () => {
    const { TouchlessController } = await import('/src/touchless/TouchlessController.ts')
    const kiosk = document.querySelector<HTMLElement>('.kiosk-shell')!
    kiosk.style.transform = 'translate3d(60px, 30px, 0) scale(.85)'
    const button = document.querySelector<HTMLButtonElement>('.kiosk-examples button')!
    const rect = button.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const cursor = document.querySelector<HTMLElement>('.touchless-cursor')!
    const controller = new TouchlessController(cursor, () => {})
    const hand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }))
    hand[8] = { x: 1 - x / innerWidth, y: y / innerHeight }
    hand[4] = { x: 0.8, y: 0.5 }
    hand[5] = { x: 0.4, y: 0.6 }
    hand[17] = { x: 0.6, y: 0.6 }
    controller.onHand(hand, 640, 480, 1000)
    controller.onHand(hand, 640, 480, 1040)
    controller.onHand(hand, 640, 480, 1180)
    const cursorRect = cursor.getBoundingClientRect()
    const offset = Math.hypot(cursorRect.left + cursorRect.width / 2 - x, cursorRect.top + cursorRect.height / 2 - y)
    const result = { offset, hover: button.classList.contains('touchless-hover'), portal: cursor.parentElement === document.body }
    controller.dispose()
    return result
  })
  expect(result.portal).toBe(true)
  expect(result.hover).toBe(true)
  expect(result.offset).toBeLessThan(1)
})

test('local hand model initializes with a camera stream', async ({ browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || testInfo.project.name !== 'desktop', 'Fake camera startup is checked once.')
  test.setTimeout(60_000)
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
  try {
    const context = await browser.newContext({ permissions: ['camera'] })
    const page = await context.newPage()
    await page.goto('http://127.0.0.1:5173/')
    await page.getByRole('button', { name: '비접촉 손동작 사용하기' }).click()
    await expect(page.getByText('손을 찾고 있어요')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: '비접촉 입력 끄기' }).click()
    await expect(page.getByText('손을 찾고 있어요')).toHaveCount(0)
  } finally {
    await browser.close()
  }
})
