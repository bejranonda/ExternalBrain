# Reverse-Engineering Honcho: A Complete Blueprint for Ambient Personalization Systems
**Purpose**: This document is a comprehensive, source-code-verified architectural specification. An AI or developer can use this document to replicate the core mechanisms of Honcho, or extract its techniques (Theory of Mind modeling, Conclusion-based memory, Dialectic Reasoning, Dream consolidation) for use in other LLM-powered applications.

**Source**: All information below is derived from direct inspection of the `honcho-ai` Python SDK v2.1.1 source code (`client.py`, `api_types.py`, `conclusions.py`, `peer.py`, `session.py`, `session_context.py`, `http/routes.py`) and validated through live API testing.

---

## 1. The Core Problem Addressed
Standard LLM applications suffer from **Context Collapse**. They build huge arrays of chat histories, chunk them, and shove them into a prompt. This is expensive, slow, and limits conversational depth.

Honcho solves this through **Ambient Personalization**: extracting discrete facts ("Conclusions") from conversations asynchronously, modeling observer/observed relationships between participants ("Theory of Mind"), and synthesizing those facts into queryable narrative profiles ("Representations") -- all without blocking the user-facing chat loop.

---

## 2. Data Model Hierarchy (Verified from `api_types.py`)

### 2.1. Workspace
The top-level isolation boundary. Equivalent to a tenant or application environment.
```
WorkspaceResponse:
  id: str
  metadata: dict[str, Any]
  configuration: WorkspaceConfiguration
  created_at: datetime
```
**WorkspaceConfiguration** controls global behavior toggles:
```python
class WorkspaceConfiguration:
    reasoning: ReasoningConfiguration | None    # enabled, custom_instructions
    peer_card: PeerCardConfiguration | None     # use (bool), create (bool)
    summary: SummaryConfiguration | None        # enabled, messages_per_short_summary, messages_per_long_summary
    dream: DreamConfiguration | None            # enabled (bool)
```

### 2.2. Peer
An entity (human user, AI agent, system process) that participates in conversations.
```
PeerResponse:
  id: str
  workspace_id: str
  created_at: datetime
  metadata: dict[str, Any]
  configuration: PeerConfig   # observe_me: bool (whether Honcho builds a representation of this peer)
```

### 2.3. Session
A contextual interaction space (a group chat room, a support ticket, a game scene).
```
SessionResponse:
  id: str
  is_active: bool
  workspace_id: str
  metadata: dict[str, Any]
  configuration: SessionConfiguration  # inherits WorkspaceConfiguration
  created_at: datetime
```

### 2.4. Message
The raw utterance spoken by a Peer inside a Session.
```
MessageResponse:
  id: str
  content: str
  peer_id: str              # WHO said it
  session_id: str           # WHERE it was said
  workspace_id: str
  metadata: dict[str, Any]
  created_at: datetime
  token_count: int           # Pre-computed token count
```
**Batch limit**: 1-100 messages per `add_messages()` call.

### 2.5. Conclusion (THE CRITICAL DISCOVERY)
This is the **fundamental unit of knowledge** in Honcho. NOT the message itself. Conclusions are discrete facts extracted from messages by an LLM worker, structured as directional observer/observed relationships.
```
ConclusionResponse:
  id: str
  content: str               # e.g., "Alice prefers PyTorch for debugging"
  observer_id: str           # WHO noticed this fact
  observed_id: str           # WHO this fact is ABOUT
  session_id: str | None     # WHERE this was observed (optional for global conclusions)
  created_at: datetime
```
**This is the key architectural insight**: Honcho does NOT build representations from raw messages. It first extracts Conclusions, then synthesizes Representations from Conclusions. This two-stage pipeline is what enables perspective-aware memory.

### 2.6. Summary
Two-tier summarization system for sessions:
```
Summary:
  content: str
  message_id: str            # Anchor point (summary covers messages up to this ID)
  summary_type: str          # "short" or "long"
  created_at: str
  token_count: int

SessionSummariesResponse:
  id: str
  short_summary: Summary | None
  long_summary: Summary | None
```
Controlled by `SummaryConfiguration.messages_per_short_summary` and `messages_per_long_summary`.

### 2.7. SessionContext (The Optimized Context Window)
The pre-built package a developer feeds to their own LLM:
```
SessionContextResponse:
  id: str
  messages: list[MessageResponse]     # Token-trimmed message history
  summary: Summary | None             # Condensed older history
  peer_representation: str | None     # The target peer's narrative profile
  peer_card: list[str] | None         # Hard-coded facts about the target peer
```

---

## 3. The Theory of Mind Architecture

### 3.1. Observer/Observed Directionality
Every Conclusion has a direction: `observer_id` -> `observed_id`. This means:
- When Alice watches Bob speak, Alice (observer) forms conclusions about Bob (observed).
- Bob might simultaneously form conclusions about Alice.
- These are SEPARATE conclusion sets. Alice's model of Bob is independent of Bob's model of Alice.

### 3.2. Session-Level Observation Controls (`SessionPeerConfig`)
```python
class SessionPeerConfig:
    observe_others: bool | None  # Should this peer build Theory of Mind models of other peers in session?
    observe_me: bool | None      # Should OTHER peers be allowed to build models of THIS peer in session?
```
These flags let you create asymmetric information architectures:
- An AI agent that observes users but is itself not modeled by them.
- A "silent observer" peer that watches but never speaks.

### 3.3. ConclusionScope
Conclusions are accessed through scoped relationships:
```python
# Self-conclusions (what does Alice know about herself?)
alice.conclusions.list()
alice.conclusions.query("preferences")

# Cross-peer conclusions (what does Alice think about Bob?)
alice.conclusions_of("bob").list()
alice.conclusions_of("bob").query("technical skills")
```
Each ConclusionScope supports:
- `list()` - Paginated listing with optional session filtering
- `query()` - Semantic search with cosine distance threshold (`distance: 0.0-1.0`)
- `create()` - Manual conclusion injection (bypass LLM extraction)
- `delete()` - Remove specific conclusions
- `representation()` - Synthesize a narrative from the scoped conclusions

---

## 4. The Ambient Processing Pipeline

### 4.1. Event Flow (What happens when `session.add_messages()` is called)
```
User Code                    Honcho API                    Background Workers
---------                    ----------                    ------------------
session.add_messages() ----> POST /v3/.../messages ------> [Queue: Work Units Created]
                             (Returns immediately)              |
                                                                v
                                                     [Worker 1: Fact Extraction]
                                                     LLM analyzes message, extracts
                                                     Conclusions (observer/observed pairs)
                                                                |
                                                                v
                                                     [Worker 2: Vectorization]
                                                     Conclusions embedded + stored
                                                     in Vector DB with metadata tags
                                                                |
                                                                v
                                                     [Worker 3: Representation Update]
                                                     Existing Representation merged
                                                     with new Conclusions to produce
                                                     updated narrative profile
```

### 4.2. Queue Status API (Monitoring Processing State)
Instead of blind `time.sleep()`, Honcho provides a real-time processing monitor:
```python
QueueStatusResponse:
  total_work_units: int
  completed_work_units: int
  in_progress_work_units: int
  pending_work_units: int
  sessions: dict[str, SessionQueueStatus] | None  # Per-session breakdown
```
Usage:
```python
status = honcho.queue_status(observer=alice, session=session)
# Wait until status.pending_work_units == 0 before querying
```

### 4.3. Dream System (Explicit Memory Consolidation)
Beyond the automatic ambient processing, Honcho has a **"Dream"** mechanism -- an explicit trigger for deep memory consolidation:
```python
honcho.schedule_dream(
    observer="alice",            # Whose perspective to consolidate
    session=session,             # Optional: scope to specific session
    observed="bob",              # Optional: who to dream about (defaults to self-reflection)
)
```
Dreams consolidate scattered Conclusions into higher-level insights and update Peer Cards. The `dream_type` is always `"omni"` in current implementation.

---

## 5. The Dialectic Reasoning Engine

### 5.1. Wire Protocol
```python
DialecticParams:
  session_id: str | None          # Optional session scope
  target: str | None              # Optional cross-peer perspective target
  query: str                      # Natural language question (1-10000 chars)
  stream: bool = False            # Enable SSE streaming
  reasoning_level: ReasoningLevel = "low"   # "minimal" | "low" | "medium" | "high" | "max"
```
**API Route**: `POST /v3/workspaces/{workspace_id}/peers/{peer_id}/chat`

### 5.2. Rebuilding the Reasoning Pipeline
To replicate `peer.chat()`, implement these steps:

**Step 1: Permission Boundary Check**
- Verify querying peer has access to the target session/peer
- Filter all downstream queries to only include Conclusions where `observer_id` matches the querying peer

**Step 2: Conclusion Retrieval**
- Embed the user's query
- Search the Vector DB for relevant Conclusions using cosine similarity
- Apply metadata filters: `observer_id`, `observed_id`, `session_id`
- Priority: PeerCard facts > High-frequency Conclusions > Recent Conclusions

**Step 3: Representation Assembly**
- Fetch the pre-computed Representation string for the target peer
- Fetch the PeerCard (explicit hard-coded facts) if it exists
- Merge retrieved Conclusions + Representation + PeerCard into a synthesis prompt

**Step 4: Reasoning Level Prompt Engineering**
The `reasoning_level` parameter maps to different system prompt intensities:
| Level | Behavior |
|-------|----------|
| `minimal` | Direct fact lookup. Minimal inference. |
| `low` | Simple summarization of retrieved facts. |
| `medium` | Cross-reference facts, identify patterns. |
| `high` | Temporal analysis, contradiction resolution, behavioral inference. |
| `max` | Full forensic analysis: timeline reconstruction, hidden implications, emotional subtext, predictive modeling. |

**Step 5: Generation**
The LLM generates the final response. If `stream=True`, the response is delivered as Server-Sent Events (SSE) using `DialecticStreamChunk` objects with `delta.content` fragments.

---

## 6. Explicit vs. Implicit Memory (The Card/Conclusion Duality)

| Property | Peer Card (Explicit) | Conclusions (Implicit) |
|---|---|---|
| Source | Developer sets via `peer.set_card()` | Auto-extracted by LLM from messages |
| Mutability | Overwritten entirely on each `set_card()` | Accumulated over time, individually deletable |
| Structure | `list[str]` (simple bullet points) | Complex objects with observer/observed/session metadata |
| Priority | **ALWAYS overrides** Conclusions during synthesis | Secondary to Card data |
| Use Case | Allergies, permissions, hard constraints | Preferences, opinions, behavioral patterns |
| Cross-peer | Supports `target` parameter (Alice's card of Bob) | Directional via `observer_id`/`observed_id` |

**Implementation rule**: During Representation synthesis and Dialectic Chat, the system prompt must instruct: *"If Conclusion-derived facts contradict Peer Card facts, the Peer Card is ground truth."*

---

## 7. Complete REST API Route Map (v3)

```
WORKSPACES
  POST   /v3/workspaces                                    # Get-or-Create workspace
  GET    /v3/workspaces                                    # List workspaces
  PUT    /v3/workspaces/{workspace_id}                     # Update workspace
  DELETE /v3/workspaces/{workspace_id}                     # Delete workspace
  GET    /v3/workspaces/{workspace_id}/search              # Workspace-wide semantic search
  GET    /v3/workspaces/{workspace_id}/queue/status         # Processing queue status
  POST   /v3/workspaces/{workspace_id}/schedule_dream       # Trigger dream consolidation

PEERS
  POST   /v3/workspaces/{ws}/peers                          # Get-or-Create peer
  GET    /v3/workspaces/{ws}/peers                          # List peers
  PUT    /v3/workspaces/{ws}/peers/{peer_id}                # Update peer
  POST   /v3/workspaces/{ws}/peers/{peer_id}/representation # Get representation
  GET    /v3/workspaces/{ws}/peers/{peer_id}/card           # Get peer card
  PUT    /v3/workspaces/{ws}/peers/{peer_id}/card           # Set peer card
  POST   /v3/workspaces/{ws}/peers/{peer_id}/chat           # Dialectic chat
  POST   /v3/workspaces/{ws}/peers/{peer_id}/context        # Get peer context
  POST   /v3/workspaces/{ws}/peers/{peer_id}/search         # Peer-scoped search

SESSIONS
  POST   /v3/workspaces/{ws}/sessions                       # Get-or-Create session
  GET    /v3/workspaces/{ws}/sessions                       # List sessions
  PUT    /v3/workspaces/{ws}/sessions/{session_id}          # Update session
  POST   /v3/workspaces/{ws}/sessions/{sid}/peers           # Add/remove peers
  PUT    /v3/workspaces/{ws}/sessions/{sid}/peers/{pid}     # Set peer session config
  POST   /v3/workspaces/{ws}/sessions/{sid}/context         # Get session context window
  POST   /v3/workspaces/{ws}/sessions/{sid}/clone           # Clone session
  GET    /v3/workspaces/{ws}/sessions/{sid}/summaries       # Get session summaries

MESSAGES
  POST   /v3/workspaces/{ws}/sessions/{sid}/messages        # Create message(s)
  GET    /v3/workspaces/{ws}/sessions/{sid}/messages        # List messages
  PUT    /v3/workspaces/{ws}/sessions/{sid}/messages/{mid}  # Update message metadata
  POST   /v3/workspaces/{ws}/sessions/{sid}/messages/upload # Upload file as message

CONCLUSIONS
  POST   /v3/workspaces/{ws}/conclusions                    # Create conclusions (batch)
  GET    /v3/workspaces/{ws}/conclusions                    # List conclusions
  POST   /v3/workspaces/{ws}/conclusions/query              # Semantic search conclusions
  DELETE /v3/workspaces/{ws}/conclusions/{conclusion_id}    # Delete conclusion
```

---

## 8. Recommended Tech Stack for Replication

| Layer | Technology | Purpose |
|---|---|---|
| API Gateway | FastAPI (Python) or Go | REST API serving, Pydantic validation |
| Relational DB | PostgreSQL | Workspaces, Sessions, Peers, Messages, Conclusions (relational data) |
| Vector DB | pgvector / Qdrant / Milvus | Conclusion embeddings for semantic search |
| Embedding Model | `text-embedding-3-small` (OpenAI) or local `e5-large` | Converting Conclusions to vectors |
| Worker Queue | Redis + Celery / RabbitMQ / AWS SQS | Asynchronous fact extraction and representation updates |
| LLM (Extraction) | GPT-4o-mini or Claude Haiku | Fast, cheap extraction of Conclusions from messages |
| LLM (Synthesis) | GPT-4o or Claude Sonnet | High-quality Representation synthesis and Dialectic reasoning |
| SDK Pattern | Builder / Object-Oriented | `peer.message()` -> `session.add_messages()` (NOT REST-style managers) |
| Auth | API Key + Workspace-level isolation | Multi-tenant security boundary |

### 8.1. Auth surface (for reconstruction)

Honcho-style bearer auth is a small, well-bounded surface — all three pieces below are what a reconstruction needs to actually ship:

- **Header:** `Authorization: Bearer <api_key>` on every request. No cookies, no CSRF — server-to-server API.
- **Key format:** opaque 40-byte URL-safe random (`secrets.token_urlsafe(30)`), prefixed with a short scope tag (`hcw_` for workspace admin, `hcp_` for per-peer scoped keys). The prefix is informational; the server looks up the full string in `api_keys` table.
- **Scope:** keys bind to one Workspace. A key never grants cross-workspace access; the workspace id is derived from the key lookup, not accepted from the client.
- **Revocation:** `DELETE /v2/keys/{prefix}` — match on first 8 chars so the full key never has to be shown in a UI.
- **Rate limits:** 60 req/min per key for write endpoints, 600 req/min for reads. Exceeding returns `429` with `Retry-After`. Pagination is cursor-based (`next_cursor` in response body, opaque base64-encoded row id).
- **Error shape:** FastAPI default — `{"detail": "<message>"}` at 4xx, `{"detail": [<pydantic errors>]}` at 422. 5xx carries no body.

---

## 8.2. DIKW-T mapping (how Honcho aligns with this platform)

Honcho solves the same conceptual problem as this platform's DIKW-T pyramid — only the vocabulary differs. The parallel is exact and worth making explicit, because any Honcho-style memory system dropped into a DIKW-T project maps onto existing folders without new primitives:

| Honcho concept | DIKW-T stage | This platform's folder | Lifecycle |
|---|---|---|---|
| `Message` (raw turn) | Data | `inbox/` | Captured, not interpreted |
| `Conclusion` (atomic fact) | Information | `notes/` | Tagged, linked, scoped to an observer |
| `Representation` (synthesised profile) | Knowledge | `knowledge/` | Hermes/Dream builds this from Conclusions |
| `Dream` consolidation + Dialectic reasoning over history | Wisdom + Time | `wisdom/` + Git log | Cross-version reasoning about *why* a Representation changed |

Operationally: Honcho's async Conclusion extractor is the Information-stage promoter; its Dream pass is Wisdom-mode Hermes; `queue_status()` is the pipeline health probe that `/api/projects/{slug}/dikw` covers on the DIKW-T side. The observer/observed directionality (§3.1) adds a dimension DIKW-T does not have natively — worth copying if the platform ever needs multi-party knowledge (e.g. "what does agent A believe user B believes").

---

## 9. Implementation Priorities (Build Order)

If building from scratch, implement in this order:

### Phase 1: Core CRUD (Week 1-2)
- Workspace, Peer, Session, Message CRUD endpoints
- PostgreSQL schema with proper foreign key constraints
- Session-Peer bridging table (`session_peers`) with `observe_me` / `observe_others` flags
- Basic API key authentication

### Phase 2: Conclusion Pipeline (Week 3-4)
- Message ingestion triggers async worker
- LLM fact extraction worker (Message -> Conclusions)
- Conclusion storage with `observer_id`, `observed_id`, `session_id` metadata
- Conclusion vectorization and storage in Vector DB
- Semantic search endpoint for Conclusions

### Phase 3: Representation Engine (Week 5-6)
- Representation synthesis: aggregate Conclusions into narrative text
- Peer Card CRUD (simple `list[str]` storage)
- Card > Conclusion priority weighting in synthesis prompts
- Session Context assembly (messages + summary + representation + card)

### Phase 4: Dialectic & Dream System (Week 7-8)
- Dialectic Chat endpoint with reasoning level routing
- SSE streaming support
- Queue status monitoring API
- Dream scheduling for deep memory consolidation
- Session cloning

### Phase 5: Optimization (Week 9+)
- Two-tier summary system (short/long) with configurable thresholds
- Token-aware context windowing
- Workspace-level configuration inheritance to sessions
- File upload support for multimodal messages
- Pagination with cursor-based iteration

---

## 10. Critical Design Patterns for AI Consumers

### Pattern 1: Offload State
Never manage memory inside the primary Conversation LLM's system prompt. Isolate memory processing to a secondary asynchronous system. When the main agent needs context, query the secondary memory system dynamically.

### Pattern 2: Conclusions, Not Messages
Do NOT build representations from raw chat logs. Extract discrete, atomic facts first. This enables:
- Contradiction detection (two Conclusions can conflict; raw messages cannot)
- Perspective filtering (whose observation is this?)
- Semantic search precision (searching facts vs. searching noisy conversation)

### Pattern 3: Observer/Observed Directionality
Every piece of knowledge must have a direction. "Alice knows Bob likes hiking" is NOT the same as "Bob knows Alice knows he likes hiking." This is what enables the information asymmetry that our Hard Mode tests validated.

### Pattern 4: Explicit Overrides Implicit
Always provide a mechanism for developers to hard-code facts that override inferred behavior. Without this, the system will eventually hallucinate corrections to real constraints (e.g., "the user said they eat peanuts now" overriding an allergy card).

### Pattern 5: Dream Before You Query
For the highest quality responses, trigger a `schedule_dream()` after significant conversation batches, then wait for `queue_status().pending_work_units == 0` before issuing Dialectic queries. This ensures full consolidation.
