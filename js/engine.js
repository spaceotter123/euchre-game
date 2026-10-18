// Euchre rules engine: dealing, bidding, play and scoring.
// Seats go clockwise: 0 = you (south), 1 = West, 2 = your partner (north), 3 = East.
// Teams: seats 0 and 2 are team 0 ("Us"), seats 1 and 3 are team 1 ("Them").
(function (root) {
  'use strict';

  const SUITS = ['S', 'H', 'D', 'C'];
  const RANKS = ['9', '10', 'J', 'Q', 'K', 'A'];
  const RANK_VAL = { '9': 1, '10': 2, J: 3, Q: 4, K: 5, A: 6 };
  const SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SAME_COLOR = { S: 'C', C: 'S', H: 'D', D: 'H' };
  const SEAT_NAMES = ['You', 'West', 'Partner', 'East'];
  const WINNING_SCORE = 10;

  const nextSeat = (s) => (s + 1) % 4;
  const partnerOf = (s) => (s + 2) % 4;
  const teamOf = (s) => s % 2;

  function makeDeck() {
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ s, r, id: r + s });
    return deck;
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const isRight = (c, t) => c.r === 'J' && c.s === t;
  const isLeft = (c, t) => c.r === 'J' && c.s === SAME_COLOR[t];
  // The left bower counts as a trump card, not as its printed suit.
  const effSuit = (c, t) => (t && isLeft(c, t) ? t : c.s);

  // Higher number wins the trick. Cards that neither follow the led suit nor trump score low.
  function power(c, t, led) {
    if (t) {
      if (isRight(c, t)) return 200;
      if (isLeft(c, t)) return 199;
      if (c.s === t) return 150 + RANK_VAL[c.r];
    }
    if (effSuit(c, t) === led) return 100 + RANK_VAL[c.r];
    return RANK_VAL[c.r];
  }

  function cardName(c) {
    return c.r + SUIT_SYM[c.s];
  }

  function newGame(options) {
    return {
      options: Object.assign({ difficulty: 'regular', stickDealer: false, canadianLoner: false }, options),
      scores: [0, 0],
      dealer: Math.floor(Math.random() * 4),
      handNo: 0,
      phase: 'idle',
      winner: -1,
    };
  }

  function startHand(g, rng) {
    rng = rng || Math.random;
    g.handNo++;
    const deck = shuffle(makeDeck(), rng);
    g.hands = [[], [], [], []];
    for (let i = 0; i < 20; i++) g.hands[(g.dealer + 1 + i) % 4].push(deck[i]);
    g.kitty = deck.slice(20);
    g.upcard = g.kitty[0];
    g.phase = 'bid1';
    g.turn = nextSeat(g.dealer);
    g.passes = 0;
    g.trump = null;
    g.maker = -1;
    g.alone = false;
    g.sittingOut = -1;
    g.turnedDown = null;
    g.discarded = null;
    g.trick = [];
    g.tricks = [];
    g.tricksWon = [0, 0];
    g.played = [];
    g.voids = [{}, {}, {}, {}];
    g.say = {};
    g.lastResult = null;
    g.note = SEAT_NAMES[g.dealer] + (g.dealer === 0 ? ' deal.' : ' dealt.') + ' The up card is ' + cardName(g.upcard) + '.';
  }

  function setTrump(g, seat, suit, alone) {
    g.trump = suit;
    g.maker = seat;
    g.alone = alone;
    g.sittingOut = alone ? partnerOf(seat) : -1;
  }

  function bidOptions(g, seat) {
    const o = g.options;
    if (g.phase === 'bid1') {
      const forcedAlone = o.canadianLoner && seat === partnerOf(g.dealer);
      return { round: 1, canPass: true, forcedAlone, suit: g.upcard.s };
    }
    const stuck = o.stickDealer && seat === g.dealer;
    return { round: 2, canPass: !stuck, suits: SUITS.filter((s) => s !== g.turnedDown), forcedAlone: false };
  }

  // action: { type: 'pass' } | { type: 'order', alone } (round 1) | { type: 'call', suit, alone } (round 2)
  function bid(g, seat, action) {
    if (seat !== g.turn) throw new Error('Not this seat\'s turn to bid');
    const opts = bidOptions(g, seat);
    const who = SEAT_NAMES[seat];
    if (action.type === 'pass') {
      if (!opts.canPass) throw new Error('The dealer must name trump');
      g.say[seat] = 'Pass';
      g.note = who + (seat === 0 ? ' pass.' : ' passed.');
      g.passes++;
      if (g.passes < 4) {
        g.turn = nextSeat(seat);
      } else if (g.phase === 'bid1') {
        g.phase = 'bid2';
        g.turnedDown = g.upcard.s;
        g.passes = 0;
        g.turn = nextSeat(g.dealer);
        g.say = {};
        g.note = 'Everyone passed. The ' + cardName(g.upcard) + ' is turned down. Name any other suit as trump.';
      } else {
        g.phase = 'misdeal';
        g.turn = -1;
        g.note = 'Everyone passed again, so nobody plays this hand. The deal moves to ' + SEAT_NAMES[nextSeat(g.dealer)] + '.';
      }
      return;
    }

    let alone = !!action.alone || opts.forcedAlone;
    if (g.phase === 'bid1') {
      setTrump(g, seat, g.upcard.s, alone);
      const verb = seat === g.dealer ? 'Picked it up' : 'Order up';
      g.say[seat] = verb + (alone ? ', alone' : '');
      g.note = who + (seat === g.dealer ? (seat === 0 ? ' pick up ' : ' picked up ') : (seat === 0 ? ' order up ' : ' ordered up '))
        + SUIT_NAME[g.trump] + (alone ? ' and ' + (seat === 0 ? 'go' : 'goes') + ' alone' : '') + '.';
      if (opts.forcedAlone && !action.alone) g.note += ' Canadian Loner: ordering up your partner means playing alone.';
      if (g.sittingOut === g.dealer) {
        startPlay(g);
      } else {
        g.hands[g.dealer].push(g.upcard);
        g.phase = 'discard';
        g.turn = g.dealer;
      }
      return;
    }

    if (!opts.suits.includes(action.suit)) throw new Error('That suit was turned down');
    setTrump(g, seat, action.suit, alone);
    g.say[seat] = SUIT_SYM[action.suit] + ' ' + SUIT_NAME[action.suit] + (alone ? ', alone' : '');
    g.note = who + (seat === 0 ? ' call ' : ' called ') + SUIT_NAME[g.trump] + (alone ? ' and ' + (seat === 0 ? 'go' : 'goes') + ' alone' : '') + '.';
    startPlay(g);
  }

  function discard(g, seat, cardId) {
    if (g.phase !== 'discard' || seat !== g.dealer) throw new Error('No discard expected');
    const hand = g.hands[seat];
    const i = hand.findIndex((c) => c.id === cardId);
    if (i < 0) throw new Error('Card not in hand');
    g.discarded = hand.splice(i, 1)[0];
    startPlay(g);
  }

  function nextActive(g, s) {
    let n = nextSeat(s);
    if (n === g.sittingOut) n = nextSeat(n);
    return n;
  }

  function activeCount(g) {
    return g.sittingOut >= 0 ? 3 : 4;
  }

  function startPlay(g) {
    g.phase = 'play';
    g.say = {};
    g.leader = nextActive(g, g.dealer);
    g.turn = g.leader;
    g.trick = [];
  }

  function ledSuit(g) {
    return g.trick.length ? effSuit(g.trick[0].card, g.trump) : null;
  }

  function legalPlays(g, seat) {
    const hand = g.hands[seat];
    const led = ledSuit(g);
    if (!led) return hand.slice();
    const follow = hand.filter((c) => effSuit(c, g.trump) === led);
    return follow.length ? follow : hand.slice();
  }

  function trickWinner(trick, t) {
    const led = effSuit(trick[0].card, t);
    let best = trick[0];
    for (const p of trick) if (power(p.card, t, led) > power(best.card, t, led)) best = p;
    return best;
  }

  function play(g, seat, cardId) {
    if (g.phase !== 'play' || seat !== g.turn) throw new Error('Not this seat\'s turn to play');
    const legal = legalPlays(g, seat);
    const card = legal.find((c) => c.id === cardId);
    if (!card) throw new Error('You must follow suit');
    const led = ledSuit(g);
    if (led && effSuit(card, g.trump) !== led) g.voids[seat][led] = true;
    const hand = g.hands[seat];
    hand.splice(hand.indexOf(card), 1);
    g.trick.push({ seat, card });
    g.played.push(card);
    if (g.trick.length === activeCount(g)) {
      const w = trickWinner(g.trick, g.trump).seat;
      g.tricksWon[teamOf(w)]++;
      g.tricks.push({ cards: g.trick.slice(), winner: w });
      g.trickWinner = w;
      g.phase = 'trickDone';
      g.turn = -1;
    } else {
      g.turn = nextActive(g, seat);
    }
  }

  function collectTrick(g) {
    if (g.phase !== 'trickDone') return;
    if (g.tricks.length === 5) {
      scoreHand(g);
      return;
    }
    g.trick = [];
    g.leader = g.trickWinner;
    g.turn = g.trickWinner;
    g.phase = 'play';
  }

  function scoreHand(g) {
    const mt = teamOf(g.maker);
    const won = g.tricksWon[mt];
    let team, pts, kind;
    if (won >= 3) {
      team = mt;
      kind = won === 5 ? 'march' : 'made';
      pts = won === 5 ? (g.alone ? 4 : 2) : 1;
    } else {
      team = 1 - mt;
      kind = 'euchred';
      pts = 2;
    }
    g.scores[team] += pts;
    g.lastResult = { team, pts, kind, makerTeam: mt, makerTricks: won, alone: g.alone, maker: g.maker };
    if (g.scores[team] >= WINNING_SCORE) {
      g.phase = 'gameOver';
      g.winner = team;
    } else {
      g.phase = 'handOver';
    }
    g.turn = -1;
  }

  function nextHand(g, rng) {
    g.dealer = nextSeat(g.dealer);
    startHand(g, rng);
  }

  const Euchre = {
    SUITS, RANKS, RANK_VAL, SUIT_NAME, SUIT_SYM, SAME_COLOR, SEAT_NAMES, WINNING_SCORE,
    nextSeat, partnerOf, teamOf, makeDeck, isRight, isLeft, effSuit, power, cardName,
    newGame, startHand, bidOptions, bid, discard, legalPlays, ledSuit, trickWinner, play,
    collectTrick, nextHand, nextActive, activeCount,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Euchre;
  else root.Euchre = Euchre;
})(this);
