const path = require('path')
const { sharedHelper } = require(path.join(process.env.AURORA_E2E_ROOT, 'helpers/paths'))
const { expect } = require('@playwright/test')
const { gotoLoggedIn, step } = sharedHelper('login')
const { getPrimaryCredentials } = sharedHelper('credentials')

/**
 * The user's own public PGP key stored in contacts on the server.
 *
 * Private keys live only in localStorage, so every test context starts without
 * one and the specs generate a fresh keypair. But the Generate dialog also
 * counts public keys from contacts: if a contact card with the user's own email
 * holds a PGP key, it reports "keys exist" and creates no private key. The specs
 * therefore clear that key before generating and again after the test.
 */

/**
 * Invoke an Aurora Web API method with the page's session, the way the desktop
 * client's Ajax does (same-origin `?/Api/`, session cookie, X-Client header).
 */
async function callApi(page, moduleName, methodName, parameters = {}) {
  return page.evaluate(
    async ({ moduleName, methodName, parameters }) => {
      const res = await fetch(location.origin + location.pathname + '?/Api/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Client': 'WebClient',
        },
        body: new URLSearchParams({
          Module: moduleName,
          Method: methodName,
          Parameters: JSON.stringify(parameters),
        }),
        credentials: 'include',
      })
      const text = await res.text()
      try {
        return JSON.parse(text)
      } catch {
        return { Result: false, ErrorMessage: `HTTP ${res.status}: not JSON` }
      }
    },
    { moduleName, methodName, parameters }
  )
}

/** Public keys in contacts that belong to the user's own email. */
async function ownKeysInContacts(page) {
  const email = getPrimaryCredentials().login.toLowerCase()
  const own = await callApi(page, 'OpenPgpWebclient', 'GetOwnContactPublicKey')
  const personal = await callApi(page, 'OpenPgpWebclient', 'GetPublicKeysFromContacts')
  const personalOwn = (Array.isArray(personal && personal.Result) ? personal.Result : []).filter(
    (item) => String(item.Email || '').toLowerCase() === email && item.PublicPgpKey
  )
  return { ownContact: !!(own && own.Result), personal: personalOwn.length }
}

/**
 * Remove the user's own public key from every contact card with the user's
 * email (UpdateOwnContactPublicKey with an empty key), then check nothing is left.
 */
async function removeOwnPublicKeyFromContacts(page) {
  await callApi(page, 'OpenPgpWebclient', 'UpdateOwnContactPublicKey', { PublicPgpKey: '' })
  const left = await ownKeysInContacts(page)
  expect(left, 'own public PGP key is still in contacts').toEqual({
    ownContact: false,
    personal: 0,
  })
}

/**
 * Before generating keys: clear the own public key from contacts and reload the
 * app, since the client reads contact keys once at startup.
 */
async function prepareOwnKeysForGenerate(page) {
  await step('Remove own public PGP key from contacts', async () => {
    const before = await ownKeysInContacts(page)
    if (!before.ownContact && before.personal === 0) {
      console.log('  → no own public key in contacts')
      return
    }
    await removeOwnPublicKeyFromContacts(page)
    console.log('  → removed own public key from contacts; reloading the app')
    await gotoLoggedIn(page)
  })
}

/**
 * After the test (also when it failed): remove own public keys the run may
 * have added to contacts and verify none remain.
 */
async function cleanupOwnKeysInContacts(page) {
  // The page may not be on the app yet if the test failed very early.
  if (!/^https?:/.test(page.url())) {
    await gotoLoggedIn(page)
  }
  await removeOwnPublicKeyFromContacts(page)
}

module.exports = {
  prepareOwnKeysForGenerate,
  cleanupOwnKeysInContacts,
}
