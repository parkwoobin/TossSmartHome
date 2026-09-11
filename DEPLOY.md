# Production Server

This app should be deployed as one HTTPS Node service.

## SmartThings console values

Use the deployed app URL as the SmartThings Target URL:

```text
https://your-domain.example.com
```

Use this as the Redirect URI:

```text
https://your-domain.example.com/oauth/callback
```

After deployment, open this URL to connect the Samsung account:

```text
https://your-domain.example.com/oauth/start
```

## Required environment variables

```text
SMART_HOME_API_HOST=0.0.0.0
SMART_HOME_API_PORT=4176
SMART_HOME_PUBLIC_BASE_URL=https://your-domain.example.com
SMART_HOME_ALLOWED_ORIGINS=https://your-domain.example.com
SMART_HOME_API_KEY=change-this-long-random-key
SMART_HOME_ENABLE_LOCAL_SCHEDULER=false
SMARTTHINGS_CLIENT_ID=
SMARTTHINGS_CLIENT_SECRET=
SMARTTHINGS_OAUTH_STATE=change-this-random-state
SMARTTHINGS_SCOPES=r:devices:* x:devices:* r:locations:* r:rules:* w:rules:*
VITE_SMART_HOME_API_BASE=https://your-domain.example.com
VITE_SMART_HOME_API_KEY=change-this-long-random-key
```

`SMART_HOME_API_KEY` and `VITE_SMART_HOME_API_KEY` must match.

Saved appliance schedules are mirrored to SmartThings Rules when the server has a valid OAuth token. After a Rule is created, SmartThings handles the scheduled execution; the server token is only needed again when schedules are changed or Rules are recreated.

## Local production check

```bash
npm install
npm run build
SMART_HOME_API_HOST=0.0.0.0 node server.js
```
