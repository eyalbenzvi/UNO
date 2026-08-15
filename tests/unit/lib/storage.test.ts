import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJson, readRaw, removeRaw, writeJson, writeRaw } from '../../../src/lib/storage.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('namespaced storage', () => {
  it('round trips raw values under a namespace', () => {
    writeRaw('theme', 'dark');
    expect(readRaw('theme')).toBe('dark');
    expect(localStorage.getItem('uno:theme')).toBe('dark');
  });

  it('returns null for missing keys', () => {
    expect(readRaw('nothing')).toBeNull();
  });

  /*
   * A GitHub Pages project site shares its origin with every other project site
   * under the same account, and `localStorage` is keyed by origin. If this game
   * ever adopted a sibling game's prefix the two would be reading and writing one
   * store: this game's resume offer would carry the other's room code, pointed at
   * the wrong room server. The prefix is the only thing keeping them apart, so it
   * is asserted rather than trusted.
   */
  it('does not share a namespace with the game this one was built from', () => {
    writeRaw('resumableRoom', '{}');
    expect(localStorage.getItem('superTaki:resumableRoom')).toBeNull();
    expect(localStorage.getItem('uno:resumableRoom')).toBe('{}');
  });

  it('removes values', () => {
    writeRaw('theme', 'dark');
    removeRaw('theme');
    expect(readRaw('theme')).toBeNull();
  });

  it('validates json and drops values it cannot trust', () => {
    writeJson('identity', { playerId: 'pl_1' });
    const valid = readJson('identity', (value) =>
      typeof value === 'object' && value !== null && 'playerId' in value
        ? (value as { playerId: string })
        : null,
    );
    expect(valid).toEqual({ playerId: 'pl_1' });

    writeJson('identity', { wrong: true });
    const invalid = readJson('identity', () => null);
    expect(invalid).toBeNull();
    expect(readRaw('identity')).toBeNull();
  });

  it('drops malformed json', () => {
    writeRaw('identity', '{not json');
    expect(readJson('identity', (value) => value as never)).toBeNull();
    expect(readRaw('identity')).toBeNull();
  });

  it('survives a throwing storage implementation', () => {
    // jsdom exposes these on Storage.prototype, so patch there.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => {
      writeRaw('theme', 'dark');
    }).not.toThrow();
    expect(readRaw('theme')).toBeNull();
    expect(() => {
      removeRaw('theme');
    }).not.toThrow();
    expect(() => {
      writeJson('theme', { a: 1 });
    }).not.toThrow();
  });

  it('does not throw on values that cannot be serialised', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => {
      writeJson('cyclic', cyclic);
    }).not.toThrow();
  });
});
