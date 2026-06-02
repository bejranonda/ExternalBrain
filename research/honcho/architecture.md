# Honcho AI: Architecture Pointer

> **This file is a pointer, not a blueprint.** The subagent audit flagged its
> original form as redundant with `platform_blueprint.md` — same hierarchy,
> shallower coverage, no unique technical facts. Rather than duplicate, use
> `platform_blueprint.md` as the single source of truth and this file as an
> orientation map.

## If you want…

| Goal | Read |
|---|---|
| The full reconstruction spec (data model, pipeline, REST, auth) | `platform_blueprint.md` |
| How Honcho maps onto this platform's DIKW-T pyramid | `platform_blueprint.md` §8.2 |
| A quick SDK reference (Thai prose, English code) | `api_cheatsheet.md` |
| The three advanced SDK calls (`session.context`, `queue_status`, `schedule_dream`) | `api_cheatsheet.md` §9 |
| What Honcho demonstrates empirically (cross-session asymmetry, contradiction handling) | `tests/hard_mode_results_en.md` |
| Honest weaknesses of Honcho | `tests/explained_en.md` — "Weaknesses" section |

## The one-paragraph summary

Honcho is an **ambient personalization framework** organised around four
layers — Workspace → Peer → Session → Message — that extracts atomic facts
("Conclusions") asynchronously from chat and synthesises them into
queryable narrative profiles ("Representations"). Its distinguishing
techniques are observer/observed directionality (who knows what about
whom), a "Dream" consolidation pass, and explicit Peer Cards that override
inferred knowledge. For this project, Honcho's pipeline is structurally
identical to our Information → Knowledge → Wisdom chain — see the DIKW-T
mapping in the blueprint.
