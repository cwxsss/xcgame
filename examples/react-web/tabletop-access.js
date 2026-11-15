import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { bodyParser } from '@koa/bodyparser';

const cookieName = 'tabletop_entry';
const lifetime = 365 * 24 * 60 * 60;
const retryWindow = 10 * 60 * 1000;
const attemptsPerIP = 5;

function digest(value) {
  return createHash('sha256').update(value).digest();
}

export function registerTabletopAccess(server) {
  const password = process.env.TABLETOP_ACCESS_PASSWORD;
  if (!password) throw new Error('TABLETOP_ACCESS_PASSWORD is required');
  const secret = process.env.TABLETOP_ACCESS_SECRET || randomBytes(32);
  const passwordDigest = digest(password);
  const signingKey = createHmac('sha256', secret)
    .update(passwordDigest)
    .digest();
  const origin = process.env.BOARDGAME_ORIGIN;
  const secure = origin?.startsWith('https://');
  const trustedProxyPrefix = process.env.TABLETOP_ACCESS_PROXY_PREFIX;
  const failures = new Map();
  const parse = bodyParser({ enableTypes: ['json'], jsonLimit: '1kb' });

  function signature(expires) {
    return createHmac('sha256', signingKey).update(expires).digest();
  }

  function validCookie(request) {
    const header = request.headers.cookie;
    const entry =
      typeof header === 'string' &&
      header
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(cookieName + '='));
    const token = entry && entry.slice(cookieName.length + 1);
    const match = /^([0-9]{10,12})\.([A-Za-z0-9_-]{43})$/.exec(token || '');
    if (!match || Number(match[1]) <= Date.now() / 1000) return false;
    const candidate = Buffer.from(match[2], 'base64url');
    return (
      candidate.length === 32 && timingSafeEqual(candidate, signature(match[1]))
    );
  }

  function sendCookie(ctx) {
    const expires = String(Math.floor(Date.now() / 1000) + lifetime);
    const token = expires + '.' + signature(expires).toString('base64url');
    ctx.set(
      'Set-Cookie',
      cookieName +
        '=' +
        token +
        '; Path=/; Max-Age=' +
        lifetime +
        '; HttpOnly; SameSite=Lax' +
        (secure ? '; Secure' : ''),
    );
  }

  function address(request) {
    const direct =
      request.socket.remoteAddress?.replace(/^::ffff:/, '') || 'unknown';
    const forwarded = request.headers['x-forwarded-for'];
    return trustedProxyPrefix &&
      direct.startsWith(trustedProxyPrefix) &&
      typeof forwarded === 'string'
      ? forwarded.split(',').at(-1).trim() || direct
      : direct;
  }

  const cleanup = setInterval(() => {
    for (const [ip, entry] of failures) {
      if (entry.expires <= Date.now()) failures.delete(ip);
    }
  }, retryWindow);
  cleanup.unref();

  server.transport.io.engine.use((request, _response, next) => {
    if (
      !validCookie(request) ||
      (origin && request.headers.origin && request.headers.origin !== origin)
    ) {
      return next(new Error('Tabletop access required'));
    }
    next();
  });

  server.app.use(async (ctx, next) => {
    if (ctx.path === '/access') {
      ctx.set('Cache-Control', 'no-store');
      const allowed = validCookie(ctx.req);
      if (ctx.method === 'GET') {
        if (allowed) sendCookie(ctx);
        ctx.body = { allowed };
        return;
      }
      if (ctx.method !== 'POST') ctx.throw(405);
      if (origin && ctx.get('Origin') && ctx.get('Origin') !== origin)
        ctx.throw(403);
      if (allowed) {
        ctx.body = { allowed: true };
        return;
      }
      const ip = address(ctx.req);
      function limited(entry) {
        ctx.set(
          'Retry-After',
          String(Math.max(1, Math.ceil((entry.expires - Date.now()) / 1000))),
        );
        ctx.status = 429;
        ctx.body = { allowed: false };
      }
      if (
        failures.get(ip)?.count >= attemptsPerIP &&
        failures.get(ip).expires > Date.now()
      ) {
        limited(failures.get(ip));
        return;
      }
      await parse(ctx, () => {
        const candidate = ctx.request.body?.password;
        if (
          typeof candidate === 'string' &&
          timingSafeEqual(digest(candidate), passwordDigest)
        ) {
          failures.delete(ip);
          sendCookie(ctx);
          ctx.body = { allowed: true };
          return;
        }
        const now = Date.now();
        let entry = failures.get(ip);
        if (!entry || entry.expires <= now) {
          if (failures.size >= 10000)
            failures.delete(failures.keys().next().value);
          entry = { count: 0, expires: now + retryWindow };
          failures.set(ip, entry);
        }
        entry.count++;
        if (entry.count >= attemptsPerIP) limited(entry);
        else {
          ctx.status = 401;
          ctx.body = { allowed: false };
        }
      });
      return;
    }
    const path = ctx.path;
    if (/^\/games(?:\/|$)/i.test(path) && !validCookie(ctx.req)) {
      ctx.status = 401;
      ctx.set('Cache-Control', 'no-store');
      ctx.body = { error: 'Tabletop access required' };
      return;
    }
    await next();
  });
}
