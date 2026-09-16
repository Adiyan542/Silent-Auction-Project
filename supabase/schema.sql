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
    -- 'lobby' | 'nominating' | 'bidding' | 'results' | 'complete' | 'trade proposal'
    -- 'results': an auction just resolved (or was auto-awarded, or had no
    -- bidders); budgets/rosters are already updated, but the room stays
    -- parked here — showing the winner and every bid — until the HOST
    -- clicks Continue. This intentionally does not auto-advance.
  settings jsonb not null default '{"budget":200,"roster_size":13,"auction_time":60}',
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



-- ---------- Trade Proposals ----------

create table if not exists trade_proposals (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  give_players jsonb not null default '[]',
  give_cash int not null default 0,
  receive_players jsonb not null default '[]',
  receive_cash int not null default 0,
  invalid_reason text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table rooms
add column if not exists active_trade_id uuid references trade_proposals(id);

alter table trade_proposals enable row level security;

create policy "trade proposals visible to room participants"
  on trade_proposals
  for select
  using (
    public.is_room_participant(room_id)
  );

alter publication supabase_realtime
add table trade_proposals;


create or replace function create_trade_proposal(
  p_room_id uuid,
  p_to_user_id uuid,
  p_give_players jsonb,
  p_give_cash int,
  p_receive_players jsonb,
  p_receive_cash int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms%rowtype;
  v_from room_participants%rowtype;
  v_to room_participants%rowtype;
  v_current_nominator uuid;
  v_trade_id uuid;
  v_player jsonb;
begin
  select *
  into v_room
  from rooms
  where id = p_room_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'Room not found'
    );
  end if;

  if v_room.status <> 'nominating' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Trades can only be proposed during your nomination turn'
    );
  end if;

  v_current_nominator :=
    v_room.nominator_order[v_room.current_nominator_index + 1];

  if auth.uid() is distinct from v_current_nominator then
    return jsonb_build_object(
      'ok', false,
      'error', 'Only the current nominator can propose a trade'
    );
  end if;

  if p_to_user_id = auth.uid() then
    return jsonb_build_object(
      'ok', false,
      'error', 'You cannot trade with yourself'
    );
  end if;

  if jsonb_array_length(p_give_players) = 0
     or jsonb_array_length(p_receive_players) = 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Both sides must include at least one player'
    );
  end if;

  if jsonb_array_length(p_give_players) > 2
     or jsonb_array_length(p_receive_players) > 2 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Trades are limited to 2 players per side'
    );
  end if;

  select *
  into v_from
  from room_participants
  where room_id = p_room_id
    and user_id = auth.uid();

  select *
  into v_to
  from room_participants
  where room_id = p_room_id
    and user_id = p_to_user_id;

  if v_from is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'You are not in this room'
    );
  end if;

  if v_to is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'That manager is not in this room'
    );
  end if;

  for v_player in
    select * from jsonb_array_elements(p_give_players)
  loop
    if not exists (
      select 1
      from jsonb_array_elements(v_from.roster) p
      where (p->>'id')::int = (v_player->>'id')::int
    ) then
      return jsonb_build_object(
        'ok', false,
        'error', 'You do not own ' || (v_player->>'name')
      );
    end if;
  end loop;

  for v_player in
    select * from jsonb_array_elements(p_receive_players)
  loop
    if not exists (
      select 1
      from jsonb_array_elements(v_to.roster) p
      where (p->>'id')::int = (v_player->>'id')::int
    ) then
      return jsonb_build_object(
        'ok', false,
        'error', 'They do not own ' || (v_player->>'name')
      );
    end if;
  end loop;

  if p_give_cash < 0 or p_receive_cash < 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Cash amounts cannot be negative'
    );
  end if;

  if p_give_cash > v_from.budget then
    return jsonb_build_object(
      'ok', false,
      'error', 'You do not have enough budget'
    );
  end if;

  if p_receive_cash > v_to.budget then
    return jsonb_build_object(
      'ok', false,
      'error', 'They do not have enough budget'
    );
  end if;

  insert into trade_proposals (
    room_id,
    from_user_id,
    to_user_id,
    give_players,
    give_cash,
    receive_players,
    receive_cash
  )
  values (
    p_room_id,
    auth.uid(),
    p_to_user_id,
    p_give_players,
    p_give_cash,
    p_receive_players,
    p_receive_cash
  )
  returning id into v_trade_id;

  update rooms
  set
    status = 'trade_proposal',
    active_trade_id = v_trade_id
  where id = p_room_id;

  return jsonb_build_object(
    'ok', true,
    'trade_id', v_trade_id
  );
end;
$$;

grant execute on function create_trade_proposal(
  uuid,
  uuid,
  jsonb,
  int,
  jsonb,
  int
) to authenticated;


create or replace function accept_trade_proposal(
  p_trade_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade trade_proposals%rowtype;
  v_room rooms%rowtype;
  v_from room_participants%rowtype;
  v_to room_participants%rowtype;

  v_from_new_roster jsonb;
  v_to_new_roster jsonb;

  v_from_new_budget int;
  v_to_new_budget int;

  v_roster_size int;
  v_player jsonb;

  v_order uuid[];
  v_len int;
  v_i int;
  v_next_idx int;
  v_candidate uuid;
  v_candidate_roster_len int;

  v_done boolean := true;
begin
  select *
  into v_trade
  from trade_proposals
  where id = p_trade_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'Trade not found'
    );
  end if;

  if v_trade.status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'error', 'This trade is no longer pending'
    );
  end if;

  if auth.uid() is distinct from v_trade.to_user_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'Only the recipient can accept this trade'
    );
  end if;

  select *
  into v_room
  from rooms
  where id = v_trade.room_id
  for update;

  if v_room.active_trade_id is distinct from p_trade_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'This trade is no longer active'
    );
  end if;

  v_roster_size :=
    coalesce(
      (v_room.settings->>'roster_size')::int,
      13
    );

  select *
  into v_from
  from room_participants
  where room_id = v_trade.room_id
    and user_id = v_trade.from_user_id
  for update;

  select *
  into v_to
  from room_participants
  where room_id = v_trade.room_id
    and user_id = v_trade.to_user_id
  for update;

  if v_from is null or v_to is null then
    update trade_proposals
    set
      status = 'invalid',
      invalid_reason = 'A participant left the room',
      resolved_at = now()
    where id = p_trade_id;

    update rooms
    set
      status = 'nominating',
      active_trade_id = null
    where id = v_trade.room_id;

    return jsonb_build_object(
      'ok', false,
      'error', 'A participant left the room'
    );
  end if;

  for v_player in
    select * from jsonb_array_elements(v_trade.give_players)
  loop
    if not exists (
      select 1
      from jsonb_array_elements(v_from.roster) p
      where (p->>'id')::int = (v_player->>'id')::int
    ) then
      update trade_proposals
      set
        status = 'invalid',
        invalid_reason =
          'Sender no longer owns ' || (v_player->>'name'),
        resolved_at = now()
      where id = p_trade_id;

      update rooms
      set
        status = 'nominating',
        active_trade_id = null
      where id = v_trade.room_id;

      return jsonb_build_object(
        'ok', false,
        'error',
        'Sender no longer owns ' || (v_player->>'name')
      );
    end if;
  end loop;

  for v_player in
    select * from jsonb_array_elements(v_trade.receive_players)
  loop
    if not exists (
      select 1
      from jsonb_array_elements(v_to.roster) p
      where (p->>'id')::int = (v_player->>'id')::int
    ) then
      update trade_proposals
      set
        status = 'invalid',
        invalid_reason =
          'You no longer own ' || (v_player->>'name'),
        resolved_at = now()
      where id = p_trade_id;

      update rooms
      set
        status = 'nominating',
        active_trade_id = null
      where id = v_trade.room_id;

      return jsonb_build_object(
        'ok', false,
        'error',
        'You no longer own ' || (v_player->>'name')
      );
    end if;
  end loop;

  if v_from.budget < v_trade.give_cash then
    update trade_proposals
    set
      status = 'invalid',
      invalid_reason = 'Sender no longer has enough budget',
      resolved_at = now()
    where id = p_trade_id;

    update rooms
    set
      status = 'nominating',
      active_trade_id = null
    where id = v_trade.room_id;

    return jsonb_build_object(
      'ok', false,
      'error', 'Sender no longer has enough budget'
    );
  end if;

  if v_to.budget < v_trade.receive_cash then
    update trade_proposals
    set
      status = 'invalid',
      invalid_reason = 'You no longer have enough budget',
      resolved_at = now()
    where id = p_trade_id;

    update rooms
    set
      status = 'nominating',
      active_trade_id = null
    where id = v_trade.room_id;

    return jsonb_build_object(
      'ok', false,
      'error', 'You no longer have enough budget'
    );
  end if;

  select coalesce(jsonb_agg(p), '[]'::jsonb)
  into v_from_new_roster
  from jsonb_array_elements(v_from.roster) p
  where not exists (
    select 1
    from jsonb_array_elements(v_trade.give_players) g
    where (g->>'id')::int = (p->>'id')::int
  );

  v_from_new_roster :=
    v_from_new_roster || v_trade.receive_players;

  select coalesce(jsonb_agg(p), '[]'::jsonb)
  into v_to_new_roster
  from jsonb_array_elements(v_to.roster) p
  where not exists (
    select 1
    from jsonb_array_elements(v_trade.receive_players) g
    where (g->>'id')::int = (p->>'id')::int
  );

  v_to_new_roster :=
    v_to_new_roster || v_trade.give_players;

  v_from_new_budget :=
    v_from.budget
    - v_trade.give_cash
    + v_trade.receive_cash;

  v_to_new_budget :=
    v_to.budget
    - v_trade.receive_cash
    + v_trade.give_cash;

  if jsonb_array_length(v_from_new_roster) > v_roster_size
     or jsonb_array_length(v_to_new_roster) > v_roster_size then
    update trade_proposals
    set
      status = 'invalid',
      invalid_reason = 'Trade would exceed roster size',
      resolved_at = now()
    where id = p_trade_id;

    update rooms
    set
      status = 'nominating',
      active_trade_id = null
    where id = v_trade.room_id;

    return jsonb_build_object(
      'ok', false,
      'error', 'Trade would exceed roster size'
    );
  end if;

  if v_from_new_budget <
       (v_roster_size - jsonb_array_length(v_from_new_roster))
     or
     v_to_new_budget <
       (v_roster_size - jsonb_array_length(v_to_new_roster)) then

    update trade_proposals
    set
      status = 'invalid',
      invalid_reason =
        'Trade would leave a roster unable to fill remaining slots',
      resolved_at = now()
    where id = p_trade_id;

    update rooms
    set
      status = 'nominating',
      active_trade_id = null
    where id = v_trade.room_id;

    return jsonb_build_object(
      'ok', false,
      'error',
      'Trade would leave a roster unable to fill remaining slots'
    );
  end if;

  update room_participants
  set
    budget = v_from_new_budget,
    roster = v_from_new_roster
  where room_id = v_trade.room_id
    and user_id = v_trade.from_user_id;

  update room_participants
  set
    budget = v_to_new_budget,
    roster = v_to_new_roster
  where room_id = v_trade.room_id
    and user_id = v_trade.to_user_id;

  update trade_proposals
  set
    status = 'accepted',
    resolved_at = now()
  where id = p_trade_id;

  v_order := v_room.nominator_order;
  v_len := array_length(v_order, 1);
  v_next_idx := v_room.current_nominator_index;

  for v_i in 1..v_len loop
    v_next_idx :=
      (v_next_idx + 1) % v_len;

    v_candidate :=
      v_order[v_next_idx + 1];

    select
      coalesce(jsonb_array_length(roster), 0)
    into v_candidate_roster_len
    from room_participants
    where room_id = v_trade.room_id
      and user_id = v_candidate;

    if v_candidate_roster_len < v_roster_size then
      v_done := false;
      exit;
    end if;
  end loop;

  update rooms
  set
    status =
      case
        when v_done then 'complete'
        else 'nominating'
      end,
    current_nominator_index = v_next_idx,
    active_trade_id = null
  where id = v_trade.room_id;

  return jsonb_build_object(
    'ok', true
  );
end;
$$;

grant execute on function accept_trade_proposal(uuid)
to authenticated;


create or replace function decline_trade_proposal(
  p_trade_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade trade_proposals%rowtype;
  v_room rooms%rowtype;
begin
  select *
  into v_trade
  from trade_proposals
  where id = p_trade_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'Trade not found'
    );
  end if;

  if v_trade.status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'error', 'This trade is no longer pending'
    );
  end if;

  if auth.uid() is distinct from v_trade.to_user_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'Only the recipient can decline this trade'
    );
  end if;

  select *
  into v_room
  from rooms
  where id = v_trade.room_id
  for update;

  if v_room.active_trade_id is distinct from p_trade_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'This trade is no longer active'
    );
  end if;

  update trade_proposals
  set
    status = 'declined',
    resolved_at = now()
  where id = p_trade_id;

  update rooms
  set
    status = 'nominating',
    active_trade_id = null
  where id = v_trade.room_id;

  return jsonb_build_object(
    'ok', true
  );
end;
$$;

grant execute on function decline_trade_proposal(uuid)
to authenticated;


create or replace function cancel_trade_proposal(
  p_trade_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade trade_proposals%rowtype;
  v_room rooms%rowtype;
begin
  select *
  into v_trade
  from trade_proposals
  where id = p_trade_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'Trade not found'
    );
  end if;

  if v_trade.status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'error', 'This trade is no longer pending'
    );
  end if;

  if auth.uid() is distinct from v_trade.from_user_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'Only the sender can cancel this trade'
    );
  end if;

  select *
  into v_room
  from rooms
  where id = v_trade.room_id
  for update;

  if v_room.active_trade_id is distinct from p_trade_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'This trade is no longer active'
    );
  end if;

  update trade_proposals
  set
    status = 'cancelled',
    resolved_at = now()
  where id = p_trade_id;

  update rooms
  set
    status = 'nominating',
    active_trade_id = null
  where id = v_trade.room_id;

  return jsonb_build_object(
    'ok', true
  );
end;
$$;

grant execute on function cancel_trade_proposal(uuid)
to authenticated;


-- ---------- Room Chat ----------

create table if not exists room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  message text not null check (
    char_length(message) > 0 and char_length(message) <= 300
  ),
  created_at timestamptz not null default now()
);

-- Speeds up "last ~100 messages for this room" lookups.
create index if not exists room_messages_room_id_created_at_idx
  on room_messages (room_id, created_at desc);

alter table room_messages enable row level security;

-- Only participants of the room can read its messages.
create policy "room messages readable by room participants"
  on room_messages
  for select
  using (
    public.is_room_participant(room_id)
  );

-- You can only send as yourself, in a room you're actually in, and the
-- display_name you send must match your real participant row — prevents
-- spoofing someone else's name in chat.
create policy "room participants can send messages as themselves"
  on room_messages
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from room_participants rp
      where rp.room_id = room_messages.room_id
        and rp.user_id = auth.uid()
        and rp.display_name = room_messages.display_name
    )
  );

-- No update/delete policies on purpose: chat messages are immutable.

-- Realtime: expose room_messages to Supabase Realtime.
-- Idempotent: safe to rerun even if room_messages is already in the
-- publication (a plain `alter publication ... add table` errors on rerun
-- with "relation ... is already member of publication").
-- (Dashboard equivalent: Database -> Replication -> toggle room_messages on,
-- if this block doesn't already cover it.)
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_messages'
  ) then
    alter publication supabase_realtime add table room_messages;
  end if;
end $$;

-- ---------- Host Redo Auction (v1: normal player auctions only) ----------
--
-- Reverses the most recently completed normal player auction (still parked
-- on the results screen, before the host has clicked Continue) and
-- immediately restarts a fresh blind-bid round for the same player with a
-- brand new auction_id, so no bids from the discarded round can leak in.
--
-- Host-only. Not available for Pandora's Box, no-sale, or auto-awarded
-- results. Safe to call more than once / concurrently — see the locking
-- and state-check strategy below.

create or replace function redo_auction(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms%rowtype;
  v_winner room_participants%rowtype;

  v_player_id int;
  v_player_name text;
  v_winner_user_id uuid;
  v_amount int;

  v_log_len int;
  v_draft_log_entry jsonb;   -- draft_log[1] — jsonb[] is 1-indexed in Postgres

  v_roster_match_count int;
  v_new_roster jsonb;
  v_new_drafted_ids int[];
  v_new_draft_log jsonb[];
  v_new_auction_id text;
  v_auction_seconds int;
begin
  select * into v_room
  from rooms
  where id = p_room_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Room not found');
  end if;

  if auth.uid() is distinct from v_room.host_id then
    return jsonb_build_object('ok', false, 'error', 'Only the host can redo this auction');
  end if;

  if v_room.status <> 'results' then
    return jsonb_build_object('ok', false, 'error', 'This auction is no longer on the results screen');
  end if;

  if v_room.current_player is null then
    return jsonb_build_object('ok', false, 'error', 'No current auction to redo');
  end if;

  if coalesce((v_room.current_player->>'isPandora')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', "Pandora's Box auctions cannot be redone");
  end if;

  if v_room.results is null then
    return jsonb_build_object('ok', false, 'error', 'No result to redo');
  end if;

  if coalesce((v_room.results->>'isPandora')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', "Pandora's Box auctions cannot be redone");
  end if;

  if coalesce((v_room.results->>'noSale')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'No-sale results cannot be redone');
  end if;

  if coalesce((v_room.results->>'autoAwarded')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'Auto-awarded results cannot be redone yet');
  end if;

  v_player_id := (v_room.current_player->>'id')::int;
  v_player_name := v_room.current_player->>'name';
  v_winner_user_id := (v_room.results->>'winnerUserId')::uuid;
  v_amount := (v_room.results->>'amount')::int;

  if v_player_id is null or v_player_name is null
     or v_winner_user_id is null or v_amount is null
  then
    return jsonb_build_object('ok', false, 'error', 'Result is missing data needed to redo');
  end if;

  if v_room.results->>'playerName' is distinct from v_player_name then
    return jsonb_build_object('ok', false, 'error', 'Result does not match the current player; cannot safely redo');
  end if;

  -- drafted_player_ids: the player being redone must be the most recently
  -- drafted one.
  if v_room.drafted_player_ids is null
     or array_length(v_room.drafted_player_ids, 1) is null
     or v_room.drafted_player_ids[array_length(v_room.drafted_player_ids, 1)] <> v_player_id
  then
    return jsonb_build_object('ok', false, 'error', 'Draft state does not match this result; cannot safely redo');
  end if;

  -- draft_log is a jsonb[] and Postgres arrays are 1-indexed, so the
  -- newest entry (unshifted to the front on every write) is draft_log[1].
  v_log_len := array_length(v_room.draft_log, 1);

  if v_room.draft_log is null or v_log_len is null then
    return jsonb_build_object('ok', false, 'error', 'Draft log is empty; cannot safely redo');
  end if;

  v_draft_log_entry := v_room.draft_log[1];

  if (v_draft_log_entry->>'id') !~ ('^' || v_player_id || '_')
     or (v_draft_log_entry->>'playerName') is distinct from v_player_name
     or (v_draft_log_entry->>'winnerUserId')::uuid is distinct from v_winner_user_id
     or (v_draft_log_entry->>'amount')::int is distinct from v_amount
  then
    return jsonb_build_object('ok', false, 'error', 'Draft log does not match this result; cannot safely redo');
  end if;

  select * into v_winner
  from room_participants
  where room_id = p_room_id and user_id = v_winner_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Winning manager is no longer in this room');
  end if;

  -- Winner's roster must contain exactly one matching entry for this
  -- player — not zero (already gone) and not more than one (would mean
  -- duplicate/corrupt roster data), either of which makes it unsafe to
  -- blindly strip an entry.
  select count(*) into v_roster_match_count
  from jsonb_array_elements(v_winner.roster) p
  where (p->>'id')::int = v_player_id;

  if v_roster_match_count <> 1 then
    return jsonb_build_object(
      'ok', false,
      'error', format(
        'Winner roster has %s matching entries for this player (expected exactly 1); aborting without changes',
        v_roster_match_count
      )
    );
  end if;

  -- All checks passed — results, current_player, draft_log[1],
  -- drafted_player_ids, and the winner's roster all consistently agree
  -- on the same player/winner/amount. Safe to reverse.

  select coalesce(jsonb_agg(p), '[]'::jsonb)
  into v_new_roster
  from jsonb_array_elements(v_winner.roster) p
  where (p->>'id')::int <> v_player_id;

  update room_participants
  set budget = budget + v_amount,
      roster = v_new_roster
  where room_id = p_room_id and user_id = v_winner_user_id;

  v_new_drafted_ids :=
    v_room.drafted_player_ids[1 : array_length(v_room.drafted_player_ids, 1) - 1];

  v_new_draft_log := v_room.draft_log[2 : v_log_len];

  v_new_auction_id := gen_random_uuid()::text;
  v_auction_seconds := coalesce((v_room.settings->>'auction_time')::int, 60);

  update rooms
  set
    drafted_player_ids = v_new_drafted_ids,
    draft_log = v_new_draft_log,
    results = null,
    tie_eligible_ids = null,
    tie_redo_count = 0,
    is_paused = false,
    paused_seconds_left = null,
    status = 'bidding',
    current_player = current_player || jsonb_build_object('auction_id', v_new_auction_id),
    auction_deadline = now() + (v_auction_seconds || ' seconds')::interval
  where id = p_room_id
    and status = 'results';

  return jsonb_build_object('ok', true, 'new_auction_id', v_new_auction_id);
end;
$$;

grant execute on function redo_auction(uuid) to authenticated;



-- ---------- Final Tiebreaker Wheel ----------

alter table rooms
add column if not exists wheel_candidates jsonb;

alter table rooms
add column if not exists wheel_winner_user_id uuid;

alter table rooms
add column if not exists wheel_spin_started_at timestamptz;

alter table rooms
add column if not exists wheel_tied_amount int;

alter table rooms
add column if not exists wheel_all_bids jsonb;


-- Host pulls the lever.
-- Server randomly chooses the winner exactly once.
create or replace function spin_tiebreaker_wheel(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms%rowtype;
  v_count int;
  v_idx int;
  v_winner_candidate jsonb;
  v_winner_user_id uuid;
begin
  select *
  into v_room
  from rooms
  where id = p_room_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'Room not found'
    );
  end if;

  if auth.uid() is distinct from v_room.host_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'Only the host can pull the lever'
    );
  end if;

  if v_room.status <> 'tiebreaker_wheel' then
    return jsonb_build_object(
      'ok', false,
      'error', 'The wheel is not active right now'
    );
  end if;

  if v_room.wheel_winner_user_id is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'The wheel has already been spun'
    );
  end if;

  v_count :=
    jsonb_array_length(
      coalesce(v_room.wheel_candidates, '[]'::jsonb)
    );

  if v_count < 2 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Not enough tied candidates to spin'
    );
  end if;

  v_idx := floor(random() * v_count)::int;

  v_winner_candidate :=
    v_room.wheel_candidates -> v_idx;

  v_winner_user_id :=
    (v_winner_candidate->>'userId')::uuid;

  update rooms
  set
    wheel_winner_user_id = v_winner_user_id,
    wheel_spin_started_at = now()
  where id = p_room_id
    and status = 'tiebreaker_wheel'
    and wheel_winner_user_id is null;

  return jsonb_build_object(
    'ok', true,
    'winnerUserId', v_winner_user_id
  );
end;
$$;

grant execute on function spin_tiebreaker_wheel(uuid)
to authenticated;


-- Finalize only AFTER the wheel has actually spun for 5 seconds.
create or replace function finalize_tiebreaker_wheel(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rooms%rowtype;
  v_winner room_participants%rowtype;

  v_player_id int;
  v_amount int;

  v_new_roster jsonb;
  v_all_bids jsonb;
  v_log_entry jsonb;
begin
  select *
  into v_room
  from rooms
  where id = p_room_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'Room not found'
    );
  end if;

  if not public.is_room_participant(p_room_id) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Not a participant of this room'
    );
  end if;

  if v_room.status <> 'tiebreaker_wheel' then
    return jsonb_build_object(
      'ok', true,
      'skipped', 'not awaiting wheel finalize'
    );
  end if;

  if v_room.wheel_winner_user_id is null then
    return jsonb_build_object(
      'ok', true,
      'skipped', 'wheel has not been spun yet'
    );
  end if;

  if v_room.wheel_spin_started_at is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'Wheel spin start time is missing'
    );
  end if;

  if now() < v_room.wheel_spin_started_at + interval '5 seconds' then
    return jsonb_build_object(
      'ok', true,
      'skipped', 'wheel is still spinning'
    );
  end if;

  if v_room.current_player is null
     or v_room.wheel_tied_amount is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'Missing auction data; cannot finalize'
    );
  end if;

  v_player_id :=
    (v_room.current_player->>'id')::int;

  v_amount :=
    v_room.wheel_tied_amount;

  select *
  into v_winner
  from room_participants
  where room_id = p_room_id
    and user_id = v_room.wheel_winner_user_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'Winning manager is no longer in this room'
    );
  end if;

  v_new_roster :=
    coalesce(v_winner.roster, '[]'::jsonb)
    ||
    jsonb_build_array(
      jsonb_build_object(
        'id', v_player_id,
        'name', v_room.current_player->>'name',
        'rating',
          (v_room.current_player->>'rating')::numeric,
        'positions',
          coalesce(
            v_room.current_player->'positions',
            '[]'::jsonb
          ),
        'cost', v_amount
      )
    );

  update room_participants
  set
    budget = budget - v_amount,
    roster = v_new_roster
  where room_id = p_room_id
    and user_id = v_room.wheel_winner_user_id;

  v_all_bids :=
    coalesce(
      v_room.wheel_all_bids,
      '[]'::jsonb
    );

  v_log_entry :=
    jsonb_build_object(
      'id',
        v_player_id::text
        || '_'
        || extract(epoch from now())::bigint::text,

      'playerName',
        v_room.current_player->>'name',

      'amount',
        v_amount,

      'winnerName',
        v_winner.display_name,

      'winnerUserId',
        v_room.wheel_winner_user_id,

      'wasWheelTiebreaker',
        true
    );

  update rooms
  set
    drafted_player_ids =
      drafted_player_ids || v_player_id,

    draft_log =
      array_prepend(
        v_log_entry,
        draft_log
      ),

    status = 'results',

    results =
      jsonb_build_object(
        'playerName',
          v_room.current_player->>'name',

        'winnerName',
          v_winner.display_name,

        'winnerUserId',
          v_room.wheel_winner_user_id,

        'amount',
          v_amount,

        'allBids',
          v_all_bids,

        'wasCoinFlip',
          false,

        'wasWheelTiebreaker',
          true
      ),

    wheel_candidates = null,
    wheel_winner_user_id = null,
    wheel_spin_started_at = null,
    wheel_tied_amount = null,
    wheel_all_bids = null,

    tie_eligible_ids = null,
    tie_redo_count = 0

  where id = p_room_id
    and status = 'tiebreaker_wheel';

  return jsonb_build_object(
    'ok', true,
    'winnerUserId',
      v_room.wheel_winner_user_id,
    'amount',
      v_amount
  );
end;
$$;

grant execute on function finalize_tiebreaker_wheel(uuid)
to authenticated;