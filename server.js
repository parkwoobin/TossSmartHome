import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PORT = Number(process.env.SMART_HOME_API_PORT || 4176);
const HOST = process.env.SMART_HOME_API_HOST || '127.0.0.1';
const PUBLIC_BASE_URL = (process.env.SMART_HOME_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const API_KEY = process.env.SMART_HOME_API_KEY || '';
const OAUTH_STATE = process.env.SMARTTHINGS_OAUTH_STATE || 'toss-smart-home';
const SMARTTHINGS_CLIENT_ID = process.env.SMARTTHINGS_CLIENT_ID || '';
const SMARTTHINGS_CLIENT_SECRET = process.env.SMARTTHINGS_CLIENT_SECRET || '';
const SMARTTHINGS_SCOPES = process.env.SMARTTHINGS_SCOPES || 'r:devices:* x:devices:* r:locations:* r:rules:* w:rules:*';
const ENABLE_LOCAL_SCHEDULER = process.env.SMART_HOME_ENABLE_LOCAL_SCHEDULER === 'true';
const allowedOrigins = (process.env.SMART_HOME_ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const STORE_PATH = join(process.cwd(), 'toss-smart-home-store.json');
const DIST_DIR = join(process.cwd(), 'dist');
const NOTIFICATION_LIMIT = 30;
const KOREAN_DAY_TO_INDEX = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};
const KOREAN_DAY_TO_RULE_DAY = {
  일: 'Sun',
  월: 'Mon',
  화: 'Tue',
  수: 'Wed',
  목: 'Thu',
  금: 'Fri',
  토: 'Sat',
};

let store = {
  token: process.env.SMARTTHINGS_TOKEN || '',
  refreshToken: process.env.SMARTTHINGS_REFRESH_TOKEN || '',
  tokenExpiresAt: '',
  schedules: {},
  devices: [],
  lastRuns: {},
  notifications: [],
  installedAppId: '',
  scheduleRules: {},
  scheduleRulesSignature: '',
};

async function loadStore() {
  if (!existsSync(STORE_PATH)) {
    return;
  }
  try {
    store = {
      ...store,
      ...JSON.parse(await readFile(STORE_PATH, 'utf8')),
    };
  } catch {
    console.warn('toss-smart-home-store.json 파일을 읽지 못했어요. 새 저장소로 시작합니다.');
  }
}

async function saveStore() {
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function getCorsOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) {
    return '*';
  }
  if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
    return origin;
  }
  return 'null';
}

function sendJson(request, response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': getCorsOrigin(request),
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Smart-Home-Key',
  });
  response.end(JSON.stringify(body));
}

function sendText(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(body);
}

async function sendStatic(request, response, url) {
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = resolve(DIST_DIR, relativePath);
  const distRoot = resolve(DIST_DIR);
  const canServePath = filePath === distRoot || filePath.startsWith(`${distRoot}\\`) || filePath.startsWith(`${distRoot}/`);
  const resolved = canServePath ? await stat(filePath).catch(() => null) : null;
  const finalPath = resolved?.isFile() ? filePath : resolve(DIST_DIR, 'index.html');
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
  }[finalPath.slice(finalPath.lastIndexOf('.'))] || 'application/octet-stream';

  response.writeHead(200, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': getCorsOrigin(request),
  });
  createReadStream(finalPath).pipe(response);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function confirmSmartThingsWebhook(body) {
  const confirmationUrl = body?.confirmationData?.confirmationUrl;
  if (!confirmationUrl) {
    return false;
  }
  const response = await fetch(confirmationUrl);
  if (!response.ok) {
    throw new Error(`SmartThings confirmation HTTP ${response.status}`);
  }
  return true;
}

function requireApiKey(request, response) {
  if (!API_KEY) {
    return true;
  }
  if (request.headers['x-smart-home-key'] === API_KEY) {
    return true;
  }
  sendJson(request, response, 401, { error: 'Unauthorized' });
  return false;
}

function getKoreanNow() {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const date = `${value.year}-${value.month}-${value.day}`;
  const time = `${value.hour}:${value.minute}`;
  const day = new Date(`${date}T00:00:00+09:00`).getDay();
  return { date, time, day };
}

function findDevice(scheduleKey) {
  return store.devices.find(device => (
    device.deviceId === scheduleKey ||
    device.name === scheduleKey ||
    device.label === scheduleKey
  ));
}

function getScheduleRulesSignature(schedules, devices) {
  const deviceSummary = devices.map(device => ({
    deviceId: device.deviceId,
    name: device.name,
    label: device.label,
    locationId: device.locationId,
    componentId: device.componentId,
  }));
  return JSON.stringify({ schedules, devices: deviceSummary });
}

function minutesFromNoon(time) {
  const [hour, minute] = String(time).split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  return (hour * 60 + minute) - (12 * 60);
}

function buildScheduleRule(device, field, time, days) {
  const offset = minutesFromNoon(time);
  const daysOfWeek = days.map(day => KOREAN_DAY_TO_RULE_DAY[day]).filter(Boolean);
  if (offset == null || daysOfWeek.length === 0) {
    return null;
  }
  const command = field === 'on' ? 'on' : 'off';
  return {
    name: `Toss Smart Home - ${device.name} ${command} ${time}`,
    timeZoneId: 'Asia/Seoul',
    actions: [
      {
        every: {
          specific: {
            daysOfWeek,
            reference: 'Noon',
            offset: {
              value: {
                integer: offset,
                type: 'integer',
              },
              unit: 'Minute',
            },
          },
          actions: [
            {
              command: {
                devices: [device.deviceId],
                commands: [
                  {
                    component: device.componentId || 'main',
                    capability: 'switch',
                    command,
                    arguments: [],
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  };
}

function pushNotification(title, message, notification = {}) {
  store.notifications = [
    {
      id: notification.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      message,
      createdAt: notification.createdAt || new Date().toISOString(),
    },
    ...(store.notifications || []),
  ].slice(0, NOTIFICATION_LIMIT);
}

function getTokenExpiry(expiresIn) {
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '';
  }
  return new Date(Date.now() + (seconds * 1000)).toISOString();
}

function tokenNeedsRefresh() {
  if (!store.tokenExpiresAt) {
    return false;
  }
  return new Date(store.tokenExpiresAt).getTime() - Date.now() < 5 * 60 * 1000;
}

async function refreshSmartThingsToken() {
  if (!store.refreshToken) {
    return false;
  }
  if (!SMARTTHINGS_CLIENT_ID || !SMARTTHINGS_CLIENT_SECRET) {
    return false;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: store.refreshToken,
    client_id: SMARTTHINGS_CLIENT_ID,
  });
  const response = await fetch('https://api.smartthings.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${SMARTTHINGS_CLIENT_ID}:${SMARTTHINGS_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`SmartThings token refresh HTTP ${response.status}`);
  }

  const data = await response.json();
  store.token = data.access_token || store.token;
  store.refreshToken = data.refresh_token || store.refreshToken;
  store.tokenExpiresAt = getTokenExpiry(data.expires_in);
  await saveStore();
  return true;
}

async function exchangeSmartThingsCode(code, redirectUri) {
  if (!SMARTTHINGS_CLIENT_ID || !SMARTTHINGS_CLIENT_SECRET) {
    throw new Error('SMARTTHINGS_CLIENT_ID and SMARTTHINGS_CLIENT_SECRET are required');
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: SMARTTHINGS_CLIENT_ID,
    redirect_uri: redirectUri,
  });
  const response = await fetch('https://api.smartthings.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${SMARTTHINGS_CLIENT_ID}:${SMARTTHINGS_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`SmartThings code exchange HTTP ${response.status}`);
  }
  const data = await response.json();
  store.token = data.access_token || store.token;
  store.refreshToken = data.refresh_token || store.refreshToken;
  store.tokenExpiresAt = getTokenExpiry(data.expires_in);
  store.installedAppId = data.installed_app_id || store.installedAppId || '';
  await saveStore();
  return data;
}

async function getSmartThingsToken() {
  if (!store.token) {
    throw new Error('SmartThings token is missing');
  }
  if (tokenNeedsRefresh()) {
    await refreshSmartThingsToken();
  }
  return store.token;
}

async function deleteSmartThingsRule(token, ruleId, locationId) {
  if (!ruleId || !locationId) {
    return;
  }
  const response = await fetch(`https://api.smartthings.com/rules/${ruleId}?locationId=${encodeURIComponent(locationId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`SmartThings rule delete HTTP ${response.status}`);
  }
}

async function createSmartThingsRule(token, locationId, rule) {
  const response = await fetch(`https://api.smartthings.com/rules?locationId=${encodeURIComponent(locationId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(rule),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`SmartThings rule create HTTP ${response.status}${message ? `: ${message}` : ''}`);
  }
  return response.json();
}

async function syncScheduleRules() {
  if (!store.token) {
    return { ok: false, reason: 'missing-token' };
  }
  const signature = getScheduleRulesSignature(store.schedules, store.devices);
  if (signature === store.scheduleRulesSignature) {
    return { ok: true, skipped: true };
  }

  const token = await getSmartThingsToken();
  const previousRules = store.scheduleRules || {};
  for (const rule of Object.values(previousRules)) {
    await deleteSmartThingsRule(token, rule.ruleId, rule.locationId);
  }

  const nextRules = {};
  for (const [scheduleKey, schedule] of Object.entries(store.schedules || {})) {
    if (!schedule || !Array.isArray(schedule.days) || schedule.days.length === 0) {
      continue;
    }
    const device = findDevice(scheduleKey);
    if (!device?.deviceId || !device?.locationId || !device?.capabilities?.includes('switch')) {
      continue;
    }
    for (const field of ['on', 'off']) {
      if (!schedule[field]) {
        continue;
      }
      const ruleBody = buildScheduleRule(device, field, schedule[field], schedule.days);
      if (!ruleBody) {
        continue;
      }
      const created = await createSmartThingsRule(token, device.locationId, ruleBody);
      const ruleId = created.id || created.ruleId;
      if (ruleId) {
        nextRules[`${scheduleKey}:${field}`] = {
          ruleId,
          locationId: device.locationId,
          deviceId: device.deviceId,
          field,
          time: schedule[field],
        };
      }
    }
  }

  store.scheduleRules = nextRules;
  store.scheduleRulesSignature = signature;
  await saveStore();
  return { ok: true, count: Object.keys(nextRules).length };
}

async function sendSmartThingsCommand(device, command) {
  if (!device?.deviceId) {
    throw new Error('SmartThings deviceId is missing');
  }
  const token = await getSmartThingsToken();
  const response = await fetch(`https://api.smartthings.com/v1/devices/${device.deviceId}/commands`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      commands: [{
        component: device.componentId || 'main',
        capability: 'switch',
        command,
      }],
    }),
  });
  if (!response.ok) {
    throw new Error(`SmartThings HTTP ${response.status}`);
  }
}

async function runDueSchedules() {
  const now = getKoreanNow();
  for (const [scheduleKey, schedule] of Object.entries(store.schedules)) {
    if (!schedule || !Array.isArray(schedule.days) || schedule.days.length === 0) {
      continue;
    }
    const activeDays = schedule.days.map(day => KOREAN_DAY_TO_INDEX[day]).filter(day => day !== undefined);
    if (!activeDays.includes(now.day)) {
      continue;
    }
    for (const field of ['on', 'off']) {
      if (schedule[field] !== now.time) {
        continue;
      }
      const runKey = `${scheduleKey}:${field}:${now.date}:${now.time}`;
      if (store.lastRuns[runKey]) {
        continue;
      }
      const device = findDevice(scheduleKey);
      try {
        await sendSmartThingsCommand(device, field === 'on' ? 'on' : 'off');
        store.lastRuns[runKey] = new Date().toISOString();
        pushNotification(
          `${device?.name || scheduleKey}${field === 'on' ? ' 켜짐' : ' 꺼짐'}`,
          `예약한 시간 ${now.time}에 ${field === 'on' ? '켜졌어요.' : '꺼졌어요.'}`,
        );
        await saveStore();
        console.log(`${scheduleKey} ${field === 'on' ? '켜짐' : '꺼짐'} 예약 실행 완료 ${now.date} ${now.time}`);
      } catch (error) {
        console.error(`${scheduleKey} 예약 실행 실패: ${error.message}`);
      }
    }
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(request, response, 204, {});
    return;
  }

  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(request, response, 200, { ok: true });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/') {
      const body = await readJson(request);
      if (body.messageType === 'CONFIRMATION') {
        const confirmed = await confirmSmartThingsWebhook(body);
        sendJson(request, response, confirmed ? 200 : 400, { ok: confirmed });
        return;
      }
      if (body.messageType === 'EVENT') {
        sendJson(request, response, 200, { ok: true });
        return;
      }
      sendJson(request, response, 200, { ok: true });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/oauth/start') {
      if (!PUBLIC_BASE_URL || !SMARTTHINGS_CLIENT_ID) {
        sendText(response, 500, 'SMART_HOME_PUBLIC_BASE_URL and SMARTTHINGS_CLIENT_ID are required');
        return;
      }
      const redirectUri = `${PUBLIC_BASE_URL}/oauth/callback`;
      const authorizeUrl = new URL('https://api.smartthings.com/v1/oauth/authorize');
      authorizeUrl.searchParams.set('client_id', SMARTTHINGS_CLIENT_ID);
      authorizeUrl.searchParams.set('scope', SMARTTHINGS_SCOPES);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('state', OAUTH_STATE);
      response.writeHead(302, { Location: authorizeUrl.toString() });
      response.end();
      return;
    }
    if (request.method === 'GET' && url.pathname === '/oauth/callback') {
      const error = url.searchParams.get('error');
      if (error) {
        sendText(response, 400, `SmartThings authorization failed: ${error}`);
        return;
      }
      if (url.searchParams.get('state') !== OAUTH_STATE) {
        sendText(response, 400, 'Invalid OAuth state');
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        sendText(response, 400, 'Missing OAuth code');
        return;
      }
      const redirectUri = `${PUBLIC_BASE_URL}/oauth/callback`;
      await exchangeSmartThingsCode(code, redirectUri);
      sendText(response, 200, 'SmartThings connected. You can close this tab.');
      return;
    }
    if (url.pathname.startsWith('/api/') && !requireApiKey(request, response)) {
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/schedules') {
      sendJson(request, response, 200, { schedules: store.schedules, devices: store.devices, rules: store.scheduleRules || {} });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/notifications') {
      sendJson(request, response, 200, { notifications: store.notifications || [] });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/notifications') {
      const body = await readJson(request);
      pushNotification(String(body.title || '알림'), String(body.message || ''), body);
      await saveStore();
      sendJson(request, response, 200, { ok: true, notifications: store.notifications });
      return;
    }
    const notificationMatch = url.pathname.match(/^\/api\/notifications\/([^/]+)$/);
    if (request.method === 'DELETE' && notificationMatch) {
      const notificationId = decodeURIComponent(notificationMatch[1]);
      store.notifications = (store.notifications || []).filter(item => item.id !== notificationId);
      await saveStore();
      sendJson(request, response, 200, { ok: true });
      return;
    }
    if (request.method === 'PUT' && url.pathname === '/api/schedules') {
      const body = await readJson(request);
      store.schedules = body.schedules || {};
      store.devices = Array.isArray(body.devices) ? body.devices : [];
      await saveStore();
      const rules = await syncScheduleRules().catch(error => ({ ok: false, error: error.message }));
      sendJson(request, response, 200, { ok: true, rules });
      return;
    }
    if (request.method === 'PUT' && url.pathname === '/api/token') {
      const body = await readJson(request);
      store.token = String(body.token || body.accessToken || '');
      store.refreshToken = String(body.refreshToken || store.refreshToken || '');
      store.tokenExpiresAt = body.expiresIn
        ? getTokenExpiry(body.expiresIn)
        : String(body.tokenExpiresAt || store.tokenExpiresAt || '');
      await saveStore();
      sendJson(request, response, 200, { ok: true });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/token/refresh') {
      const refreshed = await refreshSmartThingsToken();
      sendJson(request, response, refreshed ? 200 : 400, {
        ok: refreshed,
        tokenExpiresAt: store.tokenExpiresAt,
        hasRefreshToken: Boolean(store.refreshToken),
      });
      return;
    }
    const commandMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/commands$/);
    if (request.method === 'POST' && commandMatch) {
      const body = await readJson(request);
      const deviceId = decodeURIComponent(commandMatch[1]);
      const token = await getSmartThingsToken();
      const smartThingsResponse = await fetch(`https://api.smartthings.com/v1/devices/${deviceId}/commands`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      sendJson(request, response, smartThingsResponse.ok ? 200 : smartThingsResponse.status, {
        ok: smartThingsResponse.ok,
      });
      return;
    }
    if (request.method === 'GET' && existsSync(DIST_DIR)) {
      await sendStatic(request, response, url);
      return;
    }
    sendJson(request, response, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(request, response, 500, { error: error.message });
  }
});

await loadStore();
server.listen(PORT, HOST, () => {
  console.log(`Toss Smart Home API listening on http://${HOST}:${PORT}`);
});

if (ENABLE_LOCAL_SCHEDULER) {
  setInterval(runDueSchedules, 30_000);
}
