import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import appService from '../services/AppService';
import tournamentService, {
  MAX_TOURNAMENT_MEMBERS,
  Tournament,
  TournamentSettings,
  hasEnded,
} from '../services/TournamentService';
import { presentBoardRow } from '../services/AppService';
import { MAX_APPS_PER_USER, MAX_TOURNAMENTS_PER_USER } from '../util/limits';
import auth from '../middleware/auth';
import { writeRateLimit } from '../middleware/rateLimit';
import { ErrorCodes } from '../types/ErrorCodes';
import { isUuid } from '../util/uuid';
import { sanitizeBotName } from '../util/botName';
import { isNameProfane } from '../util/nameFilter';
import { abbreviateName } from '../util/displayName';
import { logger, LogEvent } from '../util/logger';
import type User from '../types/user';

// Personal tournaments (GitHub #119) — a named, shareable filter over the global
// Elo ladder; see services/TournamentService.ts for the model.
//
// Access model:
//   - GET /api/tournaments/:id is PUBLIC (auth(false)): the id is the share
//     link, and the board carries only what the global board already shows
//     publicly (app name, abbreviated owner name, record). Never source, never
//     another user's app id or user id.
//   - Everything else needs sign-in. Join/leave act on the caller only (the
//     path says `members/me`, so there is no other user to name), and
//     rename/delete are creator-only.
//
// Lives under /api/tournaments rather than /api/user/:userId/... for the same
// reason as /api/profile: the actor comes from the session, not a path param,
// so there is no ownership check to get wrong. Mounted under /api, so the broad
// apiRateLimit applies; creating and joining also ride the per-user
// writeRateLimit (after auth, so it keys by user).
const app = express();

// The board is a small group's, but a member brings up to MAX_APPS_PER_USER apps,
// so show more rows than the global top 20. Also the ceiling on the creator's
// own `maxEntries` setting.
const TOURNAMENT_BOARD_LIMIT = 100;

// The most each creator-set numeric rule may be. A per-member cap above
// MAX_APPS_PER_USER could never bite, and a row cap above the board limit would
// be silently clipped — so neither is accepted rather than stored meaninglessly.
// The games floor is bounded only so a typo can't hide every bot forever.
const SETTINGS_LIMITS = {
  maxAppsPerMember: MAX_APPS_PER_USER,
  maxEntries: TOURNAMENT_BOARD_LIMIT,
  minGames: 10000,
} as const;

type MaybeUserRequest = Request & { user?: User };
type TournamentRequest = Request & { user?: User; tournament: Tournament };

const actorId = (req: Request) => (req as MaybeUserRequest).user?.getId();

// Same precautions the global board applies to owner names: Google account names
// are untrusted, so sanitize, fall back to Anonymous on profanity, and abbreviate
// to "First L." so a public page never shows a full surname.
const publicOwnerName = (name: string | null): string => {
  const clean = sanitizeBotName(name);
  return isNameProfane(clean) ? 'Anonymous' : abbreviateName(clean);
};

// Validate a user-supplied tournament name. Returns the stored form or an error.
const cleanName = (raw: unknown): { name: string } | { error: string } => {
  const name = sanitizeBotName(raw);
  if (!name) return { error: 'A tournament needs a name.' };
  // Tournament names show on a public (link-shared) page, so they get the same
  // profanity screen as bot names.
  if (isNameProfane(name)) return { error: 'Please choose a different name.' };
  return { name };
};

// Validate one creator-set board rule from a PATCH body. `undefined` (absent)
// leaves the stored value alone; `null` clears it; otherwise it must be an
// integer from 1 to `max`. Anything else — a string, 0, a float, too large — is
// rejected rather than coerced, so a typo never quietly becomes a rule.
const parseCap = (
  raw: unknown,
  max: number,
  label: string
): { value: number | null | undefined } | { error: string } => {
  if (raw === undefined) return { value: undefined };
  if (raw === null) return { value: null };
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > max)
    return { error: `${label} must be a whole number from 1 to ${max}.` };
  return { value: raw };
};

// A boolean switch from a PATCH body: absent leaves it, otherwise it must be a
// real boolean (not "true", not 1).
const parseSwitch = (
  raw: unknown,
  label: string
): { value: boolean | undefined } | { error: string } => {
  if (raw === undefined) return { value: undefined };
  if (typeof raw !== 'boolean')
    return { error: `${label} must be true or false.` };
  return { value: raw };
};

// A date from a PATCH body: absent leaves it, null clears it, otherwise an ISO
// 8601 string (what the UI's date input and JSON.stringify(Date) both produce)
// that parses to a real instant.
const parseWhen = (
  raw: unknown,
  label: string
): { value: Date | null | undefined } | { error: string } => {
  if (raw === undefined) return { value: undefined };
  if (raw === null) return { value: null };
  const when = typeof raw === 'string' ? new Date(raw) : new Date(NaN);
  if (Number.isNaN(when.getTime()))
    return { error: `${label} must be a date and time.` };
  return { value: when };
};

// The settings the board reports and the PATCH route accepts.
const settingsOf = (t: Tournament): TournamentSettings => ({
  maxAppsPerMember: t.maxAppsPerMember,
  maxEntries: t.maxEntries,
  minGames: t.minGames,
  rankBy: t.rankBy,
  hideOwners: t.hideOwners,
  publicOnly: t.publicOnly,
  joinLocked: t.joinLocked,
  endsAt: t.endsAt,
  editedSince: t.editedSince,
});

// Ranking players (rankBy 'members') is a per-member cap of one, whatever
// maxAppsPerMember says.
const effectiveOwnerCap = (t: Tournament): number =>
  t.rankBy === 'members' ? 1 : (t.maxAppsPerMember ?? Infinity);

// Why a would-be member can't join right now, if anything stops them.
const joinClosedReason = (t: Tournament): string | undefined =>
  hasEnded(t)
    ? 'This tournament has ended.'
    : t.joinLocked
      ? 'This tournament is not accepting new members.'
      : undefined;

const fail = (res: Response, err: unknown, msg: string) => {
  logger.error({ event: LogEvent.HTTP_ERROR, err }, msg);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
};

// Loads :tournamentId into req.tournament: 400 (E028) for a malformed id, so a
// typo never reaches a uuid cast as a 500, and 404 for a well-formed id that
// matches nothing.
const loadTournament = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const id = req.params.tournamentId;
  if (!isUuid(id)) {
    res.status(400).json({
      code: ErrorCodes.E028,
      error: 'Invalid tournament id: expected a UUID.',
    });
    return;
  }
  try {
    const tournament = await tournamentService.get(id);
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found.' });
      return;
    }
    (req as TournamentRequest).tournament = tournament;
    next();
  } catch (err) {
    fail(res, err, 'failed to load tournament');
  }
};

const requireCreator = (req: Request, res: Response, next: NextFunction) => {
  const { tournament } = req as TournamentRequest;
  if (tournament.ownerUserId !== actorId(req)) {
    logger.warn(
      {
        event: LogEvent.AUTH_FORBIDDEN,
        tournamentId: tournament.id,
        userId: actorId(req),
      },
      'non-creator tried to manage a tournament'
    );
    res.status(403).json({ error: 'Only the tournament creator can do that.' });
    return;
  }
  next();
};

// The signed-in user's tournaments: the ones they created or joined.
app.get('/api/tournaments', auth(true), async (req, res) => {
  try {
    res.json(await tournamentService.listForUser(actorId(req) as string));
  } catch (err) {
    fail(res, err, 'failed to list tournaments');
  }
});

app.post('/api/tournaments', auth(true), writeRateLimit, async (req, res) => {
  try {
    const userId = actorId(req) as string;
    const parsed = cleanName(req.body?.name);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (
      (await tournamentService.countOwnedBy(userId)) >= MAX_TOURNAMENTS_PER_USER
    ) {
      res.status(409).json({
        error: `You can create up to ${MAX_TOURNAMENTS_PER_USER} tournaments. Delete one to make room.`,
      });
      return;
    }
    const t = await tournamentService.create(userId, parsed.name);
    res.status(201).json({ id: t.id, name: t.name });
  } catch (err) {
    fail(res, err, 'failed to create tournament');
  }
});

// The public board. Optional auth so a signed-in viewer sees their own rows
// marked and gets join/leave state; anonymous viewers get the same board.
app.get(
  '/api/tournaments/:tournamentId',
  auth(false),
  loadTournament,
  async (req, res) => {
    try {
      const { tournament } = req as TournamentRequest;
      const viewerId = actorId(req);
      const ended = hasEnded(tournament);
      // The creator's rules ride the same machinery as the global board's: the
      // per-member cap is the rank function's owner cap (so ranks are
      // renumbered over the kept rows), the row cap is the display limit, and
      // the eligibility filters narrow the candidate rows before ranking.
      const rankLive = () =>
        appService.rankBoard(
          Math.min(
            tournament.maxEntries ?? TOURNAMENT_BOARD_LIMIT,
            TOURNAMENT_BOARD_LIMIT
          ),
          {
            tournamentId: tournament.id,
            ownerCap: effectiveOwnerCap(tournament),
            minGames: tournament.minGames ?? undefined,
            publicOnly: tournament.publicOnly,
            editedSince: tournament.editedSince ?? undefined,
          }
        );
      // Past the end date the standings are final: the first read after the
      // deadline ranks the board one last time and stores it; every later read
      // serves that snapshot (the global ratings keep moving, the board does
      // not). Movement arrows mean nothing on a frozen board, so they're
      // levelled out.
      const finalRows = async () => {
        if (tournament.finalBoard) return tournament.finalBoard;
        const rows = (await rankLive()).map((r) => ({
          ...r,
          previousRank: r.rank,
        }));
        return tournamentService.setFinalBoard(tournament.id, rows);
      };
      const [members, rows] = await Promise.all([
        tournamentService.members(tournament.id),
        ended ? finalRows() : rankLive(),
      ]);
      // Owner names are a presentation choice, so hiding them applies even to
      // a frozen board.
      const entries = rows.map((row) =>
        presentBoardRow(row, viewerId, { hideOwners: tournament.hideOwners })
      );
      const owner = members.find((m) => m.userId === tournament.ownerUserId);
      const isOwner =
        viewerId !== undefined && viewerId === tournament.ownerUserId;
      res.json({
        id: tournament.id,
        name: tournament.name,
        // The creator may have left; the name is still worth showing. Their
        // account name only comes from the member list, so a creator who left
        // reads as Anonymous rather than costing an extra lookup.
        ownerName: owner ? publicOwnerName(owner.name) : undefined,
        isOwner,
        joined:
          viewerId !== undefined && members.some((m) => m.userId === viewerId),
        memberCount: members.length,
        maxMembers: MAX_TOURNAMENT_MEMBERS,
        // Everyone sees the rules the board was built under (a viewer should
        // know they're looking at each member's top 3), and the ceilings the
        // creator's settings form may offer.
        settings: settingsOf(tournament),
        settingsLimits: SETTINGS_LIMITS,
        // Final standings (end date passed) — the board no longer moves.
        ended,
        // Set when sign-in alone wouldn't let a viewer join.
        joinClosed: joinClosedReason(tournament),
        // The member roster is the creator's alone: other viewers see the
        // ranked bots (which already carry owner names) but not who has joined
        // without a ranked bot yet. Display names only — member user ids never
        // leave the server.
        members: isOwner
          ? members.map((m) => publicOwnerName(m.name))
          : undefined,
        entries,
      });
    } catch (err) {
      fail(res, err, 'failed to build tournament board');
    }
  }
);

// Rename and/or change the board rules. Every field is optional and only the
// fields present change: `name` renames, `maxAppsPerMember` / `maxEntries` set a
// rule (an integer) or clear it (`null`). A body naming none of them is a 400
// rather than a silent no-op. Everything is validated before anything is
// written, so a bad name can't land half an update.
app.patch(
  '/api/tournaments/:tournamentId',
  auth(true),
  loadTournament,
  requireCreator,
  async (req, res) => {
    try {
      const { tournament } = req as TournamentRequest;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const reject = (error: string) => res.status(400).json({ error });

      const settings = settingsOf(tournament);
      let settingsChanged = false;
      // The end date is special: moving or clearing it reopens a board that had
      // frozen, so the final standings are discarded along with it.
      let endsAtChanged = false;

      const perMember = parseCap(
        body.maxAppsPerMember,
        SETTINGS_LIMITS.maxAppsPerMember,
        'Bots per member'
      );
      if ('error' in perMember) return reject(perMember.error);
      if (perMember.value !== undefined) {
        settings.maxAppsPerMember = perMember.value;
        settingsChanged = true;
      }

      const entries = parseCap(
        body.maxEntries,
        SETTINGS_LIMITS.maxEntries,
        'Bots shown'
      );
      if ('error' in entries) return reject(entries.error);
      if (entries.value !== undefined) {
        settings.maxEntries = entries.value;
        settingsChanged = true;
      }

      const minGames = parseCap(
        body.minGames,
        SETTINGS_LIMITS.minGames,
        'Minimum ranked games'
      );
      if ('error' in minGames) return reject(minGames.error);
      if (minGames.value !== undefined) {
        settings.minGames = minGames.value;
        settingsChanged = true;
      }

      if (body.rankBy !== undefined) {
        if (body.rankBy !== 'bots' && body.rankBy !== 'members')
          return reject('Rank by must be "bots" or "members".');
        settings.rankBy = body.rankBy;
        settingsChanged = true;
      }

      for (const key of ['hideOwners', 'publicOnly', 'joinLocked'] as const) {
        const parsed = parseSwitch(body[key], key);
        if ('error' in parsed) return reject(parsed.error);
        if (parsed.value !== undefined) {
          settings[key] = parsed.value;
          settingsChanged = true;
        }
      }

      const endsAt = parseWhen(body.endsAt, 'End date');
      if ('error' in endsAt) return reject(endsAt.error);
      if (endsAt.value !== undefined) {
        endsAtChanged =
          (endsAt.value?.getTime() ?? null) !==
          (tournament.endsAt?.getTime() ?? null);
        settings.endsAt = endsAt.value;
        settingsChanged = true;
      }

      const editedSince = parseWhen(body.editedSince, 'Edited since');
      if ('error' in editedSince) return reject(editedSince.error);
      if (editedSince.value !== undefined) {
        settings.editedSince = editedSince.value;
        settingsChanged = true;
      }

      let name: string | undefined;
      if (body.name !== undefined) {
        const parsed = cleanName(body.name);
        if ('error' in parsed) return reject(parsed.error);
        name = parsed.name;
      }
      if (name === undefined && !settingsChanged)
        return reject('Nothing to update.');

      if (name !== undefined)
        await tournamentService.rename(tournament.id, name);
      if (settingsChanged)
        await tournamentService.updateSettings(tournament.id, settings, {
          clearFinalBoard: endsAtChanged,
        });
      res.json({
        id: tournament.id,
        name: name ?? tournament.name,
        settings,
        updated: true,
      });
    } catch (err) {
      fail(res, err, 'failed to update tournament');
    }
  }
);

app.delete(
  '/api/tournaments/:tournamentId',
  auth(true),
  loadTournament,
  requireCreator,
  async (req, res) => {
    try {
      const { tournament } = req as TournamentRequest;
      await tournamentService.delete(tournament.id);
      res.json({ id: tournament.id, deleted: true });
    } catch (err) {
      fail(res, err, 'failed to delete tournament');
    }
  }
);

app.put(
  '/api/tournaments/:tournamentId/members/me',
  auth(true),
  writeRateLimit,
  loadTournament,
  async (req, res) => {
    try {
      const { tournament } = req as TournamentRequest;
      // Already-members pass (idempotent, as before); the lock and the end date
      // stop only newcomers. The creator is bound by their own lock too — they
      // reopen it from Settings rather than slipping past it.
      const closed = joinClosedReason(tournament);
      if (
        closed &&
        !(await tournamentService.isMember(
          tournament.id,
          actorId(req) as string
        ))
      ) {
        res.status(409).json({ error: closed });
        return;
      }
      const result = await tournamentService.join(
        tournament.id,
        actorId(req) as string
      );
      if (result === 'full') {
        res.status(409).json({
          error: `This tournament is full (${MAX_TOURNAMENT_MEMBERS} members).`,
        });
        return;
      }
      res.json({ id: tournament.id, joined: true });
    } catch (err) {
      fail(res, err, 'failed to join tournament');
    }
  }
);

app.delete(
  '/api/tournaments/:tournamentId/members/me',
  auth(true),
  loadTournament,
  async (req, res) => {
    try {
      const { tournament } = req as TournamentRequest;
      await tournamentService.leave(tournament.id, actorId(req) as string);
      res.json({ id: tournament.id, left: true });
    } catch (err) {
      fail(res, err, 'failed to leave tournament');
    }
  }
);

export default app;
