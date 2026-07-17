import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { brandTitle, useDocumentTitle } from '../../util/useDocumentTitle';
import type {
  Profile,
  CatalogEntry,
  AchievementScope,
} from '../../types/profile';

// Badges are your own private surface (GitHub #121) — there is no public profile,
// so this page only ever renders the signed-in user's own achievements.
//
// No polling, unlike the rankings: your badges only change from your own actions,
// so a one-shot load is right.

// What each scope means, in the user's terms. Rendering the group header from here
// keeps the page free of per-badge knowledge — the catalog comes from the server.
const SCOPES: { scope: AchievementScope; title: string; blurb: string }[] = [
  {
    scope: 'ladder',
    title: 'Ranked',
    blurb:
      'Earned only in ranked ladder matches against real opponents. These can’t be farmed.',
  },
  {
    scope: 'sandbox',
    title: 'Career',
    blurb:
      'Lifetime totals across every match your bots have fought, ranked or in your own arena.',
  },
  {
    scope: 'account',
    title: 'Milestones',
    blurb: 'For getting stuck in: writing bots and making the platform yours.',
  },
];

// Translucent fills, so both read over the light and dark page background without
// a per-theme value (the same trick the rankings podium uses).
const GOLD_WASH = 'rgba(255, 215, 0, 0.12)';
const LOCKED_WASH = 'rgba(128, 128, 128, 0.08)';

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
  gap: 12,
  marginBottom: 28,
};

const card: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
  padding: '10px 12px',
  border: '1px solid var(--rule)',
  borderRadius: 8,
  background: GOLD_WASH,
};

// Locked badges are shown, greyed — seeing what's still out there is the whole
// point of the page.
const lockedCard: React.CSSProperties = {
  ...card,
  background: LOCKED_WASH,
  opacity: 0.55,
};

const iconStyle: React.CSSProperties = { fontSize: '1.6em', lineHeight: 1.1 };
const nameStyle: React.CSSProperties = { fontWeight: 600, color: 'var(--fg)' };
const descStyle: React.CSSProperties = { fontSize: '0.85em', color: '#888' };

const track: React.CSSProperties = {
  height: 4,
  borderRadius: 2,
  background: 'rgba(128, 128, 128, 0.25)',
  marginTop: 6,
};

const formatNumber = (n: number) => n.toLocaleString();

function BadgeCard({
  entry,
  unlockedAt,
  progress,
}: {
  entry: CatalogEntry;
  unlockedAt?: string;
  progress?: { value: number; threshold: number };
}) {
  const unlocked = unlockedAt !== undefined;
  const pct = progress
    ? Math.min(100, (progress.value / progress.threshold) * 100)
    : 0;

  return (
    <div
      style={unlocked ? card : lockedCard}
      // A greyed card reads as "locked" visually but not to a screen reader.
      aria-label={unlocked ? entry.name : `Locked: ${entry.name}`}
    >
      <div style={iconStyle} aria-hidden="true">
        {entry.icon}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={nameStyle}>{entry.name}</div>
        <div style={descStyle}>{entry.description}</div>

        {unlocked && (
          <div style={{ ...descStyle, marginTop: 4 }}>
            Earned {new Date(unlockedAt).toLocaleDateString()}
          </div>
        )}

        {/* Progress only helps on a locked, countable badge. */}
        {!unlocked && progress && (
          <>
            <div style={track}>
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  borderRadius: 2,
                  background: 'gold',
                }}
              />
            </div>
            <div style={{ ...descStyle, marginTop: 4 }}>
              {formatNumber(progress.value)} /{' '}
              {formatNumber(progress.threshold)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  useDocumentTitle(brandTitle('Your Badges'));
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await axios.get<Profile>('/api/profile');
        if (cancelled) return;
        setProfile(res.data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        // Branch on the response here rather than threading the app's user state
        // in: this page then renders correctly regardless of when that resolves,
        // with no flash of an empty profile on load.
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        if (status === 401 || status === 403) setSignedOut(true);
        else setError('Could not load your badges.');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const unlockedById = new Map((profile?.unlocked ?? []).map((u) => [u.id, u]));
  const earnedCount = profile?.unlocked.length ?? 0;
  const totalCount = profile?.catalog.length ?? 0;

  return (
    <div>
      <div className="markdown">
        <h1>Your Badges</h1>
        <p>
          Badges track what your bots have actually done: every ranked win,
          every shot fired. The ranked ones can only be earned on the{' '}
          <Link to="/leaderboard">global ladder</Link>, so they mean something.
        </p>
      </div>

      <div style={{ padding: '0 20px' }}>
        {signedOut && <p>Sign in to see the badges you’ve earned.</p>}

        {error && <p style={{ color: '#c0392b' }}>{error}</p>}

        {!error && !signedOut && profile === null && (
          <p>Loading your badges…</p>
        )}

        {!error && !signedOut && profile !== null && (
          <>
            <p style={{ color: '#888' }}>
              {earnedCount} of {totalCount} earned
              {profile.user.memberSince &&
                ` · member since ${new Date(
                  profile.user.memberSince
                ).toLocaleDateString(undefined, {
                  month: 'long',
                  year: 'numeric',
                })}`}
            </p>

            {SCOPES.map(({ scope, title, blurb }) => {
              const entries = profile.catalog.filter((e) => e.scope === scope);
              // A scope with nothing in it yet (account badges land later) simply
              // doesn't render — no empty headings.
              if (entries.length === 0) return null;

              return (
                <section key={scope}>
                  <h2 style={{ marginBottom: 4 }}>{title}</h2>
                  <p style={descStyle}>{blurb}</p>
                  <div style={grid}>
                    {entries.map((entry) => {
                      const hit = unlockedById.get(entry.id);
                      const progress =
                        entry.counter && entry.threshold
                          ? {
                              value: profile.counters[entry.counter] ?? 0,
                              threshold: entry.threshold,
                            }
                          : undefined;
                      return (
                        <BadgeCard
                          key={entry.id}
                          entry={entry}
                          unlockedAt={hit?.unlockedTimestamp}
                          progress={progress}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
