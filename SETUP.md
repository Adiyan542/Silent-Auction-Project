# Setting up online mode

Practice mode (vs 11 AI bots) needs nothing extra and works out of the box.
Online mode needs a free Supabase project. This has **not** been tested
against a live Supabase project — I don't have network access to supabase.co
from where this was written, so budget time to debug real-world issues
(typos, RLS policy tweaks, etc.) the first time you run it.

## Already have a project set up? (migration note)
If you ran an earlier version of `schema.sql`, the `rooms` table won't have
the `results` column that the new host-controlled results screen needs. Run
this once in the SQL Editor to add it without losing any existing data:
```sql
alter table rooms add column if not exists results jsonb;
```
Then redeploy the Edge Function (`supabase functions deploy resolve-auction`)
so it picks up the new resolution logic.

## 1. Create a Supabase project
1. Go to https://supabase.com, sign up, click "New Project".
2. Pick any name/region/password (the password is for the Postgres database,
   not something your friends need).
3. Wait ~2 minutes for it to provision.

## 2. Run the database schema
1. In your project dashboard, open **SQL Editor** -> **New query**.
2. Paste the entire contents of `supabase/schema.sql` from this project.
3. Click **Run**. You should see "Success. No rows returned."
4. Double check: **Database -> Replication** — `rooms`, `room_participants`,
   and `bids` should show as included in `supabase_realtime`. The schema
   script does this for you, but it's worth confirming.

## 2b. Enable anonymous sign-ins (lets friends join with just a name + code)
1. **Authentication -> Providers -> Anonymous Sign-Ins** -> toggle it on.
2. That's it. This is what lets a friend type their name and your room code
   and land straight in the draft — no email, no password, no account
   screen for them at all. Only the host needs a real account (to create
   and manage rooms); everyone who joins with a code gets a lightweight
   anonymous session created automatically in the background.

## 3. Get your API keys
1. **Project Settings -> API**.
2. Copy the **Project URL** and the **anon public** key.
3. In this project folder, copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```
4. Paste your URL and anon key into `.env`.

## 4. Deploy the Edge Function
This is the one piece of real server-side logic — it's what actually decides
who won each auction, so no single player's browser can cheat or crash the
round.

1. Install the Supabase CLI if you don't have it:
   ```
   npm install -g supabase
   ```
2. Log in and link this project:
   ```
   supabase login
   supabase link --project-ref your-project-ref
   ```
   (`your-project-ref` is the id in your project URL, e.g.
   `abcdefghijklmno` from `https://abcdefghijklmno.supabase.co`.)
3. Deploy the function:
   ```
   supabase functions deploy resolve-auction
   ```
4. The function needs your service-role key available to it — Supabase sets
   this up automatically for functions deployed this way (it's injected as
   `SUPABASE_SERVICE_ROLE_KEY` in the function's environment). No extra step
   needed unless the dashboard tells you otherwise under **Edge Functions ->
   resolve-auction -> Secrets**.

## 5. Run it
```
npm install
npm run dev
```
"Play Online with Friends" on the lobby screen should now be enabled
(it's disabled automatically if `.env` isn't filled in).

**As the host:** click "I'm Hosting," create an account (one-time), create a
room, and share the room code with your friends.

**As a friend:** click "I Have a Room Code," type your name and the code —
that's it, no account, no email, no password. You're in.

If someone closes the tab or loses connection mid-draft, reopening the site
in the same browser will drop them straight back into the room (their
budget/roster are safe in the database regardless — this just saves them
re-typing the code). Missing the exact 3-second window on one specific
auction because of a dropped connection just means they don't win that one
player; the draft doesn't pause for anybody.

## Notes on what's simplified here (vs. a "real" product)
- **Every auction resolves into a results screen** (winner highlighted, every
  bid shown underneath) and stays there until the **host** clicks Continue —
  same as practice mode, except a person is gating it instead of a button
  click auto-advancing. If the host is AFK on the results screen, the draft
  just waits; nobody else can advance it.
- **No mid-auction pause on disconnect** — a dropped connection mid-bid just
  means that person doesn't win that one player; the auction still resolves
  on schedule for everyone else.
- **Draft order** is randomized once when the host starts the draft, not
  configurable (no snake order, no manual ordering) — easy to add later if
  you want it.
- **Budget/roster size** are stored in `rooms.settings` and default to
  $200 / 13 slots, matching practice mode, but there's no UI yet to change
  them per-room — you'd edit the default in `schema.sql` or add a settings
  form to `OnlineLobby.jsx`.
- **Anonymous guest sessions are per-browser.** A friend who joins on their
  phone and later opens the link on their laptop will look like a brand new
  person (a fresh anonymous session) rather than the same guest — they'd
  just rejoin with the same name.
