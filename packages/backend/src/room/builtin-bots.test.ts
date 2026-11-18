import type { Server } from '@avalon/types';
import { Room } from './index';

const io = {
  to: () => io,
  except: () => io,
  emit: () => true,
} as unknown as Server;

test('host can atomically configure local bot seats and roles remain private to host while waiting', () => {
  const room = new Room('local-bots', 'owner', ['owner'], io);
  room.setRoomBots([{}, {}, {}, {}]);
  expect(room.players).toEqual(['owner', 'avalon-agent-1', 'avalon-agent-2', 'avalon-agent-3', 'avalon-agent-4']);
  expect(room.calculateRoomState('owner').roomBots).toHaveLength(4);
  expect(room.calculateRoomState('guest').roomBots).toEqual([
    { id: 'avalon-agent-1' },
    { id: 'avalon-agent-2' },
    { id: 'avalon-agent-3' },
    { id: 'avalon-agent-4' },
  ]);
});

test('local bots start a five-seat game through the regular GameManager', () => {
  const room = new Room('local-bots-start', 'owner', ['owner'], io);
  room.setRoomBots([{}, {}, {}, {}]);
  room.startGame();
  expect(room.data.stage).toBe('started');
  if (room.data.stage !== 'started') return;
  expect(room.data.manager.game.players).toHaveLength(5);
  room.data.manager.game.players.forEach((player) => expect(player.userID).toBeTruthy());
});
