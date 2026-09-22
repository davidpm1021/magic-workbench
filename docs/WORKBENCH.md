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

v0.1 supports:

- `chooseAction`
- `payManaCost`

Thinking AI takeover pauses on other prompt families so the human can resolve them normally. Combat
declarations, target selection, mulligans, ordering, and other prompt types are the next coverage
milestone.

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

1. Cover all prompt families so Thinking AI can pilot an entire game.
2. Add decision importance routing so trivial choices use a fast policy and hard choices use a
   reasoning model.
3. Add named snapshots and deterministic branch execution.
4. Run parallel continuations from a saved state.
5. Compare alternate actions and card swaps across matched seeds.
6. Log human decisions as evaluation trajectories.
7. Add replay analysis and ghost-pilot comparison.
