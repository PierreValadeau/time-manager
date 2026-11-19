import { useId, useRef, useState } from 'react';
import { SignInIcon, SignOutIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useCurrentUser } from '../auth/auth-context';
import { Alert, Button, useToast } from '../components/ui';
import { ApiError } from '../lib/api';
import { useCurrentSession, useDaySessions, useToggleClock, type Session } from '../lib/clocks';
import { formatDay, formatDuration, formatTime, localDay, useNow } from '../lib/time';
import './HomePage.css';

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Bonjour';
  if (hour < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

// Minutes worked over the day: closed sessions plus the running one; a forgotten clock-out counts for nothing
function workedMinutes(sessions: Session[], now: Date): number {
  return sessions.reduce((total, session) => {
    if (session.status === 'closed') return total + (session.workedMinutes ?? 0);
    if (session.status === 'open') return total + (now.getTime() - new Date(session.clockIn).getTime()) / 60_000;
    return total;
  }, 0);
}

function clockErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'Un autre pointage était en cours. Votre statut a été actualisé, réessayez si besoin.';
    if (error.status === 403) return 'Votre compte ne permet pas de pointer.';
    if (error.status === 429) return 'Trop de requêtes. Réessayez dans quelques instants.';
  }
  return 'Pointage impossible pour le moment. Réessayez dans quelques instants.';
}

// Uses the server time, never the client one
function confirmationMessage(session: Session): string {
  return session.clockOut
    ? `Départ enregistré à ${formatTime(session.clockOut)}`
    : `Arrivée enregistrée à ${formatTime(session.clockIn)}`;
}

type DayEvent = {
  key: string;
  kind: 'in' | 'out' | 'missing';
  label: string;
  time: string | null;
  // Shown instead of the time when it is unknown
  placeholder?: string;
};

function dayEvents(sessions: Session[]): DayEvent[] {
  return sessions.flatMap((session): DayEvent[] => {
    const arrival: DayEvent = { key: `${session.id}-in`, kind: 'in', label: 'Arrivée', time: session.clockIn };
    if (session.status === 'anomaly') {
      return [arrival, { key: `${session.id}-out`, kind: 'missing', label: 'Départ non pointé', time: null, placeholder: 'À corriger' }];
    }
    if (!session.clockOut) {
      return [arrival, { key: `${session.id}-out`, kind: 'out', label: 'Départ', time: null, placeholder: 'En cours' }];
    }
    return [arrival, { key: `${session.id}-out`, kind: 'out', label: 'Départ', time: session.clockOut }];
  });
}

const EVENT_ICONS = { in: SignInIcon, out: SignOutIcon, missing: WarningCircleIcon };

function DayHistory({ day }: { day: string }) {
  const titleId = useId();
  const { data: sessions, isPending, isError } = useDaySessions(day);

  let content;
  if (isPending) {
    content = <p className="text-muted">Chargement des pointages…</p>;
  } else if (isError) {
    content = <p className="text-muted">Impossible de charger les pointages du jour.</p>;
  } else if (sessions.length === 0) {
    content = <p className="text-muted">Aucun pointage aujourd’hui.</p>;
  } else {
    content = (
      <ol className="day-events">
        {dayEvents(sessions).map(({ key, kind, label, time, placeholder }) => {
          const EventIcon = EVENT_ICONS[kind];
          return (
            <li key={key} className="day-event">
              <EventIcon size={18} aria-hidden="true" className="day-event-icon" />
              <span className="day-event-label">{label}</span>
              {time ? (
                <time className="day-event-time" dateTime={time}>
                  {formatTime(time)}
                </time>
              ) : (
                <span className="day-event-time">{placeholder}</span>
              )}
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <section className="card" aria-labelledby={titleId}>
      <h2 id={titleId}>Pointages du jour</h2>
      {content}
    </section>
  );
}

function ClockScreen({ firstName }: { firstName: string }) {
  const titleId = useId();
  const now = useNow();
  const day = localDay(now);
  const current = useCurrentSession();
  const { data: todaySessions = [] } = useDaySessions(day);
  const toggle = useToggleClock();
  const showToast = useToast();
  const [error, setError] = useState('');
  // POST /clocks is a toggle: a second click before the answer would clock in then out right away.
  // A ref, because the mutation state only re-renders after the second click may already be handled
  const inFlight = useRef(false);

  const session = current.data ?? null;
  const openSession = session?.status === 'open' ? session : null;
  const onDuty = openSession !== null;
  const forgotten = session?.status === 'anomaly' ? session : null;
  const lastClockOut = todaySessions.findLast((s) => s.status === 'closed')?.clockOut;

  const statusText = openSession
    ? `En poste depuis ${formatTime(openSession.clockIn)}`
    : lastClockOut
      ? `Hors poste · dernier départ ${formatTime(lastClockOut)}`
      : 'Pas encore pointé';

  const handleToggle = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError('');
    try {
      showToast(confirmationMessage(await toggle.mutateAsync()));
    } catch (err) {
      setError(clockErrorMessage(err));
    } finally {
      inFlight.current = false;
    }
  };

  let action;
  if (current.isPending) {
    action = <p className="text-muted">Chargement de votre pointage…</p>;
  } else if (current.isError) {
    action = (
      <Button variant="secondary" block onClick={() => current.refetch()}>
        Réessayer
      </Button>
    );
  } else {
    const ActionIcon = onDuty ? SignOutIcon : SignInIcon;
    action = (
      <Button block className="clock-button" loading={toggle.isPending} onClick={handleToggle}>
        <ActionIcon size={20} aria-hidden="true" />
        {onDuty ? 'Pointer mon départ' : 'Pointer mon arrivée'}
      </Button>
    );
  }

  return (
    <div className="home-grid">
      <section className={onDuty ? 'clock-hero is-on-duty' : 'clock-hero'} aria-labelledby={titleId}>
        <h2 id={titleId} className="visually-hidden">
          Pointage
        </h2>
        <div className="clock-hero-info">
          <p className="clock-status">
            <span className="clock-dot" aria-hidden="true" />
            {statusText}
          </p>
          <p className="clock-time">
            <time dateTime={now.toISOString()}>
              {formatTime(now)}
              <span className="clock-seconds">:{String(now.getSeconds()).padStart(2, '0')}</span>
            </time>
          </p>
          <p className="text-muted">
            {greeting(now)}, {firstName} — {formatDuration(workedMinutes(todaySessions, now))} travaillées aujourd’hui
          </p>
        </div>

        <div className="clock-hero-actions">
          {action}
          {/* Live regions kept mounted: only their content changes, so it gets announced */}
          <div className="clock-messages">
            <Alert tone="info">
              {forgotten &&
                `Votre départ du ${formatDay(forgotten.clockIn)} n’a pas été pointé. Pointez votre arrivée pour démarrer une nouvelle session : votre manager pourra corriger l’ancienne.`}
            </Alert>
            <Alert tone="error">
              {error || (current.isError && 'Impossible de récupérer votre pointage. Réessayez dans quelques instants.')}
            </Alert>
          </div>
        </div>
      </section>

      <DayHistory day={day} />
    </div>
  );
}

// The admin never clocks (POST /clocks refuses the role)
function AdminWelcome({ firstName }: { firstName: string }) {
  return (
    <section className="card">
      <p>Bonjour, {firstName}.</p>
      <p className="text-muted">Le pointage est réservé aux employés et aux managers.</p>
    </section>
  );
}

function HomePage() {
  const user = useCurrentUser();
  return user.role === 'admin' ? <AdminWelcome firstName={user.firstName} /> : <ClockScreen firstName={user.firstName} />;
}

export default HomePage;
