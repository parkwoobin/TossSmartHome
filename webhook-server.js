import { createServer } from 'node:http';

const PORT = Number(process.env.SMART_HOME_WEBHOOK_PORT || 4180);
const HOST = process.env.SMART_HOME_WEBHOOK_HOST || '127.0.0.1';

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,Digest,Date',
  });
  response.end(JSON.stringify(body));
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
  console.log(`SmartThings confirmation URL: ${confirmationUrl}`);
  const response = await fetch(confirmationUrl);
  if (!response.ok) {
    throw new Error(`SmartThings confirmation HTTP ${response.status}`);
  }
  return true;
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/') {
      const body = await readJson(request);
      if (body.messageType === 'CONFIRMATION') {
        const confirmed = await confirmSmartThingsWebhook(body);
        sendJson(response, confirmed ? 200 : 400, { ok: confirmed });
        return;
      }
      if (body.messageType === 'EVENT') {
        console.log('SmartThings event received');
        sendJson(response, 200, { ok: true });
        return;
      }
      sendJson(response, 200, { ok: true });
      return;
    }
    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error.message);
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Toss Smart Home webhook listening on http://${HOST}:${PORT}`);
});
