# Fantasy Basketball Auction Draft

A fantasy basketball auction draft application built with React, Vite, Tailwind CSS, and Supabase.

The application includes both a single player practice mode against AI controlled managers and an online multiplayer mode where friends can join a private draft room and compete in real time.

This project was built as a final project to demonstrate front end development, state management, real time multiplayer synchronization, authentication, database integration, and UI/UX design.

## Features

### Practice Mode

Practice mode runs entirely in the browser and does not require an account or Supabase connection.

You compete against 11 AI controlled managers in a 12 team fantasy basketball auction draft. Each AI manager uses its own bidding behavior while following the same budget and roster restrictions as the user.

Practice mode includes a real time auction countdown, sealed bidding, a $200 starting budget, 13 roster spots, automatic salary restrictions, a live Draft Board, and final standings.

### Online Multiplayer

Online mode uses Supabase to synchronize the draft between multiple real players.

Players can create private draft rooms and share a five character room code with friends. The game synchronizes nominations, bids, auction results, rosters, budgets, and draft progress in real time.

Only the host needs to create an account.

Friends can join by entering:

1. A display name
2. The room code

Guest players are authenticated anonymously through Supabase in the background. They do not need an email address, password, or account.

The host controls when the draft begins and when the game advances after each auction result.

## Auction System

Each manager begins with a $200 budget and 13 available roster spots.

When it is a manager's turn, they nominate an available NBA player.

Every eligible manager then submits a sealed bid before the auction timer expires. Players cannot see each other's bids while the auction is active.

The highest valid bidder wins the player, and the winning amount is deducted from that manager's remaining budget.

The bidding system also prevents managers from spending money they will need to fill their remaining roster positions. A manager must preserve at least $1 for every remaining empty roster spot.

## Auction Results

When an auction finishes, everyone is taken to the same results screen.

The winning manager is highlighted along with the player and winning price. Every submitted bid is displayed underneath so players can see how the auction played out.

The Draft Board and updated rosters remain visible.

The game stays on the results screen until the host clicks Continue. After the host continues, the draft moves to the next nomination.

## Tied Bids

If multiple managers submit the same highest bid, the auction enters another bidding round involving only the tied managers.

If the players continue tying through the maximum number of tie breaking rounds, the winner is selected randomly from the remaining tied bidders.

## No Sale Auctions

If nobody submits a valid bid, the player goes unsold.

The results screen displays that there was no sale. The player returns to the available player pool and can be nominated again later in the draft.

## NBA Player Pool

The application includes a preloaded collection of NBA players with information such as player name, rating, position, and team.

Once a player is successfully purchased, that player is removed from the available player pool for the remainder of the draft.

## AI Bidding Logic

Practice mode includes 11 computer controlled managers.

Each AI manager has the same budget and roster restrictions as the user. The AI considers player value, remaining budget, available roster spots, and its bidding strategy when determining how much to bid.

Different AI managers use different approaches, including aggressive, balanced, and value focused bidding behavior.

## Technology Stack

### Front End

React

JavaScript ES6+

Vite

Tailwind CSS

Lucide React

### Backend and Multiplayer

Supabase

Supabase Auth

Anonymous Authentication

PostgreSQL

Row Level Security

Supabase Realtime

Supabase Edge Functions

## Multiplayer Architecture

Online draft state is stored in Supabase rather than inside an individual player's browser.

### profiles

Stores account information and display names for registered host accounts.

### rooms

Stores the shared state of each online draft, including the room code, host, draft status, settings, nomination order, current player, auction deadline, draft history, and auction results.

### room_participants

Stores each manager's display name, remaining budget, roster, and ready status.

### bids

Stores sealed bids submitted during each auction round.

## Server Side Auction Resolution

Auction winners are determined by the `resolve-auction` Supabase Edge Function rather than by an individual player's browser.

The Edge Function determines the highest valid bid, enforces budget restrictions, resolves ties, updates the winner's budget and roster, records completed purchases, and creates the auction results shown to every player.

The function also prevents multiple browsers from resolving the same auction simultaneously.

## Running Practice Mode

Install the project dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local address displayed by Vite in your browser.

Practice mode works without any Supabase configuration.

## Setting Up Online Multiplayer

Online multiplayer requires a free Supabase project.

Detailed setup instructions are available in:

```text
SETUP.md
```

The general setup process is:

1. Create a Supabase project
2. Run `supabase/schema.sql`
3. Enable anonymous authentication
4. Add the Supabase Project URL and publishable key to `.env`
5. Deploy the `resolve-auction` Edge Function
6. Start the application

The `.env` file should never be committed to GitHub. The included `.env.example` file provides the required variable names without exposing actual project credentials.

## Playing Online

### Host

1. Select Play Online with Friends
2. Select I Am Hosting
3. Create an account or log in
4. Create a room
5. Share the room code with friends
6. Wait for everyone to mark themselves ready
7. Start the draft
8. Nominate and bid on players
9. Click Continue after each auction result

### Guest

1. Select Play Online with Friends
2. Select I Have a Room Code
3. Enter a display name
4. Enter the host's room code
5. Join the room
6. Mark yourself ready
7. Participate in the draft

Guests do not need to create an account.

## Local Network Testing

The application can be tested across multiple devices connected to the same WiFi network.

Start Vite with:

```bash
npm run dev -- --host
```

Vite will display a network address similar to:

```text
http://192.168.x.x:5173/
```

Other devices on the same WiFi network can open that address in their browser.

This makes it possible to test multiplayer using phones, tablets, and additional computers.

## Current Limitations

Online draft order is randomized and cannot currently be manually configured.

There is no pause mechanism if a player disconnects during an auction.

Anonymous guest identities are tied to their browser session. Opening the game on another browser or device creates a new anonymous identity.

Budget, roster size, and auction timer settings are stored in the room configuration but do not currently have a settings interface for the host.

Online multiplayer requires a configured Supabase project.

## Future Improvements

Future improvements could include configurable room settings, custom auction timers through the user interface, manual draft order controls, improved reconnect handling, a larger NBA player database, additional player statistics, draft history and analytics, sound effects, animations, and production deployment for remote multiplayer.

## Author

**Adiyawn**

Final Project: Fantasy Basketball Auction Draft

## License

This project is for educational purposes.
