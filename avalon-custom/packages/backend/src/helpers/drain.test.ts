import { Drain } from './drain';

test('closing rejects new work and waits for work already admitted', async () => {
  const drain = new Drain();
  let finish!: () => void;
  const accepted = drain.run(() => new Promise<void>((resolve) => { finish = resolve; }));
  const complete = jest.fn();
  const closing = drain.close().then(complete);
  expect(() => drain.run(() => 1)).toThrow('serverRestarting');
  await Promise.resolve();
  expect(complete).not.toHaveBeenCalled();
  finish();
  await accepted;
  await closing;
  expect(complete).toHaveBeenCalledTimes(1);
});

test('a failed operation does not prevent shutdown, and its original caller sees the error', async () => {
  const drain = new Drain();
  const failure = Error('save failed');
  const accepted = drain.run(async () => { throw failure; });
  await expect(accepted).rejects.toBe(failure);
  await expect(drain.close()).resolves.toBeUndefined();
});
