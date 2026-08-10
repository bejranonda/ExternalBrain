# Schnellstart — von null zu einem Brain, das lernt

**Dauer:** ca. 5 Minuten. **Du brauchst:** eine Brain-URL (z. B. `https://brain.autobahn.bot`) und ein Konto oder eine Einladung.

Drei Schritte. Token erstellen, einen Befehl ausführen, dann normal mit ihm sprechen.

> Diese Übersetzung wurde KI-generiert und wartet noch auf eine muttersprachliche Durchsicht. Maßgeblich ist die englische Fassung: [00-quick-start.md](./00-quick-start.md)

---

## Abkürzung — Gutscheincode? Direkt zu [`/start`](/start)

Öffne `https://<your-brain>/start`, füge deinen Code ein und kopiere den Prompt,
den du bekommst, in Claude Code, Cursor oder ein beliebiges KI-Werkzeug, das
eine URL abrufen kann. Deine KI legt das Konto an, erzeugt das Token und führt
den Installationsbefehl aus — **dann starte dein KI-Werkzeug neu**, denn die
MCP-Konfiguration wird nur beim Start gelesen.

Das Token ist eingeschränkt (14 Tage, kein Oracle), weil der Code durch ein
Chatfenster gereist ist. Ein vollwertiges Token gibt es später unter
**Settings → Tokens**.

Kein Gutscheincode, oder `agentic_onboarding_disabled`? Weiter mit Schritt 1.

---

## Schritt 1 — Token erstellen

1. Anmelden → **Settings → Tokens** ([`/settings/tokens`](/settings/tokens)).
2. **Create token** → benenne ihn nach dem *Rechner* (`laptop`, `ci-runner`).
3. Kopiere den `bp_…`-Wert — nur einmal angezeigt, und der nächste Bildschirm hat deinen Installationsbefehl schon fertig. Details (Rotation, Geltungsbereich, Widerruf): [Tutorial 04](./04-managing-tokens.md).

---

## Schritt 2 — Verbinde dein KI-Tool

Ein Befehl, unabhängig vom Tool. `--client` ist standardmäßig `claude-code`.

```bash
# macOS / Linux / WSL / Git Bash
curl -fsSL https://<your-brain>/api/onboard.sh | bash -s 'bp_…' --client claude-code
```

```powershell
# Windows PowerShell 5.1+
iwr https://<your-brain>/api/onboard.ps1 -UseBasicParsing | iex
Install-Brain -Token 'bp_…' -Client claude-code
```

### Wähle deinen `--client`

| Dein Tool | `--client` | Wissenswert |
|---|---|---|
| Claude Code | `claude-code` | Installiert zusätzlich den Brain-Skill |
| Claude Desktop | `claude-desktop` | Benötigt Node; danach die App **vollständig beenden** — das Fenster zu schließen genügt nicht |
| Cursor | `cursor` | |
| Windsurf | `windsurf` | |
| Google Antigravity | `antigravity` | Eine Konfiguration bedient IDE und CLI gemeinsam |
| VS Code + Copilot | `vscode` | Im Projektstammverzeichnis ausführen — schreibt `./.vscode/mcp.json` |
| GitHub Copilot CLI | `copilot-cli` | |
| OpenAI Codex | `codex` | Gibt zusätzlich eine `export BRAIN_TOKEN=…`-Zeile aus — **ohne sie im Shell-Profil bekommt Codex einen 401** |
| Alles andere | `generic` | Mit `--config-path <Datei>` wird diese Datei für dich geschrieben |

JetBrains / Visual Studio / Eclipse / Xcode haben keinen festen Konfigurationspfad — füge dort stattdessen das JSON aus der Token-Seite ein.

**Starte danach dein KI-Tool neu.** Alle lesen die MCP-Konfiguration ausschließlich beim Start — das ist mit Abstand die häufigste Ursache für „installiert, aber nichts passiert“.

Willst du genau wissen, was das Skript macht, oder es erst lesen, bevor du es in eine Shell pipest? [Tutorial 01](./01-getting-started.md) geht es Schritt für Schritt durch.

---

## Schritt 3 — Sprich mit ihm

Keine Toolnamen zu merken. Du sprichst einfach normal — in Claude Code, Cursor, Windsurf oder jedem anderen MCP-Client — und der Skill wählt den richtigen `brain_*`-Aufruf.

**Verbindung beweisen**
| Du sagst… | Was passiert |
|---|---|
| „frag das Brain, was es über dieses Projekt weiß“ | Kostenlos, sofort — beweist, dass die Verbindung steht |

**Ihm etwas beibringen**
| Du sagst… | Was passiert |
|---|---|
| „merk dir: wir nutzen pgvector, nicht Pinecone“ | Wird als Regel gespeichert; erscheint unter **Skills** |
| „nein — das haben wir letzten Monat in den Route-Handler verschoben“ | Korrektur mitten in der Sitzung; bringt ihm bei, veraltete Ratschläge zu verlernen |
| „wir haben uns für Redis statt Postgres für Sessions entschieden“ | Als Projektentscheidung gespeichert (geteilt, verfällt nicht) |

**Abrufen — sofort, kostenlos, kein Modellaufruf**
| Du sagst… | Was passiert |
|---|---|
| „finde die Regel zu Prisma-Migrationen“ | Inhaltlich nächste Treffer |
| „was habe ich letzte Woche an Billing gemacht?“ | Frühere Sitzungen zu diesen Wörtern |

**Das Oracle fragen — langsamer, kostenpflichtig, begründete Antwort mit Belegen**
| Du sagst… | Was passiert |
|---|---|
| „frag das Oracle: wie haben wir die Migrationsreihenfolge gelöst?“ | Zusammengefasste Antwort, belegt mit den Ursprungs-Sitzungen |
| ✗ „frag das Oracle: wie funktioniert flexbox?“ | Falsche Nutzung — es ist das Gedächtnis deines Projekts, nicht das Internet |

**Den Kreis schließen — die eine Gewohnheit, auf die es ankommt**
| Du sagst… | Was passiert |
|---|---|
| „hat funktioniert“ / „wir sind fertig“ / „ab damit“ | **Schließt die Sitzung — dadurch lernt es.** Eine nicht geschlossene Sitzung bringt dem Brain nichts bei; das ist der häufigste Grund, warum ein Brain nach einer Woche echter Nutzung noch leer ist |

Weitere Kategorien und ein vollständiges Beispiel: [Tutorial 01](./01-getting-started.md), [Tutorial 02 — Das Oracle fragen](./02-asking-the-oracle.md), [Tutorial 03 — Wissen beibringen](./03-teaching-knowledge.md)

---

## Prüfen, ob es läuft

```bash
claude mcp list | grep brain
```

Frag es dann in deinem Tool: *„frag das Brain, was es über dieses Projekt weiß“*. Wenn überhaupt eine Antwort kommt, läuft der Kreislauf.

| Symptom | Ursache |
|---|---|
| Dein Tool sieht das Brain nicht | Nach der Installation nicht neu gestartet |
| 401 bei jedem Aufruf | Token widerrufen, abgelaufen oder von einem anderen Brain |
| Nur Codex bekommt 401 | `BRAIN_TOKEN` fehlt im Shell-Profil |
| Verbunden, aber Skills bleibt leer | Sitzungen werden nie geschlossen — sag „wir sind fertig“ |
| `~/.claude/mcp.json` bearbeitet, nichts ändert sich | Falsche Datei. Claude Code liest `~/.claude.json` |

Mehr dazu: [Fehlersuche](./06-troubleshooting.md)

---

## Weiterlesen

| | |
|---|---|
| [01 — Erste Schritte](./01-getting-started.md) | Dasselbe, langsamer, mit ausführlicher Begründung |
| [02 — Das Oracle fragen](./02-asking-the-oracle.md) | Frageformen, die funktionieren |
| [03 — Wissen beibringen](./03-teaching-knowledge.md) | Regeln schreiben, die bestehen |
| [04 — Tokens verwalten](./04-managing-tokens.md) | Geltungsbereich, Rotation, Widerruf |
| [USING_BRAIN](../USING_BRAIN.md) | Die vollständige Alltagsreferenz |
| [CLIENTS](../CLIENTS.md) | Konfigurationsformen und Fallstricke je Client |
