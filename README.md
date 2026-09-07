# Fantasy Basketball Auction Draft

A real time multiplayer fantasy basketball auction draft built with React, Vite, Tailwind CSS, and Supabase.

Managers join a private room, take turns nominating NBA players, and submit sealed bids using a shared $200 budget. The goal is to build a 13 player roster while managing money carefully enough to finish the draft.

## How It Works

Each manager starts with:

- $200 budget
- 13 roster spots
- A turn in the nomination order

When it is your turn, you nominate an available NBA player. Every eligible manager can then submit a hidden bid or pass before the timer expires.

The highest valid bid wins the player, and that amount is deducted from the winner's budget.

The game also protects roster completion by preventing managers from spending money they still need to fill their remaining roster spots.

## Online Multiplayer

The game is designed for private drafts with friends.

- The host creates a room and shares a five character room code.
- Friends join with a display name and room code.
- Only the host needs a registered account.
- Guest players join through anonymous Supabase authentication.
- Supabase keeps bids, budgets, rosters, nominations, and results synchronized across all devices.

The host controls when the draft starts and when the game continues after each auction result.

## Main Features

- Real-time online multiplayer
- Sealed bidding
- Pass button
- Tie redo auction rounds
- $1 auto awards when everyone is capped at the same maximum bid
- Host pause and resume controls
- Live Draft Board showing completed auctions and prices
- Live roster tracking
- Responsive desktop and mobile layout
- Mobile collapsible **My Lineup** panel
- Positional fantasy lineups
- Dynamic bench spots for players who cannot fit into active positions
- 170 player draft pool with fantasy position eligibility

## Positional Lineups

Each manager's roster is displayed using fantasy basketball positions:

- PG
- SG
- G
- SF
- PF
- F
- C
- UTIL
- UTIL
- UTIL
- BE
- BE
- BE

Players are automatically placed into eligible active positions.

If a manager drafts too many players at the same position and they cannot fit into the normal lineup, extra bench rows are created so no drafted player disappears from the lineup.

On desktop, **Your Lineup** is shown beside the auction. On mobile, it opens through a collapsible button.

## Pandora's Box

Pandora's Box is an optional one time special auction that the host can enable before the draft begins.

It cannot appear before 12 completed auctions. After that point, it has a chance to become available after each completed round and is guaranteed to appear by auction 20 if it has not already triggered.

When Pandora appears:

1. It can be nominated like a player.
2. Everyone can bid or pass.
3. The winner pays their bid.
4. The box opens automatically.
5. A random budget reward or punishment is applied immediately.
6. The result screen shows what the winner paid and how their budget changed.

Pandora is intentionally risky, with negative outcomes more likely than positive ones.

If nobody buys it, Pandora remains available for a future nomination.

## Auction Results

After each auction, everyone sees the same result screen.

The screen shows:

- Winning manager
- Player won
- Winning price
- All submitted bids
- Tie-break information when needed
- Pandora outcome when applicable

The draft stays on the results screen until the host clicks **Continue**.

## Technology

### Front End

- React
- Vite
- Tailwind CSS
- Lucide React

### Backend

- Supabase
- PostgreSQL
- Supabase Auth
- Anonymous Authentication
- Supabase Realtime
- Supabase Edge Functions

The `resolve-auction` Edge Function handles auction resolution, validates bids, resolves ties, updates budgets and rosters, and processes Pandora outcomes.

## Running the Project

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm run dev
```

To test across multiple devices on the same WiFi network:

```bash
npm run dev -- --host
```

Open the network address shown by Vite on your phone or another computer.

## Supabase Setup

Online multiplayer requires a Supabase project.

See:

```text
SETUP.md
```

for the full setup process.

After changing the auction Edge Function, deploy it with:

```bash
npx supabase functions deploy resolve-auction
```

## Author

**Adiyawn**

Final Project: Fantasy Basketball Auction Draft
