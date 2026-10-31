import { useEffect, useState, type ReactNode } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { BadgeCheck, Cable, ScrollText, Waypoints } from "lucide-react";
import {
  actionsFor,
  checkInvariants,
  CONSOLE_MAGIC,
  decide,
  formatBps,
  formatMinor,
  hexGroups,
  linkEndpoints,
  NODES,
  pathLabel,
  settlement,
  sumMoney,
  type ActionId,
  type Circuit,
  type NodeId,
} from "@/lib/scf/model";
import { useFabric, type TabId } from "@/lib/scf/store";

const primaryBtn =
  "inline-flex min-h-11 items-center justify-center rounded-sm bg-brass px-4 text-sm font-medium text-brass-ink";
const ghostBtn =
  "inline-flex min-h-11 items-center justify-center rounded-sm border border-line bg-surface px-3 text-sm text-fg";
const choiceBtn =
  "inline-flex min-h-11 items-center justify-center rounded-sm border border-line bg-surface px-1 text-sm text-fg";
const field =
  "min-h-11 w-full rounded-sm border border-line bg-raised px-3 text-base text-fg";

const PRESETS = [
  { bps: 100, label: "100 b/s", note: "Pricing sample" },
  { bps: 2_000_000, label: "2 Mb/s", note: "Fits an edge" },
  { bps: 6_000_000, label: "6 Mb/s", note: "Leaves a second path" },
  { bps: 12_000_000, label: "12 Mb/s", note: "Oversubscribes 10 Mb/s" },
];

const HAPPY: ActionId[] = [
  "request",
  "admit",
  "reserve",
  "install",
  "activate",
  "drain",
  "release",
  "recycle",
];

const POS: Record<NodeId, { x: number; y: number }> = {
  N: { x: 160, y: 42 },
  E: { x: 274, y: 148 },
  S: { x: 160, y: 254 },
  W: { x: 46, y: 148 },
};

export function Console() {
  useEffect(() => {
    void useFabric.persist.rehydrate();
  }, []);
  return <Exchange />;
}

function Exchange() {
  const model = useFabric((s) => s.model);
  const tab = useFabric((s) => s.tab);
  const setTab = useFabric((s) => s.setTab);
  const dispatch = useFabric((s) => s.dispatch);
  const last = model.transcript[model.transcript.length - 1];
  const reserved = model.links.reduce((sum, link) => sum + link.reservedBps, 0);
  const capacity = model.links.reduce((sum, link) => sum + link.capacityBps, 0);
  const broken = checkInvariants(model).some((item) => !item.ok);

  return (
    <main className="mx-auto flex h-dvh w-full max-w-lg flex-col bg-bg text-fg">
      <header className="border-t-2 border-brass px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs tracking-widest text-brass">SCF · NS 0</p>
            <h1 className="mt-1 text-xl font-medium leading-tight tracking-tight">
              Sovereign
              <span className="block">Circuit Fabric</span>
            </h1>
            <p className="mt-1 text-sm text-muted">Phase I model, running here. Toolchains not executed.</p>
          </div>
          <button type="button" className={primaryBtn} onClick={() => dispatch({ type: "tick" })}>
            +1 s
          </button>
        </div>
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-3 font-mono text-xs">
            <span className="text-muted">t = {model.seconds} s</span>
            <span>
              {formatBps(reserved)}
              <span className="text-muted"> / {formatBps(capacity)}</span>
            </span>
          </div>
          <div className="mt-2 h-1 bg-raised" aria-hidden="true">
            <div
              className="h-1 bg-brass"
              style={{ width: `${capacity === 0 ? 0 : Math.min(100, (reserved / capacity) * 100)}%` }}
            />
          </div>
        </div>
        {broken && (
          <p className="mt-3 text-sm">
            Stored state breaks an invariant. Reset it from Evidence.
          </p>
        )}
      </header>

      <Tabs.Root
        className="flex min-h-0 flex-1 flex-col"
        value={tab}
        onValueChange={(value) => setTab(value as TabId)}
      >
        <Tabs.List className="grid grid-cols-4 border-b border-line" aria-label="Exchange sections">
          <TabButton value="fabric" icon={<Waypoints className="size-4" />} label="Fabric" />
          <TabButton value="circuits" icon={<Cable className="size-4" />} label="Circuits" />
          <TabButton value="ledger" icon={<ScrollText className="size-4" />} label="Ledger" />
          <TabButton value="evidence" icon={<BadgeCheck className="size-4" />} label="Evidence" />
        </Tabs.List>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <Tabs.Content value="fabric" tabIndex={-1}>
            <FabricView />
          </Tabs.Content>
          <Tabs.Content value="circuits" tabIndex={-1}>
            <CircuitsView />
          </Tabs.Content>
          <Tabs.Content value="ledger" tabIndex={-1}>
            <LedgerView />
          </Tabs.Content>
          <Tabs.Content value="evidence" tabIndex={-1}>
            <EvidenceView />
          </Tabs.Content>
        </div>
      </Tabs.Root>

      <footer className="safe-bottom border-t border-line px-4 pt-3" aria-live="polite">
        {last && (
          <p className="line-clamp-4 font-mono text-xs leading-relaxed">
            <span className={last.result === "error" ? "text-fg" : "text-brass"}>{last.result}</span>
            <span className="text-muted"> · {last.command}</span>
            <span className="mt-1 block text-fg">{last.detail}</span>
          </p>
        )}
      </footer>
    </main>
  );
}

function TabButton({ value, icon, label }: { value: TabId; icon: ReactNode; label: string }) {
  return (
    <Tabs.Trigger
      value={value}
      className="flex min-h-11 flex-col items-center justify-center gap-1 border-b-2 border-transparent py-2 text-xs text-muted data-[state=active]:border-brass data-[state=active]:text-brass"
    >
      {icon}
      {label}
    </Tabs.Trigger>
  );
}

function FabricView() {
  const model = useFabric((s) => s.model);
  const dispatch = useFabric((s) => s.dispatch);
  const setTab = useFabric((s) => s.setTab);
  const [focus, setFocus] = useState<string | null>(null);
  const active = model.links.find((link) => link.id === focus) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <svg viewBox="0 0 320 296" className="w-full" role="img" aria-label="Four-node reference fabric">
        {model.links.map((link) => {
          const a = POS[link.a];
          const b = POS[link.b];
          const util = link.capacityBps === 0 ? 0 : link.reservedBps / link.capacityBps;
          return (
            <line
              key={link.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={link.down ? "var(--color-muted)" : "var(--color-brass)"}
              strokeWidth={link.reservedBps > 0 ? 4 : 1.5}
              strokeDasharray={link.down ? "5 4" : undefined}
              opacity={link.down ? 0.7 : 0.35 + util * 0.65}
            />
          );
        })}
        {NODES.map((node) => {
          const pos = POS[node];
          return (
            <g key={node}>
              <circle cx={pos.x} cy={pos.y} r="22" fill="var(--color-surface)" stroke="var(--color-brass)" />
              <text
                x={pos.x}
                y={pos.y + 4}
                textAnchor="middle"
                fill="var(--color-fg)"
                fontFamily="var(--font-mono)"
                fontSize="13"
              >
                {node}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-sm text-muted">
        Reference capacities, not a measured link. Edge links 10 Mb/s. Backbone W–E 20 Mb/s. A down link keeps
        existing reservations until release.
      </p>
      <ul className="flex flex-col gap-2">
        {model.links.map((link) => {
          const holders = model.circuits.filter(
            (c) => c.reservedBps > 0 && c.linkIds.includes(link.id) && c.state !== "FREE" && c.state !== "RELEASED",
          );
          const util = link.capacityBps === 0 ? 0 : link.reservedBps / link.capacityBps;
          return (
            <li key={link.id} className="border border-line bg-surface px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <button type="button" className="min-h-11 text-left" onClick={() => setFocus(link.id)}>
                  <span className="block font-mono text-sm">{linkEndpoints(link)}</span>
                  <span className="block text-sm text-muted">
                    {formatBps(link.reservedBps)} reserved · {formatBps(link.capacityBps)}
                    {link.down ? " · down" : ""}
                  </span>
                </button>
                <button
                  type="button"
                  className={ghostBtn}
                  onClick={() =>
                    dispatch(link.down ? { type: "restoreLink", linkId: link.id } : { type: "failLink", linkId: link.id })
                  }
                >
                  {link.down ? "Restore" : "Fail link"}
                </button>
              </div>
              <div className="mt-2 h-1 bg-raised" aria-hidden="true">
                <div className="h-1 bg-brass" style={{ width: `${Math.min(100, util * 100)}%` }} />
              </div>
              {holders.length > 0 && (
                <p className="mt-2 font-mono text-xs text-muted">
                  Held by {holders.map((c) => `#${c.id}`).join(" ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {active && (
        <p className="text-sm text-muted">
          {linkEndpoints(active)} is {active.down ? "down" : "up"}. New admissions will not use a down link.
          Restoration does not rebuild failed circuits.
        </p>
      )}
      <section className="border border-line bg-surface px-3 py-3">
        <h2 className="text-sm font-medium">Try the conservation rules</h2>
        <ol className="mt-2 flex list-decimal flex-col gap-2 pl-4 text-sm text-muted">
          <li>Open two W→E circuits at 12 Mb/s. Admit both, then reserve. The second reserve must fail.</li>
          <li>Activate one, inject a frame, then inject a bad magic. Only the good frame counts.</li>
          <li>
            <button type="button" className="text-brass underline" onClick={() => setTab("evidence")}>
              Run the pricing.erl vector
            </button>{" "}
            and read the ledger. The published total is 0.2500.
          </li>
        </ol>
      </section>
    </div>
  );
}

function CircuitsView() {
  const model = useFabric((s) => s.model);
  const selectedId = useFabric((s) => s.selectedId);
  const select = useFabric((s) => s.select);
  const dispatch = useFabric((s) => s.dispatch);
  const [src, setSrc] = useState<NodeId>("N");
  const [dst, setDst] = useState<NodeId>("S");
  const [bps, setBps] = useState(2_000_000);
  const [priority, setPriority] = useState(3);
  const [qos, setQos] = useState(1);
  const [tariffId, setTariffId] = useState(1);
  const [formOpen, setFormOpen] = useState(true);

  return (
    <div className="flex flex-col gap-4">
      <details
        className="border border-line bg-surface"
        open={formOpen}
        onToggle={(event) => setFormOpen(event.currentTarget.open)}
      >
        <summary className="min-h-11 px-3 py-3 text-sm font-medium">Open a circuit</summary>
        <form
          className="flex flex-col gap-3 px-3 pb-3"
          onSubmit={(event) => {
            event.preventDefault();
            const result = dispatch({ type: "create", src, dst, bps, priority, qos, tariffId });
            if (result.ok) setFormOpen(false);
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs tracking-wide text-muted">
              Source
              <select className={field} value={src} onChange={(event) => setSrc(event.target.value as NodeId)}>
                {NODES.map((node) => (
                  <option key={node} value={node}>
                    {node}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs tracking-wide text-muted">
              Destination
              <select className={field} value={dst} onChange={(event) => setDst(event.target.value as NodeId)}>
                {NODES.map((node) => (
                  <option key={node} value={node}>
                    {node}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset>
            <legend className="text-xs tracking-wide text-muted">Bandwidth</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {PRESETS.map((preset) => {
                const on = preset.bps === bps;
                return (
                  <button
                    key={preset.bps}
                    type="button"
                    className={on ? primaryBtn : ghostBtn}
                    onClick={() => setBps(preset.bps)}
                  >
                    <span className="flex flex-col items-start">
                      <span>{preset.label}</span>
                      <span className={on ? "text-xs text-brass-ink" : "text-xs text-muted"}>{preset.note}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-xs tracking-wide text-muted">Priority {priority}</legend>
            <div className="mt-1 grid grid-cols-8 gap-1">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    value === priority
                      ? "inline-flex min-h-11 items-center justify-center rounded-sm bg-brass px-1 text-sm font-medium text-brass-ink"
                      : choiceBtn
                  }
                  onClick={() => setPriority(value)}
                  aria-pressed={value === priority}
                >
                  {value}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1 text-xs tracking-wide text-muted">
            QoS class 0–15
            <input
              className={field}
              inputMode="numeric"
              type="number"
              min={0}
              max={15}
              value={qos}
              onChange={(event) => setQos(Number(event.target.value))}
            />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs tracking-wide text-muted">Tariff locked at admission</legend>
            {model.tariffs.map((tariff) => {
              const on = tariff.id === tariffId;
              return (
                <button
                  key={tariff.id}
                  type="button"
                  className={`min-h-11 border px-3 py-2 text-left ${on ? "border-brass bg-brass text-brass-ink" : "border-line bg-raised text-fg"}`}
                  onClick={() => setTariffId(tariff.id)}
                >
                  <span className="block text-sm font-medium">
                    {tariff.name} · v{tariff.version}
                  </span>
                  <span className={`block text-xs ${on ? "text-brass-ink" : "text-muted"}`}>
                    Setup {tariff.setup} minor · {tariff.rateBps}/bps/s · {tariff.rateByte}/byte · priority ×
                    {tariff.prioMult}/100
                  </span>
                </button>
              );
            })}
          </fieldset>
          <button type="submit" className={primaryBtn} disabled={src === dst}>
            Create in FREE
          </button>
          {src === dst && <p className="text-sm">Source and destination must differ.</p>}
        </form>
      </details>

      {model.circuits.length === 0 ? (
        <p className="text-sm text-muted">No circuits. Capacity is idle.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {model.circuits.map((circuit) => (
            <li key={`${circuit.id}-${circuit.lifecycle}`}>
              <CircuitCard circuit={circuit} open={circuit.id === selectedId} onOpen={() => select(circuit.id)} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">
        Commands carry transaction ids. Replaying one does not reserve twice or post the same accounting event again.
      </p>
      <button
        type="button"
        className={ghostBtn}
        onClick={() => {
          const line = model.transcript.filter((entry) => entry.txId.startsWith("tx-")).at(-1);
          if (!line) return;
          dispatch({ type: "tick", txId: line.txId });
        }}
      >
        Replay last tx
      </button>
    </div>
  );
}

function CircuitCard({ circuit, open, onOpen }: { circuit: Circuit; open: boolean; onOpen: () => void }) {
  const model = useFabric((s) => s.model);
  const dispatch = useFabric((s) => s.dispatch);
  const [bytes, setBytes] = useState(64);
  const options = actionsFor(model, circuit);
  const primary = HAPPY.map((id) => options.find((option) => option.id === id)).find((option) => option?.enabled);
  const secondary = options.filter((option) => option.enabled && option.id !== primary?.id);
  const decision = circuit.state === "REQUESTED" ? decide(model, circuit) : circuit.decision;
  const owed = settlement(model, circuit);
  const frame = model.lastFrame?.circuitId === circuit.id ? model.lastFrame : null;

  function fire(id: ActionId) {
    const cid = circuit.id;
    if (id === "request") dispatch({ type: "request", cid });
    else if (id === "admit") dispatch({ type: "admit", cid });
    else if (id === "reject") dispatch({ type: "reject", cid });
    else if (id === "timeout") dispatch({ type: "timeout", cid });
    else if (id === "reserve") dispatch({ type: "reserve", cid });
    else if (id === "install") dispatch({ type: "install", cid });
    else if (id === "install-fault") dispatch({ type: "install", cid, faultAtHop: Math.max(0, circuit.path.length - 1) });
    else if (id === "activate") dispatch({ type: "activate", cid });
    else if (id === "drain") dispatch({ type: "drain", cid });
    else if (id === "release") dispatch({ type: "release", cid });
    else if (id === "fail") dispatch({ type: "fail", cid, reason: "OPERATOR" });
    else if (id === "recycle") dispatch({ type: "recycle", cid });
  }

  return (
    <article className={open ? "border border-brass bg-surface" : "border border-line bg-surface"}>
      <button type="button" className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left" onClick={onOpen}>
        <span>
          <span className="block font-mono text-sm">
            #{circuit.id} · {circuit.src}→{circuit.dst}
          </span>
          <span className="mt-1 block text-sm text-muted">
            {formatBps(circuit.requestedBps)} · p{circuit.priority} · q{circuit.qos}
            {circuit.path.length ? ` · ${pathLabel(circuit.path)}` : ""}
          </span>
        </span>
        <StateMark state={circuit.state} />
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-3 pb-3">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <Pair label="Held" value={formatBps(circuit.reservedBps)} />
            <Pair label="Duration" value={`${circuit.durationS} s`} />
            <Pair label="Sent" value={`${circuit.bytesSent} B · ${circuit.packetsSent} pkt`} />
            <Pair label="Lifecycle" value={String(circuit.lifecycle)} />
            <Pair
              label="Tariff"
              value={
                circuit.tariffLock
                  ? `T${circuit.tariffLock.id} v${circuit.tariffLock.version} locked`
                  : `T${circuit.tariffId} unlocked`
              }
            />
            <Pair label="This lifecycle" value={owed === null ? "—" : formatMinor(owed.toString())} />
          </dl>
          {decision && (
            <p className="font-mono text-xs leading-relaxed text-muted">
              decision {decision.action} · {decision.reasonCode}
              {decision.path.length ? ` · ${pathLabel(decision.path)}` : ""}
              {decision.action === "reroute"
                ? " · alternative is not applied. The state machine has no reroute transition."
                : ""}
            </p>
          )}
          {circuit.entries.length > 0 && (
            <ul className="font-mono text-xs text-muted">
              {circuit.entries.map((entry) => (
                <li key={`${entry.node}-${entry.ingress}`}>
                  {entry.node} {entry.ingress}→{entry.egress}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {primary && (
              <button type="button" className={primaryBtn} onClick={() => fire(primary.id)}>
                {primary.label}
              </button>
            )}
            {secondary.map((option) => (
              <button key={option.id} type="button" className={ghostBtn} onClick={() => fire(option.id)}>
                {option.label}
              </button>
            ))}
          </div>
          {primary && <p className="text-xs text-muted">{primary.reason}</p>}
          {circuit.state === "ACTIVE" && (
            <form
              className="flex flex-col gap-2 border-t border-line pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                dispatch({ type: "inject", cid: circuit.id, payloadBytes: bytes });
              }}
            >
              <label className="flex flex-col gap-1 text-xs tracking-wide text-muted">
                Payload bytes
                <input
                  className={field}
                  inputMode="numeric"
                  type="number"
                  min={0}
                  max={2048}
                  value={bytes}
                  onChange={(event) => setBytes(Number(event.target.value))}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={primaryBtn}>
                  Inject data
                </button>
                <button
                  type="button"
                  className={ghostBtn}
                  onClick={() => dispatch({ type: "inject", cid: circuit.id, payloadBytes: bytes, corrupt: "magic" })}
                >
                  Bad magic
                </button>
                <button
                  type="button"
                  className={ghostBtn}
                  onClick={() => dispatch({ type: "inject", cid: circuit.id, payloadBytes: bytes, corrupt: "checksum" })}
                >
                  Bad checksum
                </button>
              </div>
            </form>
          )}
          {frame && <FrameDump hex={frame.hex} accepted={frame.accepted} reason={frame.reason} />}
        </div>
      )}
    </article>
  );
}

function FrameDump({ hex, accepted, reason }: { hex: string; accepted: boolean; reason: string }) {
  const header = hexGroups(hex.slice(0, 40));
  const payload = hexGroups(hex.slice(40));
  return (
    <div className="border-t border-line pt-3">
      <p className="font-mono text-xs">
        {accepted ? "ACCEPTED" : "DROPPED"} · {reason}
      </p>
      <p className="mt-2 font-mono text-xs leading-relaxed break-all text-brass">{header}</p>
      {payload && <p className="font-mono text-xs leading-relaxed break-all text-muted">{payload}</p>}
      <p className="mt-2 text-xs text-muted">
        20-byte header, then payload. Magic on this console is {CONSOLE_MAGIC.toString(16)} — a stand-in, not the
        unresolved spec literal 0xSCF1.
      </p>
    </div>
  );
}

function LedgerView() {
  const model = useFabric((s) => s.model);
  const dispatch = useFabric((s) => s.dispatch);
  const [setup, setSetup] = useState(model.tariffs[0]?.setup ?? 1000);
  const total = sumMoney(model.ledger.map((event) => event.amount));
  const rows = [...model.ledger].reverse();

  return (
    <div className="flex flex-col gap-4">
      <section className="border border-line bg-surface px-3 py-3">
        <p className="text-xs tracking-wide text-muted">Posted minor units · 1/10000</p>
        <p className="mt-1 font-mono text-2xl tabular-nums">{formatMinor(total.toString())}</p>
        <p className="mt-2 text-sm text-muted">
          Setup posts at admission. Reservation posts once per clock second while bandwidth is held, including
          FAILED. Usage and priority post once, on release.
        </p>
      </section>
      {model.tariffs.map((tariff) => (
        <section key={tariff.id} className="border border-line px-3 py-3">
          <h2 className="text-sm font-medium">
            {tariff.name} · v{tariff.version}
          </h2>
          <p className="mt-1 text-sm text-muted">{tariff.origin}</p>
          <p className="mt-2 font-mono text-xs text-muted">
            setup {tariff.setup} · rate {tariff.rateBps}/bps/s · byte {tariff.rateByte} · prio {tariff.prioMult}
          </p>
        </section>
      ))}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          dispatch({ type: "reviseTariff", tariffId: 1, setup });
        }}
      >
        <label className="flex flex-col gap-1 text-xs tracking-wide text-muted">
          New T1 setup fee, minor units
          <input
            className={field}
            inputMode="numeric"
            type="number"
            min={0}
            value={setup}
            onChange={(event) => setSetup(Number(event.target.value))}
          />
        </label>
        <button type="submit" className={ghostBtn}>
          Publish T1 version
        </button>
        <p className="text-xs text-muted">Circuits already admitted keep the version they locked.</p>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No accounting events yet.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((event) => (
            <li key={`${event.circuitId}-${event.lifecycle}-${event.seq}`} className="border-t border-line py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-mono text-xs">
                  #{event.circuitId} · {event.kind} · seq {event.seq}
                </p>
                <p className="font-mono text-sm tabular-nums">{formatMinor(event.amount)}</p>
              </div>
              <p className="mt-1 text-sm text-muted">
                t={event.second}s · lifecycle {event.lifecycle} · {event.detail}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EvidenceView() {
  const model = useFabric((s) => s.model);
  const dispatch = useFabric((s) => s.dispatch);
  const checks = checkInvariants(model);
  const [armed, setArmed] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h2 className="text-sm font-medium">Evidence or silence</h2>
        <p className="mt-2 text-sm text-muted">
          This console executes the Phase I exchange: legal transitions, per-link reservation, integer tariffs, and
          20-byte frame checks. A passing row below is a property of this running model. It is not a TLC log, a Why3
          discharge, a p4c run, or a synthesis report.
        </p>
      </section>
      <button type="button" className={primaryBtn} onClick={() => dispatch({ type: "pricingVector" })}>
        Reproduce pricing.erl vector
      </button>
      <section>
        <h2 className="text-sm font-medium">What was actually run</h2>
        <ul className="mt-2 border-t border-line">
          {CLAIMS.map((claim) => (
            <li key={claim.title} className="border-b border-line py-3">
              <p className="text-sm">{claim.title}</p>
              <p className="mt-1 text-sm text-muted">{claim.body}</p>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-sm font-medium">Invariants of this model</h2>
        <ul className="mt-2">
          {checks.map((check) => (
            <li key={check.id} className="flex gap-3 border-t border-line py-3">
              <span className={`font-mono text-xs ${check.ok ? "text-brass" : "text-fg"}`}>
                {check.ok ? "PASS" : "FAIL"}
              </span>
              <span>
                <span className="block font-mono text-xs">{check.id}</span>
                <span className="mt-1 block text-sm text-muted">{check.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="text-sm text-muted">
        <p>
          <span className="text-fg">spec/README.md</span> names circuit_id.md and invariants.md. Those files are not
          in the repository.
        </p>
        <p className="mt-2">
          Magic is written as 0xSCF1. S is not a hexadecimal digit, and p4c was not run, so the wire value is
          unresolved. Frames here use console-local 0x{CONSOLE_MAGIC.toString(16)}.
        </p>
        <p className="mt-2">
          TLA+ Fail allows REQUESTED. The spec does not. The Erlang actor also fails from REQUESTED and records
          bandwidth at request time. This console follows spec/state_machine.md: reserve is the only event that
          holds bandwidth, and REQUESTED ends in admit, reject, or timeout.
        </p>
        <p className="mt-3">
          <a
            className="text-brass underline"
            href="https://github.com/AHMADALIPARR/sovereign-circuit-fabric"
          >
            Source repository
          </a>
        </p>
      </section>
      <button
        type="button"
        className={ghostBtn}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          dispatch({ type: "reset" });
          setArmed(false);
        }}
      >
        {armed ? "Confirm reset" : "Reset exchange"}
      </button>
    </div>
  );
}

function StateMark({ state }: { state: Circuit["state"] }) {
  const hot = state === "ACTIVE" || state === "RESERVED" || state === "INSTALLED";
  const terminal = state === "FAILED" || state === "RELEASED";
  const tone = hot
    ? "border-brass text-brass"
    : terminal
      ? "border-fg text-fg"
      : "border-line text-muted";
  return <span className={`shrink-0 border px-2 py-1 font-mono text-xs tracking-wide ${tone}`}>{state}</span>;
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
    </div>
  );
}

const CLAIMS: { title: string; body: string }[] = [
  {
    title: "Phase I definitions",
    body: "Executing. State machine, resource conservation, tariff formula, frame layout.",
  },
  {
    title: "accounting/pricing.erl",
    body: "Formula executing. basic_charge_test constants are T1. Expected settlement is 2500 minor units.",
  },
  {
    title: "TLA+ CircuitState.tla",
    body: "Source is in the repository. TLC was not run. Status: unchecked.",
  },
  {
    title: "WhyML / Why3 and Dafny",
    body: "Not in the repository. No proofs discharged.",
  },
  {
    title: "P4_16 circuit_forward.p4",
    body: "Source only. p4c was not run. That program drops bad magic, bad version, and table misses. It does not yet enforce admission state. This console does, as model policy, not as a claim about the P4.",
  },
  {
    title: "VHDL scf_crossbar",
    body: "Source only. No GHDL log. No resource or timing numbers.",
  },
  {
    title: "Gödel",
    body: "Blocked. No compiler. Admission here is a TypeScript transcription of the relations in control/godel/README.md. It is not a Gödel execution.",
  },
  {
    title: "Dylan, Tcl, BEAM",
    body: "Not executed in this console. No scalability measurement. No bare-metal BEAM.",
  },
];
