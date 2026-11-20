import { eventBus } from '@/helpers';
import type { Server } from '@avalon/types';
import { Room } from '@/room';

const io = {
  to: () => ({ emit: () => {} }),
  except: () => ({ to: () => ({ emit: () => {} }) }),
} as unknown as Server;

afterEach(() => eventBus.removeAllListeners());

test('claims the requested physical seat atomically and leaves a vacancy behind', () => {
  const room = new Room('seats', 'owner', ['owner'], io);

  expect(room.getSeatAssignments()).toEqual(['owner', ...Array<string | null>(9).fill(null)]);
  room.seatGame('bob', 4);
  expect(room.getSeatAssignments()[4]).toBe('bob');
  expect(room.players).toEqual(['owner', 'bob']);
  expect(() => room.seatGame('carol', 4)).toThrow('Seat is occupied');

  room.seatGame('bob', 7);
  expect(room.getSeatAssignments()[4]).toBeNull();
  expect(room.getSeatAssignments()[7]).toBe('bob');
  room.leaveGame('bob');
  expect(room.getSeatAssignments()[7]).toBeNull();
  expect(room.players).toEqual(['owner']);
});

test('legacy joinGame takes the first vacant seat and configured AI seats cannot be claimed', () => {
  const room = new Room('bots', 'owner', ['owner'], io);
  room.setRoomBots([{}, {}]);
  expect(room.getSeatAssignments().slice(0, 3)).toEqual(['owner', 'avalon-agent-1', 'avalon-agent-2']);
  expect(() => room.seatGame('guest', 1)).toThrow('Seat is occupied');
  room.joinGame('guest');
  expect(room.getSeatAssignments()[3]).toBe('guest');
});

test('last human leaving a bot-filled waiting room destroys it instead of handing host to a bot', () => {
  const room = new Room('last-human', 'owner', ['owner'], io);
  room.setRoomBots([{}, {}]);
  const destroyed: Room[] = [];
  eventBus.on('destroyRoom', (value) => destroyed.push(value as Room));

  room.leaveGame('owner');

  expect(destroyed).toEqual([room]);
  expect(room.leaderID).toBe('owner');
});

test('seat changes are rejected once the game has started', () => {
  const room = new Room('running', 'owner', ['owner', 'bob', 'carol', 'dave', 'eve'], io);
  room.startGame();
  expect(() => room.seatGame('owner', 9)).toThrow('Seats cannot be changed after the game starts');
});

test('locking preserves the roster while seated players can still switch to a free place', () => {
  const room = new Room('locked', 'owner', ['owner'], io);
  room.toggleLockedState();
  expect(() => room.seatGame('spectator', 3)).toThrow('The room is locked');
  room.seatGame('owner', 3);
  expect(room.getSeatAssignments()[0]).toBeNull();
  expect(room.getSeatAssignments()[3]).toBe('owner');
});
