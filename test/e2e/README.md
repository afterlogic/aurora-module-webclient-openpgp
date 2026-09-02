# Desktop E2E (Playwright)

OpenPGP mail encrypt/decrypt scenario.

```bash
npm run test:e2e-desktop -- --setup "OpenPgpWebclient Chrome"
```

Requires `E2E_OPENPGP_PASSWORD` in `.env.e2e` (passphrase for the test key).

Stand gates: OpenPGP settings tab missing, encrypt checkbox absent, no private key on account.
