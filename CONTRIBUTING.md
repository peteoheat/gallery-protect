# Contributing

1. Fork the repository.
2. Create a feature branch.
3. Make the smallest practical change.
4. Run `npm install`.
5. Run `npm run types`.
6. Run `npm run deploy:dry-run` where you have an appropriate Cloudflare test account.
7. Open a pull request describing the change and security implications.

Never include production passwords, `AUTH_SECRET`, private gallery data or `.secrets` files in a pull request.
