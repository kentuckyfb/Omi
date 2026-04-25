// ===== Omi Card Game =====

import { Realtime } from 'ably';

// Add your free Ably API key from https://ably.com
const ABLY_API_KEY = 'j2A0-A.Cr1qtA:ojdgVsJef0B2e_W-Lwh2WlYlN_5jX7tnCtmXTxkvuQM';

// === Constants ===
const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_SYMBOLS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
const RANK_VALUES = { '7': 1, '8': 2, '9': 3, '10': 4, 'J': 5, 'Q': 6, 'K': 7, 'A': 8 };

// === Game State ===
let gameState = {
  mode: null,           // 'single' | 'host' | 'guest'
  myPlayerIndex: 0,
  roomCode: null,
  roomSize: 4,
  isBot: [false, true, true, true],
  playerNames: ['You', 'West', 'North', 'East'],
  hands: [[], [], [], []],
  trumpPreviewCards: [],
  trump: null,
  trumpChooser: 0,
  currentTrick: [],
  leadSuit: null,
  currentPlayer: 0,
  tricks: [0, 0],
  scores: [0, 0],
  roundNumber: 1,
  isPlayerTurn: false,
  gameStarted: false
};

// === Settings ===
let settings = {
  theme: 'pixel',
  botSpeed: 'normal',
  animations: 'normal',
  sound: 'on'
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('omi-settings') || '{}');
    Object.assign(settings, saved);
  } catch {}
  applySettings();
}

function saveSettings() {
  localStorage.setItem('omi-settings', JSON.stringify(settings));
}

function applySettings() {
  applyTheme(settings.theme);
  applyAnimations(settings.animations);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'pixel' ? '' : theme;
  if (theme === 'pixel') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  document.querySelectorAll('.theme-card').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

function applyAnimations(mode) {
  document.body.classList.remove('anim-reduced', 'anim-off');
  if (mode === 'reduced') document.body.classList.add('anim-reduced');
  if (mode === 'off') document.body.classList.add('anim-off');
}

// === Bot speed helpers ===
function getBotThinkDelay() {
  return settings.botSpeed === 'slow' ? 1200 : settings.botSpeed === 'fast' ? 160 : 500;
}
function getTrickDelay() {
  return settings.botSpeed === 'slow' ? 2000 : settings.botSpeed === 'fast' ? 500 : 1200;
}
function getBotNextDelay() {
  return settings.botSpeed === 'slow' ? 700 : settings.botSpeed === 'fast' ? 80 : 400;
}
function getPlayerNextDelay() {
  return settings.botSpeed === 'slow' ? 900 : settings.botSpeed === 'fast' ? 200 : 600;
}

// === Sound System ===
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playSound(type) {
  if (settings.sound !== 'on') return;
  try {
    const ctx = getAudioCtx();
    const g = ctx.createGain();
    g.connect(ctx.destination);
    const now = ctx.currentTime;

    const beep = (freq, start, dur, vol = 0.18, wave = 'square') => {
      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.setValueAtTime(freq, now + start);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, now + start);
      env.gain.linearRampToValueAtTime(vol, now + start + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      o.connect(env);
      env.connect(g);
      o.start(now + start);
      o.stop(now + start + dur + 0.01);
    };

    if (type === 'deal')       { beep(440, 0, 0.06); beep(520, 0.07, 0.06); }
    if (type === 'play')       { beep(660, 0, 0.08, 0.14); }
    if (type === 'your-turn')  { beep(880, 0, 0.06); beep(1100, 0.08, 0.06); }
    if (type === 'win-trick')  { beep(523, 0, 0.07); beep(659, 0.08, 0.07); beep(784, 0.16, 0.12); }
    if (type === 'lose-trick') { beep(330, 0, 0.08); beep(262, 0.1, 0.12, 0.12); }
    if (type === 'round-end')  { beep(392, 0, 0.1); beep(494, 0.12, 0.1); beep(587, 0.24, 0.18); }
    if (type === 'game-win')   { [523,659,784,1047].forEach((f,i) => beep(f, i*0.14, 0.18, 0.2)); }
    if (type === 'game-lose')  { beep(330, 0, 0.15, 0.2); beep(262, 0.18, 0.2, 0.2); beep(220, 0.42, 0.3, 0.2); }
    if (type === 'trump')      { beep(349, 0, 0.08); beep(440, 0.1, 0.08); beep(523, 0.2, 0.14); }
    if (type === 'fight')      { beep(784, 0, 0.08, 0.22); beep(988, 0.1, 0.08, 0.22); beep(1175, 0.2, 0.2, 0.22); }
  } catch {}
}

// === Player Name ===
function loadPlayerName() {
  return localStorage.getItem('omi-name') || '';
}

function savePlayerName(name) {
  if (name) localStorage.setItem('omi-name', name);
}

function getPlayerName() {
  const inputVal = elements.playerNameInput ? elements.playerNameInput.value.trim() : '';
  return (inputVal || loadPlayerName() || 'Player').slice(0, 16);
}

// === Multiplayer State ===
let mp = {
  client: null,
  channel: null,
  playerId: null,
  pendingRoomSize: 4,
  presenceNames: {}
};

const elements = {};

// === DOM Init ===
function initElements() {
  elements.menuScreen = document.getElementById('menu-screen');
  elements.lobbyScreen = document.getElementById('lobby-screen');
  elements.waitingScreen = document.getElementById('waiting-screen');
  elements.gameScreen = document.getElementById('game-screen');

  elements.btnSolo = document.getElementById('btn-solo');
  elements.btnOnline = document.getElementById('btn-online');
  elements.btnBackMenu = document.getElementById('btn-back-menu');
  elements.btnCreateRoom = document.getElementById('btn-create-room');
  elements.btnJoinRoom = document.getElementById('btn-join-room');
  elements.roomCodeInput = document.getElementById('room-code-input');
  elements.sizeTabs = document.querySelectorAll('.size-tab');

  elements.btnLeaveRoom = document.getElementById('btn-leave-room');
  elements.displayRoomCode = document.getElementById('display-room-code');
  elements.playerCount = document.getElementById('player-count');
  elements.playerCountMax = document.getElementById('player-count-max');
  elements.playersContainer = document.getElementById('players-container');
  elements.btnStartGame = document.getElementById('btn-start-game');
  elements.waitingText = document.getElementById('waiting-text');

  elements.team1Score = document.getElementById('team1-score');
  elements.team2Score = document.getElementById('team2-score');
  elements.trumpDisplay = document.getElementById('trump-display');
  elements.team1Tricks = document.getElementById('team1-tricks');
  elements.team2Tricks = document.getElementById('team2-tricks');
  elements.roundDisplay = document.getElementById('round-display');

  elements.northHand = document.getElementById('north-hand');
  elements.eastHand = document.getElementById('east-hand');
  elements.southHand = document.getElementById('south-hand');
  elements.westHand = document.getElementById('west-hand');
  elements.playedCards = document.getElementById('played-cards');
  elements.currentTurn = document.getElementById('current-turn');
  elements.tricksDisplay = document.getElementById('tricks-display');

  elements.northName = document.getElementById('north-name');
  elements.eastName = document.getElementById('east-name');
  elements.southName = document.getElementById('south-name');
  elements.westName = document.getElementById('west-name');

  elements.trumpModal = document.getElementById('trump-modal');
  elements.trumpInfo = document.getElementById('trump-info');
  elements.previewCards = document.getElementById('preview-cards');
  elements.trumpBtns = document.querySelectorAll('.trump-btn');

  elements.btnCopyCode = document.getElementById('btn-copy-code');
  elements.message = document.getElementById('message');

  elements.roundModal = document.getElementById('round-modal');
  elements.roundTitle = document.getElementById('round-title');
  elements.roundMessage = document.getElementById('round-message');
  elements.btnNextRound = document.getElementById('btn-next-round');

  elements.winnerModal = document.getElementById('winner-modal');
  elements.winnerTitle = document.getElementById('winner-title');
  elements.winnerMessage = document.getElementById('winner-message');
  elements.btnPlayAgain = document.getElementById('btn-play-again');
  elements.btnBackToMenu = document.getElementById('btn-back-to-menu');

  elements.gameMenuModal = document.getElementById('game-menu-modal');
  elements.btnGameMenu = document.getElementById('btn-game-menu');
  elements.btnResume = document.getElementById('btn-resume');
  elements.btnQuit = document.getElementById('btn-quit');

  elements.connectionStatus = document.getElementById('connection-status');
  elements.statusText = document.querySelector('#connection-status .status-text');

  elements.playerNameInput = document.getElementById('player-name-input');

  elements.settingsScreen = document.getElementById('settings-screen');
  elements.btnSettings = document.getElementById('btn-settings');
  elements.btnBackSettings = document.getElementById('btn-back-settings');
  elements.themeCards = document.querySelectorAll('.theme-card');
  elements.optionBtns = document.querySelectorAll('.option-btn');

  elements.fightOverlay = document.getElementById('fight-overlay');
  elements.fightRoundText = document.getElementById('fight-round-text');

  elements.team1Panel = document.querySelector('.your-team-panel');
  elements.team2Panel = document.querySelector('.opp-team-panel');
}

// === Screen Management ===
function showScreen(screen) {
  [elements.menuScreen, elements.lobbyScreen, elements.waitingScreen, elements.gameScreen, elements.settingsScreen]
    .forEach(s => s && s.classList.add('hidden'));
  screen.classList.remove('hidden');
}

// === Deck ===
function createDeck() {
  const deck = [];
  for (const suit of SUITS)
    for (const rank of RANKS)
      deck.push({ suit, rank });
  return deck;
}

function shuffleDeck(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function dealCards() {
  const deck = shuffleDeck(createDeck());
  gameState.hands = [[], [], [], []];
  for (let i = 0; i < 32; i++) gameState.hands[i % 4].push(deck[i]);
  gameState.trumpPreviewCards = gameState.hands[gameState.trumpChooser].slice(0, 4);
  for (let i = 0; i < 4; i++) {
    gameState.hands[i].sort((a, b) => {
      if (a.suit !== b.suit) return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
      return RANK_VALUES[a.rank] - RANK_VALUES[b.rank];
    });
  }
}

// === Card Elements ===
function createCardElement(card, faceUp = true, index = 0) {
  const el = document.createElement('div');
  el.className = `card ${faceUp ? 'face-up ' + card.suit : ''} dealing`;
  el.style.animationDelay = `${index * 0.05}s`;
  if (faceUp) {
    el.innerHTML = `<div class="card-content"><span class="card-rank">${card.rank}</span><span class="card-suit">${SUIT_SYMBOLS[card.suit]}</span></div>`;
    el.dataset.suit = card.suit;
    el.dataset.rank = card.rank;
  }
  return el;
}

// Render all hands — south is always the local player
function renderHands() {
  const my = gameState.myPlayerIndex;
  // Slots: south=my, west=my+1, north=my+2, east=my+3
  const slots = [
    { el: elements.southHand, nameEl: elements.southName, cls: 'you' },
    { el: elements.westHand,  nameEl: elements.westName,  cls: 'opponent' },
    { el: elements.northHand, nameEl: elements.northName, cls: 'partner' },
    { el: elements.eastHand,  nameEl: elements.eastName,  cls: 'opponent' },
  ];

  playSound('deal');
  slots.forEach(({ el, nameEl, cls }, slot) => {
    const pi = (my + slot) % 4;
    el.innerHTML = '';
    nameEl.textContent = gameState.playerNames[pi];
    nameEl.className = `player-name ${cls}`;
    gameState.hands[pi].forEach((card, i) => {
      const cardEl = createCardElement(card, slot === 0, i);
      if (slot === 0) cardEl.addEventListener('click', () => playCard(card, cardEl));
      el.appendChild(cardEl);
    });
  });

  updatePlayableCards();
}

function renderPlayerHand() {
  elements.southHand.innerHTML = '';
  const my = gameState.myPlayerIndex;
  gameState.hands[my].forEach((card) => {
    const cardEl = createCardElement(card, true, 0);
    cardEl.style.animationDelay = '0s';
    cardEl.classList.remove('dealing');
    cardEl.addEventListener('click', () => playCard(card, cardEl));
    elements.southHand.appendChild(cardEl);
  });
  updatePlayableCards();
}

function updatePlayableCards() {
  const playerCards = elements.southHand.querySelectorAll('.card');
  if (!gameState.isPlayerTurn) {
    playerCards.forEach(c => c.classList.add('disabled'));
    return;
  }
  const hand = gameState.hands[gameState.myPlayerIndex];
  playerCards.forEach((cardEl, i) => {
    const card = hand[i];
    if (!card) return;
    let canPlay = true;
    if (gameState.leadSuit) {
      const hasLead = hand.some(c => c.suit === gameState.leadSuit);
      if (hasLead && card.suit !== gameState.leadSuit) canPlay = false;
    }
    cardEl.classList.toggle('disabled', !canPlay);
  });
}

// === Play Card ===
function playCard(card, cardEl) {
  if (!gameState.isPlayerTurn || cardEl.classList.contains('disabled')) return;
  gameState.isPlayerTurn = false;
  playSound('play');

  const my = gameState.myPlayerIndex;
  const idx = gameState.hands[my].findIndex(c => c.suit === card.suit && c.rank === card.rank);
  if (idx > -1) gameState.hands[my].splice(idx, 1);

  addCardToTrick(card, my);
  renderPlayerHand();
  elements.currentTurn.classList.add('hidden');

  if (gameState.mode === 'guest') {
    mp.channel.publish('card-play', { suit: card.suit, rank: card.rank, playerIndex: my });
    // Guest waits; trick advance comes from received events
  } else {
    setTimeout(() => nextTurn(), getPlayerNextDelay());
  }
}

// === Trick Display ===
function addCardToTrick(card, playerIndex) {
  const my = gameState.myPlayerIndex;
  const rel = (playerIndex - my + 4) % 4;
  const pos = ['south', 'west', 'north', 'east'][rel];

  const cardEl = createCardElement(card, true);
  cardEl.classList.remove('dealing');
  cardEl.classList.add('playing');
  const wrapper = document.createElement('div');
  wrapper.className = `played-card ${pos}`;
  wrapper.appendChild(cardEl);
  elements.playedCards.appendChild(wrapper);

  gameState.currentTrick.push({ card, playerIndex });
  if (!gameState.leadSuit) gameState.leadSuit = card.suit;
}

// Remove one face-down card from a bot hand display
function updateBotHand(playerIndex) {
  const my = gameState.myPlayerIndex;
  const rel = (playerIndex - my + 4) % 4;
  const handEls = [elements.southHand, elements.westHand, elements.northHand, elements.eastHand];
  const cards = handEls[rel].querySelectorAll('.card');
  if (cards.length > 0) cards[cards.length - 1].remove();
}

// === Bot AI ===
function botPlayCard(botIndex) {
  const hand = gameState.hands[botIndex];
  if (!hand || hand.length === 0) return;

  let cardToPlay = null;
  const leadSuit = gameState.leadSuit;

  if (leadSuit) {
    const suitCards = hand.filter(c => c.suit === leadSuit);
    if (suitCards.length > 0) {
      const cw = getCurrentWinner();
      const canBeat = !cw || cw.card.suit !== gameState.trump || leadSuit === gameState.trump;
      const winning = canBeat
        ? suitCards.filter(c => RANK_VALUES[c.rank] > RANK_VALUES[cw.card.rank])
        : [];
      if (cw && isTeammate(botIndex, cw.playerIndex)) {
        cardToPlay = suitCards.reduce((m, c) => RANK_VALUES[c.rank] < RANK_VALUES[m.rank] ? c : m);
      } else if (winning.length > 0) {
        cardToPlay = winning.reduce((m, c) => RANK_VALUES[c.rank] < RANK_VALUES[m.rank] ? c : m);
      } else {
        cardToPlay = suitCards.reduce((m, c) => RANK_VALUES[c.rank] < RANK_VALUES[m.rank] ? c : m);
      }
    } else {
      const trumps = hand.filter(c => c.suit === gameState.trump);
      const cw = getCurrentWinner();
      const partnerWinning = cw && isTeammate(botIndex, cw.playerIndex);
      if (trumps.length > 0 && !partnerWinning) {
        const wtv = (cw && cw.card.suit === gameState.trump) ? RANK_VALUES[cw.card.rank] : 0;
        const wt = trumps.filter(c => RANK_VALUES[c.rank] > wtv);
        cardToPlay = wt.length > 0
          ? wt.reduce((m, c) => RANK_VALUES[c.rank] < RANK_VALUES[m.rank] ? c : m)
          : hand.reduce((m, c) => RANK_VALUES[c.rank] < RANK_VALUES[m.rank] ? c : m);
      } else {
        cardToPlay = hand.reduce((m, c) => RANK_VALUES[c.rank] < RANK_VALUES[m.rank] ? c : m);
      }
    }
  } else {
    const sc = {};
    hand.forEach(c => { sc[c.suit] = (sc[c.suit] || 0) + 1; });
    if (sc[gameState.trump] >= 3) {
      const tc = hand.filter(c => c.suit === gameState.trump);
      cardToPlay = tc.reduce((m, c) => RANK_VALUES[c.rank] > RANK_VALUES[m.rank] ? c : m);
    } else {
      let best = null, max = 0;
      for (const s of SUITS) {
        if (s !== gameState.trump && (sc[s] || 0) > max) { max = sc[s]; best = s; }
      }
      if (best) {
        const bc = hand.filter(c => c.suit === best);
        cardToPlay = bc.reduce((m, c) => RANK_VALUES[c.rank] > RANK_VALUES[m.rank] ? c : m);
      } else {
        cardToPlay = hand.reduce((m, c) => RANK_VALUES[c.rank] > RANK_VALUES[m.rank] ? c : m);
      }
    }
  }

  if (!cardToPlay) cardToPlay = hand[0];
  const ci = hand.findIndex(c => c.suit === cardToPlay.suit && c.rank === cardToPlay.rank);
  hand.splice(ci, 1);
  addCardToTrick(cardToPlay, botIndex);
  updateBotHand(botIndex);
  return cardToPlay;
}

// === Game Logic Helpers ===
function isTeammate(p1, p2) {
  return p1 !== undefined && p2 !== undefined && (p1 % 2) === (p2 % 2);
}

function getCurrentWinner() {
  if (!gameState.currentTrick.length) return null;
  let w = gameState.currentTrick[0];
  for (let i = 1; i < gameState.currentTrick.length; i++) {
    const c = gameState.currentTrick[i];
    if (c.card.suit === gameState.trump && w.card.suit !== gameState.trump) w = c;
    else if (c.card.suit === w.card.suit && RANK_VALUES[c.card.rank] > RANK_VALUES[w.card.rank]) w = c;
  }
  return w;
}

// === Turn Flow ===
function nextTurn() {
  if (gameState.currentTrick.length === 4) { resolveTrick(); return; }

  gameState.currentPlayer = (gameState.currentPlayer + 1) % 4;
  const cp = gameState.currentPlayer;

  if (cp === gameState.myPlayerIndex) {
    gameState.isPlayerTurn = true;
    elements.currentTurn.textContent = 'Your turn';
    elements.currentTurn.classList.remove('hidden');
    updatePlayableCards();
    playSound('your-turn');
  } else if (gameState.isBot[cp]) {
    // Only host/single runs bots
    setTimeout(() => {
      const played = botPlayCard(cp);
      if (played && gameState.mode === 'host') {
        mp.channel.publish('card-play', { suit: played.suit, rank: played.rank, playerIndex: cp });
      }
      setTimeout(() => nextTurn(), getBotNextDelay());
    }, getBotThinkDelay());
  }
  // else: human guest turn — wait for their card-play message
}

function resolveTrick() {
  const winner = getCurrentWinner();
  const team = winner.playerIndex % 2;
  gameState.tricks[team]++;
  updateTricksDisplay();

  const isMyTeam = winner.playerIndex % 2 === gameState.myPlayerIndex % 2;
  playSound(isMyTeam ? 'win-trick' : 'lose-trick');

  const rel = (winner.playerIndex - gameState.myPlayerIndex + 4) % 4;
  elements.playedCards.classList.add(['fly-south', 'fly-west', 'fly-north', 'fly-east'][rel]);

  setTimeout(() => {
    elements.playedCards.innerHTML = '';
    elements.playedCards.classList.remove('fly-south', 'fly-west', 'fly-north', 'fly-east');
    gameState.currentTrick = [];
    gameState.leadSuit = null;

    if (gameState.hands[gameState.myPlayerIndex].length === 0) {
      endRound();
      return;
    }

    gameState.currentPlayer = winner.playerIndex;
    const cp = gameState.currentPlayer;

    if (cp === gameState.myPlayerIndex) {
      gameState.isPlayerTurn = true;
      elements.currentTurn.textContent = 'Your turn to lead';
      elements.currentTurn.classList.remove('hidden');
      updatePlayableCards();
      playSound('your-turn');
    } else if (gameState.isBot[cp]) {
      setTimeout(() => {
        const played = botPlayCard(cp);
        if (played && gameState.mode === 'host') {
          mp.channel.publish('card-play', { suit: played.suit, rank: played.rank, playerIndex: cp });
        }
        setTimeout(() => nextTurn(), getBotNextDelay());
      }, getBotThinkDelay());
    }
    // else: wait for guest to lead
  }, getTrickDelay());
}

function updateTricksDisplay() {
  elements.team1Tricks.textContent = gameState.tricks[0];
  elements.team2Tricks.textContent = gameState.tricks[1];
  elements.tricksDisplay.innerHTML = `
    <span class="tricks-you">${gameState.tricks[0]}</span>
    <span class="tricks-separator">-</span>
    <span class="tricks-opp">${gameState.tricks[1]}</span>
  `;
}

function endRound() {
  const t1 = gameState.tricks[0], t2 = gameState.tricks[1];
  let p1 = 0, p2 = 0, msg = '';
  if (t1 >= 5) { p1 = t1 === 8 ? 3 : t1 >= 7 ? 2 : 1; msg = `Your team wins ${p1} point${p1 > 1 ? 's' : ''}!`; }
  else if (t2 >= 5) { p2 = t2 === 8 ? 3 : t2 >= 7 ? 2 : 1; msg = `Opponents win ${p2} point${p2 > 1 ? 's' : ''}!`; }
  else { msg = 'Draw! No points awarded.'; }

  gameState.scores[0] += p1;
  gameState.scores[1] += p2;
  elements.team1Score.textContent = gameState.scores[0];
  elements.team2Score.textContent = gameState.scores[1];
  updateScoreBars();

  // Screen flash
  elements.gameScreen.classList.add('flash');
  setTimeout(() => elements.gameScreen.classList.remove('flash'), 360);
  playSound('round-end');

  if (gameState.scores[0] >= 10 || gameState.scores[1] >= 10) { endGame(); return; }

  elements.roundTitle.textContent = `Round ${gameState.roundNumber} Complete`;
  elements.roundMessage.innerHTML = `
    <div class="round-result">
      <div class="result-main">${msg}</div>
      <div class="result-details">
        <div class="result-row"><span>Tricks</span><span><strong>${t1}</strong> - <strong>${t2}</strong></span></div>
        <div class="result-row"><span>Score</span><span><strong>${gameState.scores[0]}</strong> - <strong>${gameState.scores[1]}</strong></span></div>
      </div>
    </div>
  `;

  // Guests can't start next round — only host does
  if (gameState.mode === 'guest') {
    elements.btnNextRound.textContent = 'Waiting for host...';
    elements.btnNextRound.disabled = true;
  } else {
    elements.btnNextRound.textContent = 'Next Round';
    elements.btnNextRound.disabled = false;
  }
  elements.roundModal.classList.remove('hidden');
}

function endGame() {
  const youWin = gameState.scores[0] >= 10;
  playSound(youWin ? 'game-win' : 'game-lose');
  elements.winnerTitle.textContent = youWin ? 'Victory!' : 'Defeat';
  elements.winnerMessage.innerHTML = `
    <div class="game-result">
      <div class="result-main">${youWin ? 'Your team wins!' : 'Opponents win!'}</div>
      <div class="result-score"><span class="final-score">${gameState.scores[0]} - ${gameState.scores[1]}</span></div>
      <div class="result-rounds">Completed in ${gameState.roundNumber} rounds</div>
    </div>
  `;
  // Guests can't replay
  elements.btnPlayAgain.classList.toggle('hidden', gameState.mode === 'guest');
  elements.winnerModal.classList.remove('hidden');
}

function startNextRound() {
  elements.roundModal.classList.add('hidden');
  gameState.roundNumber++;
  gameState.tricks = [0, 0];
  gameState.currentTrick = [];
  gameState.leadSuit = null;
  gameState.trump = null;
  updateTricksDisplay();
  updateRoundDisplay();
  elements.trumpDisplay.textContent = '—';
  elements.trumpDisplay.className = 'trump-display';
  elements.trumpInfo.classList.remove('spades', 'hearts', 'diamonds', 'clubs');
  elements.playedCards.innerHTML = '';
  gameState.trumpChooser = (gameState.trumpChooser + 1) % 4;
  dealCards();

  if (gameState.mode === 'host') {
    mp.channel.publish('round-start', {
      hands: gameState.hands,
      trumpChooser: gameState.trumpChooser,
      roundNumber: gameState.roundNumber
    });
  }

  renderHands();
  setTimeout(() => selectTrump(), 800);
}

function updateRoundDisplay() {
  elements.roundDisplay.textContent = gameState.roundNumber;
}

function updateScoreBars() {
  const pct1 = Math.min((gameState.scores[0] / 10) * 100, 100) + '%';
  const pct2 = Math.min((gameState.scores[1] / 10) * 100, 100) + '%';
  elements.team1Panel.style.setProperty('--score-pct', pct1);
  elements.team2Panel.style.setProperty('--score-pct', pct2);
}

function showFightOverlay() {
  elements.fightRoundText.textContent = `ROUND ${gameState.roundNumber}`;
  elements.fightOverlay.classList.remove('hidden');
  setTimeout(() => elements.fightOverlay.classList.add('hidden'), 1900);
  playSound('fight');
}

// === Trump ===
function selectTrump() {
  const tc = gameState.trumpChooser;
  if (tc === gameState.myPlayerIndex) {
    showTrumpModal();
  } else if (gameState.isBot[tc] && gameState.mode !== 'guest') {
    const hand = gameState.hands[tc];
    const sc = {};
    hand.forEach(c => { sc[c.suit] = (sc[c.suit] || 0) + 1; });
    let best = SUITS[0], max = 0;
    for (const s of SUITS) { if ((sc[s] || 0) > max) { max = sc[s]; best = s; } }
    applyTrump(best, tc);
    showMessage(`${gameState.playerNames[tc]} chose ${SUIT_SYMBOLS[best]} as trump`);
    if (gameState.mode === 'host') {
      mp.channel.publish('trump-selected', { suit: best, playerIndex: tc });
    }
    setTimeout(() => startPlay(), 1500);
  }
  // else: guest waiting for trump-selected message from host
}

function showTrumpModal() {
  elements.previewCards.innerHTML = '';
  const preview = gameState.trumpPreviewCards.length
    ? gameState.trumpPreviewCards
    : gameState.hands[gameState.myPlayerIndex].slice(0, 4);
  preview.forEach((card, i) => {
    const el = createCardElement(card, true, i);
    el.classList.remove('dealing');
    elements.previewCards.appendChild(el);
  });
  elements.trumpModal.classList.remove('hidden');
}

function applyTrump(suit) {
  gameState.trump = suit;
  elements.trumpDisplay.textContent = SUIT_SYMBOLS[suit];
  elements.trumpDisplay.className = `trump-display ${suit}`;
  elements.trumpInfo.dataset.suit = suit;
  elements.trumpInfo.classList.remove('spades', 'hearts', 'diamonds', 'clubs');
  elements.trumpInfo.classList.add(suit);
  elements.trumpModal.classList.add('hidden');
}

function startPlay() {
  showFightOverlay();
  gameState.currentPlayer = gameState.trumpChooser;
  const cp = gameState.currentPlayer;

  if (cp === gameState.myPlayerIndex) {
    gameState.isPlayerTurn = true;
    elements.currentTurn.textContent = 'Your turn to lead';
    elements.currentTurn.classList.remove('hidden');
    updatePlayableCards();
  } else if (gameState.isBot[cp] && gameState.mode !== 'guest') {
    setTimeout(() => {
      const played = botPlayCard(cp);
      if (played && gameState.mode === 'host') {
        mp.channel.publish('card-play', { suit: played.suit, rank: played.rank, playerIndex: cp });
      }
      setTimeout(() => nextTurn(), 400);
    }, 500);
  }
  // else: human guest leads — wait
}

// === Message ===
function showMessage(text) {
  elements.message.textContent = text;
  elements.message.classList.remove('hidden');
  setTimeout(() => elements.message.classList.add('hidden'), 1500);
}

// === Single Player Start ===
function startSinglePlayer() {
  gameState.mode = 'single';
  gameState.myPlayerIndex = 0;
  gameState.isBot = [false, true, true, true];
  const myName = loadPlayerName() || 'You';
  gameState.playerNames = [myName, 'West', 'North', 'East'];
  gameState.scores = [0, 0];
  gameState.tricks = [0, 0];
  gameState.roundNumber = 1;
  gameState.trumpChooser = Math.floor(Math.random() * 4);
  gameState.gameStarted = true;

  resetGameUI();
  showScreen(elements.gameScreen);
  dealCards();
  renderHands();
  setTimeout(() => selectTrump(), 1000);
}

function resetGameUI() {
  elements.team1Score.textContent = '0';
  elements.team2Score.textContent = '0';
  gameState.scores = [0, 0];
  updateScoreBars();
  updateTricksDisplay();
  updateRoundDisplay();
  elements.trumpDisplay.textContent = '—';
  elements.trumpDisplay.className = 'trump-display';
  elements.trumpInfo.classList.remove('spades', 'hearts', 'diamonds', 'clubs');
  elements.playedCards.innerHTML = '';
  elements.currentTurn.classList.add('hidden');
}

function resetToMenu() {
  gameState.gameStarted = false;
  elements.gameMenuModal.classList.add('hidden');
  elements.winnerModal.classList.add('hidden');
  elements.roundModal.classList.add('hidden');
  disconnectAbly();
  setConnectionStatus(null);
  showScreen(elements.menuScreen);
}

// === Multiplayer — Ably ===
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generatePlayerId() {
  return 'p' + Math.random().toString(36).substr(2, 9);
}

async function connectAbly() {
  if (!ABLY_API_KEY) {
    showMessage('No Ably API key — see src/main.js');
    return false;
  }
  try {
    mp.playerId = generatePlayerId();
    mp.client = new Realtime({ key: ABLY_API_KEY, clientId: mp.playerId });
    return new Promise((resolve) => {
      mp.client.connection.once('connected', () => resolve(true));
      mp.client.connection.once('failed', () => { showMessage('Connection failed'); resolve(false); });
      setTimeout(() => resolve(false), 10000);
    });
  } catch {
    showMessage('Connection error');
    return false;
  }
}

function disconnectAbly() {
  if (mp.channel) { try { mp.channel.presence.leave(); mp.channel.detach(); } catch {} mp.channel = null; }
  if (mp.client) { try { mp.client.close(); } catch {} mp.client = null; }
}

function setConnectionStatus(status) {
  if (!status) { elements.connectionStatus.classList.add('hidden'); return; }
  elements.connectionStatus.classList.remove('hidden');
  elements.connectionStatus.className = `connection-status${status === 'connected' ? ' connected' : ''}`;
  elements.statusText.textContent = status === 'connected' ? 'Connected' : 'Connecting...';
}

// === Create Room ===
async function createRoom() {
  setConnectionStatus('connecting');
  const ok = await connectAbly();
  if (!ok) { setConnectionStatus(null); return; }

  const size = mp.pendingRoomSize;
  const code = generateRoomCode();
  gameState.roomCode = code;
  gameState.roomSize = size;
  gameState.mode = 'host';
  gameState.myPlayerIndex = 0;

  const myName = getPlayerName();
  savePlayerName(myName);
  mp.presenceNames = { 0: myName };

  mp.channel = mp.client.channels.get(`omi-${code}`);
  mp.channel.subscribe('card-play', onRemoteCardPlay);
  mp.channel.subscribe('trump-selected', onRemoteTrumpSelected);
  mp.channel.presence.subscribe('enter', onPresenceEnter);
  mp.channel.presence.subscribe('leave', onPresenceLeave);

  await mp.channel.presence.enter({ name: myName, index: 0, roomSize: size });
  setConnectionStatus('connected');
  showWaitingRoom(code, size);
}

// === Join Room ===
async function joinRoom(code) {
  setConnectionStatus('connecting');
  const ok = await connectAbly();
  if (!ok) { setConnectionStatus(null); return; }

  mp.channel = mp.client.channels.get(`omi-${code}`);
  const members = await mp.channel.presence.get();
  const taken = members.map(m => m.data.index);

  // Find next available slot
  let myIndex = 1;
  while (taken.includes(myIndex) && myIndex < 4) myIndex++;
  if (myIndex >= 4) { showMessage('Room is full!'); disconnectAbly(); setConnectionStatus(null); return; }

  const myName = getPlayerName();
  savePlayerName(myName);
  mp.presenceNames = {};
  members.forEach(m => { mp.presenceNames[m.data.index] = m.data.name; });
  mp.presenceNames[myIndex] = myName;

  gameState.roomCode = code;
  gameState.mode = 'guest';
  gameState.myPlayerIndex = myIndex;
  gameState.roomSize = mp.pendingRoomSize;

  mp.channel.subscribe('game-start', onGameStart);
  mp.channel.subscribe('card-play', onRemoteCardPlay);
  mp.channel.subscribe('trump-selected', onRemoteTrumpSelected);
  mp.channel.subscribe('round-start', onRoundStart);
  mp.channel.presence.subscribe('enter', onPresenceEnter);
  mp.channel.presence.subscribe('leave', onPresenceLeave);

  await mp.channel.presence.enter({ name: myName, index: myIndex });
  setConnectionStatus('connected');

  // Determine size from existing members if host already set roomSize
  const hostMember = members.find(m => m.data.index === 0);
  const roomSize = (hostMember && hostMember.data.roomSize) || mp.pendingRoomSize;

  showWaitingRoom(code, roomSize);
  members.forEach(m => addPlayerToWaiting(m.data.index, m.data.name));
  addPlayerToWaiting(myIndex, myName);
}

// === Waiting Room UI ===
function showWaitingRoom(code, size) {
  // Render each character of room code as individual box
  elements.displayRoomCode.innerHTML = code.split('').map(ch =>
    `<div class="room-code-char">${ch}</div>`
  ).join('');
  elements.playerCountMax.textContent = size;
  elements.playerCount.textContent = '0';
  elements.playersContainer.innerHTML = '';
  elements.btnStartGame.classList.add('hidden');
  elements.waitingText.textContent = 'Waiting for players...';

  if (gameState.mode === 'host') {
    addPlayerToWaiting(0, getPlayerName());
    for (let i = 1; i < size; i++) addEmptySlot(i);
  }

  showScreen(elements.waitingScreen);
}

function addPlayerToWaiting(index, name) {
  const empty = elements.playersContainer.querySelector(`.player-slot.empty[data-index="${index}"]`);
  if (empty) empty.remove();
  if (elements.playersContainer.querySelector(`[data-index="${index}"]:not(.empty)`)) return;

  const team = (index % 2) + 1;
  const slot = document.createElement('div');
  slot.className = `player-slot team-${team}`;
  slot.dataset.index = index;
  slot.innerHTML = `
    <div class="player-avatar">${name.charAt(0).toUpperCase()}</div>
    <div class="player-slot-name">${name}</div>
    <div class="player-slot-team">Team ${team}</div>
  `;
  elements.playersContainer.appendChild(slot);
  updateWaitingCount();
}

function addEmptySlot(index) {
  const team = (index % 2) + 1;
  const slot = document.createElement('div');
  slot.className = `player-slot empty`;
  slot.dataset.index = index;
  slot.innerHTML = `
    <div class="player-avatar">?</div>
    <div class="player-slot-name">Waiting...</div>
    <div class="player-slot-team">Team ${team}</div>
  `;
  elements.playersContainer.appendChild(slot);
}

function updateWaitingCount() {
  const filled = elements.playersContainer.querySelectorAll('.player-slot:not(.empty)').length;
  elements.playerCount.textContent = filled;

  if (gameState.mode === 'host' && filled >= 2) {
    elements.btnStartGame.classList.remove('hidden');
    const total = gameState.roomSize;
    elements.waitingText.textContent = filled >= total
      ? 'All players ready!'
      : 'Ready — bots will fill empty slots';
  }
}

function onPresenceEnter(member) {
  if (member.clientId === mp.playerId) return;
  mp.presenceNames[member.data.index] = member.data.name;
  addPlayerToWaiting(member.data.index, member.data.name);
  showMessage(`${member.data.name} joined!`);
}

function onPresenceLeave(member) {
  const slot = elements.playersContainer.querySelector(`[data-index="${member.data.index}"]`);
  if (slot) {
    slot.className = 'player-slot empty';
    slot.querySelector('.player-slot-name').textContent = 'Waiting...';
  }
  updateWaitingCount();
}

// === Start Multiplayer Game (Host) ===
function startMultiplayerGame() {
  const humanSlots = [];
  elements.playersContainer.querySelectorAll('.player-slot:not(.empty)').forEach(s => {
    humanSlots.push(parseInt(s.dataset.index));
  });

  gameState.isBot = [true, true, true, true];
  humanSlots.forEach(i => { gameState.isBot[i] = false; });

  const fallbackNames = ['South', 'West', 'North', 'East'];
  gameState.playerNames = Array.from({ length: 4 }, (_, i) => `Player ${i + 1}`);
  humanSlots.forEach(i => {
    gameState.playerNames[i] = mp.presenceNames[i] || fallbackNames[i];
  });
  for (let i = 0; i < 4; i++) {
    if (gameState.isBot[i]) gameState.playerNames[i] = fallbackNames[i];
  }

  gameState.scores = [0, 0];
  gameState.tricks = [0, 0];
  gameState.roundNumber = 1;
  gameState.trumpChooser = Math.floor(Math.random() * 4);
  gameState.gameStarted = true;

  dealCards();

  mp.channel.publish('game-start', {
    hands: gameState.hands,
    trumpChooser: gameState.trumpChooser,
    isBot: gameState.isBot,
    playerNames: gameState.playerNames,
    scores: [0, 0],
    roundNumber: 1
  });

  beginGame();
}

function beginGame() {
  resetGameUI();
  showScreen(elements.gameScreen);
  renderHands();
  setTimeout(() => selectTrump(), 1000);
}

// === Remote Event Handlers ===
function onGameStart(msg) {
  const d = msg.data;
  gameState.hands = d.hands;
  gameState.trumpChooser = d.trumpChooser;
  gameState.isBot = d.isBot;
  gameState.playerNames = d.playerNames;
  gameState.scores = d.scores;
  gameState.roundNumber = d.roundNumber;
  gameState.tricks = [0, 0];
  gameState.currentTrick = [];
  gameState.leadSuit = null;
  gameState.trump = null;
  gameState.trumpPreviewCards = gameState.hands[gameState.myPlayerIndex].slice(0, 4);
  gameState.currentPlayer = gameState.trumpChooser;
  gameState.gameStarted = true;
  beginGame();
}

function onRoundStart(msg) {
  const d = msg.data;
  gameState.hands = d.hands;
  gameState.trumpChooser = d.trumpChooser;
  gameState.roundNumber = d.roundNumber;
  gameState.tricks = [0, 0];
  gameState.currentTrick = [];
  gameState.leadSuit = null;
  gameState.trump = null;
  gameState.trumpPreviewCards = gameState.hands[gameState.myPlayerIndex].slice(0, 4);
  gameState.currentPlayer = gameState.trumpChooser;

  elements.roundModal.classList.add('hidden');
  elements.btnNextRound.textContent = 'Next Round';
  elements.btnNextRound.disabled = false;

  updateTricksDisplay();
  updateRoundDisplay();
  elements.trumpDisplay.textContent = '—';
  elements.trumpDisplay.className = 'trump-display';
  elements.trumpInfo.classList.remove('spades', 'hearts', 'diamonds', 'clubs');
  elements.playedCards.innerHTML = '';

  renderHands();
  setTimeout(() => selectTrump(), 800);
}

function onRemoteCardPlay(msg) {
  if (msg.clientId === mp.playerId) return;

  const { suit, rank, playerIndex } = msg.data;
  const card = { suit, rank };

  const hand = gameState.hands[playerIndex];
  if (hand) {
    const i = hand.findIndex(c => c.suit === suit && c.rank === rank);
    if (i > -1) hand.splice(i, 1);
  }

  addCardToTrick(card, playerIndex);
  if (playerIndex !== gameState.myPlayerIndex) updateBotHand(playerIndex);

  if (gameState.mode === 'host') {
    // Guest played — host advances game
    setTimeout(() => nextTurn(), 600);
  } else {
    // Guest: received card from host/another player
    if (gameState.currentTrick.length === 4) {
      setTimeout(() => resolveTrick(), 600);
    } else {
      // Advance currentPlayer pointer for guests
      gameState.currentPlayer = (playerIndex + 1) % 4;
      if (gameState.currentPlayer === gameState.myPlayerIndex) {
        gameState.isPlayerTurn = true;
        elements.currentTurn.textContent = 'Your turn';
        elements.currentTurn.classList.remove('hidden');
        updatePlayableCards();
      }
    }
  }
}

function onRemoteTrumpSelected(msg) {
  if (msg.clientId === mp.playerId) return;
  const { suit, playerIndex } = msg.data;
  applyTrump(suit);
  showMessage(`${gameState.playerNames[playerIndex]} chose ${SUIT_SYMBOLS[suit]} as trump`);
  setTimeout(() => startPlay(), 1500);
}

// === Event Listeners ===
function initEventListeners() {
  elements.btnSolo.addEventListener('click', startSinglePlayer);
  elements.btnOnline.addEventListener('click', () => {
    elements.playerNameInput.value = loadPlayerName();
    showScreen(elements.lobbyScreen);
  });
  elements.btnSettings.addEventListener('click', () => {
    syncSettingsUI();
    showScreen(elements.settingsScreen);
  });
  elements.btnBackSettings.addEventListener('click', () => showScreen(elements.menuScreen));

  elements.themeCards.forEach(card => {
    card.addEventListener('click', () => {
      settings.theme = card.dataset.theme;
      saveSettings();
      applyTheme(settings.theme);
    });
  });

  elements.optionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const val = btn.dataset.val;
      settings[key] = val;
      saveSettings();
      btn.closest('.option-row').querySelectorAll('.option-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (key === 'animations') applyAnimations(val);
    });
  });

  elements.btnBackMenu.addEventListener('click', () => {
    disconnectAbly();
    setConnectionStatus(null);
    showScreen(elements.menuScreen);
  });

  elements.sizeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      elements.sizeTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      mp.pendingRoomSize = parseInt(tab.dataset.size);
    });
  });

  elements.btnCreateRoom.addEventListener('click', createRoom);

  elements.btnJoinRoom.addEventListener('click', () => {
    const code = elements.roomCodeInput.value.trim().toUpperCase();
    if (code.length !== 4) { showMessage('Enter a 4-letter room code'); return; }
    joinRoom(code);
  });

  elements.btnCopyCode.addEventListener('click', () => {
    const code = gameState.roomCode;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      elements.btnCopyCode.classList.add('copied');
      setTimeout(() => elements.btnCopyCode.classList.remove('copied'), 1500);
    });
  });

  elements.btnLeaveRoom.addEventListener('click', () => {
    disconnectAbly();
    setConnectionStatus(null);
    showScreen(elements.menuScreen);
  });

  elements.btnStartGame.addEventListener('click', startMultiplayerGame);

  elements.trumpBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const suit = btn.dataset.suit;
      applyTrump(suit);
      playSound('trump');
      showMessage(`You chose ${SUIT_SYMBOLS[suit]} as trump`);
      if (gameState.mode !== 'single') {
        mp.channel.publish('trump-selected', { suit, playerIndex: gameState.myPlayerIndex });
      }
      const delay = gameState.mode === 'single' ? 800 : 1500;
      setTimeout(() => startPlay(), delay);
    });
  });

  elements.btnNextRound.addEventListener('click', () => {
    if (gameState.mode !== 'guest') startNextRound();
  });

  elements.btnPlayAgain.addEventListener('click', () => {
    if (gameState.mode === 'single') startSinglePlayer();
    else resetToMenu();
  });
  elements.btnBackToMenu.addEventListener('click', resetToMenu);

  elements.btnGameMenu.addEventListener('click', () => elements.gameMenuModal.classList.remove('hidden'));
  elements.btnResume.addEventListener('click', () => elements.gameMenuModal.classList.add('hidden'));
  elements.btnQuit.addEventListener('click', resetToMenu);

  elements.roomCodeInput.addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  elements.playerNameInput.addEventListener('input', e => {
    savePlayerName(e.target.value.trim());
  });
}

function syncSettingsUI() {
  document.querySelectorAll('.theme-card').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === settings.theme);
  });
  document.querySelectorAll('.option-btn').forEach(btn => {
    btn.classList.toggle('active', settings[btn.dataset.key] === btn.dataset.val);
  });
}

// === Init ===
function init() {
  initElements();
  loadSettings();
  initEventListeners();
  mp.pendingRoomSize = 4;
  showScreen(elements.menuScreen);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
