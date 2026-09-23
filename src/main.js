// ===== Omi Card Game =====

import { Realtime } from 'ably';

// Add your free Ably API key from https://ably.com
const ABLY_API_KEY = 'j2A0-A.Cr1qtA:ojdgVsJef0B2e_W-Lwh2WlYlN_5jX7tnCtmXTxkvuQM';

// === Constants ===
const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_SYMBOLS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
const RANK_VALUES = { '7': 1, '8': 2, '9': 3, '10': 4, 'J': 5, 'Q': 6, 'K': 7, 'A': 8 };
const FIGHT_TEXT = { pixel: 'FIGHT!', classic: 'PLAY!', neon: 'ENGAGE!', minimal: 'GO' };

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
  playSequence: 0,
  phase: 'idle',
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
  seatAssignments: {},  // host-managed: clientId → seat index 0-3
  clientNames: {},      // clientId → display name
  selectedSeat: null,   // host UI: first seat clicked for swap
  hostId: null
};

// Invalidates delayed game-flow callbacks whenever a new game/round begins.
// UI-only timers (messages and overlays) deliberately do not use this token.
let flowGeneration = 0;
function resetGameFlow() { flowGeneration++; }
function scheduleGameFlow(callback, delay) {
  const generation = flowGeneration;
  setTimeout(() => {
    if (generation === flowGeneration && gameState.gameStarted) callback();
  }, delay);
}

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
  elements.team1Label = document.getElementById('team1-label');
  elements.team2Label = document.getElementById('team2-label');
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
  elements.fightText = document.getElementById('fight-text');

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
  if (!gameState.isPlayerTurn || gameState.phase !== 'playing' || cardEl.classList.contains('disabled')) return;
  gameState.isPlayerTurn = false;
  const my = gameState.myPlayerIndex;

  // Guests request a play; only the host mutates and broadcasts game state.
  // This keeps every client on one ordered event stream and lets the host
  // reject stale, out-of-turn, or illegal plays.
  if (gameState.mode === 'guest') {
    elements.currentTurn.classList.add('hidden');
    updatePlayableCards();
    mp.channel.publish('play-request', {
      suit: card.suit,
      rank: card.rank,
      playerIndex: my,
      roundNumber: gameState.roundNumber
    });
    return;
  }

  playSound('play');
  const idx = gameState.hands[my].findIndex(c => c.suit === card.suit && c.rank === card.rank);
  if (idx > -1) gameState.hands[my].splice(idx, 1);

  addCardToTrick(card, my);
  renderPlayerHand();
  elements.currentTurn.classList.add('hidden');

  if (gameState.mode === 'host') publishCardPlay(card, my);
  nextTurn();
}

function publishCardPlay(card, playerIndex) {
  gameState.playSequence++;
  mp.channel.publish('card-play', {
    suit: card.suit,
    rank: card.rank,
    playerIndex,
    roundNumber: gameState.roundNumber,
    playSequence: gameState.playSequence
  });
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
  if (gameState.phase !== 'playing') return;
  if (gameState.currentTrick.length === 4) { resolveTrick(); return; }

  gameState.currentPlayer = (gameState.currentPlayer + 1) % 4;
  const cp = gameState.currentPlayer;

  if (cp === gameState.myPlayerIndex) {
    gameState.isPlayerTurn = true;
    elements.currentTurn.textContent = 'Your turn';
    elements.currentTurn.classList.remove('hidden');
    updatePlayableCards();
    playSound('your-turn');
  } else if (gameState.isBot[cp] && gameState.mode !== 'guest') {
    scheduleGameFlow(() => {
      if (gameState.phase !== 'playing' || gameState.currentPlayer !== cp) return;
      const played = botPlayCard(cp);
      if (played && gameState.mode === 'host') {
        publishCardPlay(played, cp);
      }
      nextTurn();
    }, getBotThinkDelay());
  }
  // else: human guest turn — wait for their card-play message
}

function resolveTrick() {
  if (gameState.phase !== 'playing' || gameState.currentTrick.length !== 4) return;
  gameState.phase = 'resolving';
  gameState.isPlayerTurn = false;
  elements.currentTurn.classList.add('hidden');
  updatePlayableCards();

  const winner = getCurrentWinner();
  const team = winner.playerIndex % 2;
  gameState.tricks[team]++;
  updateTricksDisplay();

  const isMyTeam = winner.playerIndex % 2 === gameState.myPlayerIndex % 2;
  playSound(isMyTeam ? 'win-trick' : 'lose-trick');

  const rel = (winner.playerIndex - gameState.myPlayerIndex + 4) % 4;
  elements.playedCards.classList.add(['fly-south', 'fly-west', 'fly-north', 'fly-east'][rel]);

  // Snapshot before clearing so animation still plays correctly
  const isLastTrick = gameState.hands[gameState.myPlayerIndex].length === 0;
  const winnerIndex = winner.playerIndex;

  scheduleGameFlow(() => {
    elements.playedCards.innerHTML = '';
    elements.playedCards.classList.remove('fly-south', 'fly-west', 'fly-north', 'fly-east');
    gameState.currentTrick = [];
    gameState.leadSuit = null;

    if (isLastTrick) {
      endRound();
      return;
    }

    gameState.currentPlayer = winnerIndex;
    gameState.phase = 'playing';
    if (gameState.mode === 'host') {
      mp.channel.publish('trick-resolved', {
        roundNumber: gameState.roundNumber,
        winnerIndex,
        tricks: [...gameState.tricks],
        nextPlayer: winnerIndex
      });
    }
    const cp = gameState.currentPlayer;

    if (cp === gameState.myPlayerIndex) {
      gameState.isPlayerTurn = true;
      elements.currentTurn.textContent = 'Your turn to lead';
      elements.currentTurn.classList.remove('hidden');
      updatePlayableCards();
      playSound('your-turn');
    } else if (gameState.isBot[cp] && gameState.mode !== 'guest') {
      scheduleGameFlow(() => {
        if (gameState.phase !== 'playing' || gameState.currentPlayer !== cp) return;
        const played = botPlayCard(cp);
        if (played && gameState.mode === 'host') {
          publishCardPlay(played, cp);
        }
        nextTurn();
      }, getBotThinkDelay());
    }
    // else: wait for guest to lead or next card-play event
  }, getTrickDelay());
}

function updateTricksDisplay() {
  const myTeam = gameState.myPlayerIndex % 2;
  const theirTeam = 1 - myTeam;
  elements.team1Tricks.textContent = gameState.tricks[myTeam];
  elements.team2Tricks.textContent = gameState.tricks[theirTeam];
  elements.tricksDisplay.innerHTML = `
    <span class="tricks-you">${gameState.tricks[myTeam]}</span>
    <span class="tricks-separator">-</span>
    <span class="tricks-opp">${gameState.tricks[theirTeam]}</span>
  `;
}

function updateTeamDisplay() {
  const my = gameState.myPlayerIndex;
  const partner = (my + 2) % 4;
  const leftOpponent = (my + 1) % 4;
  const rightOpponent = (my + 3) % 4;
  elements.team1Label.textContent = `${gameState.playerNames[my]} + ${gameState.playerNames[partner]}`;
  elements.team2Label.textContent = `${gameState.playerNames[leftOpponent]} + ${gameState.playerNames[rightOpponent]}`;

  const myTeam = my % 2;
  elements.team1Score.textContent = gameState.scores[myTeam];
  elements.team2Score.textContent = gameState.scores[1 - myTeam];
  updateTricksDisplay();
  updateScoreBars();
}

function endRound() {
  const t1 = gameState.tricks[0], t2 = gameState.tricks[1];
  let p1 = 0, p2 = 0;
  if (t1 >= 5) p1 = t1 === 8 ? 3 : t1 >= 7 ? 2 : 1;
  else if (t2 >= 5) p2 = t2 === 8 ? 3 : t2 >= 7 ? 2 : 1;

  gameState.scores[0] += p1;
  gameState.scores[1] += p2;
  gameState.phase = 'round-end';
  showRoundEnd(t1, t2);

  if (gameState.mode === 'host') {
    mp.channel.publish('round-ended', {
      roundNumber: gameState.roundNumber,
      tricks: [...gameState.tricks],
      scores: [...gameState.scores]
    });
  }
}

function showRoundEnd(t1, t2) {
  const myTeam = gameState.myPlayerIndex % 2;
  const myTricks = gameState.tricks[myTeam];
  const theirTricks = gameState.tricks[1 - myTeam];
  const myScore = gameState.scores[myTeam];
  const theirScore = gameState.scores[1 - myTeam];
  const winningTeam = t1 >= 5 ? 0 : t2 >= 5 ? 1 : null;
  const points = winningTeam === 0
    ? (t1 === 8 ? 3 : t1 >= 7 ? 2 : 1)
    : winningTeam === 1 ? (t2 === 8 ? 3 : t2 >= 7 ? 2 : 1) : 0;
  const msg = winningTeam === null
    ? 'Draw! No points awarded.'
    : `${winningTeam === myTeam ? 'Your team' : 'Opponents'} win ${points} point${points > 1 ? 's' : ''}!`;

  updateTeamDisplay();

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
        <div class="result-row"><span>Tricks</span><span><strong>${myTricks}</strong> - <strong>${theirTricks}</strong></span></div>
        <div class="result-row"><span>Score</span><span><strong>${myScore}</strong> - <strong>${theirScore}</strong></span></div>
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
  const myTeam = gameState.myPlayerIndex % 2;
  const youWin = gameState.scores[myTeam] >= 10;
  playSound(youWin ? 'game-win' : 'game-lose');
  elements.winnerTitle.textContent = youWin ? 'Victory!' : 'Defeat';
  elements.winnerMessage.innerHTML = `
    <div class="game-result">
      <div class="result-main">${youWin ? 'Your team wins!' : 'Opponents win!'}</div>
      <div class="result-score"><span class="final-score">${gameState.scores[myTeam]} - ${gameState.scores[1 - myTeam]}</span></div>
      <div class="result-rounds">Completed in ${gameState.roundNumber} rounds</div>
    </div>
  `;
  // Guests can't replay
  elements.btnPlayAgain.classList.toggle('hidden', gameState.mode === 'guest');
  elements.winnerModal.classList.remove('hidden');
}

function startNextRound() {
  resetGameFlow();
  elements.roundModal.classList.add('hidden');
  gameState.roundNumber++;
  gameState.tricks = [0, 0];
  gameState.currentTrick = [];
  gameState.leadSuit = null;
  gameState.trump = null;
  gameState.playSequence = 0;
  gameState.phase = 'trump';
  gameState.isPlayerTurn = false;
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
      roundNumber: gameState.roundNumber,
      scores: [...gameState.scores],
      playerNames: gameState.playerNames
    });
  }

  renderHands();
  scheduleGameFlow(() => selectTrump(), 800);
}

function updateRoundDisplay() {
  elements.roundDisplay.textContent = gameState.roundNumber;
}

function updateScoreBars() {
  const myTeam = gameState.myPlayerIndex % 2;
  const pct1 = Math.min((gameState.scores[myTeam] / 10) * 100, 100) + '%';
  const pct2 = Math.min((gameState.scores[1 - myTeam] / 10) * 100, 100) + '%';
  elements.team1Panel.style.setProperty('--score-pct', pct1);
  elements.team2Panel.style.setProperty('--score-pct', pct2);
}

function showFightOverlay() {
  elements.fightRoundText.textContent = `ROUND ${gameState.roundNumber}`;
  elements.fightText.textContent = FIGHT_TEXT[settings.theme] || 'FIGHT!';
  elements.fightOverlay.classList.remove('hidden');
  setTimeout(() => elements.fightOverlay.classList.add('hidden'), 1900);
  playSound('fight');
}

// === Trump ===
function selectTrump() {
  if (!gameState.gameStarted || gameState.phase !== 'trump' || gameState.trump) return;
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
      mp.channel.publish('trump-selected', { suit: best, playerIndex: tc, roundNumber: gameState.roundNumber });
    }
    scheduleGameFlow(() => startPlay(), 1500);
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
  if (gameState.phase === 'playing') return;
  if (gameState.mode === 'host') {
    mp.channel.publish('play-started', {
      roundNumber: gameState.roundNumber,
      currentPlayer: gameState.trumpChooser
    });
  }
  showFightOverlay();
  gameState.phase = 'playing';
  gameState.currentPlayer = gameState.trumpChooser;
  const cp = gameState.currentPlayer;

  if (cp === gameState.myPlayerIndex) {
    gameState.isPlayerTurn = true;
    elements.currentTurn.textContent = 'Your turn to lead';
    elements.currentTurn.classList.remove('hidden');
    updatePlayableCards();
  } else if (gameState.isBot[cp] && gameState.mode !== 'guest') {
    scheduleGameFlow(() => {
      if (gameState.phase !== 'playing' || gameState.currentPlayer !== cp) return;
      const played = botPlayCard(cp);
      if (played && gameState.mode === 'host') {
        publishCardPlay(played, cp);
      }
      nextTurn();
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
  resetGameFlow();
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
  gameState.playSequence = 0;
  gameState.phase = 'trump';

  resetGameUI();
  showScreen(elements.gameScreen);
  dealCards();
  renderHands();
  scheduleGameFlow(() => selectTrump(), 1000);
}

function resetGameUI() {
  updateTeamDisplay();
  updateRoundDisplay();
  elements.trumpDisplay.textContent = '—';
  elements.trumpDisplay.className = 'trump-display';
  elements.trumpInfo.classList.remove('spades', 'hearts', 'diamonds', 'clubs');
  elements.playedCards.innerHTML = '';
  elements.currentTurn.classList.add('hidden');
}

function resetToMenu() {
  resetGameFlow();
  gameState.gameStarted = false;
  gameState.phase = 'idle';
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
  mp.seatAssignments = {};
  mp.clientNames = {};
  mp.selectedSeat = null;
  mp.hostId = null;
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
  mp.seatAssignments = { [mp.playerId]: 0 };
  mp.clientNames    = { [mp.playerId]: myName };
  mp.selectedSeat   = null;
  mp.hostId         = mp.playerId;

  mp.channel = mp.client.channels.get(`omi-${code}`);
  mp.channel.subscribe('play-request', onPlayRequest);
  mp.channel.subscribe('trump-request', onTrumpRequest);
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
  const hostMember = members.find(m => m.data.index === 0 && m.data.roomSize);
  if (!hostMember) {
    showMessage('Room not found');
    disconnectAbly();
    setConnectionStatus(null);
    return;
  }
  const roomSize = hostMember.data.roomSize;
  const taken = members.map(m => m.data.index);

  // Find next available slot
  let myIndex = 1;
  while (taken.includes(myIndex) && myIndex < roomSize) myIndex++;
  if (myIndex >= roomSize) { showMessage('Room is full!'); disconnectAbly(); setConnectionStatus(null); return; }

  const myName = getPlayerName();
  savePlayerName(myName);
  mp.clientNames  = { [mp.playerId]: myName };
  mp.selectedSeat = null;
  members.forEach(m => { mp.clientNames[m.clientId] = m.data.name; });

  gameState.roomCode = code;
  gameState.mode = 'guest';
  gameState.myPlayerIndex = myIndex;
  gameState.roomSize = roomSize;

  mp.channel.subscribe('game-start', onGameStart);
  mp.channel.subscribe('card-play', onRemoteCardPlay);
  mp.channel.subscribe('trump-selected', onRemoteTrumpSelected);
  mp.channel.subscribe('round-start', onRoundStart);
  mp.channel.subscribe('seat-swap', onSeatSwap);
  mp.channel.subscribe('lobby-state', onLobbyState);
  mp.channel.subscribe('trick-resolved', onTrickResolved);
  mp.channel.subscribe('round-ended', onRoundEnded);
  mp.channel.subscribe('play-rejected', onPlayRejected);
  mp.channel.subscribe('play-started', onPlayStarted);
  mp.channel.presence.subscribe('enter', onPresenceEnter);
  mp.channel.presence.subscribe('leave', onPresenceLeave);

  await mp.channel.presence.enter({ name: myName, index: myIndex });
  setConnectionStatus('connected');

  // Determine size from existing members if host already set roomSize
  mp.hostId = hostMember?.clientId || null;

  showWaitingRoom(code, roomSize);
  members.forEach(m => updateSeatSlot(m.data.index, m.data.name, true));
  updateSeatSlot(myIndex, myName, true);
}

// === Waiting Room UI ===
function showWaitingRoom(code, size) {
  elements.displayRoomCode.innerHTML = code.split('').map(ch =>
    `<div class="room-code-char">${ch}</div>`
  ).join('');
  elements.playerCountMax.textContent = size;
  elements.playerCount.textContent = '0';
  elements.btnStartGame.classList.add('hidden');
  elements.waitingText.textContent = 'Waiting for players...';

  const isHost = gameState.mode === 'host';
  buildTeamGrid(isHost);
  if (isHost) updateSeatSlot(0, getPlayerName(), true);

  showScreen(elements.waitingScreen);
}

function buildTeamGrid(isHost) {
  const sw = isHost ? ' swappable' : '';
  elements.playersContainer.innerHTML = `
    <div class="team-grid">
      <div class="team-col">
        <div class="team-col-label t1-label">Team 1</div>
        <div class="seat-slot${sw}" id="seat-0"><span class="seat-pos">S</span><span class="seat-name">Bot</span></div>
        <div class="seat-slot${sw}" id="seat-2"><span class="seat-pos">N</span><span class="seat-name">Bot</span></div>
      </div>
      <div class="team-col">
        <div class="team-col-label t2-label">Team 2</div>
        <div class="seat-slot${sw}" id="seat-1"><span class="seat-pos">W</span><span class="seat-name">Bot</span></div>
        <div class="seat-slot${sw}" id="seat-3"><span class="seat-pos">E</span><span class="seat-name">Bot</span></div>
      </div>
    </div>
    ${isHost ? '<p class="swap-hint" id="swap-hint">Select a seat to reassign</p>' : ''}
  `;
  if (isHost) {
    elements.playersContainer.querySelectorAll('.seat-slot').forEach(el => {
      el.addEventListener('click', () => onSeatClick(parseInt(el.id.slice(5))));
    });
  }
}

function updateSeatSlot(seat, name, isHuman) {
  const slot = document.getElementById(`seat-${seat}`);
  if (!slot) return;
  slot.querySelector('.seat-name').textContent = name;
  slot.classList.toggle('occupied', isHuman);
  updateWaitingCount();
}

function onSeatClick(seat) {
  if (mp.selectedSeat === null) {
    mp.selectedSeat = seat;
    document.getElementById(`seat-${seat}`).classList.add('swap-selected');
    const hint = document.getElementById('swap-hint');
    if (hint) hint.textContent = 'Now select another seat to swap with';
  } else if (mp.selectedSeat === seat) {
    document.getElementById(`seat-${seat}`).classList.remove('swap-selected');
    mp.selectedSeat = null;
    const hint = document.getElementById('swap-hint');
    if (hint) hint.textContent = 'Select a seat to reassign';
  } else {
    const seatA = mp.selectedSeat;
    document.getElementById(`seat-${seatA}`).classList.remove('swap-selected');
    mp.selectedSeat = null;
    swapSeats(seatA, seat);
    const hint = document.getElementById('swap-hint');
    if (hint) hint.textContent = 'Select a seat to reassign';
  }
}

function swapSeats(seatA, seatB) {
  const slotA = document.getElementById(`seat-${seatA}`);
  const slotB = document.getElementById(`seat-${seatB}`);
  if (!slotA || !slotB) return;

  const nameA = slotA.querySelector('.seat-name').textContent;
  const nameB = slotB.querySelector('.seat-name').textContent;
  const humanA = slotA.classList.contains('occupied');
  const humanB = slotB.classList.contains('occupied');

  // Swap display without triggering updateWaitingCount twice
  slotA.querySelector('.seat-name').textContent = nameB;
  slotA.classList.toggle('occupied', humanB);
  slotB.querySelector('.seat-name').textContent = nameA;
  slotB.classList.toggle('occupied', humanA);
  updateWaitingCount();

  // Update seatAssignments
  const entries = Object.entries(mp.seatAssignments);
  const clientAtA = entries.find(([, s]) => s === seatA)?.[0];
  const clientAtB = entries.find(([, s]) => s === seatB)?.[0];
  if (clientAtA) mp.seatAssignments[clientAtA] = seatB;
  if (clientAtB) mp.seatAssignments[clientAtB] = seatA;

  mp.channel.publish('seat-swap', { seatA, seatB });
  publishLobbyState();
}

function onSeatSwap(msg) {
  if (msg.clientId === mp.playerId) return;
  if (mp.hostId && msg.clientId !== mp.hostId) return;
  const { seatA, seatB } = msg.data;
  const slotA = document.getElementById(`seat-${seatA}`);
  const slotB = document.getElementById(`seat-${seatB}`);
  if (!slotA || !slotB) return;

  const nameA = slotA.querySelector('.seat-name').textContent;
  const nameB = slotB.querySelector('.seat-name').textContent;
  const humanA = slotA.classList.contains('occupied');
  const humanB = slotB.classList.contains('occupied');

  slotA.querySelector('.seat-name').textContent = nameB;
  slotA.classList.toggle('occupied', humanB);
  slotB.querySelector('.seat-name').textContent = nameA;
  slotB.classList.toggle('occupied', humanA);
}

function updateWaitingCount() {
  const filled = elements.playersContainer.querySelectorAll('.seat-slot.occupied').length;
  elements.playerCount.textContent = filled;

  if (gameState.mode === 'host') {
    if (filled >= 2) {
      elements.btnStartGame.classList.remove('hidden');
      const total = gameState.roomSize;
      elements.waitingText.textContent = filled >= total
        ? 'All players ready!'
        : 'Ready — bots will fill empty seats';
    } else {
      elements.btnStartGame.classList.add('hidden');
      elements.waitingText.textContent = 'Waiting for players...';
    }
  }
}

function onPresenceEnter(member) {
  if (member.clientId === mp.playerId) return;
  mp.clientNames[member.clientId] = member.data.name;
  if (gameState.mode === 'host') {
    const occupied = new Set(Object.values(mp.seatAssignments));
    const requested = Number(member.data.index);
    const seat = requested >= 0 && requested < gameState.roomSize && !occupied.has(requested)
      ? requested
      : [0, 1, 2, 3].find(i => i < gameState.roomSize && !occupied.has(i));
    if (seat === undefined) return;
    mp.seatAssignments[member.clientId] = seat;
    updateSeatSlot(seat, member.data.name, true);
    publishLobbyState();
  } else {
    updateSeatSlot(member.data.index, member.data.name, true);
  }
  showMessage(`${member.data.name} joined!`);
}

function onPresenceLeave(member) {
  if (gameState.mode === 'host') {
    const seat = mp.seatAssignments[member.clientId];
    delete mp.seatAssignments[member.clientId];
    delete mp.clientNames[member.clientId];
    if (seat !== undefined) updateSeatSlot(seat, 'Bot', false);
    publishLobbyState();
  } else {
    // Guest: find the slot showing this player's name
    for (let i = 0; i < 4; i++) {
      const el = document.getElementById(`seat-${i}`);
      if (el && el.querySelector('.seat-name')?.textContent === member.data.name) {
        updateSeatSlot(i, 'Bot', false);
        break;
      }
    }
  }
}

function publishLobbyState() {
  if (gameState.mode !== 'host' || !mp.channel) return;
  mp.channel.publish('lobby-state', {
    seatAssignments: mp.seatAssignments,
    clientNames: mp.clientNames,
    roomSize: gameState.roomSize,
    hostId: mp.playerId
  });
}

function onLobbyState(msg) {
  if (gameState.mode !== 'guest') return;
  if (mp.hostId && msg.clientId !== mp.hostId) return;
  const d = msg.data;
  mp.hostId = d.hostId || msg.clientId;
  mp.seatAssignments = { ...d.seatAssignments };
  mp.clientNames = { ...d.clientNames };
  gameState.roomSize = d.roomSize || gameState.roomSize;
  if (mp.seatAssignments[mp.playerId] !== undefined) {
    gameState.myPlayerIndex = mp.seatAssignments[mp.playerId];
  }
  buildTeamGrid(false);
  for (const [clientId, seat] of Object.entries(mp.seatAssignments)) {
    updateSeatSlot(seat, mp.clientNames[clientId] || 'Player', true);
  }
}

// === Start Multiplayer Game (Host) ===
function startMultiplayerGame() {
  resetGameFlow();
  // Build isBot and playerNames from seatAssignments
  const humanSeats = new Set(Object.values(mp.seatAssignments));
  const fallback = ['South', 'West', 'North', 'East'];

  gameState.isBot = [0, 1, 2, 3].map(i => !humanSeats.has(i));
  gameState.playerNames = fallback.slice();
  for (const [clientId, seat] of Object.entries(mp.seatAssignments)) {
    gameState.playerNames[seat] = mp.clientNames[clientId] || fallback[seat];
  }

  // Host's own seat may have changed via swaps
  gameState.myPlayerIndex = mp.seatAssignments[mp.playerId] ?? 0;

  gameState.scores = [0, 0];
  gameState.tricks = [0, 0];
  gameState.roundNumber = 1;
  gameState.trumpChooser = Math.floor(Math.random() * 4);
  gameState.gameStarted = true;
  gameState.playSequence = 0;
  gameState.phase = 'trump';

  dealCards();

  mp.channel.publish('game-start', {
    hands: gameState.hands,
    trumpChooser: gameState.trumpChooser,
    isBot: gameState.isBot,
    playerNames: gameState.playerNames,
    seatAssignments: mp.seatAssignments,
    hostId: mp.playerId,
    scores: [0, 0],
    roundNumber: 1
  });

  beginGame();
}

function beginGame() {
  setConnectionStatus(null);
  resetGameUI();
  showScreen(elements.gameScreen);
  renderHands();
  updateTeamDisplay();
  scheduleGameFlow(() => selectTrump(), 1000);
}

// === Remote Event Handlers ===
function onGameStart(msg) {
  if (mp.hostId && msg.clientId !== mp.hostId) return;
  const d = msg.data;
  resetGameFlow();
  mp.hostId = d.hostId || msg.clientId;

  // Resolve guest's final seat from host's seatAssignments
  if (d.seatAssignments && d.seatAssignments[mp.playerId] !== undefined) {
    gameState.myPlayerIndex = d.seatAssignments[mp.playerId];
  }

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
  gameState.playSequence = 0;
  gameState.phase = 'trump';
  beginGame();
}

function onRoundStart(msg) {
  if (mp.hostId && msg.clientId !== mp.hostId) return;
  const d = msg.data;
  if (d.roundNumber <= gameState.roundNumber) return;
  resetGameFlow();
  gameState.hands = d.hands;
  gameState.trumpChooser = d.trumpChooser;
  gameState.roundNumber = d.roundNumber;
  if (d.scores) {
    gameState.scores = d.scores;
  }
  if (d.playerNames) gameState.playerNames = d.playerNames;
  gameState.tricks = [0, 0];
  gameState.currentTrick = [];
  gameState.leadSuit = null;
  gameState.trump = null;
  gameState.trumpPreviewCards = gameState.hands[gameState.myPlayerIndex].slice(0, 4);
  gameState.currentPlayer = gameState.trumpChooser;
  gameState.playSequence = 0;
  gameState.phase = 'trump';
  gameState.isPlayerTurn = false;

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
  updateTeamDisplay();
  scheduleGameFlow(() => selectTrump(), 800);
}

function isLegalPlay(playerIndex, suit, rank) {
  if (gameState.phase !== 'playing' || gameState.currentPlayer !== playerIndex) return false;
  const hand = gameState.hands[playerIndex];
  const card = hand?.find(c => c.suit === suit && c.rank === rank);
  if (!card) return false;
  return !gameState.leadSuit || card.suit === gameState.leadSuit
    || !hand.some(c => c.suit === gameState.leadSuit);
}

function onPlayRequest(msg) {
  if (gameState.mode !== 'host') return;
  const { suit, rank, playerIndex, roundNumber } = msg.data;
  if (roundNumber !== gameState.roundNumber
      || mp.seatAssignments[msg.clientId] !== playerIndex
      || !isLegalPlay(playerIndex, suit, rank)) {
    mp.channel.publish('play-rejected', {
      clientId: msg.clientId,
      roundNumber: gameState.roundNumber,
      currentPlayer: gameState.currentPlayer
    });
    return;
  }
  const hand = gameState.hands[playerIndex];
  const index = hand.findIndex(c => c.suit === suit && c.rank === rank);
  const [card] = hand.splice(index, 1);
  addCardToTrick(card, playerIndex);
  updateBotHand(playerIndex);
  playSound('play');
  publishCardPlay(card, playerIndex);
  nextTurn();
}

function onPlayRejected(msg) {
  if (msg.data.clientId !== mp.playerId || msg.data.roundNumber !== gameState.roundNumber) return;
  if (msg.data.currentPlayer === gameState.myPlayerIndex && gameState.phase === 'playing') {
    gameState.isPlayerTurn = true;
    elements.currentTurn.textContent = 'Your turn';
    elements.currentTurn.classList.remove('hidden');
    updatePlayableCards();
  }
}

function onRemoteCardPlay(msg) {
  if (gameState.mode !== 'guest' || (mp.hostId && msg.clientId !== mp.hostId)) return;
  const { suit, rank, playerIndex, roundNumber, playSequence } = msg.data;
  if (roundNumber !== gameState.roundNumber || playSequence <= gameState.playSequence) return;
  gameState.playSequence = playSequence;
  const card = { suit, rank };
  const hand = gameState.hands[playerIndex];
  if (hand) {
    const i = hand.findIndex(c => c.suit === suit && c.rank === rank);
    if (i > -1) hand.splice(i, 1);
  }
  addCardToTrick(card, playerIndex);
  if (playerIndex === gameState.myPlayerIndex) renderPlayerHand();
  else updateBotHand(playerIndex);
  playSound('play');

  if (gameState.currentTrick.length === 4) {
    gameState.phase = 'resolving';
    gameState.isPlayerTurn = false;
    elements.currentTurn.classList.add('hidden');
    updatePlayableCards();
    const winner = getCurrentWinner();
    const rel = (winner.playerIndex - gameState.myPlayerIndex + 4) % 4;
    elements.playedCards.classList.add(['fly-south', 'fly-west', 'fly-north', 'fly-east'][rel]);
  } else {
    gameState.currentPlayer = (playerIndex + 1) % 4;
    if (gameState.currentPlayer === gameState.myPlayerIndex) {
      gameState.isPlayerTurn = true;
      elements.currentTurn.textContent = 'Your turn';
      elements.currentTurn.classList.remove('hidden');
      updatePlayableCards();
      playSound('your-turn');
    }
  }
}

function onTrickResolved(msg) {
  if (gameState.mode !== 'guest' || (mp.hostId && msg.clientId !== mp.hostId)) return;
  const d = msg.data;
  if (d.roundNumber !== gameState.roundNumber) return;
  gameState.tricks = [...d.tricks];
  gameState.currentTrick = [];
  gameState.leadSuit = null;
  gameState.currentPlayer = d.nextPlayer;
  gameState.phase = 'playing';
  elements.playedCards.innerHTML = '';
  elements.playedCards.classList.remove('fly-south', 'fly-west', 'fly-north', 'fly-east');
  updateTricksDisplay();
  if (d.nextPlayer === gameState.myPlayerIndex) {
    gameState.isPlayerTurn = true;
    elements.currentTurn.textContent = 'Your turn to lead';
    elements.currentTurn.classList.remove('hidden');
    updatePlayableCards();
    playSound('your-turn');
  }
}

function onRoundEnded(msg) {
  if (gameState.mode !== 'guest' || (mp.hostId && msg.clientId !== mp.hostId)) return;
  const d = msg.data;
  if (d.roundNumber !== gameState.roundNumber) return;
  gameState.tricks = [...d.tricks];
  gameState.scores = [...d.scores];
  gameState.currentTrick = [];
  gameState.leadSuit = null;
  gameState.phase = 'round-end';
  gameState.isPlayerTurn = false;
  elements.playedCards.innerHTML = '';
  elements.playedCards.classList.remove('fly-south', 'fly-west', 'fly-north', 'fly-east');
  showRoundEnd(gameState.tricks[0], gameState.tricks[1]);
}

function onTrumpRequest(msg) {
  if (gameState.mode !== 'host') return;
  const { suit, playerIndex, roundNumber } = msg.data;
  if (roundNumber !== gameState.roundNumber
      || gameState.phase !== 'trump'
      || playerIndex !== gameState.trumpChooser
      || mp.seatAssignments[msg.clientId] !== playerIndex
      || !SUITS.includes(suit)) return;
  applyTrump(suit);
  mp.channel.publish('trump-selected', { suit, playerIndex, roundNumber: gameState.roundNumber });
  showMessage(`${gameState.playerNames[playerIndex]} chose ${SUIT_SYMBOLS[suit]} as trump`);
  scheduleGameFlow(() => startPlay(), 1500);
}

function onRemoteTrumpSelected(msg) {
  if (gameState.mode !== 'guest' || (mp.hostId && msg.clientId !== mp.hostId)) return;
  const { suit, playerIndex, roundNumber } = msg.data;
  if (roundNumber !== gameState.roundNumber || gameState.phase !== 'trump') return;
  applyTrump(suit);
  showMessage(`${gameState.playerNames[playerIndex]} chose ${SUIT_SYMBOLS[suit]} as trump`);
}

function onPlayStarted(msg) {
  if (gameState.mode !== 'guest' || (mp.hostId && msg.clientId !== mp.hostId)) return;
  if (msg.data.roundNumber !== gameState.roundNumber || gameState.phase !== 'trump') return;
  startPlay();
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
      if (gameState.phase !== 'trump' || gameState.trumpChooser !== gameState.myPlayerIndex) return;
      if (gameState.mode === 'guest') {
        elements.trumpModal.classList.add('hidden');
        mp.channel.publish('trump-request', {
          suit,
          playerIndex: gameState.myPlayerIndex,
          roundNumber: gameState.roundNumber
        });
        return;
      }
      applyTrump(suit);
      playSound('trump');
      showMessage(`You chose ${SUIT_SYMBOLS[suit]} as trump`);
      if (gameState.mode === 'host') {
        mp.channel.publish('trump-selected', {
          suit,
          playerIndex: gameState.myPlayerIndex,
          roundNumber: gameState.roundNumber
        });
      }
      const delay = gameState.mode === 'single' ? 800 : 1500;
      scheduleGameFlow(() => startPlay(), delay);
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
