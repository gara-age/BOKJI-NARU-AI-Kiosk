import { expect, test } from '@playwright/test'

test('pinch on empty space scrolls the panel without clicking a button', async ({ page }) => {
  await page.goto('/ui-preview')
  const result = await page.evaluate(async () => {
    const { TouchlessController } = await import('/src/touchless/TouchlessController.ts')
    const panel = document.createElement('div')
    panel.style.cssText = 'position:fixed;left:25vw;top:15vh;width:50vw;height:65vh;overflow-y:auto;background:white;z-index:9999'
    const button = document.createElement('button')
    button.dataset.touchless = 'true'
    button.textContent = '선택'
    button.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:48px'
    const content = document.createElement('div')
    content.style.height = '1500px'
    panel.append(button, content)
    document.body.append(panel)
    const cursor = document.createElement('div')
    cursor.style.pointerEvents = 'none'
    document.body.append(cursor)
    let clicks = 0
    button.onclick = () => { clicks += 1 }
    const controller = new TouchlessController(cursor, () => {})
    controller.setMirrorX(false)
    const hand = (y: number, closed: boolean) => {
      const landmarks = Array.from({ length: 21 }, () => ({ x: .5, y }))
      landmarks[4] = { x: closed ? .51 : .7, y }
      landmarks[5] = { x: .4, y: y + .1 }
      landmarks[6] = { x: .43, y: y + .07 }
      landmarks[17] = { x: .6, y: y + .1 }
      return landmarks
    }
    controller.onHand(hand(.65, false), 640, 480, 1000)
    controller.onHand(hand(.65, false), 640, 480, 1040)
    controller.onHand(hand(.65, true), 640, 480, 1080)
    controller.onHand(hand(.65, true), 640, 480, 1120)
    const scrollGesture = cursor.dataset.gesture
    for (let i = 0; i < 18; i += 1) controller.onHand(hand(.65 - i * .014, true), 640, 480, 1160 + i * 40)
    const scrolled = panel.scrollTop
    controller.onHand(hand(.4, false), 640, 480, 1900)
    controller.onHand(hand(.4, false), 640, 480, 1940)
    const released = cursor.dataset.phase
    controller.dispose()
    panel.remove()
    cursor.remove()
    return { scrollGesture, scrolled, clicks, released }
  })
  expect(result.scrollGesture).toBe('scroll')
  expect(result.scrolled).toBeGreaterThan(30)
  expect(result.clicks).toBe(0)
  expect(result.released).not.toBe('pinch')
})

test('preview uses the kiosk conversation flow and manual height layout', async ({ page, context }) => {
  await context.clearPermissions()
  await page.route('**/api/wake-word/status', (route) => route.fulfill({ json: { ready: false } }))
  await page.route('**/api/conversations', (route) => route.fulfill({ json: {
    session_id: 'preview-test', masked_text: '기초생활수급', assistant_text: '안내를 준비했어요.',
    clarification_options: [], staff_handoff: false,
    recommendations: [{
      program_id: 'test-1', name: '기초생활보장', plain_name: '기초생활보장', status: '확인됨',
      guidance: '담당자와 신청 자격을 확인하세요.', preparation_items: ['신분증'], needs_confirmation: [],
      office_hint: '주민센터', source: { name: 'test', url: '', checked_at: '2026-10-12' },
    }],
  } }))
  await page.route('**/api/speech', (route) => route.fulfill({ json: {} }))
  await page.route('**/api/summaries', (route) => route.fulfill({ json: { public_url: '/summary/preview-test' } }))

  await page.goto('/ui-preview')
  const preview = page.getByTestId('functional-ui-preview')
  await expect(preview).toHaveAttribute('data-view-level', 'mid')
  await expect(page.locator('#preview-title')).toContainText('안녕하세요,')
  await expect(page.getByText('마이크를 눌러 말씀해 주세요', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('마이크 버튼을 누르기 전에는 음성을 녹음하지 않습니다.')).toHaveCount(0)
  await expect(page.getByText(/나루야 자동 감지를 시작하려면 마이크 권한을 허용해 주세요/)).toHaveCount(0)
  await page.getByRole('button', { name: '도움말' }).click()
  await expect(page.locator('.preview-notice')).toContainText('마이크를 누르고 필요한 도움을 말씀해 주세요')
  await page.getByRole('button', { name: '환경설정' }).click()
  await page.getByLabel('조작 버튼 높이').selectOption('LOW')
  await page.getByRole('button', { name: '확인', exact: true }).click()
  await expect(preview).toHaveAttribute('data-view-level', 'low')
  await expect(page.getByRole('button', { name: '카메라 디버그 보기' })).toHaveCount(0)
  await page.getByRole('button', { name: '환경설정' }).click()
  await page.getByRole('button', { name: '카메라 디버그 보기' }).click()
  await expect(page.getByTestId('vision-applied-level')).toHaveText('LOW')
  await page.getByRole('button', { name: '카메라 디버그 닫기' }).click()

  await page.getByRole('button', { name: '직접 입력하기' }).click()
  await expect(page.locator('#preview-title')).toHaveText('궁금한 점을 적어 주세요')
  await page.getByLabel('궁금한 점을 입력해 보세요').fill('기초생활수급을 신청하고 싶어요')
  await page.getByRole('button', { name: '이 내용으로 확인' }).click()
  await expect(page.locator('#preview-title')).toHaveText('안내를 준비했어요')
  await expect(page.getByRole('heading', { name: '기초생활보장' })).toBeVisible()
  const resultOverflow = await page.locator('.reference-results-scroll').evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    maxHeight: getComputedStyle(element).maxHeight,
  }))
  expect(resultOverflow).toEqual({ overflowY: 'visible', maxHeight: 'none' })
  await expect(page.getByRole('button', { name: '수정하기' })).toBeVisible()
  await expect(page.getByRole('button', { name: '신청 방법·장소' })).toBeVisible()
  await page.getByRole('button', { name: 'QR로 상담 요약 받기' }).click()
  await expect(page.locator('.reference-qr svg')).toBeVisible()
  await page.getByRole('button', { name: '처음으로' }).click()
  await expect(page.locator('#preview-title')).toContainText('안녕하세요,')
  await expect(page.getByRole('heading', { name: '기초생활보장' })).toHaveCount(0)
})

test('touchless cursor waits for one stable hand and follows the active face', async ({ page }) => {
  await page.goto('/ui-preview')
  const result = await page.evaluate(async () => {
    const { TouchlessController } = await import('/src/touchless/TouchlessController.ts')
    const { updateInteractionOwner, clearInteractionOwner, selectActiveHand } = await import('/src/vision/interactionOwner.ts')
    const face = (x: number) => ({ x, y: 0.3, width: 0.16, height: 0.2, eyeY: 0.26, confidence: 1 })
    const user = face(0.3)
    const bystander = face(0.75)
    const hand = (x: number) => {
      const points = Array.from({ length: 21 }, () => ({ x, y: 0.66 }))
      points[0] = { x, y: 0.66 }
      points[9] = { x, y: 0.62 }
      points[8] = { x: 0.5, y: 0.45 }
      points[4] = { x: 0.8, y: 0.45 }
      points[5] = { x: x - 0.07, y: 0.7 }
      points[17] = { x: x + 0.07, y: 0.7 }
      return points
    }
    const cursor = document.createElement('div')
    cursor.hidden = true
    document.body.append(cursor)
    const controller = new TouchlessController(cursor, () => {})
    updateInteractionOwner([user, bystander], user, 1000, true)
    const pickedUser = selectActiveHand([hand(0.74), hand(0.29)], 1000) === null ? false : selectActiveHand([hand(0.74), hand(0.29)], 1000)?.[0].x === 0.29
    controller.onHands([hand(0.74)], 640, 480, 1000)
    controller.onHands([hand(0.74)], 640, 480, 1400)
    const bystanderHidden = cursor.hidden
    updateInteractionOwner([user, bystander], user, 1450)
    controller.onHands([hand(0.74), hand(0.29)], 640, 480, 1450)
    updateInteractionOwner([user, bystander], user, 1800)
    controller.onHands([hand(0.74), hand(0.29)], 640, 480, 1800)
    updateInteractionOwner([user, bystander], user, 1850)
    controller.onHands([hand(0.74), hand(0.29)], 640, 480, 1850)
    const userVisible = !cursor.hidden
    updateInteractionOwner([user, bystander], bystander, 1900, true)
    controller.onHands([hand(0.74), hand(0.29)], 640, 480, 1900)
    const changedHidden = cursor.hidden
    controller.dispose()
    clearInteractionOwner()
    cursor.remove()
    return { pickedUser, bystanderHidden, userVisible, changedHidden }
  })
  expect(result).toEqual({ pickedUser: true, bystanderHidden: true, userVisible: true, changedHidden: true })
})

test('preview keeps touch and text available when the camera is denied', async ({ page, context }) => {
  await context.clearPermissions()
  await page.goto('/ui-preview')
  await expect(page.locator('.adaptive-vision-status')).toContainText('카메라를 사용할 수 없어 기본 화면을 표시합니다')
  await expect(page.getByRole('alert')).toContainText('카메라를 열 수 없어요')
  await expect(page.getByRole('button', { name: '비접촉 손동작 사용하기' })).toHaveCount(0)
  await page.getByRole('button', { name: '환경설정' }).click()
  const touchless = page.getByRole('switch', { name: '비접촉 손동작' })
  await expect(touchless).toHaveAttribute('aria-checked', 'true')
  await touchless.click()
  await expect(touchless).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: '확인', exact: true }).click()
  await page.getByRole('button', { name: '직접 입력하기' }).click()
  await expect(page.getByLabel('궁금한 점을 입력해 보세요')).toBeVisible()
})

test('consultation region is sent only for the current consultation', async ({ page, context }) => {
  await context.clearPermissions()
  await page.route('**/api/wake-word/status', (route) => route.fulfill({ json: { ready: false } }))
  const requests: { region_sido: string | null; region_sigungu: string | null }[] = []
  await page.route('**/api/conversations', (route) => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ json: { session_id: 'region-test', masked_text: '복지 지원', assistant_text: '연령대를 확인해 주세요.', clarification_options: [], recommendations: [], staff_handoff: false } })
  })
  await page.route('**/api/speech', (route) => route.fulfill({ json: {} }))
  await page.goto('/ui-preview')
  await page.getByRole('button', { name: '환경설정' }).click()
  await page.getByLabel('시·도').selectOption('인천광역시')
  await page.getByLabel('시·군·구').fill('부평구')
  await page.getByRole('button', { name: '확인', exact: true }).click()
  await page.getByRole('button', { name: '기초생활수급 신청' }).click()
  await expect.poll(() => requests.length).toBe(1)
  expect(requests[0]).toMatchObject({ region_sido: '인천광역시', region_sigungu: '부평구' })
  await page.getByRole('button', { name: '새 상담 시작' }).click()
  await page.getByRole('button', { name: '환경설정' }).click()
  await expect(page.getByLabel('시·도')).toHaveValue('')
})

test('iPad portrait home keeps the main choices in one viewport', async ({ page, context }) => {
  await page.setViewportSize({ width: 820, height: 900 })
  await context.clearPermissions()
  await page.goto('/ui-preview')
  await expect(page.locator('.preview-shortcuts button')).toHaveCount(4)
  const layout = await page.evaluate(() => ({
    footerBottom: document.querySelector('.preview-footer')!.getBoundingClientRect().bottom,
    viewportHeight: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    micHeight: document.querySelector('.preview-mic')!.getBoundingClientRect().height,
    textHeight: document.querySelector('.preview-text-toggle')!.getBoundingClientRect().height,
  }))
  expect(layout.footerBottom).toBeLessThanOrEqual(layout.viewportHeight)
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.micHeight).toBeGreaterThanOrEqual(48)
  expect(layout.textHeight).toBeGreaterThanOrEqual(48)
})
