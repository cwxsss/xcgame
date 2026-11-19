import { GameManager } from '@/core/game-manager';
import type { GameOptions, Server } from '@avalon/types';

const io = { to: () => io, except: () => io, emit: () => true } as unknown as Server;
const players = ['alice', 'bob', 'carol', 'dave', 'eve'];
const roles: GameOptions['roles'] = { merlin: 1, assassin: 1 };

test('an ordinary game resumes the same deal, selected expedition, and partially cast vote', () => {
  const manager = new GameManager(players, { roles, addons: {}, features: { wtfMode: false } }, io, 'match');
  const leader = manager.game.leader.userID;
  for (const playerID of players.slice(0, 2)) manager.callGameMethods(leader, { method: 'selectPlayer', playerID });
  manager.callGameMethods(leader, { method: 'sentSelectedPlayers' });
  manager.callGameMethods('alice', { method: 'voteForMission', option: 'approve' });
  expect(manager.game.stage).toBe('votingForTeam');

  const checkpoint = JSON.parse(JSON.stringify(manager.recoverySnapshot()));
  const restored = GameManager.restore(io, 'match', checkpoint);
  for (const player of [...players, 'spectator']) {
    expect(restored.prepareStateForUser(player)).toEqual(manager.prepareStateForUser(player));
  }
  expect(JSON.stringify(restored.prepareStateForUser('spectator'))).not.toContain(checkpoint.seed);
  expect(() => restored.callGameMethods('alice', { method: 'voteForMission', option: 'reject' })).toThrow();
  for (const player of players.slice(1)) restored.callGameMethods(player, { method: 'voteForMission', option: 'approve' });
  expect(restored.game.stage).toBe('onMission');
  expect(restored.recoverySnapshot()?.actions).toHaveLength(8);
});

test('randomized expansion setup reproduces on restart', () => {
  const manager = new GameManager(
    players,
    {
      roles,
      addons: { plotCards: true },
      features: { wtfMode: false, timerDurations: { firstSelectTeam: { enabled: true, duration: 600 } } },
    },
    io,
    'match',
  );
  try {
    const checkpoint = manager.recoverySnapshot()!;
    const restored = GameManager.restore(io, 'match', checkpoint);
    try {
      expect(restored.game.addonsData).toEqual(manager.game.addonsData);
      expect(restored.game.timer.getTimerState()).toEqual(manager.game.timer.getTimerState());
    } finally {
      restored.game.timer.cleanup();
    }
  } finally {
    manager.game.timer.cleanup();
  }
});

test('automatic timer actions are replayed and already-expired timers advance only once', () => {
  jest.useFakeTimers();
  try {
    const manager = new GameManager(
      players,
      {
        roles,
        addons: {},
        features: { wtfMode: false, timerDurations: { firstSelectTeam: { enabled: true, duration: 1 } } },
      },
      io,
      'match',
    );
    expect(manager.game.timer.getTimerState()).toMatchObject({ active: true, stage: 'firstSelectTeam' });
    jest.advanceTimersByTime(1000);
    expect(manager.game.stage).toBe('votingForTeam');
    const snapshot = manager.recoverySnapshot()!;
    expect(snapshot.actions).toEqual([{ at: expect.any(Number), expiredTimer: 'firstSelectTeam' }]);
    const restored = GameManager.restore(io, 'match', snapshot);
    expect(restored.prepareStateForUser('alice')).toEqual(manager.prepareStateForUser('alice'));
    jest.advanceTimersByTime(1000);
    expect(restored.recoverySnapshot()?.actions).toHaveLength(1);
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
