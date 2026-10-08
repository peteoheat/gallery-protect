# Deployment checklist

## First deployment

1. Clone the repository.
2. Install Node.js 20+.
3. Run `npm install`.
4. Run `npm run configure`.
5. Confirm the generated `wrangler.jsonc` contains the correct R2 bucket names and custom domains.
6. Run `npx wrangler login`.
7. Run `npx wrangler secret put AUTH_SECRET`.
8. Run `npm run deploy:dry-run`.
9. Run `npm run deploy`.
10. Create/upload each event's `<event>/.secrets` object.
11. Test the event URL and password.

## Existing installation migration

If migrating an existing Gallery Protect Worker:

- Keep the existing R2 buckets and event files unchanged.
- Keep the existing event passwords in `.secrets` until the new Worker has successfully migrated them.
- Configure the same custom domains.
- Use the same `AUTH_SECRET` if you want existing session cookies to remain valid. If you create a new `AUTH_SECRET`, existing sessions will no longer validate.

## Production GitHub Actions

Create these GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Create these repository variables:

- `GALLERY_R2_BUCKET`
- `GALLERY_DOMAIN_NAMES` (comma-separated list of domains)

The Worker secret `AUTH_SECRET` must already exist on the Cloudflare Worker.

## Important

Never commit:

- `.dev.vars`
- `.env`
- `AUTH_SECRET`
- a production Wrangler config containing credentials or other secrets
- event `.secrets` objects
