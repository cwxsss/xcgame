import { createHmac, randomBytes } from 'node:crypto';

/** Private, per-game entropy and clock. A server can replay a game without affecting other rooms. */
export class GameRuntime {
  private draw = 0;
  private time?: number;
  replaying = false;

  constructor(readonly seed = randomBytes(32).toString('hex')) {}

  now(): number {
    return this.time ?? Date.now();
  }

  at<T>(time: number, action: () => T): T {
    const previous = this.time;
    this.time = time;
    try {
      return action();
    } finally {
      this.time = previous;
    }
  }

  private nextBytes(): Buffer {
    return createHmac('sha256', this.seed).update(String(this.draw++)).digest();
  }

  private index(length: number): number {
    const limit = 0x100000000 - (0x100000000 % length);
    let draw = this.nextBytes().readUInt32BE();
    while (draw >= limit) draw = this.nextBytes().readUInt32BE();
    return draw % length;
  }

  sample<T>(values: readonly T[]): T | undefined {
    return values.length ? values[this.index(values.length)] : undefined;
  }

  shuffle<T>(values: readonly T[]): T[] {
    const shuffled = [...values];
    for (let right = shuffled.length - 1; right > 0; right--) {
      const left = this.index(right + 1);
      [shuffled[left], shuffled[right]] = [shuffled[right], shuffled[left]];
    }
    return shuffled;
  }

  sampleSize<T>(values: readonly T[], count: number): T[] {
    return this.shuffle(values).slice(0, Math.max(0, count));
  }

  uuid(): string {
    const bytes = this.nextBytes();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex', 0, 16);
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }
}
