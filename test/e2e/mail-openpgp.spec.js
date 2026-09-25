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
const { clickReady, confirmOkIfVisible } = sharedHelper('ready')
const {
  openSettings,
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
const { prepareOwnKeysForGenerate, cleanupOwnKeysInContacts } = moduleHelper(
  'OpenPgpWebclient',
  'openpgp-contacts'
)

// Passphrase for the OpenPGP key the test generates; empty = a key without a passphrase.
// Private keys live only in localStorage, so every test context starts without one.
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

function discardChangesPopup(page) {
  return page.locator('.popup:visible').filter({
    hasText: /discard unsaved/i,
  })
}

async function dismissDiscardChanges(page) {
  const popup = discardChangesPopup(page)
  if (!(await popup.isVisible().catch(() => false))) {
    return false
  }
  // Cancel keeps the form so we can Save; Ok would drop Enable OpenPGP.
  await clickReady(
    popup.locator('.button').filter({ hasText: /cancel/i }).first()
  )
  await expect(popup).toBeHidden({ timeout: T(15000) })
  return true
}

function openPgpSaveButton(page) {
  // Prefer test-id; fallback is first settings Save in panel_center (not under h2).
  return page
    .getByTestId('settings-openpgp-save')
    .or(
      openPgpPanel(page)
        .locator('.buttons')
        .first()
        .locator('.button')
        .filter({ hasNotText: /saving|in progress/i })
        .first()
    )
    .first()
}

/**
 * Key rows in KeysFromThisDeviceView.
 * Remote stands may lack data-test-id on foreach items — fall back to list index
 * (0 = public, 1 = private; empty foreach still keeps the .items_list node).
 */
function openPgpKeyItems(page, kind /* 'public' | 'private' */) {
  const testId =
    kind === 'private'
      ? 'settings-openpgp-private-key'
      : 'settings-openpgp-public-key'
  const listIndex = kind === 'public' ? 0 : 1
  return page
    .getByTestId(testId)
    .or(
      openPgpPanel(page)
        .locator('.folders.items_list')
        .nth(listIndex)
        .locator('.item')
    )
}

async function saveOpenPgpSettings(page) {
  await dismissDiscardChanges(page)
  const save = openPgpSaveButton(page)
  await expect(save).toBeVisible({ timeout: T(15000) })
  await clickReady(save)
  await expect(save).toBeVisible({ timeout: T(60000) })
  // Fail here — not later inside sendCompose — if UpdateSettings errored.
  const settingsError = page.locator('.report_panel.error:not(.hide)').filter({
    hasText: /saving settings has failed/i,
  })
  await expect(settingsError).toBeHidden({ timeout: T(5000) })
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
  }
  // Persist even if already checked — KO may mark the form dirty on open.
  await saveOpenPgpSettings(page)
}

/**
 * Settings unsaved-changes guard blocks Mail routing — compose FAB stays hidden
 * on the settings screen while "Discard unsaved changes?" is open.
 */
async function leaveSettingsForMail(page) {
  await expect
    .poll(
      async () => {
        if (
          await page
            .getByTestId('mail-compose-fab')
            .isVisible()
            .catch(() => false)
        ) {
          return true
        }
        await dismissDiscardChanges(page)
        if (await openPgpSaveButton(page).isVisible().catch(() => false)) {
          await saveOpenPgpSettings(page)
        }
        await clickReady(page.getByTestId('nav-mail'))
        return page
          .getByTestId('mail-compose-fab')
          .isVisible()
          .catch(() => false)
      },
      { timeout: T(90000), intervals: [500, 1000, 2000] }
    )
    .toBe(true)
}

async function submitOpenPgpPassphraseIfAsked(page) {
  // Keep this non-blocking: a long waitFor here makes expect.poll miss short-lived UI errors.
  const passPopup = page.getByTestId('openpgp-key-password-popup')
  if (await passPopup.isVisible().catch(() => false)) {
    await page.getByTestId('openpgp-key-password-input').fill(openPgpPassword)
    await clickReady(page.getByTestId('openpgp-key-password-ok'))
    await expect(passPopup).toBeHidden({ timeout: T(60000) })
    return true
  }
  const legacy = page
    .locator('.popup:visible')
    .filter({ has: page.locator('input[type="password"]') })
    .first()
  if (!(await legacy.isVisible().catch(() => false))) {
    return false
  }
  await legacy.locator('input[type="password"]').first().fill(openPgpPassword)
  await clickReady(
    legacy.locator('.button').filter({ hasText: /^(ok|enter)$/i }).first()
  )
  await expect(legacy).toBeHidden({ timeout: T(60000) }).catch(() => undefined)
  return true
}

/**
 * mail-compose-encrypt is Mail auto-encrypt (recipient contact has a PGP key).
 * OpenPGP-in-Mail uses the Sign/Encrypt toolbar control instead.
 */
async function encryptComposeWithOpenPgp(page) {
  const signEncrypt = page.getByTestId('mail-compose-openpgp')
  await expect(signEncrypt).toBeVisible({ timeout: T(30000) })
  await clickReady(signEncrypt)
  // HTML compose asks to convert to plain before PGP.
  await confirmOkIfVisible(page, 5000)
  const popup = page.getByTestId('openpgp-encrypt-popup')
  await expect(popup).toBeVisible({ timeout: T(15000) })

  // Encrypt-only: Sign awaits a private-key passphrase popup asynchronously.
  const signBox = page.getByTestId('openpgp-encrypt-sign')
  if (await signBox.evaluate((el) => el.classList.contains('checked'))) {
    await clickReady(signBox)
  }
  await expect(signBox).not.toHaveClass(/checked/, { timeout: T(5000) })
  const encryptBox = page.getByTestId('openpgp-encrypt-encrypt')
  if (!(await encryptBox.evaluate((el) => el.classList.contains('checked')))) {
    await clickReady(encryptBox)
  }
  await expect(encryptBox).toHaveClass(/checked/, { timeout: T(5000) })

  const submit = page.getByTestId('openpgp-encrypt-submit')
  await expect(submit).toBeVisible({ timeout: T(10000) })
  // KO command: prefer a real click; jQuery trigger as fallback if still open.
  await submit.click()

  await expect
    .poll(
      async () => {
        await submitOpenPgpPassphraseIfAsked(page)
        if (!(await popup.isVisible().catch(() => false))) {
          return 'closed'
        }
        const err = page.locator('.report_panel.error:visible')
        if (await err.isVisible().catch(() => false)) {
          const text = (await err.innerText().catch(() => '')).trim()
          throw new Error(`OpenPGP encrypt failed with UI error: ${text}`)
        }
        return 'open'
      },
      { timeout: T(60000), intervals: [200, 400, 800] }
    )
    .toBe('closed')

  await expect(page.getByTestId('mail-compose-openpgp-undo')).toBeVisible({
    timeout: T(30000),
  })
}

test.describe('Desktop OpenPGP mail', () => {
  test.skip(!hasCredentials(), 'Set E2E_LOGIN_PRIMARY in .env.e2e')

  // Leave no own public key in contacts, whatever the test did or where it failed.
  test.afterEach(async ({ page }) => {
    await cleanupOwnKeysInContacts(page)
  })

  test('encrypts compose and decrypts message in Inbox', async ({ page }) => {
    test.setTimeout(T(360000))
    const subject = `E2E OpenPGP ${Date.now()}`
    const bodyText = `Encrypted body ${Date.now()}`

    await gotoLoggedIn(page)
    await prepareOwnKeysForGenerate(page)

    const opened = await openOpenPgpTab(page)
    test.skip(!opened, 'OpenPGP settings tab is not available on this stand')

    await step('Enable OpenPGP in mail', async () => {
      await expect(openPgpPanel(page)).toBeVisible({ timeout: T(30000) })
      await ensureOpenPgpMailEnabled(page)
      await attachScreenshot(page, 'openpgp-mail-01-settings')
    })

    const generate = page.getByTestId('settings-openpgp-generate')

    await step('Generate key when none exists', async () => {
      const privateKey = openPgpKeyItems(page, 'private').first()
      const publicKey = openPgpKeyItems(page, 'public').first()

      if (await privateKey.isVisible().catch(() => false)) {
        console.log('  → Private key already present, skip generate')
      } else {
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
        } else {
          const password = popup.locator('input[type="password"]')
          if (!(await password.isVisible().catch(() => false))) {
            // Keys already exist — close the info popup.
            await clickReady(
              popup
                .locator('.button')
                .filter({ hasText: /cancel|close/i })
                .first()
            ).catch(() => undefined)
          } else {
            await password.fill(openPgpPassword)
            await clickReady(
              popup.locator('.button').filter({ hasText: /generate/i }).first()
            )
            await expect(popup).toBeHidden({ timeout: T(120000) })
          }
        }
      }

      await expect(privateKey).toBeVisible({ timeout: T(30000) })
      await expect(publicKey).toBeVisible({ timeout: T(15000) })
    })

    await step('Compose encrypted message to self', async () => {
      await leaveSettingsForMail(page)
      await clickReady(page.getByTestId('mail-compose-fab'))
      await expect(page.getByTestId('mail-compose')).toBeVisible({
        timeout: T(30000),
      })
      await fillComposeRecipient(page, getComposeTo())
      await fieldControl(page, 'mail-compose-subject').fill(subject)
      await fillComposeBody(page, bodyText)
      await encryptComposeWithOpenPgp(page)
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
      await expect(decrypt).toBeVisible({ timeout: T(30000) })
      await clickReady(decrypt)
      await submitOpenPgpPassphraseIfAsked(page)
      await expect(page.locator('.message_panel, .panel.messages')).toContainText(
        bodyText,
        { timeout: T(60000) }
      )
      console.log('  → Message decrypted')
      await attachScreenshot(page, 'openpgp-mail-03-decrypted')
    })
  })
})
