# 🏃 Laufchallenge 2026

Web-App + Telegram-Bot für die interteam Laufchallenge.

## Features

- **Dashboard** – Punktestand, Team-Vergleich, Aktivitäten-Log
- **Aktivitäten eintragen** – Laufen, Sport, Rad, Team-Sport, Gewicht, Rauchfrei
- **Admin-Panel** – Teilnehmer verwalten, manuelle Punkte, Daten bereinigen
- **Telegram-Bot** – Aktivitäten per Chat eintragen und Stand abfragen
- **Scoring** – Automatische Punkteberechnung (Laufen, Sport, Rad, Gewichtsverlust)

## Quick Start

```bash
# Dependencies installieren
npm install

# Private Konfiguration anlegen
cp data/challenge.example.json data/challenge.local.json

# Passwort für die Web-App setzen
export APP_PASSWORD=meinpass

# Telegram-Bot optional setzen
export BOT_TOKEN=dein:token

# Server starten (Port 3000)
npm start
```

Danach im Browser: `http://localhost:3000` – mit dem Passwort anmelden.

## Telegram-Bot

Den Bot zu einer Gruppe hinzufügen, dann registrieren:

```
/start
Name eingeben
```

Commands:

| Befehl | Beschreibung |
|--------|-------------|
| `/laufen 5 25:00` | 5km in 25:00 |
| `/laufen 5 25:00 2026-04-01` | mit Datum |
| `/sport 45 Yoga` | 45 Min Sport |
| `/rad 20` | 20km Rad |
| `/gewicht 85` | Gewicht 85kg |
| `/rauchen 2026-04-01` | Rauchfrei-Tag |
| `/standings` | Aktueller Punktestand |
| `/aktivitaeten` | Letzte Aktivitäten |

## Scoring

| Aktivität | Formel | Beispiel |
|-----------|--------|---------|
| Laufen | 1 Pkt pro 4km (Pace < 7:00/km, min. 4km) | 10km → 2 Pkt |
| Sport | 1 Pkt pro 30min | 60min → 2 Pkt |
| Rad | 1 Pkt pro 12km | 36km → 3 Pkt |
| Gewichtsverlust | 1 Pkt für Verlust > 0kg, ab 2kg: 2 Pkt pro 2kg | -4kg → 4 Pkt |
| Team-Sport | 1 Pkt pro gemeinsamem Sport | Volleyball → 1 Pkt |

## Technologie

- **Backend:** Node.js, Express, better-sqlite3
- **Frontend:** React 19, Vite, Lucide Icons
- **Bot:** node-telegram-bot-api
