# Circuit Fabric

Phase I exchange console on Erlang/OTP. Server-rendered HTML, no JavaScript in the exchange UI. Form posts drive a live BEAM model: topology, admission, per-circuit actors, fixed-point pricing, ledger.

Source model: [sovereign-circuit-fabric](https://github.com/AHMADALIPARR/sovereign-circuit-fabric).

---

## Interactive 2D circuits

Open the map and click a circuit to highlight its path on the fabric:

**[Open 2D circuit map](circuits-2d.html)** · [docs copy](docs/circuits-2d.html)

```mermaid
flowchart TB
    N[N]
    W[W]
    E[E]
    S[S]
    N --- W
    N --- E
    W --- S
    E --- S
    W --- E
```

| Link | Capacity |
| --- | --- |
| N–W, N–E, W–S, E–S | 10 Mb/s |
| W–E backbone | 20 Mb/s |

Admission uses deterministic shortest path with per-link reservation.

---

## Console shots

<p align="center">
  <img src="images/fabric.png" alt="Fabric tab" width="240" />
  <img src="images/circuits.png" alt="Circuits tab" width="240" />
</p>

Static tab renders: [Fabric](index.html) · [Circuits](circuits.html) · [Ledger](ledger.html) · [Evidence](evidence.html)

---

## Stack

```mermaid
flowchart LR
    HTTP[scf_http] --> Render[scf_render]
    HTTP --> Exchange[scf_exchange]
    Exchange --> Model[scf_model]
    Exchange --> Actor[circuit_actor]
    Exchange --> Price[pricing]
```

| Module | Role |
| --- | --- |
| scf_console | Entry |
| scf_http | HTTP/1.1 on gen_tcp |
| scf_render | Four tabs as HTML |
| scf_exchange | State, commands, ledger |
| scf_model | Topology, frames, invariants |
| circuit_actor | One gen_statem per circuit |
| pricing | Integer minor-unit charges |

---

## Lifecycle

```mermaid
stateDiagram-v2
    [*] --> FREE
    FREE --> REQUESTED: request
    REQUESTED --> ADMITTED: admit
    REQUESTED --> FREE: reject
    ADMITTED --> RESERVED: reserve
    RESERVED --> INSTALLED: install
    INSTALLED --> ACTIVE: activate
    ACTIVE --> DRAINING: drain
    DRAINING --> RELEASED: release
    ADMITTED --> FAILED: fail
    RESERVED --> FAILED: fail
    INSTALLED --> FAILED: fail
    ACTIVE --> FAILED: fail
    FAILED --> RELEASED: release
    RELEASED --> FREE: recycle
```

| Stage | Meaning |
| --- | --- |
| FREE | No resources |
| REQUESTED | Awaiting admit |
| ADMITTED | Policy accepted, tariff locked |
| RESERVED | Bandwidth held on path |
| INSTALLED | Forwarding entries set |
| ACTIVE | Carrying traffic |
| DRAINING | Teardown in progress |
| RELEASED | Final charge posted |
| FAILED | Fault; still must release |

---

## Pricing

```text
Charge = Setup + ReservedCapacity + Usage + Priority
```

| Event | When |
| --- | --- |
| Setup | Admission |
| Reservation | Each clock second while held |
| Usage + priority | Once on release |

Integer minor units only. Suite vector: **2500** minor units.

---

## Run

```sh
./run.sh         # SCF_PORT default 8080
./run_tests.sh   # 9 tests
```

Needs `erlc` and `erl`. Exchange state is in-memory; restart resets the fabric.

---

## Evidence

| Check | Result |
| --- | --- |
| Model suite | 9 tests pass |
| Invariants | 9 checked after each command |
| HTTP lifecycle | create through release |
| Pages site | static snapshot only |

Details: [STATUS.md](STATUS.md)

---

## License

SnapKitty Opaque Source License 1.0 — see `LICENSE`.  
Copyright © 2026 SnapKitty West.
