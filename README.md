# Toss Smart Home

Toss-style smart home control dashboard for SmartThings devices.

It provides a mobile-first UI for checking appliances, controlling devices, saving schedules, and syncing those schedules to SmartThings Rules so they can continue running from SmartThings after setup.

## Features

- Toss-inspired appliance cards and room controls
- SmartThings device sync
- Schedule settings for appliances
- SmartThings OAuth connection flow
- SmartThings Rules sync for saved schedules
- Token refresh support on the backend
- HTTPS-ready Node server for production deployment

## Stack

- React
- Vite
- Node.js HTTP server
- SmartThings API
- Docker/Caddy deployment friendly

## Local Development

```bash
npm install
npm run build
npm run api
```

The API server defaults to port `4176`.

For local Vite preview/development, run Vite separately if needed:

```bash
npx vite --host 127.0.0.1 --port 4177
```

## Environment

Copy `.env.example` and fill in deployment-specific values.

```bash
cp .env.example .env
```

Important variables:

```text
SMART_HOME_PUBLIC_BASE_URL=https://your-domain.example.com
SMART_HOME_API_KEY=change-this-long-random-key
SMARTTHINGS_CLIENT_ID=
SMARTTHINGS_CLIENT_SECRET=
SMARTTHINGS_OAUTH_STATE=change-this-random-state
```

For frontend API calls, these two must match:

```text
SMART_HOME_API_KEY
VITE_SMART_HOME_API_KEY
```

## SmartThings Setup

In SmartThings Developers, create an Automation SmartApp using a WebHook Endpoint.

Use:

```text
Target URL:
https://your-domain.example.com

Redirect URI:
https://your-domain.example.com/oauth/callback
```

After deployment, open:

```text
https://your-domain.example.com/oauth/start
```

Log in with the Samsung account and approve access. The server stores the access token and refresh token in its local store.

## Scheduling Behavior

When schedules are saved, the backend mirrors them into SmartThings Rules.

After the Rules are created, SmartThings handles the scheduled execution. The server is needed again when schedules are changed, devices are resynced, or OAuth tokens need refreshing.

For production, keep:

```text
SMART_HOME_ENABLE_LOCAL_SCHEDULER=false
```

This avoids relying on the Node server timer for daily automation.

## Deployment

See [DEPLOY.md](./DEPLOY.md) for production server notes.

Recommended production setup:

- Oracle VM or another always-on server
- Docker
- Caddy for HTTPS
- A dedicated DuckDNS or custom domain

Do not commit real `.env` files, access tokens, refresh tokens, or local store JSON files.
