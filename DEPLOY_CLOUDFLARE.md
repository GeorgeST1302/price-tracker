# Deploying FullStack to Cloudflare Pages + Workers (D1)

This guide deploys the API to a Cloudflare Worker backed by D1, the React dashboard to Cloudflare Pages, and the Astro landing page last if you want it.

Prereqs:
- Cloudflare account with Pages and Workers access
- `wrangler` installed
- `npm` installed

Local development templates are included in:
- `frontend/.env.example`
- `cloudflare-api/.dev.vars.example`
- `landing/.env.example`

1. Deploy the Worker API

```powershell
cd cloudflare-api
npm install
Copy-Item .dev.vars.example .dev.vars
npm run db:create
# Copy the returned database_id into cloudflare-api/wrangler.toml if you are creating a new DB
npm run db:migrate
npm run deploy
```

`cloudflare-api/wrangler.toml` already includes:
- `CORS_ORIGINS` for the React Pages origin
- a 15-minute cron trigger for scheduled refresh
- `ALLOW_SYNTHETIC = "0"` so production refreshes stay live

Set the Worker secrets in Wrangler before deploy so Telegram notifications can send.

After deploy, copy the Worker URL printed by Wrangler, for example `https://price-tracker-api.<your-subdomain>.workers.dev`.

2. Deploy the React dashboard to Cloudflare Pages

- Project root: `frontend`
- Build command: `npm install && npm run build`
- Build output directory: `dist`
- Environment variable: `VITE_API_BASE_URL` = the Worker URL from step 1

3. Tighten CORS after the Pages domain is final

Once the React Pages project is live at `https://price-tracker-app.pages.dev`, set `CORS_ORIGINS` in `cloudflare-api/wrangler.toml` or in the Cloudflare Worker environment to only that exact origin.

If you are testing the Worker locally against `wrangler dev`, temporarily include `http://localhost:5173` in a local override.

4. Deploy the Astro landing page last if you want it

- Project root: `landing`
- Build command: `npm install && npm run build`
- Build output directory: `dist`
- Environment variable: `PUBLIC_APP_URL` = the deployed React Pages URL, for example `https://price-tracker-app.pages.dev/#/`

The landing site is optional for the app itself; it can wait until after the React dashboard is live.

5. Local development

```powershell
# terminal 1
cd cloudflare-api
npm install
npm run dev

# terminal 2
cd frontend
npm install
npm run dev

# terminal 3 (optional)
cd landing
npm install
npm run dev
```

6. Troubleshooting

- If the frontend cannot contact the Worker, verify `VITE_API_BASE_URL` and `CORS_ORIGINS`.
- If Telegram alerts do not send, confirm the Worker secrets are configured in Wrangler.
- Check `wrangler tail` logs for runtime errors during Worker requests and cron runs.

7. Verified live URLs from this workspace

- Worker API: `https://price-tracker-api.bl-en-u4aid23016.workers.dev`
- React dashboard: `https://price-tracker-app.pages.dev/#/`
- Landing deployment: `https://af11f48e.price-tracker-landing.pages.dev/`

That's it. The React app and Astro landing will run on Pages, and the API will run on Workers + D1 with scheduled refreshes.
