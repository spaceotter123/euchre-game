// Plays computer-vs-computer games to check the rules engine and compare difficulty levels.
// Usage: node test/sim.js [games]
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
  return g.winner;
}

const games = Number(process.argv[2]) || 2000;
const variants = [
  { name: 'standard', options: {} },
  { name: 'stick the dealer + canadian loner', options: { stickDealer: true, canadianLoner: true } },
];
for (const v of variants) {
  let hardWins = 0;
  for (let i = 0; i < games; i++) {
    // Alternate which team is hard so seat order can't skew the result.
    const hardTeam = i % 2;
    const levels = hardTeam === 0 ? ['hard', 'regular'] : ['regular', 'hard'];
    if (playGame(levels, v.options) === hardTeam) hardWins++;
  }
  console.log(`${v.name}: hard beat regular in ${hardWins}/${games} games (${(100 * hardWins / games).toFixed(1)}%)`);
}
