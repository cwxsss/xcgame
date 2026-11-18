const http = require('node:http');
const path = require('node:path');
const express = require('express');

const hallPrefix = '/avalon';
const tabletop = new URL(process.env.TABLETOP_UPSTREAM || 'http://127.0.0.1:18997');
const avalon = new URL(process.env.AVALON_UPSTREAM || 'http://127.0.0.1:3000');
const voice = process.env.AVALON_VOICE_UPSTREAM ? new URL(process.env.AVALON_VOICE_UPSTREAM) : undefined;
const voiceRoutes = new Set(['/rtc', '/rtc/validate', '/rtc/v1', '/rtc/v1/validate']);
const webRoot = process.env.AVALON_WEB_ROOT;
const tabletopWebRoot = process.env.TABLETOP_WEB_ROOT;
const trustedProxy = process.env.HALL_TRUST_PROXY;
if (!webRoot) throw Error('AVALON_WEB_ROOT must point to the integrated Avalon build');

function headersFor(req, upstream) {
  const headers = { ...req.headers, host: upstream.host };
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase().startsWith('x-forwarded-') || key === 'forwarded') delete headers[key];
  }
  const direct = req.socket.remoteAddress;
  const forwarded = req.headers['x-forwarded-for'];
  headers['x-forwarded-for'] =
    trustedProxy && direct === trustedProxy && typeof forwarded === 'string'
      ? forwarded.split(',').at(-1).trim() || direct
      : direct;
  return headers;
}

async function signedIn(req) {
  const result = await fetch(new URL('/access', tabletop), {
    headers: { cookie: req.headers.cookie || '' },
    signal: AbortSignal.timeout(5000),
  });
  if (!result.ok) throw Error('Game hall access check failed');
  return (await result.json()).allowed === true;
}

function serviceUnavailable(res) {
  if (res.headersSent) return res.destroy();
  return res.status(502).send('游戏服务暂时不可用');
}

function forward(req, res, target, requestPath) {
  const upstream = http.request(target, {
    path: requestPath,
    method: req.method,
    headers: headersFor(req, target),
  });
  upstream.on('response', (result) => {
    if (target === tabletop && requestPath === '/access') result.headers['x-xcgame-avalon-path'] = '/avalon/';
    res.writeHead(result.statusCode, result.headers);
    result.pipe(res);
  });
  upstream.on('error', () => serviceUnavailable(res));
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}

function refuseUpgrade(socket, status, reason) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function forwardUpgrade(req, client, head, target, requestPath) {
  const upstream = http.request(target, { path: requestPath, headers: headersFor(req, target) });
  upstream.on('upgrade', (result, peer, buffered) => {
    if (client.destroyed) return peer.destroy();
    const response = [`HTTP/1.1 ${result.statusCode} ${result.statusMessage}`];
    for (let i = 0; i < result.rawHeaders.length; i += 2) {
      response.push(`${result.rawHeaders[i]}: ${result.rawHeaders[i + 1]}`);
    }
    client.write(response.join('\r\n') + '\r\n\r\n');
    if (buffered.length) client.write(buffered);
    if (head.length) peer.write(head);
    client.on('error', () => peer.destroy());
    peer.on('error', () => client.destroy());
    client.pipe(peer).pipe(client);
  });
  upstream.on('response', (result) => {
    result.resume();
    refuseUpgrade(client, result.statusCode || 502, result.statusMessage || 'Bad Gateway');
  });
  upstream.on('error', () => refuseUpgrade(client, 502, 'Bad Gateway'));
  client.on('close', () => upstream.destroy());
  upstream.end();
}

const app = express();
app.disable('x-powered-by');
app.use(hallPrefix, async (req, res, next) => {
  try {
    if (await signedIn(req)) return next();
    res.set('Cache-Control', 'no-store');
    if (req.method === 'GET' && req.get('Accept')?.includes('text/html')) {
      return res.redirect('/?next=' + encodeURIComponent(req.originalUrl));
    }
    return res.status(401).json({ error: 'Tabletop access required' });
  } catch {
    return serviceUnavailable(res);
  }
});
app.get(hallPrefix, (req, res, next) => {
  if (req.path === hallPrefix) return res.redirect(hallPrefix + '/');
  return next();
});
app.use(hallPrefix, (req, res, next) => {
  if (/^\/(?:socket\.io|api)(?:\/|$)/.test(req.path)) {
    return forward(req, res, avalon, req.url);
  }
  return next();
});
app.use(hallPrefix, express.static(path.resolve(webRoot), { index: false }));
app.use(hallPrefix, (req, res) => {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || path.posix.extname(req.path)) return res.sendStatus(404);
  res.set('Cache-Control', 'no-cache').sendFile(path.resolve(webRoot, 'index.html'));
});
app.use(async (req, res, next) => {
  if (!voice || !voiceRoutes.has(req.path)) return next();
  try {
    if (!(await signedIn(req))) return res.sendStatus(401);
    return forward(req, res, voice, req.originalUrl);
  } catch {
    return serviceUnavailable(res);
  }
});
if (tabletopWebRoot) {
  app.use(express.static(path.resolve(tabletopWebRoot), {
    setHeaders(res, file) {
      if (path.basename(file) === 'index.html') res.setHeader('Cache-Control', 'no-cache');
    },
  }));
}
app.use((req, res) => forward(req, res, tabletop, req.originalUrl));

const server = http.createServer(app);
server.on('upgrade', async (req, client, head) => {
  client.on('error', () => client.destroy());
  const requestPath = req.url || '/';
  if (/^\/socket\.io(?:\/|\?)/.test(requestPath)) {
    return forwardUpgrade(req, client, head, tabletop, requestPath);
  }
  const avalonSocket = /^\/avalon\/socket\.io(?:\/|\?)/.test(requestPath);
  const voiceSocket = voice && voiceRoutes.has(requestPath.split('?')[0]);
  if (!avalonSocket && !voiceSocket) return refuseUpgrade(client, 404, 'Not Found');
  try {
    if (!(await signedIn(req))) return refuseUpgrade(client, 401, 'Unauthorized');
    if (!client.destroyed) {
      if (voiceSocket) forwardUpgrade(req, client, head, voice, requestPath);
      else forwardUpgrade(req, client, head, avalon, requestPath.slice(hallPrefix.length));
    }
  } catch {
    refuseUpgrade(client, 502, 'Bad Gateway');
  }
});
server.listen(Number(process.env.HALL_PORT || 18996), process.env.HALL_HOST || '127.0.0.1', () => {
  console.log('Game hall is ready');
});
