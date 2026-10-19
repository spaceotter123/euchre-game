// Exact solver for a Euchre hand when every card's location is known ("double dummy").
// It returns how many of the remaining tricks the calling team takes when both sides
// play perfectly. Hard mode runs it on many guesses of the hidden cards.
(function (root) {
  'use strict';
  const E = typeof module !== 'undefined' && module.exports ? require('./engine.js') : root.Euchre;

  const SUITS = E.SUITS;
  const RANKS = E.RANKS;
  // Card number: suitIndex * 6 + rankIndex.
  const cardNum = (c) => SUITS.indexOf(c.s) * 6 + RANKS.indexOf(c.r);
  const DECK = E.makeDeck();

  // Per-trump tables: effective suit and trick-taking power for each led suit.
  const tables = {};
  function tableFor(t) {
    if (tables[t]) return tables[t];
    const eff = new Int8Array(24);
    const pow = new Int16Array(24 * 4);
    for (let n = 0; n < 24; n++) {
      const c = DECK[n];
      eff[n] = SUITS.indexOf(E.effSuit(c, t));
      for (let l = 0; l < 4; l++) pow[n * 4 + l] = E.power(c, t, SUITS[l]);
    }
    tables[t] = { eff, pow };
    return tables[t];
  }

  // hands: four arrays of cards (objects), trick: [{seat, card}], turn: seat to act.
  // Returns the calling team's tricks from here on, with perfect play by everyone.
  function solve(hands, trick, turn, trump, makerTeam, sittingOut) {
    const ctx = setup(hands, trick, turn, trump, makerTeam, sittingOut);
    return ctx.run();
  }

  // Value (calling team's remaining tricks) of each legal card for the player on turn.
  function moveValues(hands, trick, turn, trump, makerTeam, sittingOut, legal) {
    const ctx = setup(hands, trick, turn, trump, makerTeam, sittingOut);
    return legal.map((c) => ctx.runAfter(cardNum(c)));
  }

  function setup(hands, trick, turn, trump, makerTeam, sittingOut) {
    const { eff, pow } = tableFor(trump);
    const active = sittingOut >= 0 ? 3 : 4;
    const h = hands.map((cs) => cs.map(cardNum));
    let mask = 0;
    for (let s = 0; s < 4; s++) if (s !== sittingOut) for (const n of h[s]) mask |= 1 << n;
    const memo = new Map();
    const tSeat = trick.map((p) => p.seat);
    const tCard = trick.map((p) => cardNum(p.card));
    const next = (s) => {
      let n = (s + 1) % 4;
      if (n === sittingOut) n = (n + 1) % 4;
      return n;
    };

    // Exact value at the start of a trick, led by `leader`, with `mask` cards left.
    function exact(leader, m) {
      if (m === 0) return 0;
      const key = m * 4 + leader;
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      const left = popcount(m) / active;
      const v = trickSearch(leader, m, [], [], -1, left + 1, left);
      memo.set(key, v);
      return v;
    }

    // Minimax inside one trick with alpha-beta; tricks finished go to exact().
    function trickSearch(player, m, seats, cards, alpha, beta, left) {
      const led = cards.length ? eff[cards[0]] : -1;
      const hand = h[player];
      let moves = [];
      for (const n of hand) if (m & (1 << n)) moves.push(n);
      if (led >= 0) {
        const follow = moves.filter((n) => eff[n] === led);
        if (follow.length) moves = follow;
      }
      const maxing = player % 2 === makerTeam;
      let best = maxing ? -1 : left + 1;
      for (const n of moves) {
        const m2 = m & ~(1 << n);
        seats.push(player);
        cards.push(n);
        let v;
        if (cards.length === active) {
          const l = eff[cards[0]];
          let w = 0;
          for (let i = 1; i < active; i++) if (pow[cards[i] * 4 + l] > pow[cards[w] * 4 + l]) w = i;
          const ws = seats[w];
          v = (ws % 2 === makerTeam ? 1 : 0) + exact(ws, m2);
        } else {
          v = trickSearch(next(player), m2, seats, cards, alpha, beta, left);
        }
        seats.pop();
        cards.pop();
        if (maxing) {
          if (v > best) best = v;
          if (best > alpha) alpha = best;
        } else {
          if (v < best) best = v;
          if (best < beta) beta = best;
        }
        if (alpha >= beta) break;
      }
      return best;
    }

    // Finish the trick already in progress, then continue.
    function fromCurrent(m, seats, cards, player) {
      const left = (popcount(m) + cards.length) / active;
      if (cards.length === 0) return exact(player, m);
      return trickSearch(player, m, seats.slice(), cards.slice(), -1, left + 1, left);
    }

    return {
      run: () => fromCurrent(mask, tSeat, tCard, turn),
      runAfter: (n) => {
        const m2 = mask & ~(1 << n);
        const seats = tSeat.concat([turn]);
        const cards = tCard.concat([n]);
        if (cards.length === active) {
          const l = eff[cards[0]];
          let w = 0;
          for (let i = 1; i < active; i++) if (pow[cards[i] * 4 + l] > pow[cards[w] * 4 + l]) w = i;
          const ws = seats[w];
          return (ws % 2 === makerTeam ? 1 : 0) + exact(ws, m2);
        }
        return fromCurrent(m2, seats, cards, next(turn));
      },
    };
  }

  function popcount(x) {
    x -= (x >>> 1) & 0x55555555;
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  const EuchreSolver = { solve, moveValues };
  if (typeof module !== 'undefined' && module.exports) module.exports = EuchreSolver;
  else root.EuchreSolver = EuchreSolver;
})(this);
