# STATUS

Plain facts about verification scope and limits.

- The test suite (`beam/scf_console_test.erl`, run by
  `run_tests.sh`) ports the reference console's model tests: 9
  tests, all passing. The nine model invariants are checked after
  every successful command in the suite.
- The pricing vector settles 2500 minor units (0.2500) both
  in-process and over HTTP: ESTABLISHMENT, ten RESERVATION events,
  FINAL, computed by `pricing.erl` with transitions executed by
  `circuit_actor` processes.
- The full lifecycle was also driven over HTTP against a running
  server (create through release, link failure, tariff revision,
  reset), and all four tabs render with no JavaScript in the
  responses.
- `beam/circuit_actor.erl` and `beam/pricing.erl` are byte-identical
  copies of the modules in the sovereign-circuit-fabric repository
  at import time (2026-10-31). That repository is the authority;
  changes belong there first and are re-copied.
- Exchange state lives in the `scf_exchange` process memory. A
  server restart resets the exchange to the reference topology;
  there is no persistence.
- Not run for this console: p4c on the P4 program, GHDL on the VHDL,
  Why3 or Dafny discharges (Phase II of the source repository). The
  TLC result quoted on the Evidence tab (6,271 generated states,
  1,650 distinct, four invariants) is the source repository's run
  against its committed model and configuration.
- The console is a single-node model of the Phase I exchange.
  Capacities are reference values chosen so exhaustion is
  observable; they are not measured hardware.
