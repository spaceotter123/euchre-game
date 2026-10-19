// Computer players.
// "regular": sensible but simple Euchre with some guesswork.
// "classic": rule-of-thumb play that tracks cards and voids (the earlier Hard mode; kept for testing).
// "hard": searches. It deals out many possible layouts of the cards it can't see (matching
// everything shown so far), solves each layout exactly, and picks the bid, discard or card
// that scores best on average. Your partner and both opponents use it.
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const E = isNode ? require('./engine.js') : root.Euchre;
  const S = isNode ? require('./solver.js') : root.EuchreSolver;
  const { SUITS, RANK_VAL, SAME_COLOR, effSuit, power, isRight, isLeft, partnerOf, teamOf, nextSeat } = E;

  const CALL_THRESHOLD = 6.4;
  const TRUMP_VALUE = { A: 2.0, K: 1.7, Q: 1.4, '10': 1.2, '9': 1.1 };

  function trumpScore(c, t) {
    if (isRight(c, t)) return 3.1;
    if (isLeft(c, t)) return 2.6;
    return TRUMP_VALUE[c.r];
  }

  // Rough count of how strong a five-card hand is with suit t as trump.
  function handStrength(hand, t) {
    let s = 0;
    let n = 0;
    const off = {};
    for (const c of hand) {
      if (effSuit(c, t) === t) {
        s += trumpScore(c, t);
        n++;
      } else {
        (off[c.s] = off[c.s] || []).push(c);
      }
    }
    for (const suit in off) {
      const cs = off[suit];
      const hasA = cs.some((c) => c.r === 'A');
      if (hasA) s += cs.length === 1 ? 1.0 : 0.7;
      if (hasA && cs.some((c) => c.r === 'K')) s += 0.3;
      else if (!hasA && cs.length === 1 && cs[0].r === 'K') s += 0.3;
    }
    const voids = SUITS.filter((x) => x !== t && !off[x]).length;
    if (n >= 2) s += voids * 0.45;
    if (n >= 4) s += 0.5;
    return s;
  }

  // Dealer with six cards: strength after the best possible discard.
  function bestDiscard(six, t) {
    let best = null;
    for (const c of six) {
      const rest = six.filter((x) => x !== c);
      const s = handStrength(rest, t) - power(c, t, null) * 0.001;
      if (!best || s > best.s) best = { s, card: c, rest };
    }
    return best;
  }

  // Estimated tricks lost when playing without a partner; small means a safe loner.
  function loneLosers(hand, t) {
    const trumps = hand.filter((c) => effSuit(c, t) === t);
    const offs = hand.filter((c) => effSuit(c, t) !== t);
    const n = trumps.length;
    if (n < 3) return 9;
    const ladder = [
      (c) => isRight(c, t), (c) => isLeft(c, t),
      (c) => c.s === t && c.r === 'A', (c) => c.s === t && c.r === 'K', (c) => c.s === t && c.r === 'Q',
      (c) => c.s === t && c.r === '10', (c) => c.s === t && c.r === '9',
    ];
    let top = 0;
    for (const f of ladder) {
      if (trumps.some(f)) top++;
      else break;
    }
    const gap = n - top;
    let losers = gap === 0 ? 0 : top >= 2 ? 0.4 : top === 1 ? (n >= 4 ? 0.5 : 1) : 1.5;
    const offAces = offs.filter((c) => c.r === 'A').length;
    losers += offs.length - offAces;
    if (n === 3) losers += 0.2 * offAces;
    return losers;
  }

  function noise(level, rng, size) {
    return level !== 'regular' ? 0 : (rng() * 2 - 1) * size;
  }

  function heuristicBid(g, seat, level, rng) {
    rng = rng || Math.random;
    const hard = level !== 'regular';
    const opts = E.bidOptions(g, seat);
    const hand = g.hands[seat];

    if (opts.round === 1) {
      const t = g.upcard.s;
      let s;
      let fiveCards = hand;
      if (seat === g.dealer) {
        const b = bestDiscard(hand.concat([g.upcard]), t);
        s = b.s;
        fiveCards = b.rest;
      } else {
        s = handStrength(hand, t);
        const up = trumpScore(g.upcard, t);
        if (teamOf(seat) === teamOf(g.dealer)) s += hard ? up * 0.35 + 0.2 : 0.3;
        else s -= hard ? up * 0.4 + 0.2 : 0.2;
      }
      s += noise(level, rng, 1.2);
      if (opts.forcedAlone) {
        // Canadian Loner: ordering up the dealer means playing without a partner.
        const ok = hard ? loneLosers(hand, t) <= 1.2 || s >= 9 : s >= 8.5;
        return ok ? { type: 'order', alone: true } : { type: 'pass' };
      }
      if (s < CALL_THRESHOLD) return { type: 'pass' };
      return { type: 'order', alone: wantsAlone(fiveCards, t, level, rng) };
    }

    let best = null;
    for (const t of opts.suits) {
      let s = handStrength(hand, t);
      // "Next": the suit of the same color as the turned-down card is a good call for the player left of the dealer.
      if (hard && t === SAME_COLOR[g.turnedDown] && seat === nextSeat(g.dealer)) s += 0.4;
      if (hard && t !== SAME_COLOR[g.turnedDown] && seat === g.dealer) s += 0.2;
      if (!best || s > best.s) best = { s, t };
    }
    const s = best.s + noise(level, rng, 1.2);
    if (s < CALL_THRESHOLD && opts.canPass) return { type: 'pass' };
    return { type: 'call', suit: best.t, alone: wantsAlone(hand, best.t, level, rng) };
  }

  function wantsAlone(hand, t, level, rng) {
    const l = loneLosers(hand, t);
    if (level !== 'regular') return l <= 0.5;
    return l <= 0.2 && rng() < 0.8;
  }

  function heuristicDiscard(g, seat, level) {
    const hand = g.hands[seat];
    const t = g.trump;
    if (level !== 'regular') return bestDiscard(hand, t).card.id;
    const off = hand.filter((c) => effSuit(c, t) !== t);
    const pool = off.length ? off : hand;
    return pool.reduce((a, b) => (power(b, t, null) < power(a, t, null) ? b : a)).id;
  }

  // ---- Card play -------------------------------------------------------

  function unseenCards(g, seat) {
    const gone = new Set(g.played.map((c) => c.id));
    for (const c of g.hands[seat]) gone.add(c.id);
    if (g.turnedDown) gone.add(g.upcard.id);
    if (seat === g.dealer && g.discarded) gone.add(g.discarded.id);
    return E.makeDeck().filter((c) => !gone.has(c.id));
  }

  // Seats still to play in the current trick after this seat.
  function seatsAfter(g, seat) {
    const out = [];
    let s = seat;
    for (let i = g.trick.length + 1; i < E.activeCount(g); i++) {
      s = E.nextActive(g, s);
      out.push(s);
    }
    return out;
  }

  // Can any card still hidden beat this one, given who is left to play?
  function isSafe(card, g, seat, unseen, oppsAfter) {
    if (!oppsAfter.length) return true;
    const t = g.trump;
    const led = E.ledSuit(g) || effSuit(card, t);
    const mine = power(card, t, led);
    const suit = effSuit(card, t);
    const higherSame = unseen.some((c) => effSuit(c, t) === suit && power(c, t, led) > mine);
    if (higherSame && oppsAfter.some((s) => !g.voids[s][suit])) return false;
    if (suit !== t) {
      const trumpsOut = unseen.some((c) => effSuit(c, t) === t);
      if (trumpsOut && oppsAfter.some((s) => g.voids[s][suit] && !g.voids[s][t])) return false;
      // Late in the hand an off-suit card is likely to get trumped.
      if (trumpsOut && g.tricks.length >= 3) return false;
    }
    return true;
  }

  function lowest(cards, t) {
    return cards.reduce((a, b) => (power(b, t, null) < power(a, t, null) ? b : a));
  }
  function highest(cards, t, led) {
    return cards.reduce((a, b) => (power(b, t, led) > power(a, t, led) ? b : a));
  }

  // Pick the card we can best afford to lose.
  function throwAway(legal, g, seat, level, unseen) {
    const t = g.trump;
    if (level === 'regular') return lowest(legal, t);
    const hand = g.hands[seat];
    let best = null;
    for (const c of legal) {
      const suit = effSuit(c, t);
      let v = suit === t ? 50 + trumpScore(c, t) * 10 : RANK_VAL[c.r];
      if (suit !== t) {
        const higher = unseen.some((u) => effSuit(u, t) === suit && power(u, t, suit) > power(c, t, suit));
        if (!higher) v += 20;
        if (hand.filter((x) => effSuit(x, t) === suit).length === 1) v -= 0.5;
      }
      if (!best || v < best.v) best = { v, c };
    }
    return best.c;
  }

  function heuristicPlay(g, seat, level, rng) {
    rng = rng || Math.random;
    const legal = E.legalPlays(g, seat);
    if (legal.length === 1) return legal[0];
    if (level === 'regular' && rng() < 0.06) return legal[Math.floor(rng() * legal.length)];
    return g.trick.length === 0 ? chooseLead(g, seat, level, legal, rng) : chooseFollow(g, seat, level, legal);
  }

  function chooseLead(g, seat, level, legal, rng) {
    const t = g.trump;
    const trumps = legal.filter((c) => effSuit(c, t) === t);
    const offs = legal.filter((c) => effSuit(c, t) !== t);
    const ourCall = teamOf(g.maker) === teamOf(seat);

    if (level === 'regular') {
      const aces = offs.filter((c) => c.r === 'A');
      if (aces.length) return aces[0];
      if (ourCall && trumps.length && rng() < 0.6) return highest(trumps, t, t);
      return offs.length ? lowest(offs, t) : lowest(trumps, t);
    }

    const unseen = unseenCards(g, seat);
    const trumpsOut = unseen.filter((c) => effSuit(c, t) === t);
    const isBoss = (c) => {
      const suit = effSuit(c, t);
      return !unseen.some((u) => effSuit(u, t) === suit && power(u, t, suit) > power(c, t, suit));
    };
    const bossTrumps = trumps.filter(isBoss);
    const bossOffs = offs.filter(isBoss);

    if (ourCall) {
      if (bossTrumps.length && trumpsOut.length) return highest(bossTrumps, t, t);
      if (seat === g.maker && trumps.length >= 2 && trumpsOut.length) return highest(trumps, t, t);
      if (seat !== g.maker && trumps.length && g.tricks.length < 2) return highest(trumps, t, t);
      if (bossOffs.length) return bossOffs[0];
      if (g.alone && trumps.length) return highest(trumps, t, t);
    } else if (bossOffs.length) {
      return bossOffs[0];
    }

    if (offs.length) {
      // Lead low from the shortest side suit, hoping partner wins or we build a void.
      const partner = partnerOf(seat);
      const counts = {};
      for (const c of offs) counts[c.s] = (counts[c.s] || 0) + 1;
      const pool = offs.filter((c) => !g.voids[partner][c.s] || ourCall);
      const from = pool.length ? pool : offs;
      return from.reduce((a, b) => {
        if (counts[b.s] !== counts[a.s]) return counts[b.s] < counts[a.s] ? b : a;
        return RANK_VAL[b.r] < RANK_VAL[a.r] ? b : a;
      });
    }
    return lowest(trumps, t);
  }

  function chooseFollow(g, seat, level, legal) {
    const t = g.trump;
    const led = E.ledSuit(g);
    const win = E.trickWinner(g.trick, t);
    const winPow = power(win.card, t, led);
    const partnerWinning = win.seat === partnerOf(seat);
    const winners = legal.filter((c) => power(c, t, led) > winPow);
    const lowestWinner = () => winners.reduce((a, b) => (power(b, t, led) < power(a, t, led) ? b : a));

    if (level === 'regular') {
      if (partnerWinning || !winners.length) return lowest(legal, t);
      return lowestWinner();
    }

    const unseen = unseenCards(g, seat);
    const after = seatsAfter(g, seat);
    const oppsAfter = after.filter((s) => teamOf(s) !== teamOf(seat));
    const partnerAfter = after.includes(partnerOf(seat));
    const safeWinners = winners.filter((c) => isSafe(c, g, seat, unseen, oppsAfter));
    const cheapestSafe = safeWinners.length
      ? safeWinners.reduce((a, b) => (power(b, t, led) < power(a, t, led) ? b : a))
      : null;

    if (partnerWinning) {
      if (isSafe(win.card, g, seat, unseen, oppsAfter)) return throwAway(legal, g, seat, level, unseen);
      if (cheapestSafe) return cheapestSafe;
      return throwAway(legal, g, seat, level, unseen);
    }
    if (!winners.length) return throwAway(legal, g, seat, level, unseen);
    if (!oppsAfter.length) return lowestWinner();
    if (cheapestSafe) return cheapestSafe;
    // Second seat with partner still to come: hold back unless we can trump in.
    const w = lowestWinner();
    if (partnerAfter && effSuit(w, t) === led && led !== t) return throwAway(legal, g, seat, level, unseen);
    return w;
  }

  // ---- Hard: search over possible hidden hands -------------------------

  const SAMPLES = { bid: 40, discard: 24, play: 48 };
  const TIME_LIMIT_MS = 400;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // Points for the hand from `team`'s point of view, given the calling team's trick total.
  function handPoints(makerTricks, alone, makerTeam, team) {
    const pts = makerTricks >= 3 ? (makerTricks === 5 ? (alone ? 4 : 2) : 1) : -2;
    return team === makerTeam ? pts : -pts;
  }

  // Cards this seat can't see, and where some of them are known to be.
  function hiddenInfo(g, seat) {
    const known = new Set(g.hands[seat].map((c) => c.id));
    for (const c of g.played || []) known.add(c.id);
    const fixed = [[], [], [], []];
    if (g.turnedDown) known.add(g.upcard.id);
    else if (g.phase !== 'bid1' && seat !== g.dealer && g.sittingOut !== g.dealer && !known.has(g.upcard.id)) {
      // Everyone saw the dealer pick up the up card.
      fixed[g.dealer].push(g.upcard);
      known.add(g.upcard.id);
    } else if (g.phase === 'bid1' || g.sittingOut === g.dealer) {
      // Still face up on the kitty, or left there because the dealer sits out.
      known.add(g.upcard.id);
    }
    if (seat === g.dealer && g.discarded) known.add(g.discarded.id);
    const pool = E.makeDeck().filter((c) => !known.has(c.id));
    return { pool, fixed };
  }

  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // One random layout of the hidden cards that fits hand sizes and known voids.
  function sampleHands(g, seat, info, rng, sizes, voids) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const hands = [[], [], [], []];
      hands[seat] = g.hands[seat].slice();
      let pool = shuffled(info.pool, rng);
      const others = [0, 1, 2, 3].filter((s) => s !== seat && sizes[s] > 0);
      // Fill the most restricted players first.
      const eligible = (s, c) => !voids || !voids[s][E.effSuit(c, g.trump)];
      others.sort((a, b) => pool.filter((c) => eligible(a, c)).length - pool.filter((c) => eligible(b, c)).length);
      let ok = true;
      for (const s of others) {
        hands[s] = info.fixed[s].slice();
        const need = sizes[s] - hands[s].length;
        const pick = [];
        const rest = [];
        for (const c of pool) (pick.length < need && eligible(s, c) ? pick : rest).push(c);
        if (pick.length < need) { ok = false; break; }
        hands[s] = hands[s].concat(pick);
        pool = rest;
      }
      if (ok) return hands;
    }
    return null;
  }

  // Average points (for seat's team) of calling `trump`, by solving sampled deals.
  function callValue(g, seat, trump, alone, worlds) {
    const makerTeam = teamOf(seat);
    const sittingOut = alone ? partnerOf(seat) : -1;
    let total = 0;
    for (const w of worlds) {
      const hands = w.map((h) => h.slice());
      if (g.phase === 'bid1' && sittingOut !== g.dealer) {
        const six = hands[g.dealer].concat([g.upcard]);
        hands[g.dealer] = bestDiscard(six, trump).rest;
      }
      let leader = nextSeat(g.dealer);
      if (leader === sittingOut) leader = nextSeat(leader);
      const tricks = S.solve(hands, [], leader, trump, makerTeam, sittingOut);
      total += handPoints(tricks, alone, makerTeam, makerTeam);
    }
    return total / worlds.length;
  }

  // Calling is worth it when it beats letting the bidding go on.
  const CALL_MARGIN = { 1: 0.15, 2: 0.0 };

  function searchBid(g, seat, rng) {
    const opts = E.bidOptions(g, seat);
    const info = hiddenInfo(g, seat);
    const worlds = [];
    const start = now();
    for (let i = 0; i < SAMPLES.bid; i++) {
      const w = sampleHands(g, seat, info, rng, [5, 5, 5, 5], null);
      if (w) worlds.push(w);
    }
    const suits = opts.round === 1 ? [g.upcard.s] : opts.suits;
    let best = null;
    for (const t of suits) {
      const choices = opts.forcedAlone ? [true] : [false, true];
      for (const alone of choices) {
        if (alone && !opts.forcedAlone && best && best.t === t && best.v < 1) continue; // weak hands never go alone
        if (now() - start > TIME_LIMIT_MS * 2) break;
        const v = callValue(g, seat, t, alone, worlds);
        if (!best || v > best.v) best = { t, alone, v };
      }
    }
    if (!best || (best.v < CALL_MARGIN[opts.round] && opts.canPass)) return { type: 'pass' };
    return opts.round === 1 ? { type: 'order', alone: best.alone } : { type: 'call', suit: best.t, alone: best.alone };
  }

  function searchDiscard(g, seat, rng) {
    const info = hiddenInfo(g, seat);
    const sizes = [0, 1, 2, 3].map((s) => (s === g.sittingOut ? 0 : 5));
    sizes[seat] = 6;
    const worlds = [];
    for (let i = 0; i < SAMPLES.discard; i++) {
      const w = sampleHands(g, seat, info, rng, sizes, null);
      if (w) worlds.push(w);
    }
    const makerTeam = teamOf(g.maker);
    let best = null;
    for (const c of g.hands[seat]) {
      let total = 0;
      for (const w of worlds) {
        const hands = w.map((h) => h.slice());
        hands[seat] = g.hands[seat].filter((x) => x !== c);
        const tricks = S.solve(hands, [], E.nextActive(g, g.dealer), g.trump, makerTeam, g.sittingOut);
        total += handPoints(tricks, g.alone, makerTeam, teamOf(seat));
      }
      // Ties go to the weakest card.
      const v = total / worlds.length - power(c, g.trump, null) * 1e-4;
      if (!best || v > best.v) best = { v, c };
    }
    return best.c.id;
  }

  function searchPlay(g, seat, rng) {
    const legal = E.legalPlays(g, seat);
    if (legal.length === 1) return legal[0];
    const info = hiddenInfo(g, seat);
    const sizes = [0, 1, 2, 3].map((s) => (s === g.sittingOut ? 0 : g.hands[s].length));
    const makerTeam = teamOf(g.maker);
    const done = g.tricksWon[makerTeam];
    const totals = legal.map(() => 0);
    const start = now();
    let n = 0;
    for (let i = 0; i < SAMPLES.play; i++) {
      if (n >= 8 && now() - start > TIME_LIMIT_MS) break;
      const w = sampleHands(g, seat, info, rng, sizes, g.voids);
      if (!w) continue;
      const vals = S.moveValues(w, g.trick, seat, g.trump, makerTeam, g.sittingOut, legal);
      vals.forEach((v, k) => { totals[k] += handPoints(done + v, g.alone, makerTeam, teamOf(seat)); });
      n++;
    }
    if (!n) return heuristicPlay(g, seat, 'classic', rng);
    // Ties go to the cheapest card, keeping strong cards for later.
    let bestK = 0;
    for (let k = 1; k < legal.length; k++) {
      const diff = totals[k] - totals[bestK];
      if (diff > 1e-9 || (Math.abs(diff) <= 1e-9 && power(legal[k], g.trump, null) < power(legal[bestK], g.trump, null))) bestK = k;
    }
    return legal[bestK];
  }

  function chooseBid(g, seat, level, rng) {
    rng = rng || Math.random;
    return level === 'hard' ? searchBid(g, seat, rng) : heuristicBid(g, seat, level, rng);
  }
  function chooseDiscard(g, seat, level, rng) {
    rng = rng || Math.random;
    return level === 'hard' ? searchDiscard(g, seat, rng) : heuristicDiscard(g, seat, level);
  }
  function choosePlay(g, seat, level, rng) {
    rng = rng || Math.random;
    return level === 'hard' ? searchPlay(g, seat, rng) : heuristicPlay(g, seat, level, rng);
  }

  const EuchreAI = { chooseBid, chooseDiscard, choosePlay, handStrength, loneLosers };
  if (typeof module !== 'undefined' && module.exports) module.exports = EuchreAI;
  else root.EuchreAI = EuchreAI;
})(this);
