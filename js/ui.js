// Draws the table and runs the turn loop: computer seats act on a timer, you act by clicking.
(function () {
  'use strict';
  const E = window.Euchre;
  const AI = window.EuchreAI;
  const { SUIT_SYM, SUIT_NAME, SEAT_NAMES } = E;
  const RED = { H: true, D: true };
  // "#fast" in the address speeds the computer players up (handy for testing).
  const DELAY = location.hash === '#fast' ? { bid: 20, play: 20, trick: 40 } : { bid: 800, play: 650, trick: 1300 };
  const SETTINGS_KEY = 'kte-settings';

  let g = null;
  let timer = null;
  let goAlone = false;

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const suitHtml = (s) => `<span class="${RED[s] ? 'sym-red red' : ''}">${SUIT_SYM[s]}</span>`;
  const teamLabel = (t) => (t === 0 ? 'Us' : 'Them');
  const seatsLabel = (t) => (t === 0 ? 'You and Partner' : 'West and East');

  // ---- Settings ----
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (s && typeof s === 'object') return s;
    } catch (e) { /* storage unavailable */ }
    return { difficulty: 'regular', stickDealer: false, canadianLoner: false };
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ }
  }

  // ---- Cards ----
  function cardEl(c, opts) {
    opts = opts || {};
    const b = el('button', 'card' + (RED[c.s] ? ' red' : ''));
    b.type = 'button';
    b.dataset.id = c.id;
    b.setAttribute('aria-label', c.r + ' of ' + SUIT_NAME[c.s]);
    b.innerHTML = `<span class="corner">${c.r}<small>${SUIT_SYM[c.s]}</small></span><span class="pip">${SUIT_SYM[c.s]}</span>`;
    if (g && g.trump && opts.tags !== false) {
      if (E.isRight(c, g.trump)) b.insertAdjacentHTML('beforeend', '<span class="tag">Right</span>');
      else if (E.isLeft(c, g.trump)) b.insertAdjacentHTML('beforeend', '<span class="tag">Left</span>');
    }
    if (!opts.interactive) b.tabIndex = -1;
    return b;
  }
  const backEl = () => el('div', 'back');

  function sortHand(hand) {
    const t = g.trump;
    const order = t ? [t].concat(['S', 'H', 'C', 'D'].filter((s) => s !== t)) : ['S', 'H', 'C', 'D'];
    return hand.slice().sort((a, b) => {
      const sa = order.indexOf(E.effSuit(a, t));
      const sb = order.indexOf(E.effSuit(b, t));
      if (sa !== sb) return sa - sb;
      const led = E.effSuit(a, t);
      return E.power(b, t, led) - E.power(a, t, led);
    });
  }

  // ---- Rendering ----
  function render() {
    $('scoreUs').textContent = g ? g.scores[0] : 0;
    $('scoreThem').textContent = g ? g.scores[1] : 0;
    renderStrip();
    for (const s of [1, 2, 3]) renderSeat(s);
    renderCenter();
    renderHand();
    renderPanel();
  }

  function renderStrip() {
    const strip = $('strip');
    if (!g || !g.hands) { strip.innerHTML = ''; return; }
    const o = g.options;
    const parts = [`Dealer <b>${SEAT_NAMES[g.dealer]}</b>`];
    if (g.trump) {
      parts.push(`Trump <b class="trump-sym ${RED[g.trump] ? 'red' : ''}">${SUIT_SYM[g.trump]}</b> <b>${SUIT_NAME[g.trump]}</b>`);
      parts.push(`Called by <b>${SEAT_NAMES[g.maker]}${g.alone ? ' (alone)' : ''}</b>`);
      parts.push(`Tricks <b>Us ${g.tricksWon[0]}</b> · <b>Them ${g.tricksWon[1]}</b>`);
    }
    const rules = [o.difficulty === 'hard' ? 'Hard' : 'Regular'];
    if (o.stickDealer) rules.push('Stick the Dealer');
    if (o.canadianLoner) rules.push('Canadian Loner');
    parts.push(rules.join(' · '));
    strip.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
  }

  function renderSeat(s) {
    const box = $('seat' + s);
    box.innerHTML = '';
    if (!g || !g.hands) {
      box.appendChild(el('div', 'nameplate', SEAT_NAMES[s]));
      return;
    }
    const plate = el('div', 'nameplate' + (g.turn === s ? ' turn' : '') + (g.sittingOut === s ? ' out' : ''));
    plate.textContent = SEAT_NAMES[s];
    if (g.dealer === s) plate.insertAdjacentHTML('beforeend', '<span class="chip" title="Dealer">D</span>');
    if (g.maker === s) plate.insertAdjacentHTML('beforeend', `<span class="chip maker">${g.alone ? 'Alone' : 'Called'}</span>`);
    box.appendChild(plate);
    const backs = el('div', 'backs');
    if (g.sittingOut === s) {
      backs.appendChild(el('span', 'bubble', 'Sitting out'));
    } else {
      for (let i = 0; i < g.hands[s].length; i++) backs.appendChild(backEl());
    }
    box.appendChild(backs);
  }

  function renderCenter() {
    const c = $('center');
    c.innerHTML = '';
    if (!g || !g.hands) return;
    const trick = el('div', 'trick');
    const winner = g.phase === 'trickDone' ? g.trickWinner : -1;
    for (const s of [0, 1, 2, 3]) {
      const slot = el('div', 'slot s' + s + (winner === s ? ' won' : ''));
      const p = g.trick && g.trick.find((x) => x.seat === s);
      if (p) {
        const ce = cardEl(p.card);
        if (p === g.trick[g.trick.length - 1] && g.phase !== 'trickDone') ce.classList.add('fresh');
        slot.appendChild(ce);
      }
      else if (g.say[s]) slot.appendChild(bubbleEl(s === 0 ? 'You: ' + g.say[s] : g.say[s]));
      trick.appendChild(slot);
    }
    const mid = el('div', 'mid');
    if (g.phase === 'bid1') {
      mid.appendChild(kittyEl(true));
    } else if (g.phase === 'bid2') {
      mid.appendChild(kittyEl(false));
    } else if (g.phase === 'trickDone') {
      mid.textContent = (g.trickWinner === 0 ? 'You take' : SEAT_NAMES[g.trickWinner] + ' takes') + ' it';
    }
    trick.appendChild(mid);
    c.appendChild(trick);
  }

  function bubbleEl(text) {
    const b = el('span', 'bubble');
    b.innerHTML = text.replace(/[♥♦]/g, (m) => `<span class="red">${m}</span>`);
    return b;
  }

  function kittyEl(faceUp) {
    const k = el('div', 'kitty');
    const stack = el('div', 'stack');
    stack.appendChild(backEl());
    if (faceUp) stack.appendChild(cardEl(g.upcard, { tags: false }));
    else {
      const b = backEl();
      b.style.position = 'absolute';
      b.style.inset = '0';
      b.style.width = 'var(--cw)';
      b.style.height = 'var(--ch)';
      stack.appendChild(b);
    }
    k.appendChild(stack);
    k.appendChild(el('span', 'caption', faceUp ? 'Up card' : 'Turned down ' + SUIT_SYM[g.turnedDown]));
    return k;
  }

  function renderHand() {
    const box = $('hand0');
    box.innerHTML = '';
    box.classList.toggle('out', !!g && g.sittingOut === 0);
    if (!g || !g.hands) return;
    const myTurn = g.turn === 0;
    let playable = new Set();
    if (myTurn && g.phase === 'play') playable = new Set(E.legalPlays(g, 0).map((c) => c.id));
    if (myTurn && g.phase === 'discard') playable = new Set(g.hands[0].map((c) => c.id));
    for (const c of sortHand(g.hands[0])) {
      const interactive = playable.has(c.id);
      const b = cardEl(c, { interactive });
      if (interactive) {
        b.classList.add('playable');
        b.addEventListener('click', () => onCard(c.id));
      } else if (myTurn && g.phase === 'play') {
        b.classList.add('dim');
        b.disabled = true;
      }
      box.appendChild(b);
    }
  }

  function button(label, cls, onClick, disabled) {
    const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderPanel() {
    const p = $('panel');
    p.innerHTML = '';
    const msg = el('p', 'msg');
    const actions = el('div', 'actions');
    p.appendChild(msg);

    if (!g || g.phase === 'idle') {
      msg.textContent = 'Pick a difficulty and house rules, then deal.';
      actions.appendChild(button('Start a game', 'primary', openSetup));
      p.appendChild(actions);
      return;
    }

    const note = g.note || '';
    const myTurn = g.turn === 0;

    switch (g.phase) {
      case 'bid1': {
        if (!myTurn) { msg.textContent = note + ' ' + SEAT_NAMES[g.turn] + ' is deciding…'; break; }
        const opts = E.bidOptions(g, 0);
        const s = g.upcard.s;
        const dealerIsMe = g.dealer === 0;
        const who = dealerIsMe ? 'yourself' : g.dealer === 2 ? 'your partner' : SEAT_NAMES[g.dealer];
        msg.innerHTML = `${escapeHtml(note)} Make ${suitHtml(s)} <strong>${SUIT_NAME[s]}</strong> trump and give the ${E.cardName(g.upcard)} to ${who}?`;
        actions.appendChild(button('Pass', '', () => human({ type: 'pass' })));
        if (opts.forcedAlone) {
          actions.appendChild(button('Order up and go alone', 'primary', () => human({ type: 'order', alone: true })));
          msg.innerHTML += ' <br>Canadian Loner is on, so ordering up your partner means you play alone.';
        } else {
          actions.appendChild(button(dealerIsMe ? 'Pick it up' : 'Order it up', 'primary', () => human({ type: 'order', alone: false })));
          actions.appendChild(button(dealerIsMe ? 'Pick it up, go alone' : 'Order up, go alone', '', () => human({ type: 'order', alone: true })));
        }
        break;
      }
      case 'bid2': {
        if (!myTurn) { msg.textContent = note + ' ' + SEAT_NAMES[g.turn] + ' is deciding…'; break; }
        const opts = E.bidOptions(g, 0);
        msg.innerHTML = escapeHtml(note) + (opts.canPass ? ' Name a trump suit or pass.' : ' <strong>Stick the Dealer:</strong> everyone passed, so you must name trump.');
        for (const s of opts.suits) {
          actions.appendChild(button(`${suitHtml(s)} ${SUIT_NAME[s]}`, 'suit', () => human({ type: 'call', suit: s, alone: goAlone })));
        }
        if (opts.canPass) actions.appendChild(button('Pass', '', () => human({ type: 'pass' })));
        const t = el('label', 'toggle');
        t.innerHTML = '<input type="checkbox" id="goAlone"><span>Go alone</span>';
        t.querySelector('input').checked = goAlone;
        t.querySelector('input').addEventListener('change', (e) => { goAlone = e.target.checked; });
        p.appendChild(actions);
        p.appendChild(t);
        return;
      }
      case 'discard':
        if (!myTurn) { msg.textContent = note + ' ' + SEAT_NAMES[g.dealer] + ' is picking a card to discard…'; break; }
        msg.innerHTML = `${escapeHtml(note)} You picked up the ${E.cardName(g.upcard)}. <strong>Tap a card in your hand to discard it.</strong>`;
        break;
      case 'play': {
        const lead = g.trick.length === 0;
        if (!myTurn) {
          msg.textContent = (g.tricks.length === 0 && lead ? note + ' ' : '') + SEAT_NAMES[g.turn] + (lead ? ' leads…' : ' is playing…');
          break;
        }
        if (lead) msg.innerHTML = (g.tricks.length === 0 ? escapeHtml(note) + ' ' : '') + '<strong>Your lead.</strong> Tap any card.';
        else {
          const led = E.ledSuit(g);
          const follow = g.hands[0].some((c) => E.effSuit(c, g.trump) === led);
          msg.innerHTML = follow
            ? `<strong>Your turn.</strong> ${SUIT_NAME[led]} were led, so you must follow suit.`
            : `<strong>Your turn.</strong> You have no ${SUIT_NAME[led]}, so you can trump in or throw off any card.`;
        }
        break;
      }
      case 'trickDone':
        msg.textContent = (g.trickWinner === 0 ? 'You take' : SEAT_NAMES[g.trickWinner] + ' takes') + ' the trick.';
        break;
      case 'misdeal':
        msg.textContent = note;
        actions.appendChild(button('Deal next hand', 'primary', () => { E.nextHand(g); advance(); }));
        break;
      case 'handOver':
      case 'gameOver': {
        const r = g.lastResult;
        let text;
        const makerName = r.maker === 0 ? 'You' : SEAT_NAMES[r.maker];
        if (r.kind === 'euchred') {
          text = `${seatsLabel(r.team)} euchred ${r.maker === 0 ? 'you' : makerName}! ${r.makerTricks} trick${r.makerTricks === 1 ? '' : 's'} was not enough. ${teamLabel(r.team)} +2.`;
        } else if (r.kind === 'march') {
          text = `${r.alone ? makerName + ' went alone and took' : seatsLabel(r.team) + ' took'} all 5 tricks. ${teamLabel(r.team)} +${r.pts}.`;
        } else {
          text = `${r.alone ? makerName + ' went alone and took' : seatsLabel(r.team) + ' took'} ${r.makerTricks} tricks. ${teamLabel(r.team)} +1.`;
        }
        if (g.phase === 'gameOver') {
          msg.innerHTML = escapeHtml(text) + `<br><strong>${g.winner === 0 ? 'You and your partner win' : 'West and East win'} ${g.scores[g.winner]} to ${g.scores[1 - g.winner]}.</strong>`;
          actions.appendChild(button('Play again', 'primary', () => startGame(g.options)));
          actions.appendChild(button('Change options', '', openSetup));
        } else {
          msg.textContent = text;
          actions.appendChild(button('Next hand', 'primary', () => { E.nextHand(g); advance(); }));
        }
        break;
      }
    }
    if (actions.childNodes.length) p.appendChild(actions);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }

  // ---- Turn loop ----
  function schedule(fn, ms) {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  }

  function advance() {
    clearTimeout(timer);
    render();
    if (!g) return;
    const lvl = g.options.difficulty;
    const seat = g.turn;
    if ((g.phase === 'bid1' || g.phase === 'bid2') && seat !== 0) {
      schedule(() => { E.bid(g, seat, AI.chooseBid(g, seat, lvl)); advance(); }, DELAY.bid);
    } else if (g.phase === 'discard' && seat !== 0) {
      schedule(() => { E.discard(g, seat, AI.chooseDiscard(g, seat, lvl)); advance(); }, DELAY.bid);
    } else if (g.phase === 'play' && seat !== 0) {
      schedule(() => { E.play(g, seat, AI.choosePlay(g, seat, lvl).id); advance(); }, DELAY.play);
    } else if (g.phase === 'trickDone') {
      schedule(() => { E.collectTrick(g); advance(); }, DELAY.trick);
    }
  }

  function human(action) {
    if (!g || g.turn !== 0) return;
    E.bid(g, 0, action);
    goAlone = false;
    advance();
  }

  function onCard(id) {
    if (!g || g.turn !== 0) return;
    if (g.phase === 'discard') E.discard(g, 0, id);
    else if (g.phase === 'play') E.play(g, 0, id);
    else return;
    advance();
  }

  function startGame(options) {
    g = E.newGame(options);
    E.startHand(g);
    goAlone = false;
    advance();
  }

  // ---- Options sheet ----
  function openSetup() {
    const s = g ? g.options : loadSettings();
    $(s.difficulty === 'hard' ? 'diffHard' : 'diffRegular').checked = true;
    $('optStick').checked = !!s.stickDealer;
    $('optCanadian').checked = !!s.canadianLoner;
    const inGame = !!g && g.phase !== 'gameOver';
    $('setupCancel').hidden = !inGame;
    $('setupNote').hidden = !inGame;
    $('setupStart').textContent = inGame ? 'Start new game' : 'Deal';
    $('setup').hidden = false;
    $('setupStart').focus();
  }
  function closeSetup() {
    $('setup').hidden = true;
  }

  $('setupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const opts = {
      difficulty: $('diffHard').checked ? 'hard' : 'regular',
      stickDealer: $('optStick').checked,
      canadianLoner: $('optCanadian').checked,
    };
    saveSettings(opts);
    closeSetup();
    startGame(opts);
  });
  $('setupCancel').addEventListener('click', closeSetup);
  $('optionsBtn').addEventListener('click', openSetup);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('setup').hidden && g) closeSetup();
  });

  // ---- Boot (keeps a game in progress across live page updates) ----
  function boot(data) {
    if (data && data.g) {
      g = data.g;
      advance();
    } else {
      render();
      openSetup();
    }
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ g }));
  if (hot && hot.ready) hot.ready(boot);
  else boot(hot && hot.data ? hot.data : {});
})();
