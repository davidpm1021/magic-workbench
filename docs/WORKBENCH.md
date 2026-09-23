# Magic Workbench

Magic Workbench is an experimental deck-testing layer built on top of Manabrew's existing rules,
multiplayer, Forge, snapshot, and agent infrastructure.

## v0.1 goal

The first vertical slice keeps the existing rules client intact and adds a Workbench panel that can:

- keep the local seat under manual control;
- ask an OpenAI-compatible model to evaluate the current legal actions;
- execute exactly one model recommendation;
- hand supported prompts to a thinking model automatically;
- fast-forward a routine priority sequence by passing with stack exhaustion;
- preserve Manabrew's engine-side legal-action validation.

The AI never submits an arbitrary Magic instruction. For supported prompts it receives the current
recipient-filtered game view and the engine's action IDs, then must choose one of those IDs. The
engine remains authoritative.

## Current AI prompt coverage

The v0.1 controller now validates and can answer the strategic prompt families needed for a normal
game:

- mulligans and London-mulligan put-backs;
- priority actions and mana payment;
- attackers, blockers, damage order, and combat-damage assignment;
- board targets;
- yes/no, numeric, color, card, and weighted selections;
- scry and reorder decisions.

Informational prompts remain on the existing deterministic auto-resolvers. Every AI response is
validated against the current engine prompt before it is submitted. If a model returns an illegal or
malformed choice, Workbench stops and leaves the decision with the human instead of guessing.

## Connecting a model

Open the in-game **Workbench** tab and enter:

- an OpenAI-compatible base URL, for example `http://localhost:1234/v1`;
- the model name;
- an optional API key;
- optional pilot instructions.

You can also prefill the non-secret settings when running the client:

```env
VITE_WORKBENCH_AI_BASE_URL=http://localhost:1234/v1
VITE_WORKBENCH_AI_MODEL=your-model
```

API keys entered in the Workbench panel are session-only and are not persisted. For browser builds,
a local proxy such as LiteLLM or another OpenAI-compatible gateway is preferred so a provider secret
is not exposed to browser code.

## Roadmap

1. Add decision importance routing so trivial choices use a fast policy and hard choices use a
   reasoning model.
2. Add aggressive but safe auto-yield for prompts where no meaningful legal action exists.
3. Add named snapshots and deterministic branch execution.
4. Run parallel continuations from a saved state.
5. Compare alternate actions and card swaps across matched seeds.
6. Log human decisions as evaluation trajectories.
7. Add replay analysis and ghost-pilot comparison.


## Local AI development

For browser development, the preferred path is the Vite-local Workbench proxy. Provider credentials stay in the PowerShell/Vite process and are not persisted in browser storage.

On Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-workbench-ai.ps1
```

The launcher defaults to:

- strategic decisions: `gpt-6-luna`
- routine decisions: `gpt-6-luna`
- provider base: `https://api.openai.com/v1`

The proxy automatically uses OpenAI's Responses API for `api.openai.com`. Other OpenAI-compatible bases default to Chat Completions. Override `WORKBENCH_AI_API_MODE` with `responses` or `chat` when a provider needs an explicit mode.

### Cost controls

Workbench records token usage returned by the provider for every AI decision. For recognized OpenAI models it estimates per-decision spend and totals it by game.

The default Windows launcher now uses:

- strategic decisions: `gpt-6-luna`
- routine decisions: `gpt-6-luna`
- strategic reasoning effort: high
- routine reasoning effort: low
- maximum model output: 20,000 tokens strategic, 4,000 routine
- per-game soft budget: $0.50

The budget is a local guard, not a provider billing limit. Once the recorded game spend reaches the cap, Workbench stops making new AI calls until the cap is raised or disabled. A request already in flight can take the total slightly over the cap.

The current experiment routes both routine and strategic play to GPT-6 Luna, using low reasoning for routine prompts and high reasoning for strategic prompts. Use GPT-6 Sol intentionally later when comparing decision quality. The UI shows estimated cost and token count for each recent decision so a full-game run can be evaluated before increasing model quality or budget.

### Decision routing

Workbench classifies each supported prompt as either `routine` or `strategic`.

Routine examples:
- deterministic fixed-source mana payment when Workbench can solve it locally
- low-risk color production
- most trigger ordering
- priority where no strategic spell or non-mana activation is offered

Strategic examples:
- mulligans
- casts and non-mana activations
- combat
- targeting
- card selection, scry, and modal choices

Deterministic forced prompts are resolved by the existing prompt resolver before the AI controller is allowed to act.

Each AI recommendation records prompt type, route, model, latency, validated output, and reason in the in-session Workbench history.

### Audit-driven controller safeguards

The first completed GPT-6 Luna game exposed several controller problems that looked like model mistakes. Workbench now addresses them directly:

- ordinary mana and undo-mana actions are hidden from the model when meaningful actions exist;
- empty-stack priority prompts containing only mana management are passed locally instead of asking the model to float mana;
- straightforward fixed-color mana payment steps are solved deterministically;
- recent engine log entries and recent Workbench decisions are sent as continuity context;
- multi-prompt transactions retain their originating action so follow-up confirmations do not reinterpret already-paid costs;
- modal choices include base and additional cost hints when the protocol exposes them;
- repeated failed modal-payment transactions stop at a transaction-level guard instead of looping indefinitely;
- one transient provider overload/429/5xx response is retried automatically before human recovery is required;
- repeated battlefield card characteristics are deduplicated in the model view to reduce late-game prompt size;
- manual recovery decisions are included in the audit;
- game-over state is appended to the audit, and the last completed audit can be exported from the Play home screen.

The audit remains the source of truth for evaluating model quality. A legal action is not assumed to be a good action merely because the engine offered it.
