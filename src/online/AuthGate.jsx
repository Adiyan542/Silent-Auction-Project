import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Wraps online mode: shows a sign up / log in form until there's a session,
// then renders children with { session, profile }.
export default function AuthGate({ children, onExit }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
  
    const loadOrCreateProfile = async () => {
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();
  
      if (existingProfile) {
        setProfile(existingProfile);
        return;
      }
  
      const fallbackName =
        session.user.user_metadata?.display_name ||
        session.user.email?.split('@')[0] ||
        'Manager';

      const { data: createdProfile, error: createError } = await supabase
        .from('profiles')
        .upsert(
          {
            id: session.user.id,
            display_name: fallbackName,
          },
          { onConflict: 'id' }
        )
        .select()
        .single();

      if (createError) {
        console.error('Could not create profile:', createError);
        setError(createError.message);
        return;
      }

      setProfile(createdProfile);
    };
    loadOrCreateProfile();
  }, [session]);

  


  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'signup') {
        if (!displayName.trim()) throw new Error('Enter a display name.');

        const { error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName.trim(),
            },
          },
        });

        if (signUpErr) throw signUpErr;
      } else {
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) throw signInErr;
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-500">Loading…</div>;
  }

  if (session && profile) {
    return children({ session, profile });
  }

  // Signed in but profile row hasn't loaded/created yet (rare race) — show a
  // brief loading state rather than the form.
  if (session && !profile) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-500">Setting up your profile…</div>;
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 p-8 rounded-2xl w-full max-w-md border border-slate-700 shadow-2xl">
        <button onClick={onExit} className="text-slate-500 text-xs mb-4 hover:text-slate-300">&larr; Back</button>
        <h1 className="text-2xl font-black text-white mb-1">
          {mode === 'login' ? 'Log In' : 'Create Account'}
        </h1>
        <p className="text-slate-400 text-sm mb-6">
          {mode === 'login' ? 'Log in to join or host an online draft.' : 'Set up an account so your friends can find you in a room.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'signup' && (
            <input
              className="w-full bg-slate-950 border border-slate-700 p-3 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          )}
          <input
            type="email"
            className="w-full bg-slate-950 border border-slate-700 p-3 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            className="w-full bg-slate-950 border border-slate-700 p-3 rounded-xl text-white outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition"
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Log In' : 'Sign Up'}
          </button>
        </form>

        <button
          onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}
          className="text-slate-400 text-sm mt-4 w-full text-center hover:text-white"
        >
          {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
        </button>
      </div>
    </div>
  );
}
