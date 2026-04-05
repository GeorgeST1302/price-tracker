# PricePulse Landing (Astro)

This is the marketing/landing shell for PricePulse.

It is intentionally separate from the React tracking app so you can keep product workflows stable while improving first impression and SEO.

## Run

```bash
cd landing
npm install
npm run dev
```

Default URL:
- `http://localhost:4321`

## Configure App Link

Create `landing/.env`:

```bash
PUBLIC_APP_URL=http://localhost:5173/#/
```

For production, set this to your deployed React app URL.

## Build

```bash
npm run build
```

Output:
- `landing/dist`

## Cloudflare Pages

This site is a static build and can be deployed directly to Cloudflare Pages.

- Project root: `landing`
- Build command: `npm install && npm run build`
- Build output directory: `dist`
- Set `PUBLIC_APP_URL` to the deployed React app URL, for example `https://price-tracker-app.pages.dev/#/`
- For local editing, copy [.env.example](./.env.example) to [.env](./.env) and adjust `PUBLIC_APP_URL` as needed.

If you change the app domain later, update `PUBLIC_APP_URL` and rebuild the landing site.

