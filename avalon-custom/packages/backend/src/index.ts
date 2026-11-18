import '@/init';
import { startVoiceGateway } from '@/voice/runtime';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import CookieParser from 'cookie-parser';
import cors from 'cors';

import { backendPort, frontendOrigin } from '@/const';

import { connectDB, DBManager } from '@/db';
import { MigrationError } from '@/db/migrations';

import { Manager } from '@/main';
import { supportRouter } from '@/support/routes';
import { playerBoardsRouter } from '@/player-boards/routes';
import { ensurePlayerBoardIndexes } from '@/player-boards/repository';
import { directSupport } from '@/support/direct/service';
import { startSupportWorker } from '@/support/direct/worker';
import { supportOrderModel } from '@/support/repository';
import { ensureGiveawayIndexes } from '@/support/giveaway/repository';
import { weeklyGiveaway } from '@/support/giveaway/service';
import { startGiveawayWorker } from '@/support/giveaway/worker';

const app = express();
// Only explicit proxy IPs/CIDRs; never trust arbitrary client forwarding headers.
if (process.env.TRUSTED_PROXY_CIDRS)
  app.set(
    'trust proxy',
    process.env.TRUSTED_PROXY_CIDRS.split(',').map((s) => s.trim()),
  );
const server = createServer(app);
const corsOpts = {
  cors: {
    origin: frontendOrigin,
    credentials: true,
  },
};
const io = new Server(server, { ...corsOpts, maxHttpBufferSize: 64 * 1024 });

app.use(CookieParser());
app.use(cors(corsOpts.cors));

async function start() {
  const mongoose = await connectDB();
  await supportOrderModel.init();
  await ensurePlayerBoardIndexes();
  await ensureGiveawayIndexes();
  await weeklyGiveaway.initialize();
  startGiveawayWorker(weeklyGiveaway);
  startSupportWorker(directSupport);
  app.use('/api/support', supportRouter);
  app.use('/api/player-boards', playerBoardsRouter);
  const dbManager = new DBManager(mongoose);
  const manager = new Manager(io, dbManager);
  startVoiceGateway(manager.voice);

  server.listen(backendPort, process.env.HOST || '0.0.0.0', () => {
    console.log(`server running at http://localhost:${backendPort}`);
  });
}

void start().catch((error: unknown) => {
  // Do not serialize driver errors: connection strings can contain credentials.
  console.error(
    error instanceof MigrationError
      ? error.message
      : 'Backend startup failed. Check database availability and migration diagnostics.',
  );
  process.exit(1);
});
