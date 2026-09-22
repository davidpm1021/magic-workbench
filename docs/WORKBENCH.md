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
