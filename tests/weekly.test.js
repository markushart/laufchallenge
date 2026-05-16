/**
 * Weekly Evaluation Test Suite
 * Tests all weekly rules: smoking penalty, Alex/Wonchi bonus, inactivity penalty, and weekly winner.
 * Replicates the exact logic from server.js's /api/admin/weekly-evaluation endpoint.
 */

const Database = require('better-sqlite3');
const fs = require('fs');

const TEST_DB = '/tmp/test-weekly-laufchallenge.db';
function cleanup() {
  for (const f of [TEST_DB, TEST_DB+'-shm', TEST_DB+'-wal']) { try { fs.unlinkSync(f); } catch(e) {} }
}

function setupDB(config) {
  cleanup();
  const db = new Database(TEST_DB);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS participants (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, team INTEGER NOT NULL, start_weight REAL, current_weight REAL);
    CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY AUTOINCREMENT, participant_id INTEGER, team INTEGER, type TEXT NOT NULL, value REAL, pace REAL, points INTEGER DEFAULT 0, logged_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (participant_id) REFERENCES participants(id));
    CREATE TABLE IF NOT EXISTS weight_log (id INTEGER PRIMARY KEY AUTOINCREMENT, participant_id INTEGER NOT NULL, weight REAL NOT NULL, logged_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (participant_id) REFERENCES participants(id));
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('weekly_check_day', 'Sunday')").run();
  const ins = db.prepare('INSERT OR IGNORE INTO participants (name, team, start_weight, current_weight) VALUES (?, ?, ?, ?)');
  for (const p of (config.participants || [])) ins.run(p.name, p.team, p.startWeight ?? p.weight ?? null, p.currentWeight ?? p.startWeight ?? null);
  return db;
}

function getWeekStart() {
  const now = new Date();
  let d = (now.getDay() - 0 + 7) % 7; if (d === 0) d = 7;
  const ws = new Date(now); ws.setDate(now.getDate() - d);
  return ws.toISOString().slice(0, 10);
}

function addActivity(db, pid, type, val, pts, date) {
  db.prepare("INSERT INTO activities (participant_id,type,value,points,logged_at) VALUES (?,?,?,?,?)").run(pid, type, val, pts, date + ' 12:00:00');
}

function addCig(db, pid, date) {
  db.prepare("INSERT INTO activities (participant_id,type,value,points,pace) VALUES (?,?,?,?,?)").run(pid, 'cigarette', 1, 0, date);
}

function runEval(db, challengeConfig) {
  const wss = getWeekStart();
  const participants = db.prepare('SELECT id, name, team FROM participants').all();
  const r = [];

  for (const p of participants) {
    const cnt = db.prepare("SELECT COUNT(*) as cnt FROM activities WHERE participant_id=? AND type='cigarette' AND pace >= ?").get(p.id, wss);
    const bonus = challengeConfig.smokingBonus || null;
    if (bonus && p.name.toLowerCase() === String(bonus.participant || '').toLowerCase()) {
      if (cnt.cnt === 0) {
        const bt = Number(bonus.team);
        db.prepare("INSERT INTO activities (participant_id,team,type,value,points,pace) VALUES (?,?,?,?,?,?)").run(null, bt, 'team_sport', 1, 1, bonus.label || 'Rauchfrei Bonus');
        r.push({ type: 'bonus', detail: `Bonus → Team ${bt} +1` });
      } else {
        r.push({ type: 'smoked_bonus', detail: `${p.name} ${cnt.cnt}x geraucht (kein Bonus)` });
      }
    } else if (cnt.cnt > 0) {
      const opp = p.team === 1 ? 2 : 1;
      db.prepare("INSERT INTO activities (participant_id,team,type,value,points,pace) VALUES (?,?,?,?,?,?)").run(null, opp, 'team_sport', 1, cnt.cnt, `${p.name} hat geraucht → Team ${opp}`);
      r.push({ type: 'smoking_penalty', detail: `🚬 ${p.name} ${cnt.cnt}x → +${cnt.cnt} Team ${opp}` });
    } else {
      r.push({ type: 'smoke_free', detail: `✅ ${p.name}: rauchfrei` });
    }

    const act = db.prepare("SELECT COUNT(*) as cnt FROM activities WHERE participant_id=? AND type NOT IN ('cigarette','inactivity') AND logged_at >= ?").get(p.id, wss);
    if (act.cnt === 0) {
      db.prepare("INSERT INTO activities (participant_id,type,value,points,pace,logged_at) VALUES (?,?,?,?,?,?)").run(p.id, 'inactivity', 1, -1, 'Inaktivitaet', wss + ' 23:59:59');
      r.push({ type: 'inactivity', detail: `⚠️ ${p.name}: -1 Pkt` });
    } else {
      r.push({ type: 'active', detail: `✅ ${p.name}: aktiv` });
    }
  }

  const ts = db.prepare(`SELECT COALESCE(p.team, a.team) as team, COALESCE(SUM(a.points),0) as total FROM activities a LEFT JOIN participants p ON p.id=a.participant_id WHERE a.logged_at >= ? AND a.type NOT IN ('cigarette','inactivity') GROUP BY COALESCE(p.team,a.team)`).all(wss);
  let ms=0, wt=null;
  for (const t of ts) { if (t.total > ms) { ms = t.total; wt = t.team; } }
  if (wt !== null && ms > 0) {
    db.prepare("INSERT INTO activities (participant_id,team,type,value,points,pace,logged_at) VALUES (?,?,?,?,?,?,?)").run(null, wt, 'team_sport', 1, 3, 'Wochensieger', wss + ' 23:59:59');
    r.push({ type: 'weekly_winner', detail: `🏆 Team ${wt}: +3` });
  } else r.push({ type: 'no_winner', detail: '➖ Kein Wochensieger' });

  return r;
}

let passed = 0, failed = 0;
function assert(ok, label) { if (ok) { console.log(`  ✅ ${label}`); passed++; } else { console.log(`  ❌ ${label}`); failed++; } }
function count(r, type) { return r.filter(m => m.type === type).length; }
function assertCount(r, type, expected, label) { const c = count(r, type); assert(c === expected, `${label} (${c}/${expected})`); }

const ws = getWeekStart();
const config = {
  participants: [{ name:'Oli', team:1, startWeight:109.5 }, { name:'Felix', team:1, startWeight:88 }, { name:'DJ', team:2, startWeight:96 }, { name:'Alex', team:2, startWeight:107.5 }],
  smokingBonus: { participant:'Alex', team:2, label:'Rauchfrei Bonus' },
};

// ═══ TEST 1: No activities at all ═════════════════════════
;(function() {
console.log('\n📋 TEST 1: No activities at all');
const db = setupDB(config);
const r = runEval(db, config);
assertCount(r, 'inactivity', 4, 'All get inactivity -1');
assertCount(r, 'bonus', 1, 'Alex Rauchfrei Bonus');
assertCount(r, 'weekly_winner', 1, 'Team 2 wins by Rauchfrei Bonus');
assert(db.prepare("SELECT SUM(points) as total FROM activities WHERE type='inactivity'").get().total === -4, 'Total -4 inactivity');
for (const n of ['Oli','Felix','DJ','Alex']) {
  const p = db.prepare("SELECT id FROM participants WHERE name=?").get(n);
  assert(db.prepare("SELECT SUM(points) as total FROM activities WHERE participant_id=? AND type='inactivity'").get(p.id).total === -1, `${n}: -1 inactivity`);
}
db.close();
})();

// ═══ TEST 2: Mixed activity levels ═════════════════════════
;(function() {
console.log('\n📋 TEST 2: Oli runs, Felix sport, DJ & Alex nothing');
const db = setupDB(config);
const oli = db.prepare("SELECT id FROM participants WHERE name='Oli'").get();
const felix = db.prepare("SELECT id FROM participants WHERE name='Felix'").get();
addActivity(db, oli.id, 'run', 5, 1, ws);
addActivity(db, felix.id, 'sport', 30, 1, ws);
const r = runEval(db, config);
assertCount(r, 'active', 2, 'Oli & Felix active');
assertCount(r, 'inactivity', 2, 'DJ & Alex inactivity');
assertCount(r, 'weekly_winner', 1, 'Team 1 wins week');
assert(r.some(m => m.type==='weekly_winner' && m.detail.includes('Team 1')), 'Team 1 is winner');
db.close();
})();

// ═══ TEST 3: Oli runs+cigarettes, Felix inactive, DJ active, Alex cigarettes
;(function() {
console.log('\n📋 TEST 3: Oli runs+smokes, DJ active, Alex smokes, Felix inactive');
const db = setupDB(config);
const oli = db.prepare("SELECT id FROM participants WHERE name='Oli'").get();
const dj = db.prepare("SELECT id FROM participants WHERE name='DJ'").get();
const alex = db.prepare("SELECT id FROM participants WHERE name='Alex'").get();
addActivity(db, oli.id, 'run', 8, 2, ws);
addActivity(db, dj.id, 'bike', 15, 1, ws);
addCig(db, oli.id, ws);
addCig(db, alex.id, ws);
addCig(db, alex.id, ws);
const r = runEval(db, config);
assertCount(r, 'active', 2, 'Oli & DJ active');
assertCount(r, 'inactivity', 2, 'Felix & Alex inactivity');
assertCount(r, 'smoked_bonus', 1, 'Alex smoked → no bonus');
assertCount(r, 'smoking_penalty', 1, 'Oli smoked → Team 2 +1');
// Winner: Team1 = Oli(2), Team2 = DJ(1) + OliPenalty(1) = 2 → tie → whoever has maxScore first
const win = r.filter(m => m.type==='weekly_winner');
assert(win.length === 1, `Weekly winner exists (${win.length > 0 ? win[0].detail : 'none'})`);
// Points: Oli 2 runs, no bonus for Alex (smoked), OliPenalty gives Team2 +1, DJ 1 bike
// Team1=2, Team2=2 → tie means winner determined by iteration order
console.log(`  ${win[0].detail}`);
db.close();
})();

// ═══ TEST 4: Alex clean → bonus, DJ runs, Felix inactive
;(function() {
console.log('\n📋 TEST 4: Alex clean → Rauchfrei Bonus, DJ runs, Felix inactive');
const db = setupDB(config);
const alex = db.prepare("SELECT id FROM participants WHERE name='Alex'").get();
const dj = db.prepare("SELECT id FROM participants WHERE name='DJ'").get();
addActivity(db, alex.id, 'sport', 60, 2, ws);
addActivity(db, dj.id, 'run', 10, 2, ws);
const r = runEval(db, config);
assertCount(r, 'active', 2, 'Alex & DJ active');
assertCount(r, 'inactivity', 2, 'Oli & Felix inactivity');
assertCount(r, 'bonus', 1, 'Alex Rauchfrei Bonus');
// Winner: Team2 = Alex(2) + DJ(2) + Rauchfrei(1) = 5, Team1 = 0
assert(r.some(m => m.type==='weekly_winner' && m.detail.includes('Team 2')), 'Team 2 wins week');
db.close();
})();

// ═══ TEST 5: Activity counts despite cigarettes ════════════
;(function() {
console.log('\n📋 TEST 5: Oli runs + cigarette → active');
const db = setupDB(config);
const oli = db.prepare("SELECT id FROM participants WHERE name='Oli'").get();
addActivity(db, oli.id, 'run', 5, 1, ws);
addCig(db, oli.id, ws);
const r = runEval(db, config);
assertCount(r, 'inactivity', 3, 'Felix, DJ, Alex inactivity');
assert(r.some(m => m.type==='active' && m.detail.includes('Oli')), 'Oli active despite cigs');
db.close();
})();

// ═══ TEST 6: All active → no inactivity ═══════════════════
;(function() {
console.log('\n📋 TEST 6: Everyone active → no inactivity');
const db = setupDB(config);
for (const n of ['Oli','Felix','DJ','Alex']) {
  addActivity(db, db.prepare("SELECT id FROM participants WHERE name=?").get(n).id, 'run', 5, 1, ws);
}
const r = runEval(db, config);
assertCount(r, 'inactivity', 0, 'No inactivity penalties');
db.close();
})();

// ═══ TEST 7: Only cigarettes → inactive ════════════════════
;(function() {
console.log('\n📋 TEST 7: Only cigarettes → all inactive');
const db = setupDB(config);
addCig(db, db.prepare("SELECT id FROM participants WHERE name='Oli'").get().id, ws);
const r = runEval(db, config);
assertCount(r, 'inactivity', 4, 'All inactive (cigarettes dont count as activity)');
db.close();
})();

// ═══ Summary ═══════════════════════════════════════════════
console.log(`\n═══════════════════════════════════`);
console.log(`🏆 ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════\n`);
cleanup();
