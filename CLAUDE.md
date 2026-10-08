# CLAUDE.md

Gallery Protect: a single Cloudflare Worker (`src/index.js`, plain ES modules, no build step, no runtime deps) that password-protects per-event photo galleries stored in an R2 bucket. Only dev dependency is `wrangler`.

## Commands

- `npm run dev` — `wrangler dev` (needs `.dev.vars` copied from `.dev.vars.example`)
- `npm run deploy:dry-run` / `npm run deploy`
- `npm run types` — `wrangler types`
- `npm run tail` — live Worker logs
- `npm run configure` — interactive; generates the gitignored `wrangler.jsonc`

There are no tests or linter. Sanity check syntax with `node --check src/index.js`.

## Architecture

- `src/index.js` holds everything: routing, PBKDF2 hashing, HMAC session cookies, password page, R2 serving.
- Request flow: method must be GET/HEAD → host must be in `env.DOMAIN_NAMES` (comma-separated, `www.` stripped) → bucket is `env.GALLERY_BUCKET`.
- Paths: `/` serves `index.html`; root-level files (no `/`) are public; `/<event>/<file>` is protected (default file `gallery.html`). `.secrets` is always 404; `..` is rejected.
- Auth: event password lives in R2 object `<event>/.secrets`. Plaintext is auto-migrated to `PBKDF2$100000$<salt>$<hash>` on first successful login. `?key=` login sets an `eventAuth` cookie (signed with `AUTH_SECRET`, HttpOnly/Secure/SameSite=Lax, path-scoped to the event, 7 days) and 302s to the URL without `key`.
- PBKDF2 iterations are capped at 100000 (Workers runtime limit) — don't raise them.
- All responses are `no-store`; keep it that way for protected content.

## Configuration

- `wrangler.jsonc` is generated and gitignored; `wrangler.jsonc.example` is the template. Keep `configure.mjs`, `configure-ci.mjs` and the example in sync when changing bindings/vars.
- Bindings/vars: R2 `GALLERY_BUCKET`, var `DOMAIN_NAMES`, secret `AUTH_SECRET` (set via `npx wrangler secret put AUTH_SECRET`, never committed).
- CI (`.github/workflows/deploy.yml`) deploys on push to `main`, building `wrangler.jsonc` from repo variables `GALLERY_R2_BUCKET` and `GALLERY_DOMAIN_NAMES`, plus secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`.

## Cautions

- Never commit real passwords, `AUTH_SECRET`, `.dev.vars`, `.secrets` files or `wrangler.jsonc`.
- Don't point `npm run dev` at production photo buckets.
- Known gaps (documented in README): no rate limiting, no admin UI.
- Update README/DEPLOYMENT.md/CHANGELOG.md when behaviour or config changes.
