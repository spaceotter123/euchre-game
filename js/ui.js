// Draws the table and runs the turn loop: computer seats act on a timer, you act by clicking.
(function () {
  'use strict';
  const E = window.Euchre;
  const AI = window.EuchreAI;
  const { SUIT_SYM, SUIT_NAME, SEAT_NAMES } = E;
  const RED = { H: true, D: true };
  // "#fast" in the address speeds the computer players up (handy for testing).
  const FAST = location.hash === '#fast';
  const DELAY = FAST ? { bid: 20, play: 20, trick: 40, draw: 10 } : { bid: 1100, play: 950, trick: 1500, draw: 380 };
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

  // ---- Motion ----
  // The table is redrawn after every move, so animations work by remembering where
  // things were just before the redraw and sliding them from there ("FLIP").
  const motionOK = () => !FAST && typeof Element.prototype.animate === 'function'
    && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const EASE = 'cubic-bezier(.2,.7,.2,1)';
  let flyFrom = null; // { seat, rect }: where the card just played came from
  let pickupFrom = null; // rect of the up card just before the dealer took it
  let dealtHand = 0; // last hand whose deal was animated
  let lastScores = [0, 0];
  const seen = new Set(); // markers already on screen, so only new ones pop in

  const rectOf = (node) => node && node.getBoundingClientRect();
  function seatRect(s) {
    if (s === 0) return rectOf($('hand0').lastElementChild || $('seat0'));
    return rectOf(document.querySelector('#seat' + s + ' .backs > :last-child') || $('seat' + s));
  }

  // Slide an element from `from` (a screen rectangle) to where it now sits.
  function slideFrom(node, from, opts) {
    if (!node || !from || !motionOK()) return;
    opts = opts || {};
    const to = node.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const sc = to.width ? Math.max(0.5, Math.min(1.3, from.width / to.width)) : 1;
    node.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${sc})`, opacity: opts.fade ? 0 : 1 }, { transform: 'none', opacity: 1 }],
      { duration: opts.duration || 480, delay: opts.delay || 0, easing: EASE, fill: 'backwards' },
    );
  }

  // A temporary card that travels from one spot to another and fades away.
  function ghost(from, to, html, duration, red) {
    if (!from || !to || !motionOK()) return;
    const n = el('div', 'ghost' + (red ? ' red' : ''), html);
    Object.assign(n.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' });
    document.body.appendChild(n);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const a = n.animate(
      [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(0.55)`, opacity: 0 }],
      { duration: duration || 520, easing: EASE, fill: 'forwards' },
    );
    a.onfinish = () => n.remove();
  }

  // Gather the finished trick toward whoever won it, then carry on.
  function sweepTrick(winner, done) {
    const cards = document.querySelectorAll('#center .trick .card');
    const target = winner === 0 ? rectOf($('seat0')) : seatRect(winner);
    if (!cards.length || !target || !motionOK()) { done(); return; }
    let left = cards.length;
    cards.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const dx = target.left + target.width / 2 - (r.left + r.width / 2);
      const dy = target.top + target.height / 2 - (r.top + r.height / 2);
      const a = c.animate(
        [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(0.45)`, opacity: 0 }],
        { duration: 520, delay: i * 40, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' },
      );
      a.onfinish = () => { if (--left === 0) done(); };
    });
  }

  function handRects() {
    const m = new Map();
    if (!motionOK()) return m;
    for (const c of $('hand0').querySelectorAll('.card')) m.set(c.dataset.id, c.getBoundingClientRect());
    return m;
  }

  function animateAfterRender(before) {
    if (!g || !motionOK()) { flyFrom = pickupFrom = null; return; }

    // Deal: cards come off the dealer's spot one at a time.
    if (g.hands && g.phase === 'bid1' && g.handNo !== dealtHand) {
      dealtHand = g.handNo;
      const origin = rectOf(document.querySelector('#seat' + g.dealer + ' .nameplate')) || rectOf($('center'));
      const order = [1, 2, 3, 0].map((k) => (g.dealer + k) % 4);
      let i = 0;
      for (const s of order) {
        const nodes = s === 0 ? $('hand0').querySelectorAll('.card') : document.querySelectorAll('#seat' + s + ' .back');
        nodes.forEach((n) => slideFrom(n, origin, { duration: 420, delay: 60 * i++, fade: true }));
      }
      const up = document.querySelector('#center .kitty .card');
      if (up) up.animate([{ transform: 'rotateY(90deg) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 420, delay: 60 * i + 120, easing: EASE, fill: 'backwards' });
      before = new Map();
    }

    // A card just played flies from the player to the middle.
    if (flyFrom) {
      const card = document.querySelector('#center .slot.s' + flyFrom.seat + ' .card');
      slideFrom(card, flyFrom.rect, { duration: 460 });
      before.delete(card && card.dataset.id);
    }

    // The dealer takes the up card.
    if (pickupFrom) {
      if (g.dealer === 0) slideFrom($('hand0').querySelector(`[data-id="${g.upcard.id}"]`), pickupFrom, { duration: 520 });
      else ghost(pickupFrom, seatRect(g.dealer), cardEl(g.upcard, { tags: false }).innerHTML, 560, RED[g.upcard.s]);
    }

    // Your other cards glide into their new places (after sorting or playing).
    for (const c of $('hand0').querySelectorAll('.card')) {
      if (pickupFrom && g.dealer === 0 && c.dataset.id === g.upcard.id) continue;
      const r = before.get(c.dataset.id);
      if (r) slideFrom(c, r, { duration: 320 });
    }

    // Face-up deal for the first dealer: each card comes off the middle of the table.
    if (g.phase === 'drawDealer') {
      const fresh = document.querySelector('#center .card.fresh');
      const mid = rectOf(document.querySelector('#center .trick .mid'));
      if (fresh && mid) slideFrom(fresh, { left: mid.left, top: mid.top, width: fresh.offsetWidth, height: fresh.offsetHeight }, { duration: 340, fade: true });
    }

    flyFrom = pickupFrom = null;
  }

  // Markers (passes, calls, the dealer chip) pop in once when they first appear.
  function popNew() {
    if (!g) return;
    const nodes = document.querySelectorAll('.nameplate .chip, #center .bubble');
    nodes.forEach((n) => {
      const where = n.closest('[id^="seat"]') || n.closest('.slot');
      const key = g.handNo + '|' + (g.phase === 'bid2' ? 2 : 1) + '|' + (where ? where.id || where.className : '') + '|' + n.className + '|' + n.textContent;
      if (!seen.has(key)) {
        seen.add(key);
        if (motionOK()) n.classList.add('pop');
      }
    });
    if (seen.size > 400) seen.clear();
  }

  function bumpScores() {
    if (!g) return;
    [['scoreUs', 0], ['scoreThem', 1]].forEach(([id, t]) => {
      if (g.scores[t] !== lastScores[t] && g.scores[t] > 0 && motionOK()) {
        $(id).animate([{ transform: 'scale(1)' }, { transform: 'scale(1.45)', color: '#fff' }, { transform: 'scale(1)' }], { duration: 650, easing: EASE });
      }
    });
    lastScores = g.scores.slice();
  }

  // ---- Rendering ----
  function render() {
    const before = handRects();
    $('scoreUs').textContent = g ? g.scores[0] : 0;
    $('scoreThem').textContent = g ? g.scores[1] : 0;
    renderStrip();
    for (const s of [0, 1, 2, 3]) renderSeat(s);
    renderCenter();
    renderHand();
    renderPanel();
    animateAfterRender(before);
    popNew();
    bumpScores();
  }

  function renderStrip() {
    const strip = $('strip');
    if (!g || !g.hands) { strip.innerHTML = ''; return; }
    const o = g.options;
    const parts = [`Dealer <b>${SEAT_NAMES[g.dealer]}</b>`];
    if (g.trump) {
      parts.push(`Trump <b><span class="trump-sym ${RED[g.trump] ? 'red' : ''}">${SUIT_SYM[g.trump]}</span> ${SUIT_NAME[g.trump]}</b>`);
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
      const plate = el('div', 'nameplate', SEAT_NAMES[s]);
      if (g && g.phase === 'drawDealer' && g.drawShown === g.draw.length && g.dealer === s) {
        plate.insertAdjacentHTML('beforeend', '<span class="chip" title="Dealer">D</span>');
      }
      box.appendChild(plate);
      return;
    }
    const plate = el('div', 'nameplate' + (g.turn === s ? ' turn' : '') + (g.sittingOut === s ? ' out' : ''));
    plate.textContent = SEAT_NAMES[s];
    if (g.dealer === s) plate.insertAdjacentHTML('beforeend', '<span class="chip" title="Dealer">D</span>');
    if (g.maker === s) {
      plate.insertAdjacentHTML('beforeend', `<span class="chip maker">${g.alone ? 'Alone' : 'Called'} ${suitHtml(g.trump)}</span>`);
    }
    if (g.trump && g.sittingOut !== s && ['play', 'trickDone', 'handOver', 'gameOver'].includes(g.phase)) {
      const n = g.tricks.filter((t) => t.winner === s).length;
      plate.insertAdjacentHTML('beforeend', `<span class="chip tricks" title="Tricks won this hand">${n}</span>`);
    }
    const bidding = g.phase === 'bid1' || g.phase === 'bid2' || g.phase === 'discard' || g.phase === 'misdeal';
    if (bidding && g.passed && g.passed[s]) {
      plate.insertAdjacentHTML('beforeend', `<span class="chip passed">Passed</span>`);
    }
    box.appendChild(plate);
    if (s === 0) return;
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
    if (g && g.phase === 'drawDealer') {
      c.appendChild(drawEl());
      return;
    }
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
      else if (g.say[s] && g.say[s] !== 'Pass') slot.appendChild(bubbleEl(s === 0 ? 'You: ' + g.say[s] : g.say[s]));
      trick.appendChild(slot);
    }
    const mid = el('div', 'mid');
    if (g.phase === 'bid1') {
      mid.appendChild(kittyEl(true));
    } else if (g.phase === 'bid2') {
      mid.appendChild(kittyEl(false));
    }
    trick.appendChild(mid);
    c.appendChild(trick);
  }

  // Face-up cards dealt one at a time until someone gets a black jack.
  function drawEl() {
    const trick = el('div', 'trick');
    const shown = g.draw.slice(0, g.drawShown);
    const done = g.drawShown === g.draw.length;
    for (const s of [0, 1, 2, 3]) {
      const slot = el('div', 'slot s' + s + (done && g.dealer === s ? ' won' : ''));
      const mine = shown.filter((d) => d.seat === s);
      if (mine.length) {
        const ce = cardEl(mine[mine.length - 1].card, { tags: false });
        if (shown[shown.length - 1].seat === s) ce.classList.add('fresh');
        slot.appendChild(ce);
      }
      trick.appendChild(slot);
    }
    trick.appendChild(el('div', 'mid'));
    return trick;
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
    const actions = el('div', 'actions');
    const add = (b) => actions.appendChild(b);

    if (!g || g.phase === 'idle') {
      add(button('Start a game', 'primary', openSetup));
      p.appendChild(actions);
      return;
    }

    const myTurn = g.turn === 0;
    let aloneSwitch = false;

    switch (g.phase) {
      case 'bid1': {
        if (!myTurn) break;
        const opts = E.bidOptions(g, 0);
        add(button('Pass', '', () => human({ type: 'pass' })));
        if (opts.forcedAlone) {
          add(button('Order up and go alone', 'primary', () => human({ type: 'order', alone: true })));
        } else {
          add(button(g.dealer === 0 ? 'Pick it up' : 'Order it up', 'primary', () => human({ type: 'order', alone: goAlone })));
          aloneSwitch = true;
        }
        break;
      }
      case 'bid2': {
        if (!myTurn) break;
        const opts = E.bidOptions(g, 0);
        for (const s of opts.suits) {
          add(button(`${suitHtml(s)} ${SUIT_NAME[s]}`, 'suit', () => human({ type: 'call', suit: s, alone: goAlone })));
        }
        if (opts.canPass) add(button('Pass', '', () => human({ type: 'pass' })));
        aloneSwitch = true;
        break;
      }
      case 'misdeal':
        add(button('Deal next hand', 'primary', () => { E.nextHand(g); advance(); }));
        break;
      case 'handOver':
      case 'gameOver': {
        const r = g.lastResult;
        const msg = el('p', 'msg');
        let text = `${teamLabel(r.team)} +${r.pts}` + (r.kind === 'euchred' ? ' (euchre)' : r.alone && r.kind === 'march' ? ' (loner)' : '');
        if (g.phase === 'gameOver') text += ` · ${g.winner === 0 ? 'You win' : 'They win'} ${g.scores[g.winner]}–${g.scores[1 - g.winner]}`;
        msg.textContent = text;
        p.appendChild(msg);
        if (g.phase === 'gameOver') {
          add(button('Play again', 'primary', () => startGame(g.options)));
          add(button('Change options', '', openSetup));
        } else {
          add(button('Next hand', 'primary', () => { E.nextHand(g); advance(); }));
        }
        break;
      }
    }
    if (actions.childNodes.length) p.appendChild(actions);
    if (aloneSwitch) {
      const t = el('label', 'switch');
      t.innerHTML = '<input type="checkbox" role="switch" id="goAlone"><span class="track" aria-hidden="true"></span><span>Go alone</span>';
      const input = t.querySelector('input');
      input.checked = goAlone;
      input.addEventListener('change', (e) => { goAlone = e.target.checked; });
      p.appendChild(t);
    }
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
    if (g.phase === 'drawDealer') {
      if (g.drawShown < g.draw.length) schedule(() => { g.drawShown++; advance(); }, DELAY.draw);
      else schedule(() => { E.startHand(g); advance(); }, DELAY.trick + 300);
    } else if ((g.phase === 'bid1' || g.phase === 'bid2') && seat !== 0) {
      schedule(() => {
        const action = AI.chooseBid(g, seat, lvl);
        notePickup(action);
        E.bid(g, seat, action);
        advance();
      }, DELAY.bid);
    } else if (g.phase === 'discard' && seat !== 0) {
      schedule(() => { E.discard(g, seat, AI.chooseDiscard(g, seat, lvl)); advance(); }, DELAY.bid);
    } else if (g.phase === 'play' && seat !== 0) {
      schedule(() => {
        const card = AI.choosePlay(g, seat, lvl);
        flyFrom = { seat, rect: seatRect(seat) };
        E.play(g, seat, card.id);
        advance();
      }, DELAY.play);
    } else if (g.phase === 'trickDone') {
      schedule(() => sweepTrick(g.trickWinner, () => { E.collectTrick(g); advance(); }), DELAY.trick);
    }
  }

  function human(action) {
    if (!g || g.turn !== 0) return;
    notePickup(action);
    E.bid(g, 0, action);
    goAlone = false;
    advance();
  }

  function onCard(id) {
    if (!g || g.turn !== 0) return;
    const node = $('hand0').querySelector(`[data-id="${id}"]`);
    const rect = rectOf(node);
    if (g.phase === 'discard') {
      ghost(rect, rectOf($('center')), node.innerHTML, 480, node.classList.contains('red'));
      E.discard(g, 0, id);
    } else if (g.phase === 'play') {
      flyFrom = { seat: 0, rect };
      E.play(g, 0, id);
    } else return;
    advance();
  }

  // Remember where the up card sat if this bid sends it to the dealer.
  function notePickup(action) {
    if (g.phase === 'bid1' && action.type === 'order') pickupFrom = rectOf(document.querySelector('#center .kitty .card'));
  }

  function startGame(options) {
    g = E.newGame(options);
    goAlone = false;
    dealtHand = 0;
    lastScores = [0, 0];
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
