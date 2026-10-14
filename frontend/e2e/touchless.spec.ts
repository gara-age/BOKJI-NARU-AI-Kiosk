import { chromium, expect, test } from '@playwright/test'

test('pinch has one click per open-to-closed gesture', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { PinchGate } = await import('/src/touchless/GestureDetector.ts')
    const gate = new PinchGate(0.32, 0.42)
    return [0.8, 0.3, 0.2, 0.4, 0.5, 0.5, 0.3, 0.2].map((ratio) => gate.update(ratio))
  })
  expect(result).toEqual([false, false, true, false, false, false, false, true])
})

test('a folded index finger cannot arm a pinch', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { indexExtended, pinchRatio, PinchGate } = await import('/src/touchless/GestureDetector.ts')
    const hand = (folded: boolean) => {
      const points = Array.from({ length: 21 }, () => ({ x: .5, y: .5 }))
      points[5] = { x: .4, y: .6 }
      points[17] = { x: .6, y: .6 }
      points[6] = { x: .43, y: .57 }
      points[8] = folded ? { x: .42, y: .62 } : { x: .5, y: .5 }
      points[4] = folded ? { x: .43, y: .61 } : { x: .51, y: .5 }
      return points
    }
    const gate = new PinchGate(.32, .42)
    const open = hand(false)
    open[4] = { x: .8, y: .5 }
    gate.update(pinchRatio(open, 640, 480), indexExtended(open, 640, 480))
    const fist = hand(true)
    const falseStarts = [0, 1, 2].map(() => gate.update(pinchRatio(fist, 640, 480), indexExtended(fist, 640, 480)))
    const pinch = hand(false)
    const realStarts = [0, 1].map(() => gate.update(pinchRatio(pinch, 640, 480), indexExtended(pinch, 640, 480)))
    return { fistExtended: indexExtended(fist, 640, 480), falseStarts, realStarts }
  })
  expect(result).toEqual({ fistExtended: false, falseStarts: [false, false, false], realStarts: [false, true] })
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
      landmarks[6] = { x: 0.43, y: 0.57 }
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
    controller.onHand(hand(0.51), 640, 480, 1620)
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

test('adaptive view falls back to MID when the camera is denied', async ({ page, context }) => {
  await context.clearPermissions()
  await page.goto('/')
  await expect(page.locator('.kiosk-home')).toHaveClass(/view-mid/)
  await expect(page.getByText('카메라를 사용할 수 없어 기본 화면을 표시합니다.')).toBeVisible()
  await page.getByRole('button', { name: /직접 입력하기/ }).click()
  await expect(page.getByPlaceholder('도움이 필요한 상황을 적어 주세요.')).toBeVisible()
})

test('debug overlay distinguishes detected and manually applied height', async ({ page, context }) => {
  await context.clearPermissions()
  await page.goto('/')
  await page.getByRole('button', { name: '카메라 디버그 보기' }).click()
  const panel = page.getByRole('region', { name: '시점 판정 디버그' })
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('자동 분류가 불가능합니다')
  await expect(page.getByTestId('vision-detected-level')).toHaveText('MID')
  await expect(page.getByTestId('vision-applied-level')).toHaveText('MID')
  await expect(panel).toContainText('카메라를 사용할 수 없습니다')
  await page.getByRole('button', { name: '음성 설정' }).click()
  await page.getByLabel('조작 버튼 높이').selectOption('HIGH')
  await page.getByRole('button', { name: '확인' }).click()
  await expect(page.getByTestId('vision-detected-level')).toHaveText('MID')
  await expect(page.getByTestId('vision-applied-level')).toHaveText('HIGH')
  await expect(panel).toContainText('수동 배치 사용 중')
  await panel.getByRole('button', { name: '카메라 디버그 닫기' }).click()
  await expect(panel).toHaveCount(0)
})

test('manual height override changes layout and AUTO restores it', async ({ page }) => {
  await page.goto('/')
  const mic = page.locator('.kiosk-mic-action')
  const baseline = (await mic.boundingBox())!.y
  await page.getByRole('button', { name: '음성 설정' }).click()
  await page.getByLabel('조작 버튼 높이').selectOption('LOW')
  await page.getByRole('button', { name: '확인' }).click()
  await expect(page.locator('.kiosk-home')).toHaveClass(/view-low/)
  expect((await mic.boundingBox())!.y).toBeGreaterThan(baseline)
  await page.getByRole('button', { name: '음성 설정' }).click()
  await page.getByLabel('조작 버튼 높이').selectOption('HIGH')
  await page.getByRole('button', { name: '확인' }).click()
  await expect(page.locator('.kiosk-home')).toHaveClass(/view-high/)
  expect((await mic.boundingBox())!.y).toBeLessThan(baseline)
  await page.getByRole('button', { name: '음성 설정' }).click()
  await page.getByLabel('조작 버튼 높이').selectOption('AUTO')
  await page.getByRole('button', { name: '확인' }).click()
  await expect(page.locator('.kiosk-home')).toHaveClass(/view-mid/)
})

test('eye height and head pose must agree before changing a borderline LOW layout', async ({ page }) => {
  test.setTimeout(30_000)
  await page.addInitScript(() => localStorage.setItem('bokjinaru-face-height-calibration-v1', JSON.stringify({ HIGH: .25, MID: .45, LOW: .65, pitch: { HIGH: 0, MID: 2, LOW: 18 } })))
  await page.route('**/src/vision/faceCamera.ts*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: `
      export async function startFaceCamera({ onFaces }) {
        let eyeY = .45;
        let pitch = 2;
        const conflict = () => { eyeY = .58; pitch = -10 };
        const low = () => { eyeY = .58; pitch = 14 };
        const midConflict = () => { eyeY = .45; pitch = 18 };
        const mid = () => { eyeY = .45; pitch = 2 };
        window.addEventListener('test-conflict', conflict);
        window.addEventListener('test-low', low);
        window.addEventListener('test-mid-conflict', midConflict);
        window.addEventListener('test-mid', mid);
        const timer = setInterval(() => onFaces([{ x: .5, y: eyeY + .05, width: .2, height: .25, eyeY, pitch, confidence: .95 }], performance.now()), 80);
        return () => { clearInterval(timer); for (const [name, listener] of [['test-conflict', conflict], ['test-low', low], ['test-mid-conflict', midConflict], ['test-mid', mid]]) window.removeEventListener(name, listener) };
      }
    ` })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '카메라 디버그 보기' }).click()
  await page.waitForTimeout(1400)
  await page.evaluate(() => window.dispatchEvent(new Event('test-conflict')))
  await expect(page.getByRole('region', { name: '시점 판정 디버그' })).toContainText('신호 불일치: 현재 배치 유지')
  await page.waitForTimeout(1000)
  await expect(page.locator('.kiosk-home')).toHaveClass(/view-mid/)
  await page.evaluate(() => window.dispatchEvent(new Event('test-low')))
  await expect(page.locator('.kiosk-home')).toHaveClass(/view-low/, { timeout: 3000 })
  await page.evaluate(() => window.dispatchEvent(new Event('test-mid-conflict')))
  await page.waitForTimeout(1000)
  await expect(page.locator('.kiosk-home')).toHaveClass(/view-low/)
  await page.evaluate(() => window.dispatchEvent(new Event('test-mid')))
  await expect(page.locator('.kiosk-home')).toHaveClass(/view-mid/, { timeout: 3000 })
})

test('handover waits for confirmation and resets only after the eight-second grace period', async ({ page }) => {
  test.setTimeout(35_000)
  await page.route('**/src/vision/faceCamera.ts*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: `
      export async function startFaceCamera({ onFaces }) {
        let x = .22;
        const moveA = () => { x = .22 };
        const moveB = () => { x = .8 };
        const moveC = () => { x = .5 };
        window.addEventListener('test-user-a', moveA);
        window.addEventListener('test-user-b', moveB);
        window.addEventListener('test-user-c', moveC);
        const timer = setInterval(() => onFaces([{ x, y: .45, width: .2, height: .25, eyeY: .4, confidence: .95 }], performance.now()), 80);
        return () => { clearInterval(timer); window.removeEventListener('test-user-a', moveA); window.removeEventListener('test-user-b', moveB); window.removeEventListener('test-user-c', moveC) };
      }
    ` })
  })
  await page.goto('/')
  await page.getByRole('button', { name: /직접 입력하기/ }).click()
  await page.getByPlaceholder('도움이 필요한 상황을 적어 주세요.').fill('진행 중인 상담')
  await page.waitForTimeout(550)
  await page.evaluate(() => window.dispatchEvent(new Event('test-user-b')))
  await expect(page.getByRole('alertdialog', { name: '새 사용자 확인' })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('test-user-a')))
  await expect(page.getByRole('alertdialog', { name: '새 사용자 확인' })).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new Event('test-user-b')))
  await expect(page.getByRole('alertdialog', { name: '새 사용자 확인' })).toBeVisible()
  await page.getByRole('button', { name: '계속 사용' }).click()
  await expect(page.getByPlaceholder('도움이 필요한 상황을 적어 주세요.')).toHaveValue('진행 중인 상담')
  await page.evaluate(() => window.dispatchEvent(new Event('test-user-c')))
  await expect(page.getByRole('alertdialog', { name: '새 사용자 확인' })).toBeVisible()
  await expect(page.getByPlaceholder('도움이 필요한 상황을 적어 주세요.')).toHaveCount(0, { timeout: 11_000 })
  await expect(page.getByRole('alertdialog', { name: '새 사용자 확인' })).toHaveCount(0)
})

test('camera calibration is available only after administrator login', async ({ page }) => {
  await page.route('**/src/vision/faceCamera.ts*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: `
      export async function startFaceCamera({ onFaces }) {
        let eyeY = .2;
        let pitch = 0;
        const mid = () => { eyeY = .45; pitch = 2 };
        const low = () => { eyeY = .7; pitch = 16 };
        window.addEventListener('test-mid', mid);
        window.addEventListener('test-low', low);
        const timer = setInterval(() => onFaces([{ x: .5, y: eyeY + .05, width: .2, height: .25, eyeY, pitch, confidence: .95 }], performance.now()), 80);
        return () => { clearInterval(timer); window.removeEventListener('test-mid', mid); window.removeEventListener('test-low', low) };
      }
    ` })
  })
  await page.route('**/api/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith('/login') ? { token: 'test-admin-token' }
      : path.endsWith('/overview') ? { total_sessions: 0, handoff_count: 0, approved_programs: 0, needs_review_programs: 0, summaries: [] }
        : path.endsWith('/programs') ? [] : { sido: null, sigungu: null }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.goto('/admin')
  await expect(page.getByText('이 기기의 시점 높이 보정')).toHaveCount(0)
  await page.getByLabel('비밀번호').fill('test-password')
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page.getByText('이 기기의 시점 높이 보정')).toBeVisible()
  await page.getByRole('button', { name: '카메라 보정 시작' }).click()
  await expect(page.getByText('얼굴 한 개가 보입니다.', { exact: false })).toBeVisible()
  await page.waitForTimeout(950)
  await page.getByRole('button', { name: /높은 시점 측정/ }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('test-mid')))
  await page.waitForTimeout(950)
  await page.getByRole('button', { name: /일반 시점 측정/ }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('test-low')))
  await page.waitForTimeout(950)
  await page.getByRole('button', { name: /낮은 시점 측정/ }).click()
  await page.getByRole('button', { name: '기준 저장' }).click()
  await expect(page.getByText('저장된 기준:', { exact: false })).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bokjinaru-face-height-calibration-v1') ?? 'null').pitch.LOW)).toBe(16)
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
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      Object.assign(window, { __cameraCalls: 0 })
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (constraints.video) (window as Window & { __cameraCalls: number }).__cameraCalls += 1
        return original(constraints)
      }
    })
    await page.goto('http://127.0.0.1:5173/')
    await expect(page.locator('.adaptive-vision-status')).toContainText('높이 보정이 없어 기본 화면(MID)을 표시합니다', { timeout: 45_000 })
    await page.getByRole('button', { name: '카메라 디버그 보기' }).click()
    const preview = page.getByLabel('실시간 카메라 미리보기')
    await expect(preview).toBeVisible()
    await expect.poll(() => preview.evaluate((video) => (video as HTMLVideoElement).videoWidth)).toBeGreaterThan(0)
    await page.getByRole('button', { name: '카메라 디버그 닫기' }).click()
    await page.getByRole('button', { name: '카메라 디버그 보기' }).click()
    await expect(page.getByLabel('실시간 카메라 미리보기')).toBeVisible()
    await page.getByRole('button', { name: '비접촉 손동작 사용하기' }).click()
    await expect(page.getByText('손을 찾고 있어요')).toBeVisible({ timeout: 45_000 })
    expect(await page.evaluate(() => (window as Window & { __cameraCalls: number }).__cameraCalls)).toBe(1)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: '비접촉 입력 끄기' }).click()
    await expect(page.getByText('손을 찾고 있어요')).toHaveCount(0)
    await page.route('**/api/admin/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      const data = path.endsWith('/login') ? { token: 'test-admin-token' }
        : path.endsWith('/overview') ? { total_sessions: 0, handoff_count: 0, approved_programs: 0, needs_review_programs: 0, summaries: [] }
          : path.endsWith('/programs') ? [] : { sido: null, sigungu: null }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    })
    await page.goto('http://127.0.0.1:5173/admin')
    await page.getByLabel('비밀번호').fill('test-password')
    await page.getByRole('button', { name: '로그인' }).click()
    await page.getByRole('button', { name: '카메라 보정 시작' }).click()
    const calibrationPreview = page.getByLabel('관리자 시점 보정 카메라')
    await expect(calibrationPreview).toBeVisible()
    await expect.poll(() => calibrationPreview.evaluate((video) => (video as HTMLVideoElement).videoWidth)).toBeGreaterThan(0)
    expect(await page.evaluate(() => (window as Window & { __cameraCalls: number }).__cameraCalls)).toBe(1)
    await page.getByRole('button', { name: '취소' }).click()
    await expect(calibrationPreview).toHaveCount(0)
  } finally {
    await browser.close()
  }
})
