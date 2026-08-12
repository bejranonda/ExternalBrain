# Schnellstart — Verbinde dein AI-Tool in 3 Minuten mit dem External Brain

**Dauer:** ~3 Minuten. **Voraussetzung:** Deine Brain-URL (z. B. `https://brain.autobahn.bot`) und ein Benutzerkonto oder Voucher-Code.

> Diese Übersetzung wurde per KI erstellt und wartet auf eine Prüfung durch Muttersprachler. Englische Originalfassung: [00-quick-start.md](./00-quick-start.md)

---

> [!IMPORTANT]
> **WÄHLE EINE DER BEIDEN EINRICHTUNGS-OPTIONEN (Nicht beide ausführen!):**
> - **OPTION 1 (Empfohlen, wenn du einen Voucher-Code hast)** — Automatische Einrichtung per AI-Chat in 1 Min.
> - **OPTION 2 (Standard-Weg mit Brain-Konto)** — Einrichtung über die Web-UI in 2 Min.

---

## OPTION 1 — Automatische Einrichtung mit Voucher-Code (1 Minute)

Nutze diesen Weg, wenn dir ein Teammitglied einen Voucher-Code oder Einladungslink gegeben hat:

1. Öffne [`https://<your-brain>/start`](https://<your-brain>/start) im Browser und gib deinen Voucher-Code ein.
2. Kopiere den angezeigten Prompt und füge ihn in Claude Code, Cursor oder Windsurf ein. Dein AI-Tool erstellt dein Konto und richtet die Brain-Verbindung automatisch ein.
3. **Starte dein AI-Tool neu**, damit die neue MCP-Konfiguration geladen wird.

> **Hinweis zum Token-Umfang:** Über den AI-Chat erstellte Voucher-Token sind 14 Tage gültig und aus Sicherheitsgründen auf einfache Abfragen beschränkt. Ein dauerhaftes Token kannst du jederzeit unter **Settings → Tokens** ([`/settings/tokens`](/settings/tokens)) erstellen. Details in [Tutorial 04](./04-managing-tokens.md).

---

## OPTION 2 — Standard-Einrichtung mit Benutzerkonto (3 Schritte)

### Schritt 1 — Token erstellen & Befehl kopieren

1. Melde dich in der Brain-Webapp an → Gehe zu **Settings → Tokens** ([`/settings/tokens`](/settings/tokens)).
2. Klicke auf **Create token** → Vergib einen Namen für dein Gerät (`laptop`, `workstation`, `ci-runner`).
3. Klicke auf der Bestätigungsseite auf **Copy Command**. *(Dies kopiert den exakten, ausführbaren Befehl mit deinem echten Token und deiner Host-URL in deine Zwischenablage!).*

---

### Schritt 2 — Installer ausführen & AI-Tool neustarten

1. Öffne ein Terminal auf deinem Gerät.
2. **Füge den ECHTEN Befehl ein, den du in Schritt 1 aus der Webapp kopiert hast, und führe ihn aus.**

> [!WARNING]
> **Kopiere NICHT den Beispielbefehl unten in dein Terminal.** Der Beispielbefehl unten enthält nur Platzhalter (`https://<your-brain>` und `bp_...`). Füge immer den echten Befehl aus Schritt 1 deiner Webapp-Anzeige ein!

```bash
# NUR BEISPIEL — Diesen Block NICHT kopieren! Füge deinen kopierten Befehl aus Schritt 1 ein.
curl -fsSL https://<your-brain>/api/onboard.sh | bash -s 'bp_…dein_token…' --client claude-code
```

```powershell
# NUR BEISPIEL (Windows PowerShell) — Füge deinen kopierten Befehl aus Schritt 1 ein!
iwr https://<your-brain>/api/onboard.ps1 -UseBasicParsing | iex
Install-Brain -Token 'bp_…dein_token…' -Client claude-code
```

3. **STARTE DEIN AI-TOOL NEU.** *(Erforderlich: AI-Tools wie Claude Code, Cursor und Windsurf lesen MCP-Serverkonfigurationen nur beim Start).*

> Möchtest du das Skript vor der Ausführung prüfen? Siehe [Tutorial 01 — Vertiefende Einrichtung](./01-getting-started.md).

---

### Schritt 3 — Erstes Gespräch führen (Echte Praxisbeispiele)

Du sprichst mit deinem AI-Tool in ganz normaler Sprache — keine speziellen Befehle erforderlich.

#### Echte Session-Mitschrift (So sieht es in der Praxis aus)

```text
You:     I need to refactor the auth middleware to use the credentials adapter.
Claude:  [opens session, retrieves matching rules]
         Two of your rules apply here: session tokens bind at start, and
         credential checks belong at the repository layer.

You:     no — we moved that check to the route handler last month.
Claude:  Noted, updating code to use the route handler.

You:     that worked, we're done.
Claude:  [closes session & extracts new rules]
         Saved rule: "Credential checks live at the route handler, not the repository layer."
```

#### Schnellreferenz

| Sag… | Was in der Praxis passiert | Warum es wichtig ist |
|---|---|---|
| *"ask the brain what it knows about this project"* | Bestätigt die Verbindung und listet Projektregeln auf | Beweist, dass dein AI-Agent mit dem Brain sprechen kann |
| *"remember this: we use pgvector, not Pinecone"* | Speichert eine dauerhafte Regel unter **Skills** | Verhindert, dass dein AI-Tool denselben Fehler erneut macht |
| *"no — we moved that check to the route handler last month"* | Korrektur während der Session | Lehrt das Brain, veraltete Ratschläge zu verlernen |
| *"we decided to use Redis for sessions, not Postgres"* | Als Projekt-**Decision** gespeichert | Geteiltes Teamwissen; verblasst nicht mit der Zeit |
| *"ask the oracle: how did we solve the migration ordering?"* | Synthetisiert Antwort mit Quellennachweisen `[^K1]`, `[^S2]` | Beantwortet Fragen anhand deiner eigenen Projekthistorie |
| *"that worked"* / *"we're done"* / *"ship it"* | **Schließt die Session & extrahiert neue Skills** | **Wichtige Gewohnheit:** Ungeschlossene Sessions lehren nichts! Das Schließen lässt das Brain lernen. |

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
| `401 Unauthorized` | Token abgelaufen, widerrufen oder Beispielbefehl kopiert | Neues Token unter [`/settings/tokens`](/settings/tokens) erstellen & aus Webapp einfügen |
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
| [USING_BRAIN](../USING_BRAIN.md) | Vollständige Referenz mit echten Mitschriften |
| [CLIENTS](../CLIENTS.md) | Client-spezifische Konfigurationen & Stolperfallen |
