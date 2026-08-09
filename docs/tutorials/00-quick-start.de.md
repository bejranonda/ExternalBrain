# Schnellstart — von null zu einem Brain, das lernt

**Dauer:** ca. 5 Minuten. **Du brauchst:** eine Brain-URL (z. B. `https://brain.autobahn.bot`) und ein Konto oder eine Einladung.

Drei Schritte. Token erstellen, einen Befehl ausführen, dann normal mit ihm sprechen.

> Diese Übersetzung wurde KI-generiert und wartet noch auf eine muttersprachliche Durchsicht. Maßgeblich ist die englische Fassung: [00-quick-start.md](./00-quick-start.md)

---

## Abkürzung — Gutscheincode? Direkt zu `/start`

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

1. Melde dich an und öffne **Settings → Tokens** (`/settings/tokens`).
2. **Create token** → benenne ihn nach dem *Rechner*, nicht nach dir: `laptop`, `work-desktop`, `ci-runner`. Widerrufen wird pro Rechner, und genau deshalb machen rechnerbezogene Namen den Widerruf später überhaupt erst nützlich.
3. Kopiere den `bp_…`-Wert.

> **Der Token wird nur einmal angezeigt.** Die Datenbank speichert ausschließlich seinen SHA-256-Hash — es gibt keine Anzeigen-Schaltfläche, und auch der Support kann ihn nicht wiederherstellen. Verloren? Erstelle einen neuen und widerrufe den alten.

Danach zeigt die Seite einen Installationsbefehl mit deinem bereits eingesetzten Token. Dieser Befehl ist Schritt 2 — kopieren und weiterspringen.

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

### Was dieser Befehl tatsächlich tut

1. **Schreibt die Konfiguration** — über das eigene `mcp add` deines Tools, sofern vorhanden, sonst durch **Zusammenführen** mit der bestehenden Datei. Deine anderen MCP-Server bleiben erhalten, und die Datei wird vorher gesichert.
2. **Beweist, dass es funktioniert** — mit einem echten MCP-`initialize` und Tool-Aufruf über dein Netzwerk und deine Authentifizierung. Nur deshalb darf er Erfolg melden: dass eine Datei geschrieben wurde, sagt nichts darüber aus, ob der Token überhaupt etwas aufrufen kann.
3. **Protokolliert eine erste Sitzung**, damit dein Dashboard nicht leer bleibt.

**Starte danach dein KI-Tool neu.** Alle lesen die MCP-Konfiguration ausschließlich beim Start — das ist mit Abstand die häufigste Ursache für „installiert, aber nichts passiert“.

Lieber erst lesen, bevor du in eine Shell pipest?

```bash
curl -fsSL https://<your-brain>/api/onboard.sh -o /tmp/brain-install.sh
less /tmp/brain-install.sh
bash /tmp/brain-install.sh 'bp_…' --client cursor
```

---

## Schritt 3 — Sprich mit ihm

Du rufst nie Tools beim Namen auf. Du sprichst normal, und der installierte Skill sagt deiner KI, wonach sie greifen soll.

| Du sagst… | Was passiert |
|---|---|
| *(du beginnst irgendeine echte Aufgabe)* | Eine Sitzung startet; passende frühere Regeln werden eingespielt |
| „merk dir: wir nutzen pgvector, nicht Pinecone“ | Wird als Regel gespeichert; erscheint unter **Skills** |
| „frag das Oracle: wie haben wir die Migrationsreihenfolge gelöst?“ | Zusammengefasste Antwort **mit Belegen** |
| „finde die Regel zu Prisma-Migrationen“ | Inhaltlich nächste Treffer, sofort und kostenlos |
| „was habe ich letzte Woche an Billing gemacht?“ | Frühere Sitzungen zu diesen Wörtern |
| **„hat funktioniert“ / „wir sind fertig“ / „ab damit“** | **Schließt die Sitzung — dadurch lernt es** |

### Die eine Gewohnheit, auf die es ankommt

**Schließe deine Sitzungen.** Sag *„hat funktioniert“* oder *„wir sind fertig“*, wenn du fertig bist.

Eine nicht geschlossene Sitzung bringt dem Brain nichts bei — die Extraktion läuft erst beim Schließen. Das ist der häufigste Grund, warum ein Brain nach einer Woche echter Nutzung noch leer ist. Alles andere ist optional, das hier nicht.

### Eine Sitzung von Anfang bis Ende

```
Du      Ich muss die Auth-Middleware auf den neuen Credentials-Adapter umbauen.
Claude  [öffnet eine Sitzung, holt passende Regeln]
        Zwei deiner Regeln greifen hier: Sitzungen binden beim Start,
        und Credential-Prüfungen gehören in die Repository-Schicht.

Du      Nein — wir haben das letzten Monat in den Route-Handler verschoben.
Claude  Notiert, wird angepasst.

Du      Hat funktioniert, wir sind fertig.
Claude  [schließt die Sitzung mit dem Gelernten]
        Gespeichert: "Credential-Prüfungen liegen im Route-Handler,
        nicht in der Repository-Schicht — verschoben 2026-07."
```

Diese Korrektur ist jetzt dauerhaft. Nächsten Monat, auf einem anderen Rechner, kommt sie an, bevor du dich daran erinnern musst.

### Wie du gute Antworten bekommst

- **„finde die Regel zu X“** — sofort, kostenlos, kein Modellaufruf. Nimm es immer dann, wenn du sonst eine frühere Entscheidung neu herleiten würdest.
- **„frag das Oracle: …“** — langsamer und kostenpflichtig, dafür zusammengefasst und belegt. Nimm es, wenn du Begründungen willst, keine Liste.
- **Frag das Oracle nicht** nach allgemeinen Programmierfragen. Es ist das Gedächtnis deines Projekts, nicht das Internet.

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
| [01 — Erste Schritte](./01-getting-started.md) | Dasselbe, langsamer, mit Diagrammen |
| [02 — Das Oracle fragen](./02-asking-the-oracle.md) | Frageformen, die funktionieren |
| [03 — Wissen beibringen](./03-teaching-knowledge.md) | Regeln schreiben, die bestehen |
| [04 — Tokens verwalten](./04-managing-tokens.md) | Geltungsbereich, Rotation, Widerruf |
| [USING_BRAIN](../USING_BRAIN.md) | Die vollständige Alltagsreferenz |
| [CLIENTS](../CLIENTS.md) | Konfigurationsformen und Fallstricke je Client |
