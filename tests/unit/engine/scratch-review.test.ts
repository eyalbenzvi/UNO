import { describe, expect, it } from 'vitest';
import { applyCommand, createGame } from '../../../src/features/game/engine/engine.ts';
import { DECK_SIZE } from '../../../src/features/game/engine/cards.ts';
import type { GameState, GameCommand } from '../../../src/features/game/engine/state.ts';
import { card, cards, expectOk, makeState, players } from '../helpers/engineFixtures.ts';

function census(state: GameState): number {
  let n = state.drawPile.length + state.discardPile.length;
  for (const p of state.players) n += (state.hands[p.id] ?? []).length;
  return n;
}

function ids(state: GameState): string[] {
  const out: string[] = [];
  for (const c of state.drawPile) out.push(c.id);
  for (const c of state.discardPile) out.push(c.id);
  for (const p of state.players) for (const c of state.hands[p.id] ?? []) out.push(c.id);
  return out.sort();
}

describe('scratch review', () => {
  it('WD4 winner who leaves before the answer loses the win', () => {
    const list = players('Alice', 'Bob', 'Carol');
    const state = makeState({
      players: list,
      hands: {
        'p-alice': cards('wildDrawFour'),
        'p-bob': cards('red:3', 'red:4'),
        'p-carol': cards('red:5', 'red:6'),
      },
      discardPile: cards('red:9'),
      currentPlayerIndex: 0,
    });
    const played = expectOk(
      applyCommand(state, {
        type: 'playCard',
        playerId: 'p-alice',
        cardId: state.hands['p-alice']![0]!.id,
        chosenColor: 'blue',
      }),
    ).state;
    expect(played.challenge).not.toBeNull();
    expect(played.hands['p-alice']!.length).toBe(0);
    const left = expectOk(applyCommand(played, { type: 'leaveGame', playerId: 'p-alice' })).state;
    // eslint-disable-next-line no-console
    console.log('after author-left:', left.phase, left.winnerId, left.endReason);
    expect(left.phase).toBe('finished');
  });

  it('fuzz: conservation + invariants', () => {
    const rand = (() => {
      let s = 42;
      return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
    })();
    for (let game = 0; game < 300; game += 1) {
      const n = 2 + Math.floor(rand() * 5);
      const list = players(...Array.from({ length: n }, (_, i) => `P${i}`));
      const res = createGame(list, Math.floor(rand() * 1e9), 1, Math.floor(rand() * 6), 'points');
      if (!res.ok) throw new Error('createGame failed ' + res.rejection.code);
      let state = res.state;
      expect(census(state)).toBe(DECK_SIZE);
      expect(state.turnSeq).toBe(0);
      const baseIds = ids(state);
      for (let step = 0; step < 400 && state.phase === 'playing'; step += 1) {
        const cur = state.players[state.currentPlayerIndex]!;
        const candidates: GameCommand[] = [];
        const actorId = state.challenge ? state.challenge.targetId : cur.id;
        if (state.challenge) {
          candidates.push({ type: 'acceptWildDrawFour', playerId: actorId });
          candidates.push({ type: 'challengeWildDrawFour', playerId: actorId });
        } else {
          for (const c of state.hands[actorId] ?? []) {
            candidates.push({
              type: 'playCard',
              playerId: actorId,
              cardId: c.id,
              ...(c.kind === 'wild' || c.kind === 'wildDrawFour' ? { chosenColor: 'red' as const } : {}),
              declareUno: rand() < 0.5,
            });
          }
          candidates.push({ type: 'drawCard', playerId: actorId });
          candidates.push({ type: 'passTurn', playerId: actorId });
          candidates.push({ type: 'skipTurn', playerId: actorId });
        }
        for (const p of state.players) {
          candidates.push({ type: 'declareUno', playerId: p.id });
          for (const q of state.players) {
            if (p.id !== q.id) candidates.push({ type: 'catchUno', playerId: p.id, targetId: q.id });
          }
        }
        if (rand() < 0.02) {
          candidates.push({ type: 'leaveGame', playerId: state.players[Math.floor(rand() * n)]!.id });
        }
        const pick = candidates[Math.floor(rand() * candidates.length)]!;
        const out = applyCommand(state, pick);
        if (!out.ok) continue;
        const next = out.state;
        // conservation
        if (census(next) !== DECK_SIZE) {
          throw new Error(`census broke after ${pick.type}: ${census(next)}`);
        }
        const nowIds = ids(next);
        if (nowIds.join(',') !== baseIds.join(',')) {
          throw new Error(`card identities changed after ${pick.type}`);
        }
        // turn pointer never rests on a left seat while playing
        if (next.phase === 'playing') {
          const at = next.players[next.currentPlayerIndex];
          if (!at || at.left === true) {
            throw new Error(`turn on a left seat after ${pick.type}`);
          }
        }
        // turnSeq monotone
        if (next.turnSeq < state.turnSeq) throw new Error('turnSeq went backwards');
        if (next.turnSeq > state.turnSeq + 1) {
          throw new Error(`turnSeq jumped by ${next.turnSeq - state.turnSeq} on ${pick.type}`);
        }
        // stamps only for uncalled single cards
        for (const [pid, stamp] of Object.entries(next.unoExposed)) {
          const len = (next.hands[pid] ?? []).length;
          if (len !== 1) throw new Error(`stamp on a hand of ${len} after ${pick.type}`);
          if (next.declaredUno.includes(pid)) throw new Error('stamp on a declared hand');
          if (stamp > next.turnSeq) throw new Error(`stamp in the future after ${pick.type}`);
        }
        state = next;
      }
    }
  });
});
