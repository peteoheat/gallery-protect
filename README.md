# Gallery Protect

A Cloudflare Worker that password-protects photo galleries stored in Cloudflare R2.

Gallery Protect is designed for event/photo galleries where the gallery itself is public infrastructure but the event content should only be available to people who know the event password.

> **GDPR note:** Password protection can be one technical measure supporting privacy, but it does not by itself make a gallery GDPR-compliant. You remain responsible for the lawful basis, notices, retention, access controls and other requirements applicable to your use of personal data.

## Features

- Cloudflare Workers + R2
- One or more event galleries in an R2 bucket
- Per-event passwords stored in each event's `.secrets` object
- Automatic migration from plaintext event passwords to PBKDF2-SHA-256 hashes
- 100,000 PBKDF2 iterations for compatibility with the Cloudflare Workers runtime
- Signed, HttpOnly, Secure, SameSite=Lax session cookies
- Password removed from the browser URL after successful `?key=` authentication
- Multiple domains served from one bucket via the `DOMAIN_NAMES` list
- Public root `index.html` and root-level assets
- Blocks direct access to `.secrets`
- Blocks path traversal
- No password or `AUTH_SECRET` stored in source control
- Wrangler-based local development and deployment
- Optional GitHub Actions deployment

## Architecture

```text
Visitor
   |
   v
Custom Domain
   |
   v
Cloudflare Worker (gallery-protect)
   |
   +--> public root files
   |
   +--> /event/.secrets --> password verification
   |
   +--> signed event session cookie
   |
   +--> /event/gallery.html
   |        |
   |        +--> images / CSS / JS
   |
   v
Cloudflare R2
```

## R2 layout

An event is a directory/prefix in the R2 bucket:

```text
testevent/
├── .secrets
├── gallery.html
├── image001.jpg
├── image002.jpg
└── ...
```

The Worker treats the first URL path component as the event name.

For example:

```text
https://gallery.example.com/testevent/
```

serves:

```text
testevent/gallery.html
```

## Creating an event

Create the event folder/prefix in R2 and upload the gallery files.

Create an object called:

```text
<event-name>/.secrets
```

For a new event, its initial contents can simply be the event password:

```text
MySecretPassword123
```

On the first successful password login, Gallery Protect replaces that plaintext value with a salted PBKDF2 hash such as:

```text
PBKDF2$100000$<salt>$<hash>
```

Do not expose or publish `.secrets`.

## Password links

Gallery Protect retains the convenient sharing form:

```text
https://gallery.example.com/testevent?key=MySecretPassword123
```

After successful authentication the Worker redirects to the clean event URL and establishes a signed session cookie. The password is therefore not retained in the final browser URL.

Treat password URLs as sensitive while they contain `key=` because URLs can be copied into browser history, logs or referrers before the redirect occurs. For higher privacy, share the gallery URL and password separately.

## Local installation

Requirements:

- Node.js 20 or later
- An existing Cloudflare account
- Cloudflare R2 buckets
- A domain managed by Cloudflare if using Custom Domains

Install dependencies:

```bash
npm install
```

Authenticate Wrangler:

```bash
npx wrangler login
```

Generate your local deployment configuration:

```bash
npm run configure
```

The command creates `wrangler.jsonc` containing your R2 bucket names and optional custom domains. That file is deliberately ignored by Git because it is deployment-specific.

Create the Worker secret:

```bash
npx wrangler secret put AUTH_SECRET
```

Use a long random value. Never put this value in `wrangler.jsonc`, source code, GitHub or the R2 bucket.

Check the deployment without publishing it:

```bash
npm run deploy:dry-run
```

Deploy:

```bash
npm run deploy
```

## Configuration

The repository contains:

```text
wrangler.jsonc.example
```

The actual:

```text
wrangler.jsonc
```

is generated locally and ignored by Git.

This separation keeps the open-source repository reusable while allowing each deployment to choose its own R2 buckets and domains.

## Required bindings

The Worker expects this R2 binding:

| Binding | Purpose |
|---|---|
| `GALLERY_BUCKET` | R2 bucket holding all event galleries |

and this variable:

| Variable | Purpose |
|---|---|
| `DOMAIN_NAMES` | Comma-separated list of hostnames the Worker serves (others get 400) |

The binding name is not necessarily the R2 bucket name. You can point it at any bucket when generating your deployment configuration.

The Worker also requires this secret:

| Secret | Purpose |
|---|---|
| `AUTH_SECRET` | Signs the authentication session cookies |

## GitHub Actions deployment

The repository includes:

```text
.github/workflows/deploy.yml
```

The workflow deploys automatically when changes are pushed to `main`, and can also be started manually.

### GitHub secrets

Add these repository secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

The API token should have the minimum permissions required to deploy the Worker and manage the resources used by the deployment.

### GitHub variables

Add these repository variables:

```text
GALLERY_R2_BUCKET
GALLERY_DOMAIN_NAMES
```

`GALLERY_DOMAIN_NAMES` is a comma-separated list, for example `myselfie.pictures,myparty.photos`.

Do not put `AUTH_SECRET` in repository variables. It remains a Cloudflare Worker secret.

The GitHub workflow generates the deployment-specific `wrangler.jsonc` during the CI run, deploys it, and leaves no deployment configuration committed to the repository.

## GitHub Actions and AUTH_SECRET

The `AUTH_SECRET` value is stored in Cloudflare rather than GitHub. This means a GitHub deployment does not need to know the secret value.

Before the first GitHub Actions deployment, configure the secret on the Worker with:

```bash
npx wrangler secret put AUTH_SECRET
```

The Wrangler configuration declares `AUTH_SECRET` as required, so deployment fails if the Worker does not have the required secret configured.

## Updating the Worker

Normal development cycle:

```bash
npm install
npm run types
npm run deploy:dry-run
npm run deploy
```

For production changes, commit the source changes to Git and allow GitHub Actions to deploy them, or deploy manually with Wrangler.

## Testing locally

Create a local secret file from the example:

```bash
copy .dev.vars.example .dev.vars
```

On macOS/Linux:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and set a development `AUTH_SECRET`.

Then run:

```bash
npm run dev
```

Local R2 development may require additional Wrangler R2 configuration or remote bindings depending on how you want to test your production buckets. Do not point a development instance at production photo data unless you deliberately intend to do so.

## Security considerations

### Event passwords

New event passwords are initially accepted in plaintext only so the Worker can migrate the existing `.secrets` format. After the first successful authentication the object is replaced with a PBKDF2 hash.

### Session cookie

The Worker does not store the event password in the authentication cookie. It creates a signed session containing the event name and an expiry time.

The cookie is:

- `HttpOnly`
- `Secure`
- `SameSite=Lax`
- scoped to the event path
- valid for seven days

### `AUTH_SECRET`

`AUTH_SECRET` is used to sign session cookies. Changing it invalidates existing sessions when the Worker is redeployed with the new secret.

### Password reset

To reset an event password, replace the event's `.secrets` object with the desired plaintext password. The next successful login will migrate it back to a PBKDF2 hash.

If an old session cookie remains valid, remove that event's cookie or wait for it to expire before testing the new password.

## Limitations

Gallery Protect is intentionally small and focused. It does not currently provide:

- a web-based event administration interface
- password rate limiting
- user accounts
- audit logging of individual gallery visitors
- per-user access permissions
- encrypted storage of images at the application layer

Cloudflare infrastructure, R2 permissions and appropriate operational controls should be configured separately.

## License

MIT. See `LICENSE`.
