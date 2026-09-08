-- Run this once in the Supabase SQL editor for your project.
-- Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
--
-- Also required (this is a dashboard setting, not SQL): enable anonymous
-- sign-ins so friends can join with just a name + room code, no account.
-- Dashboard -> Authentication -> Providers -> Anonymous Sign-Ins -> Enable.

create extension if not exists pgcrypto;

-- One row per signed-up user. Supabase Auth creates auth.users automatically;
-- this table just holds the display name people see in the draft.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

-- One row per draft room.
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text unique not null,
  host_id uuid not null references profiles(id),
  status text not null default 'lobby',
    -- 'lobby' | 'nominating' | 'bidding' | 'results' | 'complete'
    -- 'results': an auction just resolved (or was auto-awarded, or had no
    -- bidders); budgets/rosters are already updated, but the room stays
    -- parked here — showing the winner and every bid — until the HOST
    -- clicks Continue. This intentionally does not auto-advance.
  settings jsonb not null default '{"budget":200,"roster_size":13,"auction_time":25}',
  nominator_order uuid[] not null default '{}',
  current_nominator_index int not null default 0,
  current_player jsonb,               -- {id, name, rating}
  auction_deadline timestamptz,
  drafted_player_ids int[] not null default '{}',
  draft_log jsonb[] not null default '{}',   -- feeds the Draft Board strip
  tie_eligible_ids uuid[],            -- non-null while a tie redo is in progress
  tie_redo_count int not null default 0,
  results jsonb,                      -- set when status='results'; cleared when host continues
  is_paused boolean not null default false,
  paused_seconds_left int,

  pandora_enabled boolean not null default false,
  pandora_available boolean not null default false,
  pandora_used boolean not null default false,
  completed_auction_count int not null default 0,

  created_at timestamptz not null default now()
);

-- One row per person in a room. References auth.users directly (not
-- profiles) so anonymous "join with a code" guests work without ever
-- needing a profiles row — only the host needs a full account.
create table if not exists room_participants (
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  budget int not null default 200,
  roster jsonb not null default '[]',  -- [{id, name, cost}, ...]
  is_ready boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- One row per bid. Also references auth.users directly for the same reason.
-- A unique (room_id, round_key, user_id) means a player can update their
-- bid (upsert) until the deadline, but only ever has one live bid per
-- auction round. round_key changes on every tie-break redo so old bids from
-- a previous round never leak into a new one.
create table if not exists bids (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  round_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount int not null check (amount >= 0),
  submitted_at timestamptz not null default now(),
  unique (room_id, round_key, user_id)
);

-- ---------- Row Level Security ----------

alter table profiles enable row level security;
alter table rooms enable row level security;
alter table room_participants enable row level security;
alter table bids enable row level security;

-- profiles: anyone signed in can read display names (needed to show names in a room);
-- you can only edit your own.
create policy "profiles are readable by any signed-in user"
  on profiles for select using (auth.role() = 'authenticated');
create policy "users manage their own profile"
  on profiles for insert with check (auth.uid() = id);
create policy "users update their own profile"
  on profiles for update using (auth.uid() = id);

-- rooms: any signed-in user can look a room up (needed to join by code),
-- but only participants (or the host) can update it.
create policy "rooms are readable by any signed-in user"
  on rooms for select using (auth.role() = 'authenticated');
create policy "any signed-in user can create a room"
  on rooms for insert with check (auth.uid() = host_id);
create policy "participants can update their room"
  on rooms for update using (
    auth.uid() = host_id
    or exists (
      select 1 from room_participants rp
      where rp.room_id = rooms.id and rp.user_id = auth.uid()
    )
  );

-- Only the host can permanently delete the room.
create policy "host can delete their room"
  on rooms
  for delete
  using (
    auth.uid() = host_id
  );

-- room_participants: participants of a room can see the roster; you can only
-- insert/update your own row.

create or replace function public.is_room_participant(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_participants rp
    where rp.room_id = target_room_id
      and rp.user_id = auth.uid()
  );
$$;

create policy "participants readable by other participants"
  on room_participants
  for select
  to authenticated
  using (
    public.is_room_participant(room_id)
  );

create policy "users can join a room as themselves"
  on room_participants for insert with check (auth.uid() = user_id);
create policy "users can update only their own participant row"
  on room_participants for update using (auth.uid() = user_id);

-- Users can remove themselves from a room.
create policy "users can leave a room themselves"

  on room_participants
  for delete
  using (
    auth.uid() = user_id
  );

-- bids: this is what keeps bidding "blind". While a room is still 'bidding',
-- you can only see your own bid row. Once the room moves on (resolved by the
-- edge function), everyone in the room can see every bid from that round.
create policy "bids visible to the bidder, or to everyone once resolved"
  on bids for select using (
    auth.uid() = user_id
    or exists (
      select 1 from rooms r
      where r.id = bids.room_id and r.status <> 'bidding'
    )
  );
create policy "users can submit only their own bid"
  on bids for insert with check (auth.uid() = user_id);
create policy "users can update only their own bid before resolution"
  on bids for update using (auth.uid() = user_id);

-- Realtime: expose these tables to Supabase Realtime so subscribed clients
-- get pushed updates. (In the dashboard: Database -> Replication -> toggle
-- these three tables on, if this publication statement doesn't already cover it.)
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table room_participants;
alter publication supabase_realtime add table bids;


create or replace function bid_count(p_room_id uuid, p_round_key text)
returns int
language sql
security definer
set search_path = public
as $$
  select count(distinct user_id)::int
  from bids
  where room_id = p_room_id
    and round_key = p_round_key;
$$;

grant execute on function bid_count(uuid, text) to authenticated;
