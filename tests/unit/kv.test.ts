import { describe, expect, it } from 'vitest';
import { MemoryKV } from '@/server/kv';

describe('MemoryKV', () => {
  it('stores clones and honours nx and px', async () => {
    let now = 1_000;
    const kv = new MemoryKV(() => now);
    const obj = { a: 1 };
    expect(await kv.set('k', obj, { px: 500 })).toBe(true);
    obj.a = 2;
    expect(await kv.get<{ a: number }>('k')).toEqual({ a: 1 });
    expect(await kv.set('k', { a: 3 }, { nx: true })).toBe(false);
    expect(await kv.pttl('k')).toBe(500);
    now += 501;
    expect(await kv.get('k')).toBeNull();
    expect(await kv.pttl('k')).toBe(-2);
  });

  it('increments with an initial ttl only', async () => {
    let now = 0;
    const kv = new MemoryKV(() => now);
    expect(await kv.incrby('c', 2, 1_000)).toBe(2);
    now = 600;
    expect(await kv.incrby('c', 3, 1_000)).toBe(5);
    expect(await kv.pttl('c')).toBe(400);
    expect(await kv.mget(['c', 'missing'])).toEqual([5, null]);
    expect(await kv.del(['c', 'missing'])).toBe(1);
  });
});
