# Fantasy Basketball Auction Draft

A fantasy basketball auction draft application built with React, Vite, Tailwind CSS, and Supabase.

The application includes both a single-player practice mode against AI-controlled managers and an online multiplayer mode where friends can join a private draft room and compete in real time.

This project was built as a final project to demonstrate front-end development, state management, real-time multiplayer synchronization, authentication, database integration, and UI/UX design.

---

## Features

### Practice Mode

Practice mode runs entirely in the browser and does not require an account or Supabase connection.

- Compete against 11 AI-controlled managers
- 12-team fantasy basketball auction draft
- AI managers use different bidding strategies
- Real-time auction countdown
- Sealed bidding
- $200 starting budget per manager
- 13-player roster limit
- Automatic salary and roster constraints
- Draft board showing completed purchases
- Final standings based on roster ratings

### Online Multiplayer

Online mode uses Supabase to synchronize the draft between multiple players.

- Create private draft rooms
- Share a five-character room code with friends
- Real-time multiplayer synchronization
- Host-controlled draft start
- Randomized nomination order
- Live roster and budget updates
- Sealed bidding
- Server-side auction resolution
- Tie-breaking auction rounds
- Results screen after every auction
- Host-controlled Continue button
- Draft board showing previous purchases

Only the host needs to create an account.

Friends can join a draft using only:

1. A display name
2. The room code

Guest players are authenticated anonymously through Supabase in the background, so they do not need an email address, password, or account.

---

## Auction System

Each manager begins with:

- $200 budget
- 13 roster spots

When it is a manager's turn, they nominate an available NBA player.

All eligible managers then submit a sealed bid before the auction timer expires.

The highest bidder wins the player and the winning amount is deducted from their remaining budget.

The bidding system prevents managers from spending money required to fill their remaining roster spots.

For example, a manager must always preserve at least $1 for every remaining empty roster position.

### Auction Results

When an auction finishes, all players are taken to a shared results screen.

The results screen displays:

- The winning manager
- Winning bid
- Every submitted bid
- Updated rosters and budgets
- Previous purchases on the Draft Board

The draft remains on the results screen until the host clicks Continue.

### Tied Bids

If multiple managers submit the same highest bid, the auction enters a tie-breaking round involving only the tied managers.

If the tie continues through the maximum number of tie-breaking rounds, the winner is selected randomly from the remaining tied bidders.

### No-Sale Auctions

If nobody bids on a player, the auction ends with no sale.

The player returns to the available player pool and can be nominated again later.

---

## NBA Player Pool

The application includes a preloaded pool of NBA players with information including:

- Player name
- Rating
- Position
- Team

Drafted players are removed from the available player pool.

---

## AI Bidding Logic

Practice mode includes 11 computer-controlled managers.

AI managers:

- Have the same budget and roster restrictions as the user
- Use different bidding behaviors
- Adjust bids based on player value
- Consider remaining budget
- Consider remaining roster spots
- Cannot bid more than their maximum legal bid

This allows practice drafts to run without any server or online configuration.

---

## Technology Stack

### Front End

- React
- JavaScript (ES6+)
- Vite
- Tailwind CSS
- Lucide React

### Backend / Multiplayer

- Supabase
- Supabase Auth
- Anonymous Authentication
- PostgreSQL
- Row Level Security (RLS)
- Supabase Realtime
- Supabase Edge Functions

---

## Multiplayer Architecture

Online draft state is stored in Supabase rather than individual browsers.

The main database tables are:

### `profiles`

Stores display information for registered host accounts.

### `rooms`

Stores the shared state of each draft, including:

- Room code
- Host
- Draft status
- Draft settings
- Nomination order
- Current player
- Auction deadline
- Draft history
- Auction results

### `room_participants`

Stores each manager's:

- Display name
- Budget
- Roster
- Ready status

### `bids`

Stores sealed bids submitted during each auction round.

---

## Server-Side Auction Resolution

Auction winners are determined by the `resolve-auction` Supabase Edge Function.

The Edge Function handles:

- Determining the highest valid bid
- Enforcing maximum legal bids
- Resolving ties
- Updating the winner's budget
- Updating the winner's roster
- Recording the sale
- Creating the auction results
- Preventing multiple clients from resolving the same auction

Keeping auction resolution on the server prevents an individual player's browser from determining the winner.

---

## Running Practice Mode

Install the project dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local Vite address shown in the terminal.

Practice mode works without any additional configuration.

---

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
4. Configure the Supabase Project URL and publishable key in `.env`
5. Deploy the `resolve-auction` Edge Function
6. Start the application

The `.env` file should not be committed to GitHub.

Use `.env.example` as the configuration template.

---

## Playing Online

### Host

1. Select Play Online with Friends
2. Select I'm Hosting
3. Create an account or log in
4. Create a room
5. Share the room code
6. Wait for everyone to mark themselves ready
7. Start the draft
8. Control progression from each auction results screen

### Guest

1. Select Play Online with Friends
2. Select I Have a Room Code
3. Enter a display name
4. Enter the host's room code
5. Join the room
6. Mark yourself ready
7. Play

Guests do not need to create an account.

---

## Local Network Testing

The application can be tested across multiple devices on the same network.

Start Vite with:

```bash
npm run dev -- --host
```

Vite will display a network address similar to:

```text
http://192.168.x.x:5173/
```

Other devices on the same Wi-Fi network can open that address to join the game.

This is useful for testing with phones, tablets, and additional computers.

---

## Current Limitations

- Online draft order is randomized rather than configurable
- No pause mechanism for disconnected players
- Anonymous guest identities are tied to their browser session
- Moving to another browser or device creates a new anonymous guest identity
- Room budget and roster settings do not currently have a configuration UI
- Online mode requires a Supabase project to be configured

---

## Future Improvements

Potential improvements include:

- Configurable draft settings
- Custom auction timers
- Manual or randomized draft-order options
- Improved reconnect handling
- Larger NBA player database
- Player statistics and fantasy categories
- Draft history and analytics
- Sound effects and animations
- Production deployment for remote online play

---

## Author

**Adiyawn**

Final Project - Fantasy Basketball Auction Draft

---

## License

This project is for educational purposes.
