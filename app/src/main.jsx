import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  Bike,
  CalendarDays,
  Check,
  ChevronLeft,
  Dumbbell,
  Flame,
  Gauge,
  History,
  KeyRound,
  LogOut,
  Medal,
  Plus,
  RefreshCw,
  Save,
  Scale,
  Settings,
  Shield,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react';
import './styles.css';

const TEAM_COLORS = {
  1: 'var(--team-one)',
  2: 'var(--team-two)',
};

const activityMeta = {
  run: { label: 'Laufen', icon: Activity },
  sport: { label: 'Sport', icon: Dumbbell },
  bike: { label: 'Rad', icon: Bike },
  team_sport: { label: 'Team', icon: Users },
  weight: { label: 'Gewicht', icon: Scale },
  weight_loss: { label: 'Gewicht', icon: Scale },
  cigarette: { label: 'Rauchen', icon: Flame },
  manual: { label: 'Manuell', icon: Medal },
};

function getToken() {
  const queryToken = new URLSearchParams(window.location.search).get('access');
  if (queryToken) return queryToken;
  try {
    return sessionStorage.getItem('access_token') || localStorage.getItem('access_token') || '';
  } catch {
    return '';
  }
}

function storeToken(token) {
  try {
    localStorage.setItem('access_token', token);
  } catch {}
  try {
    sessionStorage.setItem('access_token', token);
  } catch {}
}

function clearToken() {
  try {
    localStorage.removeItem('access_token');
  } catch {}
  try {
    sessionStorage.removeItem('access_token');
  } catch {}
}

function adminUrl() {
  return `/admin.html?access=${encodeURIComponent(getToken())}`;
}

function dashboardUrl() {
  return `/?access=${encodeURIComponent(getToken())}`;
}

async function api(path, opts = {}) {
  const token = getToken();
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-access-token': token,
      ...(opts.headers || {}),
    },
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/';
    throw new Error('Unauthorized');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function formatPace(value) {
  if (!value) return '-';
  const seconds = Number(value) * 60;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, '0')} /km`;
}

function formatActivity(activity) {
  if (activity.type === 'run') return `${activity.value} km · ${formatPace(activity.pace)}`;
  if (activity.type === 'sport') return activity.pace ? `${activity.value} min · ${activity.pace}` : `${activity.value} min`;
  if (activity.type === 'bike') return `${activity.value} km`;
  if (activity.type === 'team_sport') return activity.pace ? activity.pace : 'Team Sport';
  if (activity.type === 'weight_loss') return `${Math.abs(activity.value)} kg verloren`;
  if (activity.type === 'cigarette') return activity.pace || 'erfasst';
  if (activity.type === 'manual') return activity.pace ? `${activity.value} Pkt · ${activity.pace}` : `${activity.value} Pkt`;
  return activity.type;
}

function pointsLabel(points) {
  const value = Number(points) || 0;
  return `${value > 0 ? '+' : ''}${value}`;
}

function StatTile({ label, value, tone }) {
  return (
    <section className={`stat-tile ${tone || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </section>
  );
}

function IconButton({ icon: Icon, children, variant = 'primary', ...props }) {
  return (
    <button className={`button ${variant}`} type="button" {...props}>
      <Icon size={18} />
      <span>{children}</span>
    </button>
  );
}

function Toast({ message }) {
  if (!message) return null;
  return <div className={`toast ${message.type || 'ok'}`}>{message.text}</div>;
}

function LoginApp() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetch('/api/auth-check', { headers: { 'x-access-token': token } })
      .then((res) => {
        if (res.ok) {
          storeToken(token);
          window.location.href = `/?access=${encodeURIComponent(token)}`;
        }
      })
      .catch(() => {});
  }, []);

  async function login(event) {
    event.preventDefault();
    if (!password) {
      setError('Bitte Passwort eingeben');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!data.success) throw new Error('Falsches Passwort');
      storeToken(data.token);
      window.location.href = `/?access=${encodeURIComponent(data.token)}`;
    } catch (err) {
      setError(err.message || 'Verbindungsfehler');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={login}>
        <div className="brand-mark"><Activity size={34} /></div>
        <h1>Laufchallenge 2026</h1>
        <label>
          <span>Passwort</span>
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Passwort eingeben"
          />
        </label>
        <IconButton icon={KeyRound} type="submit" disabled={busy}>
          {busy ? 'Pruefe...' : 'Oeffnen'}
        </IconButton>
        <p className="form-message error">{error}</p>
      </form>
    </main>
  );
}

function DashboardApp() {
  const [participants, setParticipants] = useState([]);
  const [standings, setStandings] = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedName, setSelectedName] = useState('');
  const [type, setType] = useState('run');
  const [value, setValue] = useState('5');
  const [duration, setDuration] = useState({ h: '0', m: '0', s: '0' });
  const [notes, setNotes] = useState('');
  const [activityDate, setActivityDate] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const isTeam = selectedName === '__team1__' || selectedName === '__team2__';
  const selectedParticipant = participants.find((p) => p.name === selectedName);
  const pace = useMemo(() => {
    const km = Number(value);
    const total = Number(duration.h || 0) * 3600 + Number(duration.m || 0) * 60 + Number(duration.s || 0);
    if ((type !== 'run' && type !== 'bike') || km <= 0 || total <= 0) return null;
    return total / km / 60;
  }, [duration, type, value]);

  const durationMinutes = useMemo(() => {
    const total = Number(duration.h || 0) * 3600 + Number(duration.m || 0) * 60 + Number(duration.s || 0);
    return Math.floor(total / 60);
  }, [duration]);

  async function loadAll({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    try {
      const [p, s, a] = await Promise.all([
        api('/api/participants'),
        api('/api/standings'),
        api('/api/activities'),
      ]);
      setParticipants(p);
      setStandings(s);
      setActivities(a);
    } catch (err) {
      setResult({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    const id = setInterval(() => loadAll({ quiet: true }), 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (isTeam) setType('team');
    else if (type === 'team') setType('run');
    setResult(null);
  }, [selectedName]);

  useEffect(() => {
    if (type === 'run' && !value) setValue('5');
    if (type === 'weight' && selectedParticipant?.currentWeight) setValue('');
    setActivityDate(new Date().toISOString().slice(0, 10));
    setResult(null);
  }, [type]);

  async function submitActivity(event) {
    event.preventDefault();
    if (!selectedName) {
      setResult({ type: 'error', text: 'Bitte Namen waehlen' });
      return;
    }
    setBusy(true);
    setResult({ type: 'info', text: 'Speichere...' });

    try {
      const numericValue = Number(value);
      let response;
      if (type === 'run') {
        if (!numericValue || numericValue <= 0) throw new Error('Bitte Strecke > 0 eingeben');
        if (!pace) throw new Error('Bitte Dauer eingeben');
        response = await api('/api/activity/run', {
          method: 'POST',
          body: JSON.stringify({ name: selectedName, km: numericValue, pace, date: activityDate }),
        });
      } else if (type === 'sport') {
        if (!durationMinutes || durationMinutes <= 0) throw new Error('Bitte Dauer eingeben');
        response = await api('/api/activity/sport', {
          method: 'POST',
          body: JSON.stringify({ name: selectedName, minutes: durationMinutes, notes, date: activityDate }),
        });
      } else if (type === 'bike') {
        if (!numericValue || numericValue <= 0) throw new Error('Bitte Strecke > 0 eingeben');
        if (!pace) throw new Error('Bitte Dauer eingeben');
        response = await api('/api/activity/bike', {
          method: 'POST',
          body: JSON.stringify({ name: selectedName, km: numericValue, date: activityDate }),
        });
      } else if (type === 'team') {
        response = await api('/api/activity/team', {
          method: 'POST',
          body: JSON.stringify({ name: selectedName, notes, date: activityDate }),
        });
      } else if (type === 'weight') {
        if (!numericValue || numericValue <= 0) throw new Error('Bitte Gewicht eingeben');
        response = await api('/api/weight', {
          method: 'POST',
          body: JSON.stringify({ name: selectedName, weight: numericValue, date: activityDate }),
        });
      } else if (type === 'cigarette') {
        if (!activityDate) throw new Error('Bitte Datum waehlen');
        response = await api('/api/activity/cigarette', {
          method: 'POST',
          body: JSON.stringify({ name: selectedName, date: activityDate }),
        });
      }

      setResult({ type: 'ok', text: response.message || 'Gespeichert' });
      setValue(type === 'run' ? '5' : '');
      setDuration({ h: '0', m: '0', s: '0' });
      setNotes('');
      setActivityDate(new Date().toISOString().slice(0, 10));
      await loadAll({ quiet: true });
    } catch (err) {
      setResult({ type: 'error', text: err.message || 'Fehler' });
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    clearToken();
    window.location.href = '/';
  }

  const team1 = standings?.team1 || { members: [], teamPoints: 0, totalPoints: 0 };
  const team2 = standings?.team2 || { members: [], teamPoints: 0, totalPoints: 0 };
  const latest = activities[0];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Laufchallenge 2026</p>
          <h1>Dashboard</h1>
        </div>
        <div className="topbar-actions">
          <IconButton icon={RefreshCw} variant="secondary" onClick={() => loadAll()}>
            Aktualisieren
          </IconButton>
          <IconButton icon={Shield} variant="secondary" onClick={() => { window.location.href = adminUrl(); }}>
            Admin
          </IconButton>
          <button className="icon-only" type="button" onClick={logout} aria-label="Abmelden">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <section className="score-strip">
        <StatTile label="Team 1" value={team1.totalPoints} tone="team-one" />
        <StatTile label="Team 2" value={team2.totalPoints} tone="team-two" />
        <StatTile label="Letzte Aktivitaet" value={latest ? latest.name : '-'} />
      </section>

      <div className="layout-grid">
        <section className="panel log-panel">
          <div className="panel-heading">
            <h2>Eintragen</h2>
            <span>{selectedParticipant?.currentWeight ? `${selectedParticipant.currentWeight} kg aktuell` : ''}</span>
          </div>
          <form className="activity-form" onSubmit={submitActivity}>
            <label>
              <span>Wer?</span>
              <select value={selectedName} onChange={(event) => setSelectedName(event.target.value)}>
                <option value="">Teilnehmer waehlen</option>
                <option value="__team1__">Team 1</option>
                <option value="__team2__">Team 2</option>
                {participants.map((participant) => (
                  <option key={participant.id} value={participant.name}>
                    {participant.name} · Team {participant.team}
                  </option>
                ))}
              </select>
            </label>

            <div className="type-grid">
              {(isTeam ? ['team'] : ['run', 'sport', 'bike', 'weight', 'cigarette']).map((key) => {
                const meta = key === 'team' ? { label: 'Team', icon: Users } : activityMeta[key];
                const Icon = meta.icon;
                return (
                  <button
                    key={key}
                    type="button"
                    className={type === key ? 'active' : ''}
                    onClick={() => setType(key)}
                  >
                    <Icon size={18} />
                    <span>{meta.label}</span>
                  </button>
                );
              })}
            </div>

            <label>
              <span>Datum</span>
              <input type="date" value={activityDate} onChange={(event) => setActivityDate(event.target.value)} />
            </label>

            {type === 'run' && (
              <>
                <label>
                  <span>Strecke</span>
                  <div className="unit-input">
                    <input type="number" min="0" step="0.1" value={value} onChange={(event) => setValue(event.target.value)} />
                    <b>km</b>
                  </div>
                </label>
                <DurationInput value={duration} onChange={setDuration} />
                <div className="calc-line">
                  <Gauge size={16} />
                  <span>{pace ? formatPace(pace) : 'Pace wird aus Dauer berechnet'}</span>
                </div>
              </>
            )}

            {type === 'sport' && (
              <>
                <DurationInput value={duration} onChange={setDuration} />
                <label>
                  <span>Beschreibung</span>
                  <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="z.B. Yoga, Krafttraining, Schwimmen" />
                </label>
                <div className="calc-line">
                  <Dumbbell size={16} />
                  <span>{durationMinutes > 0 ? `${durationMinutes} Minuten${notes ? ` · ${notes}` : ''}` : 'Dauer auswaehlen'}</span>
                </div>
              </>
            )}

            {type === 'bike' && (
              <>
                <label>
                  <span>Strecke</span>
                  <div className="unit-input">
                    <input type="number" min="0" step="0.1" value={value} onChange={(event) => setValue(event.target.value)} />
                    <b>km</b>
                  </div>
                </label>
                <DurationInput value={duration} onChange={setDuration} />
                <div className="calc-line">
                  <Gauge size={16} />
                  <span>{pace ? formatPace(pace) : 'Pace wird aus Strecke und Dauer berechnet'}</span>
                </div>
              </>
            )}

            {type === 'weight' && (
              <label>
                <span>Aktuelles Gewicht</span>
                <div className="unit-input">
                  <input
                    type="number"
                    min="20"
                    step="0.1"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder={selectedParticipant?.currentWeight ? `aktuelles Gewicht, bisher ${selectedParticipant.currentWeight}` : 'aktuelles Gewicht eintragen'}
                  />
                  <b>kg</b>
                </div>
                <small className="field-hint">Bitte dein aktuelles Gesamtgewicht eintragen, nicht die Abnahme.</small>
              </label>
            )}

            {type === 'cigarette' && (
              <p className="field-hint">Das Datum oben ist der Rauchtag.</p>
            )}

            {type === 'team' && (
              <label>
                <span>Notiz</span>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="z.B. Fussball, Bouldern" />
              </label>
            )}

            <IconButton icon={Check} type="submit" disabled={busy}>
              {busy ? 'Speichere...' : 'Eintragen'}
            </IconButton>
            <p className={`form-message ${result?.type || ''}`}>{result?.text || ''}</p>
          </form>
        </section>

        <section className="teams-grid">
          <TeamPanel title="Team 1" team={1} data={team1} participants={participants} />
          <TeamPanel title="Team 2" team={2} data={team2} participants={participants} />
        </section>
      </div>

      <section className="content-grid">
        <RulesPanel />
        <ActivityList activities={activities} participants={participants} loading={loading} />
      </section>
    </main>
  );
}

function DurationInput({ value, onChange }) {
  const update = (key, next) => onChange({ ...value, [key]: next });
  const hours = Array.from({ length: 24 }, (_, index) => index);
  const minutes = Array.from({ length: 60 }, (_, index) => index);
  return (
    <fieldset className="duration-picker">
      <legend>Dauer</legend>
      <label>
        <span>Std</span>
        <select value={value.h} onChange={(event) => update('h', event.target.value)} aria-label="Stunden">
          {hours.map((item) => <option value={item} key={item}>{String(item).padStart(2, '0')}</option>)}
        </select>
      </label>
      <span>:</span>
      <label>
        <span>Min</span>
        <select value={value.m} onChange={(event) => update('m', event.target.value)} aria-label="Minuten">
          {minutes.map((item) => <option value={item} key={item}>{String(item).padStart(2, '0')}</option>)}
        </select>
      </label>
      <span>:</span>
      <label>
        <span>Sek</span>
        <select value={value.s} onChange={(event) => update('s', event.target.value)} aria-label="Sekunden">
          {minutes.map((item) => <option value={item} key={item}>{String(item).padStart(2, '0')}</option>)}
        </select>
      </label>
    </fieldset>
  );
}

function TeamPanel({ title, team, data, participants }) {
  return (
    <section className="panel team-panel" style={{ '--team': TEAM_COLORS[team] }}>
      <div className="panel-heading compact">
        <h2>{title}</h2>
        <strong>{data.totalPoints} Pkt</strong>
      </div>
      <div className="member-list">
        {data.members.map((member) => {
          const participant = participants.find((p) => p.name === member.name);
          return (
            <article className="member-row" key={member.name}>
              <div>
                <strong>{member.name}</strong>
                <span>
                  {participant?.currentWeight ? `${participant.currentWeight} kg · ` : ''}
                  {participant?.stats
                    ? `${Number(participant.stats.run_km).toFixed(1)} km Lauf · ${participant.stats.sport_min} min Sport · ${Number(participant.stats.bike_km).toFixed(1)} km Rad`
                    : ''}
                </span>
              </div>
              <b>{member.points}</b>
            </article>
          );
        })}
        {Number(data.teamPoints) !== 0 && (
          <article className="member-row team-points-row">
            <div>
              <strong>Team-Punkte</strong>
              <span>Bonusse und gemeinsame Teamwertungen</span>
            </div>
            <b>{data.teamPoints}</b>
          </article>
        )}
      </div>
    </section>
  );
}

function RulesPanel() {
  const rules = [
    ['Joggen < 7 min/km', '1 Pkt pro 4 km'],
    ['Sport ausser Laufen/Rad', '1 Pkt pro 30 min'],
    ['Radfahren', '1 Pkt pro 12 km'],
    ['Gemeinsam Sport im Team', '1 Pkt'],
    ['Gewicht verlieren', '2 Pkt pro 2 kg'],
    ['Wochensieger', '3 Pkt'],
    ['Rauchfrei Bonus', '+1 Pkt'],
    ['Inaktivitaet', '-1 Pkt'],
  ];
  return (
    <section className="panel">
      <div className="panel-heading compact">
        <h2>Punkte</h2>
        <Trophy size={20} />
      </div>
      <div className="rule-list">
        {rules.map(([name, points]) => (
          <div className="rule-row" key={name}>
            <span>{name}</span>
            <strong>{points}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivityList({ activities, participants, loading, admin = false, onDelete }) {
  return (
    <section className="panel">
      <div className="panel-heading compact">
        <h2>{admin ? 'Aktivitaeten' : 'Letzte Aktivitaeten'}</h2>
        <History size={20} />
      </div>
      <div className="activity-list">
        {loading && <p className="empty-state">Lade...</p>}
        {!loading && !activities.length && <p className="empty-state">Keine Aktivitaeten</p>}
        {activities.map((item) => {
          const participant = participants.find((p) => p.name === item.name);
          const team = item.display_team || item.team || participant?.team || 1;
          const Icon = activityMeta[item.type]?.icon || Medal;
          return (
            <article className="activity-row" key={item.id} style={{ '--team': TEAM_COLORS[team] }}>
              <div className="activity-icon"><Icon size={18} /></div>
              <div>
                <strong>{item.name}</strong>
                <span>{formatActivity(item)}</span>
              </div>
              <time>{item.logged_at ? item.logged_at.slice(0, 16).replace('T', ' ') : ''}</time>
              <b className={Number(item.points) < 0 ? 'negative' : ''}>{pointsLabel(item.points)}</b>
              {admin && (
                <button className="icon-only danger" type="button" onClick={() => onDelete(item.id)} aria-label="Aktivitaet loeschen">
                  <Trash2 size={17} />
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AdminApp() {
  const [tab, setTab] = useState('members');
  const [participants, setParticipants] = useState([]);
  const [activities, setActivities] = useState([]);
  const [settings, setSettings] = useState({});
  const [newMember, setNewMember] = useState({ name: '', team: '1', startWeight: '' });
  const [manual, setManual] = useState({ targetType: 'participant', participantId: '', team: '1', points: '', reason: '' });
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  function flash(text, type = 'ok') {
    setToast({ text, type });
    setTimeout(() => setToast(null), 2800);
  }

  async function loadAll() {
    setLoading(true);
    try {
      const [p, a, s] = await Promise.all([
        api('/api/admin/participants'),
        api('/api/admin/activities'),
        api('/api/admin/settings'),
      ]);
      setParticipants(p);
      setActivities(a);
      setSettings(s);
    } catch (err) {
      flash(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!getToken()) window.location.href = '/';
    loadAll();
  }, []);

  async function addParticipant(event) {
    event.preventDefault();
    if (!newMember.name.trim()) {
      flash('Name erforderlich', 'error');
      return;
    }
    try {
      await api('/api/admin/participants', {
        method: 'POST',
        body: JSON.stringify({
          name: newMember.name.trim(),
          team: Number(newMember.team),
          startWeight: newMember.startWeight ? Number(newMember.startWeight) : null,
        }),
      });
      setNewMember({ name: '', team: '1', startWeight: '' });
      flash('Teilnehmer hinzugefuegt');
      loadAll();
    } catch (err) {
      flash(err.message, 'error');
    }
  }

  async function deleteParticipant(id, name) {
    if (!window.confirm(`"${name}" und alle zugehoerigen Daten loeschen?`)) return;
    await api(`/api/admin/participants/${id}`, { method: 'DELETE' });
    flash('Teilnehmer geloescht');
    loadAll();
  }

  async function saveWeight(participant, currentWeight) {
    try {
      await api('/api/weight', {
        method: 'POST',
        body: JSON.stringify({ name: participant.name, weight: Number(currentWeight) }),
      });
      flash('Gewicht aktualisiert');
      loadAll();
    } catch (err) {
      flash(err.message, 'error');
    }
  }

  async function addManualPoints(event) {
    event.preventDefault();
    const points = Number(manual.points);
    if (!points) {
      flash('Punkte erforderlich', 'error');
      return;
    }
    if (manual.targetType === 'participant' && !manual.participantId) {
      flash('Teilnehmer erforderlich', 'error');
      return;
    }
    try {
      await api('/api/admin/points', {
        method: 'POST',
        body: JSON.stringify({
          participantId: manual.targetType === 'participant' ? Number(manual.participantId) : null,
          team: manual.targetType === 'team' ? Number(manual.team) : null,
          type: 'manual',
          value: points,
          points,
          reason: manual.reason.trim() || 'manuelle Anpassung',
        }),
      });
      setManual({ targetType: manual.targetType, participantId: '', team: manual.team, points: '', reason: '' });
      flash('Punkte eingetragen');
      loadAll();
    } catch (err) {
      flash(err.message, 'error');
    }
  }

  async function saveWeeklyCheckDay(value) {
    setSettings({ ...settings, weekly_check_day: value });
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ key: 'weekly_check_day', value }),
      });
      flash('Einstellung gespeichert');
    } catch (err) {
      flash(err.message, 'error');
    }
  }

  async function weeklyEvaluation() {
    try {
      const result = await api('/api/admin/weekly-evaluation', { method: 'POST' });
      flash(result.message || 'Auswertung abgeschlossen');
      loadAll();
    } catch (err) {
      flash(err.message, 'error');
    }
  }

  async function deleteActivity(id) {
    if (!window.confirm('Diese Aktivitaet loeschen?')) return;
    await api(`/api/admin/activities/${id}`, { method: 'DELETE' });
    flash('Aktivitaet geloescht');
    loadAll();
  }

  async function resetActivities() {
    if (!window.confirm('Alle Aktivitaeten loeschen? Teilnehmer und Gewichte bleiben erhalten.')) return;
    if (!window.confirm('Wirklich sicher?')) return;
    await api('/api/admin/reset', { method: 'POST' });
    flash('Alle Aktivitaeten geloescht');
    loadAll();
  }

  const tabs = [
    ['members', Users, 'Teilnehmer'],
    ['weights', Scale, 'Gewichte'],
    ['points', Medal, 'Punkte'],
    ['settings', Settings, 'Settings'],
    ['history', History, 'Historie'],
  ];

  return (
    <main className="app-shell admin-shell">
      <Toast message={toast} />
      <header className="topbar">
        <div>
          <p className="eyebrow">Laufchallenge 2026</p>
          <h1>Admin</h1>
        </div>
        <div className="topbar-actions">
          <IconButton icon={ChevronLeft} variant="secondary" onClick={() => { window.location.href = dashboardUrl(); }}>
            Dashboard
          </IconButton>
          <IconButton icon={RefreshCw} variant="secondary" onClick={loadAll}>
            Aktualisieren
          </IconButton>
        </div>
      </header>

      <nav className="tabbar">
        {tabs.map(([key, Icon, label]) => (
          <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {tab === 'members' && (
        <section className="admin-grid">
          <form className="panel form-stack" onSubmit={addParticipant}>
            <div className="panel-heading compact"><h2>Neu</h2><Plus size={20} /></div>
            <label><span>Name</span><input value={newMember.name} onChange={(event) => setNewMember({ ...newMember, name: event.target.value })} /></label>
            <label><span>Team</span><select value={newMember.team} onChange={(event) => setNewMember({ ...newMember, team: event.target.value })}><option value="1">Team 1</option><option value="2">Team 2</option></select></label>
            <label><span>Startgewicht</span><input type="number" step="0.1" value={newMember.startWeight} onChange={(event) => setNewMember({ ...newMember, startWeight: event.target.value })} /></label>
            <IconButton icon={Plus} type="submit">Hinzufuegen</IconButton>
          </form>
          <section className="panel">
            <div className="panel-heading compact"><h2>Teilnehmer</h2><Users size={20} /></div>
            <div className="admin-list">
              {participants.map((p) => (
                <article className="admin-row" key={p.id} style={{ '--team': TEAM_COLORS[p.team] }}>
                  <div><strong>{p.name}</strong><span>Team {p.team} · {p.totalPoints} Pkt</span></div>
                  <button className="icon-only danger" type="button" onClick={() => deleteParticipant(p.id, p.name)} aria-label="Teilnehmer loeschen"><Trash2 size={17} /></button>
                </article>
              ))}
            </div>
          </section>
        </section>
      )}

      {tab === 'weights' && (
        <section className="panel">
          <div className="panel-heading compact"><h2>Gewichte</h2><Scale size={20} /></div>
          <div className="admin-list">
            {participants.map((p) => <WeightRow participant={p} onSave={saveWeight} key={p.id} />)}
          </div>
        </section>
      )}

      {tab === 'points' && (
        <form className="panel form-stack narrow" onSubmit={addManualPoints}>
          <div className="panel-heading compact"><h2>Manuelle Punkte</h2><Medal size={20} /></div>
          <label>
            <span>Ziel</span>
            <select value={manual.targetType} onChange={(event) => setManual({ ...manual, targetType: event.target.value })}>
              <option value="participant">Teilnehmer</option>
              <option value="team">Team</option>
            </select>
          </label>
          {manual.targetType === 'participant' ? (
            <label><span>Teilnehmer</span><select value={manual.participantId} onChange={(event) => setManual({ ...manual, participantId: event.target.value })}><option value="">Waehlen</option>{participants.map((p) => <option value={p.id} key={p.id}>{p.name} · Team {p.team}</option>)}</select></label>
          ) : (
            <label><span>Team</span><select value={manual.team} onChange={(event) => setManual({ ...manual, team: event.target.value })}><option value="1">Team 1</option><option value="2">Team 2</option></select></label>
          )}
          <label><span>Punkte</span><input type="number" step="1" value={manual.points} onChange={(event) => setManual({ ...manual, points: event.target.value })} /></label>
          <label><span>Grund</span><input value={manual.reason} onChange={(event) => setManual({ ...manual, reason: event.target.value })} /></label>
          <IconButton icon={Save} type="submit">Eintragen</IconButton>
        </form>
      )}

      {tab === 'settings' && (
        <section className="admin-grid">
          <section className="panel form-stack">
            <div className="panel-heading compact"><h2>Wochencheck</h2><CalendarDays size={20} /></div>
            <label>
              <span>Wochentag</span>
              <select value={settings.weekly_check_day || 'Sunday'} onChange={(event) => saveWeeklyCheckDay(event.target.value)}>
                <option value="Monday">Montag</option>
                <option value="Tuesday">Dienstag</option>
                <option value="Wednesday">Mittwoch</option>
                <option value="Thursday">Donnerstag</option>
                <option value="Friday">Freitag</option>
                <option value="Saturday">Samstag</option>
                <option value="Sunday">Sonntag</option>
              </select>
            </label>
            <IconButton icon={Trophy} onClick={weeklyEvaluation}>Auswertung starten</IconButton>
          </section>
          <section className="panel form-stack danger-zone">
            <div className="panel-heading compact"><h2>Gefahrenzone</h2><Trash2 size={20} /></div>
            <p>Alle Aktivitaeten werden entfernt. Teilnehmer und Gewichte bleiben erhalten.</p>
            <IconButton icon={Trash2} variant="danger" onClick={resetActivities}>Aktivitaeten loeschen</IconButton>
          </section>
        </section>
      )}

      {tab === 'history' && (
        <ActivityList activities={activities} participants={participants} loading={loading} admin onDelete={deleteActivity} />
      )}
    </main>
  );
}

function WeightRow({ participant, onSave }) {
  const [value, setValue] = useState(participant.currentWeight || '');
  useEffect(() => setValue(participant.currentWeight || ''), [participant.currentWeight]);
  return (
    <article className="admin-row weight-row" style={{ '--team': TEAM_COLORS[participant.team] }}>
      <div>
        <strong>{participant.name}</strong>
        <span>Start: {participant.startWeight || '-'} kg</span>
      </div>
      <div className="unit-input compact">
        <input type="number" step="0.1" value={value} onChange={(event) => setValue(event.target.value)} />
        <b>kg</b>
      </div>
      <button className="icon-only" type="button" onClick={() => onSave(participant, value)} aria-label="Gewicht speichern">
        <Save size={17} />
      </button>
    </article>
  );
}

const page = document.body.dataset.page;
const root = createRoot(document.getElementById('root'));

if (page === 'login') root.render(<LoginApp />);
else if (page === 'admin') root.render(<AdminApp />);
else root.render(<DashboardApp />);
