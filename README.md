# Debater ⚔️

A multi-round AI debate orchestrator that routes a question through **ChatGPT** and **Gemini**, orchestrates an adversarial debate between them, and applies structured reasoning frameworks to govern argument depth.

## Architecture

```
frontend (React + Vite + Tailwind)
       ↓ HTTP / SSE
backend (Node.js + TypeScript + Express)
       ↓ REST APIs
  OpenAI API    Google Gemini API
```

## Reasoning Frameworks

| Framework | Application |
|-----------|-------------|
| **Toulmin Model** | Round 1 opening — Claim, Data, Warrant, Backing, Qualifier, Rebuttal |
| **5 Whys** | Counter-argument — drill to root assumptions |
| **Steel-Manning** | Every counter — state the strongest version first |
| **Socratic Interlude** | Between rounds 1 and 2 — clarifying questions |
| **Dialectical Synthesis** | Round 3 — identify genuine disagreement |

## Debate State Machine

```
IDLE → ROUND_1_AI1 → ROUND_1_AI2 → SOCRATIC_INTERLUDE →
ROUND_2_AI1 → ROUND_2_AI2 → ROUND_3_AI1 → FINAL_AI1 → FINAL_AI2 → COMPLETE
```

## Setup

### Prerequisites

- Node.js 20+
- API keys for OpenAI and Google Gemini

### Install

```bash
npm install
```

### Configure

```bash
cp .env.example .env
# Edit .env and add your API keys
```

### Run (development)

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

### Test

```bash
npm test --workspace=backend
```

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/debates` | Create a new debate session |
| GET | `/api/debates` | List all sessions |
| GET | `/api/debates/:id` | Get session details |
| POST | `/api/debates/:id/advance` | Advance one step |
| POST | `/api/debates/:id/run` | Run full debate (SSE stream or batch) |

### Create debate

```json
POST /api/debates
{
  "question": "Does remote work improve productivity?",
  "outputFormat": "stream",
  "frameworks": {
    "enableFiveWhys": true,
    "enableSteelManning": true,
    "enableSocraticInterlude": true,
    "enableToulminStructure": true
  }
}
```
Chatbot debater
