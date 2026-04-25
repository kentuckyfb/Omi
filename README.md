# Omi

A browser-based implementation of **Omi**, the Sri Lankan trick-taking card game, built with vanilla JavaScript and Vite.

## Features

- **Solo play** — play against three bots with adaptive AI
- **Online multiplayer** — create or join rooms of 2–4 players (empty slots filled with bots) via Ably Realtime
- **4 themes** — Pixel, Classic, Neon, Minimal (persisted across sessions)
- **Settings** — bot speed, animation level, sound effects
- **Fully responsive** — desktop and mobile

## How to Play

Omi is played with a 32-card deck (7–A of each suit) between two teams of two (North/South vs East/West).

1. **Trump** — the dealer picks a trump suit based on their first 4 cards
2. **Tricks** — lead any card; others must follow suit if able, otherwise play any card
3. **Winning tricks** — highest card of the led suit wins, unless a trump was played (highest trump wins)
4. **Scoring per round**
   - 5–6 tricks → 1 point
   - 7 tricks → 2 points
   - 8 tricks (sweep) → 3 points
   - 4–4 split → 0 points
5. **Game** — first team to reach **10 points** wins

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## Online Play

Online multiplayer uses [Ably Realtime](https://ably.com). Add your free API key in `src/main.js`:

```js
const ABLY_API_KEY = 'your-key-here';
```

## Build

```bash
npm run build
```

## Tech Stack

- Vanilla JS (ES modules)
- Vite 5
- Ably Realtime 2.x (multiplayer)
- Web Audio API (sound effects)
- CSS custom properties + Google Fonts (Press Start 2P)
