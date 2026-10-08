import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/speech', async (route) => {
    await route.fulfill({ json: { provider: 'browser', browser_fallback: true } })
  })
})

test('mobile view keeps all primary controls within the screen', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: /안녕하세요/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '직접 입력하기' })).toBeVisible()
  await expect(page.getByRole('button', { name: /마이크를 눌러/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})


test('microphone permission failure switches to direct input', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /마이크를 눌러/ }).click()

  await expect(page.getByPlaceholder('도움이 필요한 상황을 적어 주세요.')).toBeVisible()
  await expect(page.getByText('마이크 권한이 필요합니다.')).toBeVisible()
})

test('typed consultation completes clarification and creates a QR summary', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '직접 입력하기' }).click()
  await page.getByPlaceholder('도움이 필요한 상황을 적어 주세요.').fill('기초생활수급 신청하려고 왔어요')
  await page.locator('form').getByRole('button', { name: '이 내용으로 확인' }).click()

  await expect(page.getByRole('heading', { level: 3, name: /연령대를 골라 주세요/ })).toBeVisible()
  await page.getByRole('button', { name: '20~34세' }).click()

  await expect(page.getByRole('heading', { name: '상담 준비 결과' })).toBeVisible()
  await page.getByRole('button', { name: 'QR로 상담 요약 받기' }).click()
  await expect(page.getByText('이 QR을 담당자에게 보여 주세요.')).toBeVisible()
})
