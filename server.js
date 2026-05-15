const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');
const {
  parsePace,
  calcRunPoints,
  calcSportPoints,
  calcBikePoints,
  calcWeightPoints,
} = require('./scoring');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || null;
const DATA_DIR = path.join(__dirname, 'data');
const APP_PASSWORD = process.env.APP_PASSWORD;
const CONFIG_FILE = process.env.CHALLENGE_CONFIG || path.join(DATA_DIR, 'challenge.local.json');

if (!APP_PASSWORD) {
  console.error('APP_PASSWORD muss als Umgebungsvariable gesetzt sein.');
  process.exit(1);
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadChallengeConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.warn(`Keine private Challenge-Konfiguration gefunden: ${CONFIG_FILE}`);
    return { participants: [], smokingBonus: null };
  }

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return {
      participants: Array.isArray(config.participants) ? config.participants : [],
      smokingBonus: config.smokingBonus || null,
    };
  } catch (error) {
    console.error(`Private Challenge-Konfiguration ist ungueltig: ${error.message}`);
    process.exit(1);
  }
}

const challengeConfig = loadChallengeConfig();
const db = new Database(path.join(DATA_DIR, 'laufchallenge.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
    team INTEGER NOT NULL, start_weight REAL, current_weight REAL
  );
  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT, participant_id INTEGER, team INTEGER,
    type TEXT NOT NULL, value REAL, pace REAL, points INTEGER DEFAULT 0,
    logged_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (participant_id) REFERENCES participants(id)
  );
  CREATE TABLE IF NOT EXISTS weight_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, participant_id INTEGER NOT NULL,
    weight REAL NOT NULL, logged_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (participant_id) REFERENCES participants(id)
  );
  CREATE TABLE IF NOT EXISTS bot_users (
    telegram_id INTEGER PRIMARY KEY, first_name TEXT, participant_id INTEGER,
    FOREIGN KEY (participant_id) REFERENCES participants(id)
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  PRAGMA foreign_keys = ON;
  CREATE INDEX IF NOT EXISTS idx_activities_participant ON activities(participant_id);
  CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);
  CREATE INDEX IF NOT EXISTS idx_activities_logged ON activities(logged_at);
  CREATE INDEX IF NOT EXISTS idx_weight_log_participant ON weight_log(participant_id);
`);

function migrateActivitiesSchema() {
  const columns = db.prepare('PRAGMA table_info(activities)').all();
  const hasTeam = columns.some(c => c.name === 'team');
  const participantColumn = columns.find(c => c.name === 'participant_id');
  const participantIsNullable = participantColumn && participantColumn.notnull === 0;
  if (hasTeam && participantIsNullable) return;

  const teamExpr = hasTeam
    ? "COALESCE(a.team, CASE WHEN a.type = 'team_sport' THEN p.team ELSE NULL END)"
    : "CASE WHEN a.type = 'team_sport' THEN p.team ELSE NULL END";
  const participantExpr = hasTeam
    ? "CASE WHEN a.team IS NOT NULL OR a.type = 'team_sport' THEN NULL ELSE a.participant_id END"
    : "CASE WHEN a.type = 'team_sport' THEN NULL ELSE a.participant_id END";

  db.exec('PRAGMA foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      DROP TABLE IF EXISTS activities_new;
      CREATE TABLE activities_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        participant_id INTEGER,
        team INTEGER,
        type TEXT NOT NULL,
        value REAL,
        pace REAL,
        points INTEGER DEFAULT 0,
        logged_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (participant_id) REFERENCES participants(id)
      );
    `);
    db.prepare(`
      INSERT INTO activities_new (id, participant_id, team, type, value, pace, points, logged_at)
      SELECT a.id, ${participantExpr}, ${teamExpr}, a.type, a.value, a.pace, a.points, a.logged_at
      FROM activities a
      LEFT JOIN participants p ON p.id = a.participant_id
    `).run();
    db.exec(`
      DROP TABLE activities;
      ALTER TABLE activities_new RENAME TO activities;
      CREATE INDEX IF NOT EXISTS idx_activities_participant ON activities(participant_id);
      CREATE INDEX IF NOT EXISTS idx_activities_team ON activities(team);
      CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);
      CREATE INDEX IF NOT EXISTS idx_activities_logged ON activities(logged_at);
    `);
  })();
  db.exec('PRAGMA foreign_keys = ON');
}

migrateActivitiesSchema();
db.exec('CREATE INDEX IF NOT EXISTS idx_activities_team ON activities(team)');
// Default: Sunday
db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('weekly_check_day', 'Sunday');

const ins = db.prepare(`INSERT OR IGNORE INTO participants (name, team, start_weight, current_weight) VALUES (?, ?, ?, ?)`);
db.transaction(() => {
  for (const p of challengeConfig.participants) {
    const startWeight = p.startWeight ?? p.weight ?? null;
    ins.run(p.name, p.team, startWeight, p.currentWeight ?? startWeight);
  }
})();

// ─── Express ───────────────────────────────────────────────────
const app = express();
app.use(express.json());

function isAuth(req) {
  return (req.headers['x-access-token'] || req.query.access) === APP_PASSWORD;
}

function normalizeActivityDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : null;
}

function loggedAtForDate(date) {
  const cleanDate = normalizeActivityDate(date);
  return cleanDate ? `${cleanDate} 12:00:00` : null;
}

// Auth middleware: protect API and main page, allow static assets
app.use((req, res, next) => {
  const origPath = req.originalUrl.split('?')[0];
  if (origPath === '/api/auth' && req.method === 'POST') return next();
  if (origPath === '/api/health' && req.method === 'GET') return next();
  if (origPath.startsWith('/api/')) {
    if (!isAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    return next();
  }
  if (origPath === '/' || origPath === '/index.html' || origPath === '/admin.html') {
    if (isAuth(req)) return next(); // serve the app/admin
    return res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
  // Static assets (CSS, JS, etc.) allowed freely
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth API ──────────────────────────────────────────────────
app.post('/api/auth', (req, res) => {
  if (req.body.password === APP_PASSWORD) return res.json({ success: true, token: APP_PASSWORD });
  res.status(401).json({ success: false });
});

app.get('/api/auth-check', (req, res) => {
  if (isAuth(req)) return res.json({ valid: true });
  res.status(401).json({ valid: false });
});

// ─── API ───────────────────────────────────────────────────────
app.get('/api/participants', (req, res) => {
  const participants = db.prepare(`
    SELECT p.*, COALESCE(SUM(a.points), 0) as total_points
    FROM participants p LEFT JOIN activities a ON a.participant_id = p.id
    GROUP BY p.id ORDER BY p.team, p.name
  `).all();

  const stats = db.prepare(`
    SELECT participant_id,
      COALESCE(SUM(CASE WHEN type = 'run' THEN COALESCE(value, 0) ELSE 0 END), 0) as total_run_km,
      COALESCE(SUM(CASE WHEN type = 'sport' THEN COALESCE(value, 0) ELSE 0 END), 0) as total_sport_min,
      COALESCE(SUM(CASE WHEN type = 'bike' THEN COALESCE(value, 0) ELSE 0 END), 0) as total_bike_km,
      COALESCE(SUM(CASE WHEN type = 'team_sport' THEN 1 ELSE 0 END), 0) as total_team_sport
    FROM activities
    GROUP BY participant_id
  `).all();
  const statsMap = {};
  for (const s of stats) statsMap[s.participant_id] = s;

  const wMap = {};
  db.prepare(`SELECT DISTINCT participant_id, weight FROM weight_log
    WHERE (participant_id, logged_at) IN (SELECT participant_id, MAX(logged_at) FROM weight_log GROUP BY participant_id)`)
    .all().forEach(w => wMap[w.participant_id] = w.weight);

  const result = participants.map(p => {
    const s = statsMap[p.id] || {};
    return {
      id: p.id, name: p.name, team: p.team, startWeight: p.start_weight,
      currentWeight: wMap[p.id] || p.current_weight, totalPoints: p.total_points,
      stats: {
        run_km: s.total_run_km || 0,
        sport_min: s.total_sport_min || 0,
        bike_km: s.total_bike_km || 0,
        team_sport: s.total_team_sport || 0
      }
    };
  });
  res.json(result);
});

app.get('/api/standings', (req, res) => {
  const rows = db.prepare(`SELECT p.team, p.name, COALESCE(SUM(a.points), 0) as tp
    FROM participants p LEFT JOIN activities a ON a.participant_id = p.id
    GROUP BY p.id ORDER BY p.team, tp DESC`).all();
  const teamRows = db.prepare(`
    SELECT team, COALESCE(SUM(points), 0) as tp
    FROM activities
    WHERE team IS NOT NULL
    GROUP BY team
  `).all();
  const t1 = { team: 1, members: [], memberPoints: 0, teamPoints: 0, totalPoints: 0 };
  const t2 = { team: 2, members: [], memberPoints: 0, teamPoints: 0, totalPoints: 0 };
  for (const r of rows) {
    const target = r.team === 1 ? t1 : t2;
    target.members.push({ name: r.name, points: r.tp });
    target.memberPoints += r.tp;
  }
  for (const r of teamRows) {
    if (r.team === 1) t1.teamPoints = r.tp;
    if (r.team === 2) t2.teamPoints = r.tp;
  }
  t1.totalPoints = t1.memberPoints + t1.teamPoints;
  t2.totalPoints = t2.memberPoints + t2.teamPoints;
  res.json({ team1: t1, team2: t2 });
});

function logActivity(name, type, value, pace, points, date, res, msg) {
  const p = db.prepare('SELECT id FROM participants WHERE LOWER(name)=?').get(name.toLowerCase());
  if (!p) return res.status(404).json({ error: 'Teilnehmer nicht gefunden' });
  const loggedAt = loggedAtForDate(date);
  if (loggedAt) {
    db.prepare('INSERT INTO activities (participant_id,type,value,pace,points,logged_at) VALUES (?,?,?,?,?,?)')
      .run(p.id, type, value, pace, points, loggedAt);
  } else {
    db.prepare('INSERT INTO activities (participant_id,type,value,pace,points) VALUES (?,?,?,?,?)')
      .run(p.id, type, value, pace, points);
  }
  res.json({ success: true, points, message: msg });
}

app.post('/api/activity/run', (req, res) => {
  const { name, pace, date } = req.body;
  const km = Number(req.body.km);
  if (!name || !km || km <= 0 || km > 1000) return res.status(400).json({ error: 'name und gültige km erforderlich' });
  const parsedPace = parsePace(pace);
  const pts = calcRunPoints(km, parsedPace);
  logActivity(name, 'run', km, parsedPace, pts, date, res, `${km}km gelaufen${parsedPace ? ' (' + pace + ')' : ''} ${pts > 0 ? '→ ' + pts + ' Pkt' : '(Pace zu langsam oder <4km)'}`);
});

app.post('/api/activity/sport', (req, res) => {
  const { name, notes, date } = req.body;
  const minutes = Number(req.body.minutes);
  if (!name || !minutes || minutes <= 0 || minutes > 1440) return res.status(400).json({ error: 'name und gültige minutes erforderlich' });
  const p = db.prepare('SELECT id FROM participants WHERE LOWER(name)=?').get(name.toLowerCase());
  if (!p) return res.status(404).json({ error: 'Teilnehmer nicht gefunden' });
  const pts = calcSportPoints(minutes);
  const cleanNotes = String(notes || '').trim() || null;
  const loggedAt = loggedAtForDate(date);
  if (loggedAt) {
    db.prepare('INSERT INTO activities (participant_id,type,value,pace,points,logged_at) VALUES (?,?,?,?,?,?)')
      .run(p.id, 'sport', minutes, cleanNotes, pts, loggedAt);
  } else {
    db.prepare('INSERT INTO activities (participant_id,type,value,pace,points) VALUES (?,?,?,?,?)')
      .run(p.id, 'sport', minutes, cleanNotes, pts);
  }
  res.json({ success: true, points: pts, message: `${minutes}min ${cleanNotes || 'Sport'} → ${pts} Pkt` });
});

app.post('/api/activity/bike', (req, res) => {
  const { name, date } = req.body;
  const km = Number(req.body.km);
  if (!name || !km || km <= 0 || km > 1000) return res.status(400).json({ error: 'name und gültige km erforderlich' });
  logActivity(name, 'bike', km, null, calcBikePoints(km), date, res, `${km}km Rad → ${calcBikePoints(km)} Pkt`);
});

app.post('/api/activity/cigarette', (req, res) => {
  const { name, date } = req.body;
  if (!name || !date) return res.status(400).json({ error: 'name und date erforderlich' });
  const p = db.prepare('SELECT * FROM participants WHERE LOWER(name)=?').get(name.toLowerCase());
  if (!p) return res.status(404).json({ error: 'Teilnehmer nicht gefunden' });

  // Nur tracken, KEINE sofortigen Punkte
  const loggedAt = loggedAtForDate(date);
  if (loggedAt) {
    db.prepare('INSERT INTO activities (participant_id, type, value, points, pace, logged_at) VALUES (?,?,?,?,?,?)')
      .run(p.id, 'cigarette', 1, 0, date, loggedAt);
  } else {
    db.prepare('INSERT INTO activities (participant_id, type, value, points, pace) VALUES (?,?,?,?,?)')
      .run(p.id, 'cigarette', 1, 0, date);
  }

  res.json({ success: true, message: `${name}: 🚬 erfasst am ${date}` });
});

app.post('/api/activity/team', (req, res) => {
  const { name, notes, date } = req.body;
  if (!name) return res.status(400).json({ error: 'name erforderlich' });

  let teamNumber;
  if (name === '__team1__') {
    teamNumber = 1;
  } else if (name === '__team2__') {
    teamNumber = 2;
  } else {
    const p = db.prepare('SELECT id, name, team FROM participants WHERE LOWER(name) = ?').get(name.toLowerCase());
    if (!p) return res.status(404).json({ error: 'Teilnehmer nicht gefunden' });
    teamNumber = p.team;
  }

  const teamLabel = `Team ${teamNumber}`;
  const noteStr = notes ? ` (${notes})` : '';
  const loggedAt = loggedAtForDate(date);
  if (loggedAt) {
    db.prepare('INSERT INTO activities (participant_id, team, type, value, points, pace, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(null, teamNumber, 'team_sport', 1, 1, notes || 'Team Sport', loggedAt);
  } else {
    db.prepare('INSERT INTO activities (participant_id, team, type, value, points, pace) VALUES (?, ?, ?, ?, ?, ?)')
      .run(null, teamNumber, 'team_sport', 1, 1, notes || 'Team Sport');
  }

  res.json({ success: true, points: 1, message: `${teamLabel}: Team Sport${noteStr} → 1 Pkt` });
});

app.post('/api/weight', (req, res) => {
  const { name, date } = req.body;
  const weight = Number(req.body.weight);
  if (!name || !weight || weight <= 20 || weight > 500) return res.status(400).json({ error: 'name und gültiges weight erforderlich' });
  const p = db.prepare('SELECT * FROM participants WHERE LOWER(name)=?').get(name.toLowerCase());
  if (!p) return res.status(404).json({ error: 'Teilnehmer nicht gefunden' });
  const loggedAt = loggedAtForDate(date);
  if (loggedAt) db.prepare('INSERT INTO weight_log (participant_id,weight,logged_at) VALUES (?,?,?)').run(p.id, weight, loggedAt);
  else db.prepare('INSERT INTO weight_log (participant_id,weight) VALUES (?,?)').run(p.id, weight);
  const sw = p.start_weight || p.current_weight || weight;
  const { loss, points: pts } = calcWeightPoints(sw, weight);
  if (pts > 0) {
    if (loggedAt) {
      db.prepare('INSERT INTO activities (participant_id,type,value,points,logged_at) VALUES (?,?,?,?,?)')
        .run(p.id, 'weight_loss', loss, pts, loggedAt);
    } else {
      db.prepare('INSERT INTO activities (participant_id,type,value,points) VALUES (?,?,?,?)')
        .run(p.id, 'weight_loss', loss, pts);
    }
  }
  db.prepare('UPDATE participants SET current_weight=? WHERE id=?').run(weight, p.id);
  res.json({ success: true, points: pts, message: `Gewicht: ${weight}kg (${loss > 0 ? '-' : '+'}${Math.abs(loss)}kg → ${pts} Pkt)` });
});

app.get('/api/activities', (req, res) => {
  res.json(db.prepare(`
    SELECT a.*, COALESCE(p.name, 'Team ' || a.team) as name, COALESCE(p.team, a.team) as display_team
    FROM activities a
    LEFT JOIN participants p ON p.id = a.participant_id
    ORDER BY a.logged_at DESC LIMIT 50
  `).all());
});

// ─── Admin API ─────────────────────────────────────────────────
app.get('/api/admin/participants', (req, res) => {
  const participants = db.prepare(`
    SELECT p.*, COALESCE(SUM(a.points), 0) as total_points
    FROM participants p LEFT JOIN activities a ON a.participant_id = p.id
    GROUP BY p.id ORDER BY p.team, p.name
  `).all();
  const wMap = {};
  db.prepare(`SELECT DISTINCT participant_id, weight FROM weight_log
    WHERE (participant_id, logged_at) IN (SELECT participant_id, MAX(logged_at) FROM weight_log GROUP BY participant_id)`)
    .all().forEach(w => wMap[w.participant_id] = w.weight);
  res.json(participants.map(p => ({
    id: p.id, name: p.name, team: p.team,
    startWeight: p.start_weight, currentWeight: wMap[p.id] || p.current_weight,
    totalPoints: p.total_points
  })));
});

app.post('/api/admin/participants', (req, res) => {
  const { name, team, startWeight } = req.body;
  if (!name || team == null) return res.status(400).json({ error: 'name und team erforderlich' });
  try {
    db.prepare('INSERT INTO participants (name, team, start_weight, current_weight) VALUES (?, ?, ?, ?)')
      .run(name, team, startWeight || null, startWeight || null);
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Teilnehmer existiert bereits' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/participants/:id', (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM activities WHERE participant_id=?').run(id);
  db.prepare('DELETE FROM weight_log WHERE participant_id=?').run(id);
  db.prepare('DELETE FROM bot_users WHERE participant_id=?').run(id);
  db.prepare('DELETE FROM participants WHERE id=?').run(id);
  res.json({ success: true });
});

app.put('/api/admin/participants/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { name, team, startWeight, currentWeight } = req.body;
  try {
    db.prepare('UPDATE participants SET name=?, team=?, start_weight=?, current_weight=? WHERE id=?')
      .run(name, team, startWeight, currentWeight, id);
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Name existiert bereits' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/activities/:id', (req, res) => {
  db.prepare('DELETE FROM activities WHERE id=?').run(parseInt(req.params.id));
  res.json({ success: true });
});

app.post('/api/admin/points', (req, res) => {
  const { participantId, team, type, value, points, reason } = req.body;
  const teamNumber = team == null ? null : Number(team);
  if (!participantId && !teamNumber) return res.status(400).json({ error: 'participantId oder team erforderlich' });
  if (points == null) return res.status(400).json({ error: 'points erforderlich' });
  if (teamNumber) {
    db.prepare('INSERT INTO activities (participant_id, team, type, value, points, pace) VALUES (?,?,?,?,?,?)')
      .run(null, teamNumber, type || 'manual', value || 0, points, reason || null);
  } else {
    db.prepare('INSERT INTO activities (participant_id, team, type, value, points, pace) VALUES (?,?,?,?,?,?)')
      .run(participantId, null, type || 'manual', value || 0, points, reason || null);
  }
  res.json({ success: true });
});

app.post('/api/admin/reset', (req, res) => {
  db.prepare('DELETE FROM activities').run();
  res.json({ success: true });
});

app.get('/api/admin/activities', (req, res) => {
  res.json(db.prepare(`
    SELECT a.*, COALESCE(p.name, 'Team ' || a.team) as name, COALESCE(p.team, a.team) as display_team
    FROM activities a
    LEFT JOIN participants p ON p.id = a.participant_id
    ORDER BY a.logged_at DESC
  `).all());
});

app.get('/api/admin/settings', (req, res) => {
  const settings = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  for (const s of settings) result[s.key] = s.value;
  res.json(result);
});

app.put('/api/admin/settings', (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key erforderlich' });
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  res.json({ success: true });
});

app.post('/api/admin/weekly-evaluation', (req, res) => {
  const weeklyDay = (db.prepare("SELECT value FROM settings WHERE key='weekly_check_day'").get() || {}).value || 'Sunday';

  // Calculate week start
  const now = new Date();
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const targetDay = dayNames.indexOf(weeklyDay);
  const currentDay = now.getDay();
  let daysBack = (currentDay - targetDay + 7) % 7;
  if (daysBack === 0) daysBack = 7;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - daysBack);
  const weekStartStr = weekStart.toISOString().slice(0,10);

  const participants = db.prepare('SELECT id, name, team FROM participants').all();
  let results = [];

  for (const p of participants) {
    const count = db.prepare(
      "SELECT COUNT(*) as cnt FROM activities WHERE participant_id=? AND type='cigarette' AND pace >= ?"
    ).get(p.id, weekStartStr);

    const bonus = challengeConfig.smokingBonus;
    if (bonus && p.name.toLowerCase() === String(bonus.participant || '').toLowerCase()) {
      if (count.cnt === 0) {
        const bonusTeam = Number(bonus.team);
        const bonusLabel = bonus.label || 'Rauchfrei Bonus';
        db.prepare("INSERT INTO activities (participant_id,team,type,value,points,pace) VALUES (?,?,?,?,?,?)")
          .run(null, bonusTeam, 'team_sport', 1, 1, bonusLabel);
        results.push(`Bonus rauchfrei → Team ${bonusTeam} +1 Pkt`);
      } else {
        results.push(`${p.name} hat ${count.cnt}x geraucht`);
      }
    } else if (count.cnt > 0) {
      // Geraucht → gegnerisches Team kriegt Punkt
      const opposing = p.team === 1 ? 2 : 1;
      db.prepare("INSERT INTO activities (participant_id,team,type,value,points,pace) VALUES (?,?,?,?,?,?)")
        .run(null, opposing, 'team_sport', 1, count.cnt, `${p.name} hat geraucht → Team ${opposing}`);
      results.push(`🚬 ${p.name} (${count.cnt}x) → +${count.cnt} für Team ${opposing}`);
    } else {
      results.push(`✅ ${p.name}: rauchfrei`);
    }
  }

  res.json({ success: true, message: results.join('\n') });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ─── Telegram Bot ──────────────────────────────────────────────
let bot = null;

function startBot(token) {
  const TelegramBot = require('node-telegram-bot-api');
  bot = new TelegramBot(token, { polling: true });

  function getPart(msg) {
    const bu = db.prepare('SELECT participant_id FROM bot_users WHERE telegram_id=?').get(msg.from.id);
    if (!bu) { bot.sendMessage(msg.chat.id, 'Sag mir erst deinen Namen.'); return null; }
    return db.prepare('SELECT * FROM participants WHERE id=?').get(bu.participant_id);
  }

  bot.onText(/\/start|\/hilfe/, (msg) => {
    const names = db.prepare('SELECT name FROM participants').all().map(p => p.name).join(', ');
    bot.sendMessage(msg.chat.id,
      `🏃 *Laufchallenge 2026 Bot*\n\nTeilnehmer: ${names}\n\n` +
      `*/laufen \\<km\\> \\<pace\\>* – Joggen (zB /laufen 5 6:20)\n` +
      `*/sport \\<min\\>* – Anderer Sport (zB /sport 45)\n` +
      `*/rad \\<km\\>* – Radfahren (zB /rad 20)\n` +
      `*/team* – Gemeinsam Sport im Team\n` +
      `*/gewicht \\<kg\\>* – Neues Gewicht (zB /gewicht 108)\n` +
      `*/standings* – Punktestand\n` +
      `*/aktivitaeten* – Letzte Aktivitäten\n\n` +
      `Oder schreib deinen Namen, um dich zu registrieren.`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/\/laufen\s+([\d,.]+)\s*([\d:,.]+)?/, (msg, m) => {
    const p = getPart(msg); if (!p) return;
    const km = parseFloat(m[1].replace(',','.'));
    const ps = m[2] ? m[2].replace(',','.') : null;
    let pace = null;
    if (ps) { const [mn, s] = ps.split(':'); pace = parseFloat(mn) + parseFloat(s||'0')/60; }
    const pts = calcRunPoints(km, pace);
    db.prepare('INSERT INTO activities (participant_id,type,value,pace,points) VALUES (?,?,?,?,?)').run(p.id, 'run', km, pace, pts);
    bot.sendMessage(msg.chat.id, `✅ ${p.name}: ${km}km${ps ? ' ('+ps+')' : ''} → ${pts} Pkt 🏃`);
  });

  bot.onText(/\/sport\s+([\d,.]+)/, (msg, m) => {
    const p = getPart(msg); if (!p) return;
    const min = parseFloat(m[1].replace(',','.')); const pts = calcSportPoints(min);
    db.prepare('INSERT INTO activities (participant_id,type,value,points) VALUES (?,?,?,?)').run(p.id, 'sport', min, pts);
    bot.sendMessage(msg.chat.id, `✅ ${p.name}: ${min}min → ${pts} Pkt 💪`);
  });

  bot.onText(/\/rad\s+([\d,.]+)/, (msg, m) => {
    const p = getPart(msg); if (!p) return;
    const km = parseFloat(m[1].replace(',','.')); const pts = calcBikePoints(km);
    db.prepare('INSERT INTO activities (participant_id,type,value,points) VALUES (?,?,?,?)').run(p.id, 'bike', km, pts);
    bot.sendMessage(msg.chat.id, `✅ ${p.name}: ${km}km → ${pts} Pkt 🚴`);
  });

  bot.onText(/\/team/, (msg) => {
    const p = getPart(msg); if (!p) return;
    db.prepare('INSERT INTO activities (participant_id,team,type,value,points,pace) VALUES (?,?,?,?,?,?)').run(null, p.team, 'team_sport', 1, 1, 'Telegram Team Sport');
    bot.sendMessage(msg.chat.id, `✅ Team ${p.team}: Team Sport (+1) 👥`);
  });

  bot.onText(/\/gewicht\s+([\d,.]+)/, (msg, m) => {
    const p = getPart(msg); if (!p) return;
    const w = parseFloat(m[1].replace(',','.'));
    db.prepare('INSERT INTO weight_log (participant_id,weight) VALUES (?,?)').run(p.id, w);
    const sw = p.current_weight || p.start_weight || w;
    const { loss, points: pts } = calcWeightPoints(sw, w);
    if (pts > 0) {
      db.prepare('INSERT INTO activities (participant_id,type,value,points) VALUES (?,?,?,?)')
        .run(p.id, 'weight_loss', loss, pts);
    }
    db.prepare('UPDATE participants SET current_weight=? WHERE id=?').run(w, p.id);
    const trend = loss > 0 ? `⬇️ ${Math.abs(loss)}kg` : loss < 0 ? `⬆️ ${Math.abs(loss)}kg` : '➡️ gleich';
    bot.sendMessage(msg.chat.id, `✅ ${p.name}: ${w}kg (${trend}) → ${pts} Pkt ⚖️`);
  });

  bot.onText(/\/standings/, (msg) => {
    const rows = db.prepare(`SELECT p.team,p.name,COALESCE(SUM(a.points),0) as tp FROM participants p LEFT JOIN activities a ON a.participant_id=p.id GROUP BY p.id ORDER BY p.team,tp DESC`).all();
    const teamRows = db.prepare(`SELECT team, COALESCE(SUM(points),0) as tp FROM activities WHERE team IS NOT NULL GROUP BY team`).all();
    let t1=0,t2=0,team1=0,team2=0,s1='',s2='';
    for (const r of rows) { if (r.team===1) { t1+=r.tp; s1+=`  ${r.name}: ${r.tp}\n`; } else { t2+=r.tp; s2+=`  ${r.name}: ${r.tp}\n`; } }
    for (const r of teamRows) { if (r.team===1) team1=r.tp; else if (r.team===2) team2=r.tp; }
    t1 += team1; t2 += team2;
    if (team1) s1 += `  Team-Punkte: ${team1}\n`;
    if (team2) s2 += `  Team-Punkte: ${team2}\n`;
    bot.sendMessage(msg.chat.id, `🏆 *Aktueller Stand*\n\n*Team 1:* ${t1}\n${s1}\n*Team 2:* ${t2}\n${s2}\n${t1>t2?'🏆 Team 1!':t2>t1?'🏆 Team 2!':'🤝 Gleichstand!'}`, { parse_mode:'Markdown' });
  });

  bot.onText(/\/aktivitaeten/, (msg) => {
    const acts = db.prepare(`
      SELECT a.*, COALESCE(p.name, 'Team ' || a.team) as name
      FROM activities a
      LEFT JOIN participants p ON p.id = a.participant_id
      ORDER BY a.logged_at DESC LIMIT 10
    `).all();
    if (!acts.length) return bot.sendMessage(msg.chat.id, '📭 Noch keine Aktivitäten.');
    const e = { run:'🏃', sport:'💪', bike:'🚴', team_sport:'👥', weight_loss:'⚖️' };
    bot.sendMessage(msg.chat.id, '*Letzte Aktivitäten:*\n' + acts.map(a => `\n${e[a.type]||'📝'} ${a.name}: ${a.type} (${a.points} Pkt)`).join(''), { parse_mode:'Markdown' });
  });

  bot.on('message', (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const p = db.prepare('SELECT id FROM participants WHERE LOWER(name)=?').get(msg.text.trim().toLowerCase());
    if (p) {
      db.prepare('INSERT OR REPLACE INTO bot_users (telegram_id,first_name,participant_id) VALUES (?,?,?)').run(msg.from.id, msg.text.trim(), p.id);
      bot.sendMessage(msg.chat.id, `✅ Du bist als *${msg.text.trim()}* registriert!\nJetzt: /laufen, /sport, /rad, /gewicht, /standings`, { parse_mode:'Markdown' });
    }
  });

  console.log('🤖 Telegram Bot läuft');
}

// ─── Start ─────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Web-App: http://0.0.0.0:${PORT}`);
  console.log(`🔑 Passwort: ${APP_PASSWORD}`);
  if (BOT_TOKEN) startBot(BOT_TOKEN);
  else console.log('🤖 Kein Bot-Token');
});

process.on('SIGINT', () => { if (bot) bot.stopPolling(); db.close(); process.exit(0); });
