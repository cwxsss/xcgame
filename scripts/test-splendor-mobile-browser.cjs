const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const paths = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createServer } = require('node:net');

const repo = paths.resolve(__dirname, '..');
const examples = paths.join(repo, 'examples', 'react-web');
const browserModuleCandidates = [
  process.env.PUPPETEER_MODULE_DIR,
  paths.resolve(repo, '..', 'avalon-custom', 'node_modules', 'puppeteer'),
  paths.resolve(repo, 'avalon-custom', 'node_modules', 'puppeteer'),
].filter(Boolean);
const browserModule = browserModuleCandidates.find((candidate) =>
  existsSync(paths.join(candidate, 'package.json')),
);
if (!browserModule)
  throw new Error(
    'Puppeteer is not installed; set PUPPETEER_MODULE_DIR to a Puppeteer checkout.',
  );
const puppeteer = require(browserModule);
let port;
let base;

function freePort() {
  return new Promise((resolvePort, reject) => {
    const listener = createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const selected = listener.address().port;
      listener.close((error) =>
        error ? reject(error) : resolvePort(selected),
      );
    });
  });
}

function request(path, body, cookie) {
  return fetch(new URL(path, base), {
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await request('/access');
      if (response.status === 200 || response.status === 401) return;
    } catch {
      // The child may still be compiling the server.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('tabletop server did not start');
}

async function postJson(route, body, cookie) {
  const response = await request(route, body, cookie);
  assert.ok(response.ok, `${route} returned ${response.status}`);
  return response.json();
}

async function clickButton(page, text) {
  await page.evaluate((label) => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent.trim() === label,
    );
    if (!button) throw new Error(`button not found: ${label}`);
    button.click();
  }, text);
}

async function main() {
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const dist = mkdtempSync(paths.join(tmpdir(), 'xcgame-splendor-mobile-'));
  const build = spawnSync(
    process.execPath,
    [
      paths.join(examples, 'node_modules', 'parcel', 'lib', 'bin.js'),
      'build',
      'src/tabletop/index.html',
      '--dist-dir',
      dist,
      '--no-source-maps',
      '--no-cache',
    ],
    { cwd: examples, encoding: 'utf8' },
  );
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const babelRegister = require.resolve('@babel/register', {
    paths: [require.resolve('@babel/node/package.json')],
  });
  const serverBootstrap = `
    const register = require(${JSON.stringify(babelRegister)});
    register({ extensions: ['.js', '.ts'], presets: ['@babel/preset-env'], plugins: ['@babel/plugin-transform-modules-commonjs'] });
    require(${JSON.stringify(paths.join(repo, 'examples/react-web/tabletop-server.js'))});
  `;
  const server = spawn(process.execPath, ['-e', serverBootstrap], {
    cwd: repo,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      BOARDGAME_WEB_ROOT: dist,
      TABLETOP_ACCESS_PASSWORD: '1004',
      TABLETOP_ACCESS_SECRET: 'splendor-mobile-browser-test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverErrors = [];
  server.stderr.on('data', (chunk) => serverErrors.push(String(chunk)));
  try {
    await waitForServer();
    const access = await request('/access', { password: '1004' });
    assert.equal(access.status, 200);
    const accessCookie = access.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(accessCookie, 'access cookie missing');

    const created = await postJson(
      '/games/splendor/create',
      { numPlayers: 2 },
      accessCookie,
    );
    const roomPath = `/games/splendor/${created.matchID}`;
    const host = await postJson(
      `${roomPath}/join`,
      { playerID: '0', playerName: '浏览器房主' },
      accessCookie,
    );
    const guest = await postJson(
      `${roomPath}/join`,
      { playerName: '浏览器玩家' },
      accessCookie,
    );

    const browser = await puppeteer.launch({
      headless: 'shell',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      dumpio: true,
      args: [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-dev-shm-usage',
      ],
    });
    try {
      const contexts = await Promise.all([
        browser.createBrowserContext(),
        browser.createBrowserContext(),
      ]);
      const pages = await Promise.all(
        contexts.map((context) => context.newPage()),
      );
      for (const [page, seat] of [
        [pages[0], host],
        [pages[1], guest],
      ]) {
        await page.setViewport({
          width: 360,
          height: 800,
          deviceScaleFactor: 1,
        });
        await page.setCookie({
          name: 'tabletop_entry',
          value: accessCookie.slice(accessCookie.indexOf('=') + 1),
          domain: '127.0.0.1',
          path: '/',
        });
        await page.goto(base + '/', { waitUntil: 'networkidle0' });
        await page.evaluate(
          (key, value) => localStorage.setItem(key, JSON.stringify(value)),
          `tabletop-seat:splendor:${created.matchID}`,
          {
            playerID: String(seat.playerID),
            credentials: seat.playerCredentials,
          },
        );
        await page.goto(`${base}/#/room/splendor/${created.matchID}`, {
          waitUntil: 'networkidle0',
        });
        await page.waitForSelector('.splendor-mobile-lobby', {
          timeout: 10_000,
        });
      }

      await clickButton(pages[0], '准备');
      await clickButton(pages[1], '准备');
      await pages[0].waitForFunction(() =>
        [...document.querySelectorAll('button')].some(
          (button) =>
            button.textContent.trim() === '开始游戏' && !button.disabled,
        ),
      );
      await clickButton(pages[0], '开始游戏');
      await pages[0].waitForSelector('.splendor-mobile-market-card', {
        timeout: 10_000,
      });
      await pages[0].click('.splendor-mobile-market-card');
      await pages[0].waitForSelector('.splendor-mobile-confirm-row', {
        timeout: 10_000,
      });
      for (const width of [360, 390]) {
        await pages[0].setViewport({
          width,
          height: 800,
          deviceScaleFactor: 1,
        });
        const metrics = await pages[0].evaluate(() => {
          const row = document.querySelector('.splendor-mobile-confirm-row');
          const actions = [
            ...document.querySelectorAll('.splendor-mobile-confirm-row button'),
          ];
          return {
            viewport: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            rowRight: row.getBoundingClientRect().right,
            rowWidth: row.getBoundingClientRect().width,
            labels: actions.map((button) => button.textContent.trim()),
            visible: actions.every(
              (button) => button.getBoundingClientRect().width > 0,
            ),
          };
        });
        assert.ok(
          metrics.scrollWidth <= width,
          `horizontal overflow at ${width}px: ${JSON.stringify(metrics)}`,
        );
        assert.ok(
          metrics.rowRight <= width + 1,
          `action row exceeds ${width}px: ${JSON.stringify(metrics)}`,
        );
        assert.deepEqual(metrics.labels, ['取消', '购买', '预留']);
        assert.equal(metrics.visible, true);
      }
      await pages[0].click('.splendor-mobile-confirm-row .is-reserve');
      await pages[0].waitForFunction(
        () =>
          document.querySelectorAll('.splendor-mobile-reserved:not(.is-empty)')
            .length === 1,
      );
    } finally {
      await browser.close();
    }
  } catch (error) {
    if (serverErrors.length > 0) console.error(serverErrors.join(''));
    throw error;
  } finally {
    server.kill();
    rmSync(dist, { recursive: true, force: true });
  }
  console.log('splendor mobile browser checks passed at 360px and 390px');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
