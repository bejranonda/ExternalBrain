# Schnellstart — Verbinde dein AI-Tool in 3 Minuten mit dem External Brain

**Dauer:** ~3 Minuten. **Voraussetzung:** Deine Brain-URL (z. B. `https://brain.autobahn.bot`) und ein Benutzerkonto oder Voucher-Code.

Wähle deinen Einrichtungspfad:
- **Pfad A: Automatische Einrichtung mit AI (1 Min.)** — Ideal, wenn du einen Voucher-Code hast.
- **Pfad B: Standard-Einrichtung (2 Min.)** — Ideal, wenn du bereits ein Brain-Konto hast.

> Diese Übersetzung wurde per KI erstellt und wartet auf eine Prüfung durch Muttersprachler. Englische Originalfassung: [00-quick-start.md](./00-quick-start.md)

---

## Pfad A — Automatische Einrichtung mit einem Voucher-Code

Wenn dir ein Teammitglied einen Voucher-Code gegeben hat:

1. Öffne [`https://<dein-brain>/start`](https://<dein-brain>/start) im Browser und gib deinen Voucher-Code ein.
2. Kopiere den angezeigten Prompt und füge ihn in Claude Code, Cursor oder Windsurf ein. Dein AI-Tool erstellt dein Konto und richtet die Brain-Verbindung automatisch ein.
3. **Starte dein AI-Tool neu**, damit die neue MCP-Konfiguration geladen wird.

> **Hinweis zum Token-Umfang:** Über den AI-Chat erstellte Voucher-Token sind 14 Tage gültig und aus Sicherheitsgründen auf einfache Abfragen beschränkt. Ein dauerhaftes Token kannst du jederzeit unter **Settings → Tokens** ([`/settings/tokens`](/settings/tokens)) erstellen. Details in [Tutorial 04](./04-managing-tokens.md).

---

## Pfad B — Standard-Einrichtung in 3 Schritten

### Schritt 1 — Token erstellen & Befehl kopieren

1. Melde dich in der Brain-Webapp an → Gehe zu **Settings → Tokens** ([`/settings/tokens`](/settings/tokens)).
2. Klicke auf **Create token** → Vergib einen Namen für dein Gerät (`laptop`, `workstation`, `ci-runner`).
3. Klicke auf der Bestätigungsseite auf **Copy Command**. *(Der Befehl enthält deinen geheimen Token und den Client bereits vorausgefüllt!)*

---

### Schritt 2 — Installer ausführen & AI-Tool neustarten

1. Füge den kopierten Befehl im Terminal ein und führe ihn aus:

   ```bash
   # macOS / Linux / WSL / Git Bash
   curl -fsSL https://<dein-brain>/api/onboard.sh | bash -s 'bp_…dein_token…' --client claude-code
   ```

   ```powershell
   # Windows PowerShell 5.1+
   iwr https://<dein-brain>/api/onboard.ps1 -UseBasicParsing | iex
   Install-Brain -Token 'bp_…dein_token…' -Client claude-code
   ```

2. **STARTE DEIN AI-TOOL NEU.** *(Erforderlich: AI-Tools lesen MCP-Serverkonfigurationen nur beim Start).*

> Möchtest du das Skript vor der Ausführung prüfen? Siehe [Tutorial 01 — Vertiefende Einrichtung](./01-getting-started.md).

---

### Schritt 3 — Erstes Gespräch führen

Sprich ganz normal in Claude Code, Cursor oder Windsurf — keine spezielle Syntax erforderlich:

#### Verbindung testen
| Sag… | Was passiert | Warum es wichtig ist |
|---|---|---|
| *"ask the brain what it knows about this project"* | Bestätigt die Verbindung und listet Projektregeln auf | Beweist, dass dein AI-Agent mit dem Brain sprechen kann |

#### Regel beibringen
| Sag… | Was passiert | Warum es wichtig ist |
|---|---|---|
| *"remember this: we use pgvector, not Pinecone"* | Speichert eine dauerhafte Regel unter **Skills** | Verhindert, dass dein AI-Tool denselben Fehler erneut macht |
| *"no — we moved that check to the route handler last month"* | Korrektur während der Session | Lehrt das Brain, veraltete Ratschläge zu verlernen |
| *"we decided to use Redis for sessions, not Postgres"* | Als Projekt-**Decision** gespeichert | Geteiltes Teamwissen; verblasst nicht mit der Zeit |

#### Oracle befragen
| Sag… | Was passiert | Warum es wichtig meint |
|---|---|---|
| *"ask the oracle: how did we solve the migration ordering?"* | Synthetisiert Antwort mit Quellennachweisen `[^K1]`, `[^S2]` | Beantwortet Fragen anhand deiner eigenen Projekthistorie |

#### Session schließen (Wichtigste Gewohnheit!)
| Sag… | Was passiert | Warum es wichtig ist |
|---|---|---|
| *"that worked"* / *"we're done"* / *"ship it"* | **Schließt die Session & extrahiert neue Skills** | Ungeschlossene Sessions lehren nichts! Das Schließen lässt das Brain lernen. |

---

## Verbindung prüfen

```bash
# Überprüfen, ob Claude Code den Brain-Server sieht
claude mcp list | grep brain
```

In deinem AI-Tool: *"ask the brain what it knows about this project"*. Wenn es mit Projektregeln antwortet, ist dein Brain aktiv!

### Schnelle Fehlerbehebung

| Symptom | Ursache | Lösung |
|---|---|---|
| Tool sieht das Brain nicht | Nach Schritt 2 nicht neugestartet | Terminal/Editor schließen und neu öffnen |
| `401 Unauthorized` | Token abgelaufen oder widerrufen | Neues Token unter `/settings/tokens` erstellen |
| Verbunden, aber Skills bleibt leer | Sessions wurden nie geschlossen | Sag *"we're done"*, wenn die Aufgabe erledigt ist |
| `~/.claude/mcp.json` manuell editiert | Falsche Datei | Claude Code liest `~/.claude.json` |

Tiefergehende Hilfe: [Tutorial 06 — Fehlerbehebung](./06-troubleshooting.md).

---

## Nächste Schritte

| Anleitung | Beschreibung |
|---|---|
| [01 — Vertiefende Einrichtung](./01-getting-started.md) | Mechanismus, Installer-Details & Sicherheits-Audit |
| [02 — Oracle befragen](./02-asking-the-oracle.md) | Fragemuster, die funktionieren |
| [03 — Brain Wissen beibringen](./03-teaching-knowledge.md) | Regeln schreiben, die dauerhaft bleiben |
| [04 — Token verwalten](./04-managing-tokens.md) | Scope, Rotation und Widerruf von Token |
| [07 — Skill-Typen erklärt](./07-skill-types-explained.md) | Rezepte, Faustregeln, Anti-Pattern und Entscheidungen einfach erklärt |
| [USING_BRAIN](../USING_BRAIN.md) | Vollständige Referenz für den Alltag |
| [CLIENTS](../CLIENTS.md) | Client-spezifische Konfigurationen & Stolperfallen |
