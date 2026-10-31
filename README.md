# Sovereign Circuit Fabric — Console

The Phase I console for the Sovereign Circuit Fabric, implemented in
Erlang/OTP on BEAM. It serves a server-rendered web UI with no
JavaScript: every interaction is a link or a form post, and the
exchange re-renders the page.

The console executes the exchange model rather than transcribing it:

- One `circuit_actor` gen_statem process per circuit decides the
  legality of every lifecycle transition (FREE, REQUESTED, ADMITTED,
  RESERVED, INSTALLED, ACTIVE, DRAINING, RELEASED, FAILED).
- `pricing.erl` computes every charge through its exported
  components. Setup posts at admission, reservation posts once per
  clock second while bandwidth is held (including FAILED), and usage
  plus priority post once, on release.
- The console layer holds the fabric state: the four-node reference
  topology (edge links 10 Mb/s, backbone W–E 20 Mb/s), deterministic
  shortest-path admission with per-link reservation, tariff versions
  locked at admission, the 20-byte circuit frame codec (magic
  0x5343, network byte order, Internet checksum), an append-only
  ledger, and a transaction transcript with idempotent replay.
- The Evidence tab reports what has actually run and checks nine
  invariants of the running model on every render.

`beam/circuit_actor.erl` and `beam/pricing.erl` are copies of the
modules in the sovereign-circuit-fabric repository
(`control/beam/circuit_actor.erl`, `accounting/pricing.erl`), which
carries the specifications this console follows.

The console is also published through GitHub Pages
(ahmadaliparr.github.io/arrow-meadow-marble-gem) as a static
rendering produced by the BEAM renderer: the four tabs in their
initial state, with no JavaScript. The interactive exchange runs
on the BEAM server.

## Layout

- `beam/scf_model.erl` — topology, admission decisions, pathfinding,
  frame codec, tariff breakdowns, invariant checks, formatting.
- `beam/scf_exchange.erl` — the exchange gen_server: fabric state,
  command dispatch, actor lifecycle, ledger, transcript.
- `beam/scf_render.erl` — the four tabs (Fabric, Circuits, Ledger,
  Evidence) as server-rendered HTML and CSS.
- `beam/scf_http.erl` — a small HTTP/1.1 server on gen_tcp.
- `beam/scf_console.erl` — entry point.
- `beam/scf_console_test.erl` — the test suite.

## Run

    ./run.sh            # serves on SCF_PORT (default 8080)
    ./run_tests.sh      # compiles everything and runs the suite
