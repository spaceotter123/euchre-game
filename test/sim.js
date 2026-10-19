// Plays computer-vs-computer games to check the rules engine and compare difficulty levels.
'use strict';
const E = require('../js/engine.js');
const AI = require('../js/ai.js');

function playGame(levels, options) {
  const g = E.newGame(options);
  E.startHand(g);
  let guard = 0;
  while (g.phase !== 'gameOver') {
    if (++guard > 20000) throw new Error('Game did not finish');
    const lvl = levels[E.teamOf(g.turn < 0 ? 0 : g.turn)];
    switch (g.phase) {
      case 'bid1':
      case 'bid2':
        E.bid(g, g.turn, AI.chooseBid(g, g.turn, lvl));
        break;
      case 'discard':
        E.discard(g, g.turn, AI.chooseDiscard(g, g.turn, lvl));
        break;
      case 'play':
        E.play(g, g.turn, AI.choosePlay(g, g.turn, lvl).id);
        break;
      case 'trickDone':
        E.collectTrick(g);
        break;
      case 'handOver':
      case 'misdeal':
        E.nextHand(g);
        break;
      default:
        throw new Error('Unexpected phase ' + g.phase);
    }
  }
  return g;
}

// Usage: node test/sim.js [games] [levelA] [levelB]
const games = Number(process.argv[2]) || 2000;
const A = process.argv[3] || 'hard';
const B = process.argv[4] || 'regular';
const variants = [
  { name: 'standard', options: {} },
  { name: 'stick the dealer + canadian loner', options: { stickDealer: true, canadianLoner: true } },
];
for (const v of variants) {
  let aWins = 0;
  let aPts = 0;
  let bPts = 0;
  const t0 = Date.now();
  for (let i = 0; i < games; i++) {
    // Alternate seats so seat order can't skew the result.
    const aTeam = i % 2;
    const levels = aTeam === 0 ? [A, B] : [B, A];
    const g = playGame(levels, v.options);
    if (g.winner === aTeam) aWins++;
    aPts += g.scores[aTeam];
    bPts += g.scores[1 - aTeam];
  }
  console.log(`${v.name}: ${A} beat ${B} in ${aWins}/${games} games (${(100 * aWins / games).toFixed(1)}%), points ${aPts}-${bPts}, ${((Date.now() - t0) / games).toFixed(0)} ms/game`);
}
