const path = require('path')
const { sharedHelper, moduleHelper } = require(path.join(
  process.env.AURORA_E2E_ROOT,
  'helpers/paths'
))
const { test, expect } = require('@playwright/test')
const { T } = sharedHelper('timeouts')
const {
  gotoLoggedIn,
  step,
  attachScreenshot,
  hasCredentials,
  getComposeTo,
  fieldControl,
} = sharedHelper('login')
const { clickReady } = sharedHelper('ready')
const {
  openSettings,
  openSettingsTab,
  openPgpPanel,
  openPgpEnableMailControl,
} = moduleHelper('SettingsWebclient', 'settings')
const {
  fillComposeRecipient,
  fillComposeBody,
  sendCompose,
  waitForMessageInFolder,
  clickMessageListItem,
  waitForOpenedMessageView,
  FOLDER_TYPES,
} = moduleHelper('MailWebclient', 'mail')

const openPgpPassword = process.env.E2E_OPENPGP_PASSWORD || ''

async function openOpenPgpTab(page) {
  await openSettings(page)
  const tab = page
    .getByTestId('settings-tab')
    .filter({ hasText: /openpgp|open.?pgp|pgp/i })
  if ((await tab.count()) === 0) {
    return false
  }
  await clickReady(tab.first())
  return true
}

async function ensureOpenPgpMailEnabled(page) {
  const enable = openPgpEnableMailControl(page)
  await expect(enable).toBeVisible({ timeout: T(15000) })
  const checked = await enable.evaluate(
    (el) =>
      el.classList.contains('checked') ||
      (el.matches('input') && el.checked) ||
      !!el.querySelector('input:checked')
  )
  if (!checked) {
    await clickReady(enable)
    await clickReady(page.locator('[data-test-id="settings-openpgp"] .button').first())
  }
}

test.describe('Desktop OpenPGP mail', () => {
  test.skip(!hasCredentials(), 'Set E2E_LOGIN_PRIMARY in .env.e2e')

  test('encrypts compose and decrypts message in Inbox', async ({ page }) => {
    test.setTimeout(T(360000))
    const subject = `E2E OpenPGP ${Date.now()}`
    const bodyText = `Encrypted body ${Date.now()}`

    await gotoLoggedIn(page)

    const opened = await openOpenPgpTab(page)
    test.skip(!opened, 'OpenPGP settings tab is not available on this stand')

    await step('Enable OpenPGP in mail', async () => {
      await expect(openPgpPanel(page)).toBeVisible({ timeout: T(30000) })
      await ensureOpenPgpMailEnabled(page)
      await attachScreenshot(page, 'openpgp-mail-01-settings')
    })

    const generate = page.getByTestId('settings-openpgp-generate')
    test.skip(
      !openPgpPassword,
      'Set E2E_OPENPGP_PASSWORD to run encrypt/decrypt (private key + passphrase required)'
    )

    await step('Generate key when none exists', async () => {
      await clickReady(generate)
      const popup = page.locator('.popup:visible').filter({
        hasText: /generate|key/i,
      })
      const visible = await popup
        .waitFor({ state: 'visible', timeout: T(10000) })
        .then(() => true)
        .catch(() => false)
      if (!visible) {
        console.log('  → Key generation popup skipped (keys may already exist)')
        return
      }
      await popup.locator('input[type="password"]').fill(openPgpPassword)
      await clickReady(
        popup.locator('.button').filter({ hasText: /generate/i }).first()
      )
      await expect(popup).toBeHidden({ timeout: T(120000) })
    })

    await step('Compose encrypted message to self', async () => {
      await clickReady(page.getByTestId('nav-mail'))
      await clickReady(page.getByTestId('mail-compose-fab'))
      await expect(page.getByTestId('mail-compose')).toBeVisible({
        timeout: T(30000),
      })
      await fillComposeRecipient(page, getComposeTo())
      await fieldControl(page, 'mail-compose-subject').fill(subject)
      const encrypt = page.getByTestId('mail-compose-encrypt')
      test.skip(
        !(await encrypt.isVisible().catch(() => false)),
        'Encrypt checkbox not available (OpenPGP compose plugin off)'
      )
      if (!(await encrypt.evaluate((el) => el.classList.contains('checked')))) {
        await clickReady(encrypt)
      }
      await fillComposeBody(page, bodyText)
      await sendCompose(page)
      console.log(`  → Sent encrypted: ${subject}`)
      await attachScreenshot(page, 'openpgp-mail-02-sent')
    })

    await step('Decrypt in Inbox', async () => {
      const item = await waitForMessageInFolder(
        page,
        FOLDER_TYPES.INBOX,
        subject,
        { timeout: 180000 }
      )
      await clickMessageListItem(page, item)
      await waitForOpenedMessageView(page)
      const decrypt = page.getByTestId('mail-openpgp-decrypt')
      test.skip(
        !(await decrypt.isVisible().catch(() => false)),
        'Encrypted message controls missing (no matching private key on stand)'
      )
      await clickReady(decrypt)
      const passPopup = page.locator('.popup:visible input[type="password"]').first()
      if (await passPopup.isVisible().catch(() => false)) {
        await passPopup.fill(openPgpPassword)
        await clickReady(
          page.locator('.popup:visible .button').filter({ hasText: /ok|enter/i }).first()
        )
      }
      await expect(page.locator('.message_panel, .panel.messages')).toContainText(
        bodyText,
        { timeout: T(60000) }
      )
      console.log('  → Message decrypted')
      await attachScreenshot(page, 'openpgp-mail-03-decrypted')
    })
  })
})
