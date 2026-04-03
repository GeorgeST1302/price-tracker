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

