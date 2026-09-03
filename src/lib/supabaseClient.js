import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// True once you've filled in .env — used to hide/show "Play Online" so the
// app doesn't crash for anyone who hasn't set up Supabase yet.
export const isOnlineConfigured = Boolean(url && anonKey);

export const supabase = isOnlineConfigured ? createClient(url, anonKey) : null;
