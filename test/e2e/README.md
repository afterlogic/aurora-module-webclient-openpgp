# Desktop E2E (Playwright)

OpenPGP mail encrypt/decrypt scenario.

Run from the install root with the interactive launcher (`npm run test:e2e:tui`, pick this module), or directly:

```bash
cd modules/CoreWebclient
npm run test:e2e -- --setup "OpenPgpWebclient Chrome"
```

The test generates an OpenPGP keypair for the PRIMARY user in the browser. Private keys are kept only in localStorage and every test starts in a fresh browser context, so a new key is made on each run. Optional `E2E_OPENPGP_PASSWORD` in `.env.e2e` is its passphrase; leave it empty for a key without a passphrase.

The generate dialog also counts public keys from contacts on the server, so the test first removes the user's own public key from contacts (`UpdateOwnContactPublicKey` with an empty key) and reloads the app; after the test it removes own public keys from contacts again and checks that none are left.

Stand gates: OpenPGP settings tab missing, encrypt checkbox absent, no private key on account.

Setup of the desktop suite: [CoreWebclient/test/e2e/README.md](../../../CoreWebclient/test/e2e/README.md).
