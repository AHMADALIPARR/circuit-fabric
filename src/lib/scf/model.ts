/**
 * Reference execution of the Phase I exchange model.
 * Rules are transcribed from spec/state_machine.md, spec/resource_model.md,
 * spec/tariff_arithmetic.md, spec/circuit_frame.md, and accounting/pricing.erl.
 * This is not TLC, Why3, Dafny, p4c, GHDL, or Gödel output.
 */

export const NAMESPACE_ID = 0;
/**
 * spec/circuit_frame.md writes Magic 0xSCF1. `S` is not a hex digit, and the
 * P4 literal has not been compiled here, so the 16-bit wire value is
 * unresolved. 0x5CF1 is a console-local stand-in for exercising length,
 * checksum, and admission. It is not a reading of the spec.
 */
export const CONSOLE_MAGIC = 0x5cf1;
export const SCF_VERSION = 0x01;
export const MINOR_SCALE = 10000;
export const INT64_MAX = (1n << 63n) - 1n;

export type NodeId = "N" | "E" | "S" | "W";
export type StateName =
  | "FREE"
  | "REQUESTED"
  | "ADMITTED"
  | "RESERVED"
  | "INSTALLED"
  | "ACTIVE"
  | "DRAINING"
  | "RELEASED"
  | "FAILED";

export type DecisionAction = "admit" | "reject" | "reroute";

export type Decision = {
  circuitId: number;
  action: DecisionAction;
  path: NodeId[];
  linkIds: string[];
  reservedBps: number;
  tariffId: number;
  reasonCode: string;
};

export type Tariff = {
  id: number;
  version: number;
  name: string;
  setup: number;
  rateBps: number;
  rateByte: number;
  prioMult: number;
  origin: string;
};

export type TariffLock = {
  id: number;
  version: number;
  setup: number;
  rateBps: number;
  rateByte: number;
  prioMult: number;
};

export type TableEntry = {
  node: NodeId;
  ingress: string;
  egress: string;
};

export type Circuit = {
  id: number;
  namespaceId: number;
  lifecycle: number;
  state: StateName;
  src: NodeId;
  dst: NodeId;
  requestedBps: number;
  reservedBps: number;
  priority: number;
  qos: number;
  tariffId: number;
  tariffLock: TariffLock | null;
  path: NodeId[];
  linkIds: string[];
  entries: TableEntry[];
  installCompleted: boolean;
  heldReservation: boolean;
  durationS: number;
  bytesSent: number;
  bytesRecv: number;
  packetsSent: number;
  packetsRecv: number;
  nextSequence: number;
  nextEventSeq: number;
  finalEmitted: boolean;
  decision: Decision | null;
};

export type Link = {
  id: string;
  a: NodeId;
  b: NodeId;
  capacityBps: number;
  reservedBps: number;
  down: boolean;
};

export type LedgerKind = "ESTABLISHMENT" | "RESERVATION" | "FINAL";

export type LedgerEvent = {
  circuitId: number;
  lifecycle: number;
  seq: number;
  kind: LedgerKind;
  amount: string;
  detail: string;
  second: number;
};

export type TranscriptLine = {
  txId: string;
  second: number;
  command: string;
  result: "ok" | "error" | "replay";
  detail: string;
};

export type Applied = { ok: boolean; detail: string };

export type ParsedFrame = {
  magic: number;
  version: number;
  flags: number;
  circuitId: number;
  namespaceId: number;
  priority: number;
  qos: number;
  sequence: number;
  payloadLength: number;
  checksum: number;
  payloadBytes: number;
};

export type LastFrame = {
  hex: string;
  accepted: boolean;
  reason: string;
  circuitId: number;
  parsed: ParsedFrame | null;
};

export type Model = {
  seconds: number;
  nextId: number;
  nextTx: number;
  links: Link[];
  tariffs: Tariff[];
  circuits: Circuit[];
  ledger: LedgerEvent[];
  transcript: TranscriptLine[];
  applied: Record<string, Applied>;
  lastFrame: LastFrame | null;
};

export type Result = { ok: boolean; replay: boolean; detail: string };

export type Command =
  | {
      type: "create";
      txId: string;
      src: NodeId;
      dst: NodeId;
      bps: number;
      priority: number;
      qos: number;
      tariffId: number;
    }
  | { type: "request"; txId: string; cid: number }
  | { type: "admit"; txId: string; cid: number }
  | { type: "reject"; txId: string; cid: number }
  | { type: "timeout"; txId: string; cid: number }
  | { type: "reserve"; txId: string; cid: number }
  | { type: "install"; txId: string; cid: number; faultAtHop?: number }
  | { type: "activate"; txId: string; cid: number }
  | { type: "drain"; txId: string; cid: number }
  | { type: "release"; txId: string; cid: number }
  | { type: "fail"; txId: string; cid: number; reason: string }
  | { type: "recycle"; txId: string; cid: number }
  | { type: "tick"; txId: string }
  | {
      type: "inject";
      txId: string;
      cid: number;
      payloadBytes: number;
      corrupt?: "magic" | "version" | "checksum" | "length";
    }
  | { type: "failLink"; txId: string; linkId: string }
  | { type: "restoreLink"; txId: string; linkId: string }
  | { type: "reviseTariff"; txId: string; tariffId: number; setup: number }
  | { type: "pricingVector"; txId: string }
  | { type: "reset"; txId: string };

export const NODES: NodeId[] = ["N", "E", "S", "W"];

const NODE_NAME: Record<NodeId, string> = {
  N: "North",
  E: "East",
  S: "South",
  W: "West",
};

export function nodeName(id: NodeId): string {
  return NODE_NAME[id];
}

const HELD = new Set<StateName>([
  "RESERVED",
  "INSTALLED",
  "ACTIVE",
  "DRAINING",
  "FAILED",
]);

const FORWARDING = new Set<StateName>(["INSTALLED", "ACTIVE", "DRAINING"]);

export function initialTariffs(): Tariff[] {
  return [
    {
      id: 1,
      version: 1,
      name: "T1 reference",
      setup: 1000,
      rateBps: 1,
      rateByte: 2,
      prioMult: 10,
      origin: "accounting/pricing.erl basic_charge_test",
    },
    {
      id: 2,
      version: 1,
      name: "T2 bulk",
      setup: 2500,
      rateBps: 2,
      rateByte: 1,
      prioMult: 5,
      origin: "Console tariff. Not defined in pricing.erl.",
    },
  ];
}

export function initialLinks(): Link[] {
  return [
    { id: "N-E", a: "N", b: "E", capacityBps: 10_000_000, reservedBps: 0, down: false },
    { id: "N-W", a: "N", b: "W", capacityBps: 10_000_000, reservedBps: 0, down: false },
    { id: "S-E", a: "S", b: "E", capacityBps: 10_000_000, reservedBps: 0, down: false },
    { id: "S-W", a: "S", b: "W", capacityBps: 10_000_000, reservedBps: 0, down: false },
    { id: "W-E", a: "W", b: "E", capacityBps: 20_000_000, reservedBps: 0, down: false },
  ];
}

export function initialModel(): Model {
  return {
    seconds: 0,
    nextId: 1,
    nextTx: 1,
    links: initialLinks(),
    tariffs: initialTariffs(),
    circuits: [],
    ledger: [],
    transcript: [
      {
        txId: "boot",
        second: 0,
        command: "exchange boot",
        result: "ok",
        detail:
          "Reference topology loaded. Capacities are chosen so exhaustion is observable. They are not measured hardware.",
      },
    ],
    applied: {},
    lastFrame: null,
  };
}

export function formatMinor(amount: string): string {
  const neg = amount.startsWith("-");
  const digits = neg ? amount.slice(1) : amount;
  const padded = digits.padStart(5, "0");
  const whole = padded.slice(0, -4) || "0";
  const frac = padded.slice(-4);
  return `${neg ? "−" : ""}${whole}.${frac}`;
}

export function formatBps(bps: number): string {
  const abs = Math.abs(bps);
  if (abs >= 1_000_000) {
    const mb = bps / 1_000_000;
    const text = Number.isInteger(mb) ? String(mb) : mb.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return `${text} Mb/s`;
  }
  if (abs >= 1_000) {
    const kb = bps / 1_000;
    const text = Number.isInteger(kb) ? String(kb) : kb.toFixed(1).replace(/\.0$/, "");
    return `${text} kb/s`;
  }
  return `${bps} b/s`;
}

export function sumMoney(amounts: string[]): bigint {
  return amounts.reduce((acc, a) => acc + BigInt(a), 0n);
}

/** Charge formula from accounting/pricing.erl. Integer only. Rejects above int64. */
export function charge(input: {
  setup: number;
  rateBps: number;
  rateByte: number;
  prioMult: number;
  reservedBps: number;
  durationS: number;
  bytes: number;
  priority: number;
}): { ok: true; total: bigint; setup: bigint; reserved: bigint; usage: bigint; priority: bigint } | { ok: false; reason: string } {
  if (input.reservedBps < 0 || input.durationS < 0 || input.bytes < 0) {
    return { ok: false, reason: "NEGATIVE_INPUT" };
  }
  if (input.priority < 0 || input.priority > 7) {
    return { ok: false, reason: "BAD_PRIORITY" };
  }
  const setup = BigInt(input.setup);
  const reserved = BigInt(input.reservedBps) * BigInt(input.rateBps) * BigInt(input.durationS);
  const usage = BigInt(input.bytes) * BigInt(input.rateByte);
  const priority = ((setup + reserved) * BigInt(input.prioMult) * BigInt(input.priority)) / 100n;
  const total = setup + reserved + usage + priority;
  if (total > INT64_MAX || reserved > INT64_MAX || usage > INT64_MAX) {
    return { ok: false, reason: "INT64_OVERFLOW" };
  }
  return { ok: true, total, setup, reserved, usage, priority };
}

export function internetChecksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    sum += (bytes[i]! << 8) | bytes[i + 1]!;
  }
  if (bytes.length % 2 === 1) sum += bytes[bytes.length - 1]! << 8;
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return (~sum) & 0xffff;
}

export function checksumValid(bytes: Uint8Array): boolean {
  let sum = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    sum += (bytes[i]! << 8) | bytes[i + 1]!;
  }
  if (bytes.length % 2 === 1) sum += bytes[bytes.length - 1]! << 8;
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return sum === 0xffff;
}

export function encodeFrame(
  fields: {
    magic?: number;
    version?: number;
    flags?: number;
    circuitId: number;
    namespaceId?: number;
    priority: number;
    qos: number;
    sequence: number;
    payloadLength?: number;
  },
  payload: Uint8Array,
): Uint8Array {
  const bytes = new Uint8Array(20 + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, fields.magic ?? CONSOLE_MAGIC);
  view.setUint8(2, fields.version ?? SCF_VERSION);
  view.setUint8(3, fields.flags ?? 0x02);
  view.setUint32(4, fields.circuitId);
  view.setUint16(8, fields.namespaceId ?? NAMESPACE_ID);
  view.setUint8(10, fields.priority);
  view.setUint8(11, fields.qos);
  view.setUint32(12, fields.sequence);
  view.setUint16(16, fields.payloadLength ?? payload.length);
  view.setUint16(18, 0);
  bytes.set(payload, 20);
  view.setUint16(18, internetChecksum(bytes));
  return bytes;
}

export function parseFrame(bytes: Uint8Array): ParsedFrame | null {
  if (bytes.length < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    magic: view.getUint16(0),
    version: view.getUint8(2),
    flags: view.getUint8(3),
    circuitId: view.getUint32(4),
    namespaceId: view.getUint16(8),
    priority: view.getUint8(10),
    qos: view.getUint8(11),
    sequence: view.getUint32(12),
    payloadLength: view.getUint16(16),
    checksum: view.getUint16(18),
    payloadBytes: bytes.length - 20,
  };
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexGroups(hex: string): string {
  return hex.replace(/(.{2})/g, "$1 ").trim();
}

function linkById(model: Model, id: string): Link | undefined {
  return model.links.find((l) => l.id === id);
}

export function neighbors(model: Model, node: NodeId, opts: { ignoreDown: boolean }): NodeId[] {
  const out: NodeId[] = [];
  for (const link of model.links) {
    if (opts.ignoreDown && link.down) continue;
    if (link.a === node) out.push(link.b);
    else if (link.b === node) out.push(link.a);
  }
  out.sort();
  return out;
}

function linkBetween(model: Model, a: NodeId, b: NodeId): Link | undefined {
  return model.links.find(
    (l) => (l.a === a && l.b === b) || (l.a === b && l.b === a),
  );
}

/** Shortest feasible path. Neighbor order is alphabetical, so the choice is deterministic. */
export function findPath(
  model: Model,
  src: NodeId,
  dst: NodeId,
  bps: number,
): { path: NodeId[]; linkIds: string[] } | null {
  if (src === dst) return null;
  const prev = new Map<NodeId, NodeId | null>();
  const queue: NodeId[] = [src];
  prev.set(src, null);
  while (queue.length) {
    const node = queue.shift()!;
    if (node === dst) break;
    for (const next of neighbors(model, node, { ignoreDown: true })) {
      if (prev.has(next)) continue;
      const link = linkBetween(model, node, next);
      if (!link) continue;
      if (link.reservedBps + bps > link.capacityBps) continue;
      prev.set(next, node);
      queue.push(next);
    }
  }
  if (!prev.has(dst)) return null;
  const path: NodeId[] = [];
  let cursor: NodeId | null = dst;
  while (cursor) {
    path.push(cursor);
    cursor = prev.get(cursor) ?? null;
  }
  path.reverse();
  const linkIds: string[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const link = linkBetween(model, path[i]!, path[i + 1]!);
    if (!link) return null;
    linkIds.push(link.id);
  }
  return { path, linkIds };
}

export function decide(
  model: Model,
  circuit: Pick<Circuit, "id" | "src" | "dst" | "requestedBps" | "priority" | "qos" | "tariffId">,
): Decision {
  const base = {
    circuitId: circuit.id,
    path: [] as NodeId[],
    linkIds: [] as string[],
    reservedBps: circuit.requestedBps,
    tariffId: circuit.tariffId,
  };
  if (circuit.src === circuit.dst) {
    return { ...base, action: "reject", reasonCode: "SAME_ENDPOINT" };
  }
  if (!Number.isInteger(circuit.requestedBps) || circuit.requestedBps <= 0) {
    return { ...base, action: "reject", reasonCode: "BAD_BANDWIDTH" };
  }
  if (circuit.priority < 0 || circuit.priority > 7) {
    return { ...base, action: "reject", reasonCode: "BAD_PRIORITY" };
  }
  if (circuit.qos < 0 || circuit.qos > 15) {
    return { ...base, action: "reject", reasonCode: "BAD_QOS" };
  }
  if (!model.tariffs.some((t) => t.id === circuit.tariffId)) {
    return { ...base, action: "reject", reasonCode: "UNKNOWN_TARIFF" };
  }
  const found = findPath(model, circuit.src, circuit.dst, circuit.requestedBps);
  if (!found) {
    const structural = findPath(
      { ...model, links: model.links.map((l) => ({ ...l, reservedBps: 0, down: l.down })) },
      circuit.src,
      circuit.dst,
      1,
    );
    return {
      ...base,
      action: "reject",
      reasonCode: structural ? "NO_CAPACITY" : "NO_ROUTE",
    };
  }
  return {
    ...base,
    action: "admit",
    path: found.path,
    linkIds: found.linkIds,
    reasonCode: "OK",
  };
}

function circuit(model: Model, cid: number): Circuit | undefined {
  return model.circuits.find((c) => c.id === cid);
}

function replaceCircuit(model: Model, next: Circuit): Model {
  return {
    ...model,
    circuits: model.circuits.map((c) => (c.id === next.id ? next : c)),
  };
}

function pushLedger(model: Model, event: LedgerEvent): Model {
  return { ...model, ledger: [...model.ledger, event] };
}

function note(
  model: Model,
  txId: string,
  command: string,
  result: TranscriptLine["result"],
  detail: string,
): Model {
  const line: TranscriptLine = {
    txId,
    second: model.seconds,
    command,
    result,
    detail,
  };
  const transcript = [...model.transcript, line].slice(-120);
  return { ...model, transcript };
}

function finish(
  model: Model,
  txId: string,
  command: string,
  ok: boolean,
  detail: string,
): { model: Model; result: Result } {
  const bumped = bumpTx(model, txId);
  const withNote = note(bumped, txId, command, ok ? "ok" : "error", detail);
  const applied = { ...withNote.applied, [txId]: { ok, detail } };
  return {
    model: { ...withNote, applied },
    result: { ok, replay: false, detail },
  };
}

function bumpTx(model: Model, txId: string): Model {
  const match = /^tx-(\d+)$/.exec(txId);
  if (!match) return model;
  const next = Number(match[1]) + 1;
  return { ...model, nextTx: Math.max(model.nextTx, next) };
}

function replay(
  model: Model,
  txId: string,
  prior: Applied,
): { model: Model; result: Result } {
  const withNote = note(
    model,
    txId,
    "replay",
    "replay",
    `Idempotent. Prior result kept: ${prior.detail}`,
  );
  return {
    model: withNote,
    result: { ok: prior.ok, replay: true, detail: prior.detail },
  };
}

function entriesFor(path: NodeId[]): TableEntry[] {
  return path.map((node, i) => ({
    node,
    ingress: i === 0 ? "edge" : path[i - 1]!,
    egress: i === path.length - 1 ? "edge" : path[i + 1]!,
  }));
}

function addReservation(model: Model, linkIds: string[], bps: number): Model | null {
  const next = model.links.map((l) => ({ ...l }));
  for (const id of linkIds) {
    const link = next.find((l) => l.id === id);
    if (!link || link.down) return null;
    if (link.reservedBps + bps > link.capacityBps) return null;
  }
  for (const id of linkIds) {
    const link = next.find((l) => l.id === id)!;
    link.reservedBps += bps;
  }
  return { ...model, links: next };
}

function subReservation(model: Model, linkIds: string[], bps: number): Model {
  const next = model.links.map((l) => ({ ...l }));
  for (const id of linkIds) {
    const link = next.find((l) => l.id === id);
    if (!link) continue;
    link.reservedBps = Math.max(0, link.reservedBps - bps);
  }
  return { ...model, links: next };
}

function commandLabel(cmd: Command): string {
  switch (cmd.type) {
    case "create":
      return `create ${cmd.src} ${cmd.dst} ${cmd.bps} p${cmd.priority} q${cmd.qos} t${cmd.tariffId}`;
    case "request":
      return `request ${cmd.cid}`;
    case "admit":
      return `admit ${cmd.cid}`;
    case "reject":
      return `reject ${cmd.cid}`;
    case "timeout":
      return `timeout ${cmd.cid}`;
    case "reserve":
      return `reserve ${cmd.cid}`;
    case "install":
      return cmd.faultAtHop === undefined
        ? `install ${cmd.cid}`
        : `install ${cmd.cid} fault-hop ${cmd.faultAtHop}`;
    case "activate":
      return `activate ${cmd.cid}`;
    case "drain":
      return `drain ${cmd.cid}`;
    case "release":
      return `release ${cmd.cid}`;
    case "fail":
      return `fail ${cmd.cid} ${cmd.reason}`;
    case "recycle":
      return `recycle ${cmd.cid}`;
    case "tick":
      return "tick 1s";
    case "inject":
      return `inject ${cmd.cid} ${cmd.payloadBytes}B${cmd.corrupt ? ` corrupt-${cmd.corrupt}` : ""}`;
    case "failLink":
      return `fail-link ${cmd.linkId}`;
    case "restoreLink":
      return `restore-link ${cmd.linkId}`;
    case "reviseTariff":
      return `revise-tariff ${cmd.tariffId} setup ${cmd.setup}`;
    case "pricingVector":
      return "pricing-vector";
    case "reset":
      return "reset";
  }
}

export function apply(model: Model, cmd: Command): { model: Model; result: Result } {
  const prior = model.applied[cmd.txId];
  if (prior) return replay(model, cmd.txId, prior);
  const label = commandLabel(cmd);

  switch (cmd.type) {
    case "reset": {
      const fresh = initialModel();
      return finish(
        { ...fresh, nextTx: 1 },
        cmd.txId,
        label,
        true,
        "Exchange reset to the reference topology.",
      );
    }
    case "pricingVector":
      return runPricingVector(model, cmd.txId);
    case "reviseTariff":
      return reviseTariff(model, cmd, label);
    case "tick":
      return tick(model, cmd, label);
    case "failLink":
      return failLink(model, cmd, label);
    case "restoreLink":
      return restoreLink(model, cmd, label);
    case "create":
      return createCircuit(model, cmd, label);
    case "inject":
      return inject(model, cmd, label);
    default:
      return transition(model, cmd, label);
  }
}

function createCircuit(
  model: Model,
  cmd: Extract<Command, { type: "create" }>,
  label: string,
): { model: Model; result: Result } {
  if (!NODES.includes(cmd.src) || !NODES.includes(cmd.dst)) {
    return finish(model, cmd.txId, label, false, "Unknown endpoint.");
  }
  if (cmd.src === cmd.dst) {
    return finish(model, cmd.txId, label, false, "SAME_ENDPOINT");
  }
  if (!Number.isInteger(cmd.bps) || cmd.bps <= 0) {
    return finish(model, cmd.txId, label, false, "BAD_BANDWIDTH");
  }
  if (!Number.isInteger(cmd.priority) || cmd.priority < 0 || cmd.priority > 7) {
    return finish(model, cmd.txId, label, false, "BAD_PRIORITY");
  }
  if (!Number.isInteger(cmd.qos) || cmd.qos < 0 || cmd.qos > 15) {
    return finish(model, cmd.txId, label, false, "BAD_QOS");
  }
  if (!model.tariffs.some((t) => t.id === cmd.tariffId)) {
    return finish(model, cmd.txId, label, false, "UNKNOWN_TARIFF");
  }
  const created: Circuit = {
    id: model.nextId,
    namespaceId: NAMESPACE_ID,
    lifecycle: 1,
    state: "FREE",
    src: cmd.src,
    dst: cmd.dst,
    requestedBps: cmd.bps,
    reservedBps: 0,
    priority: cmd.priority,
    qos: cmd.qos,
    tariffId: cmd.tariffId,
    tariffLock: null,
    path: [],
    linkIds: [],
    entries: [],
    installCompleted: false,
    heldReservation: false,
    durationS: 0,
    bytesSent: 0,
    bytesRecv: 0,
    packetsSent: 0,
    packetsRecv: 0,
    nextSequence: 1,
    nextEventSeq: 1,
    finalEmitted: false,
    decision: null,
  };
  const next: Model = {
    ...model,
    nextId: model.nextId + 1,
    circuits: [...model.circuits, created],
  };
  return finish(
    next,
    cmd.txId,
    label,
    true,
    `Circuit ${created.id} FREE. ${cmd.src}→${cmd.dst} ${formatBps(cmd.bps)}.`,
  );
}

function requireCircuit(
  model: Model,
  cid: number,
  txId: string,
  label: string,
): { model: Model; result: Result } | { circuit: Circuit } {
  const found = circuit(model, cid);
  if (!found) return finish(model, txId, label, false, `Unknown circuit ${cid}.`);
  return { circuit: found };
}

function transition(
  model: Model,
  cmd: Command,
  label: string,
): { model: Model; result: Result } {
  if (!("cid" in cmd)) return finish(model, cmd.txId, label, false, "Missing circuit.");
  const got = requireCircuit(model, cmd.cid, cmd.txId, label);
  if ("result" in got) return got;
  const c = got.circuit;

  switch (cmd.type) {
    case "request": {
      if (c.state !== "FREE") return illegal(model, cmd.txId, label, c.state);
      const nextC: Circuit = { ...c, state: "REQUESTED", decision: null };
      return finish(replaceCircuit(model, nextC), cmd.txId, label, true, `Circuit ${c.id} REQUESTED.`);
    }
    case "reject": {
      if (c.state !== "REQUESTED") return illegal(model, cmd.txId, label, c.state);
      const decision = decide(model, c);
      const nextC: Circuit = {
        ...c,
        state: "FREE",
        decision: { ...decision, action: "reject", reasonCode: decision.reasonCode === "OK" ? "OPERATOR_REJECT" : decision.reasonCode },
      };
      return finish(replaceCircuit(model, nextC), cmd.txId, label, true, `Circuit ${c.id} rejected → FREE.`);
    }
    case "timeout": {
      if (c.state !== "REQUESTED") return illegal(model, cmd.txId, label, c.state);
      const nextC: Circuit = { ...c, state: "FREE", decision: null };
      return finish(replaceCircuit(model, nextC), cmd.txId, label, true, `Circuit ${c.id} timeout → FREE.`);
    }
    case "admit": {
      if (c.state !== "REQUESTED") return illegal(model, cmd.txId, label, c.state);
      const decision = decide(model, c);
      if (decision.action !== "admit") {
        return finish(
          replaceCircuit(model, { ...c, decision }),
          cmd.txId,
          label,
          false,
          `Admission refused: ${decision.reasonCode}. State stays REQUESTED.`,
        );
      }
      const tariff = model.tariffs.find((t) => t.id === c.tariffId)!;
      const lock: TariffLock = {
        id: tariff.id,
        version: tariff.version,
        setup: tariff.setup,
        rateBps: tariff.rateBps,
        rateByte: tariff.rateByte,
        prioMult: tariff.prioMult,
      };
      let next: Model = replaceCircuit(model, {
        ...c,
        state: "ADMITTED",
        decision,
        path: decision.path,
        linkIds: decision.linkIds,
        tariffLock: lock,
      });
      const seq = c.nextEventSeq;
      next = pushLedger(next, {
        circuitId: c.id,
        lifecycle: c.lifecycle,
        seq,
        kind: "ESTABLISHMENT",
        amount: String(lock.setup),
        detail: `Setup fee. Tariff ${lock.id} version ${lock.version} locked.`,
        second: model.seconds,
      });
      next = replaceCircuit(next, {
        ...next.circuits.find((x) => x.id === c.id)!,
        nextEventSeq: seq + 1,
      });
      return finish(
        next,
        cmd.txId,
        label,
        true,
        `Circuit ${c.id} ADMITTED on ${decision.path.join("–")}. Tariff v${lock.version} locked. Setup ${lock.setup} minor.`,
      );
    }
    case "reserve": {
      if (c.state !== "ADMITTED") return illegal(model, cmd.txId, label, c.state);
      if (!c.linkIds.length) {
        return finish(model, cmd.txId, label, false, "No admitted path.");
      }
      const reserved = addReservation(model, c.linkIds, c.requestedBps);
      if (!reserved) {
        const alt = findPath(model, c.src, c.dst, c.requestedBps);
        const reroute: Decision | null = alt
          ? {
              circuitId: c.id,
              action: "reroute",
              path: alt.path,
              linkIds: alt.linkIds,
              reservedBps: c.requestedBps,
              tariffId: c.tariffId,
              reasonCode: "ALT_PATH",
            }
          : null;
        return finish(
          replaceCircuit(model, { ...c, decision: reroute ?? c.decision }),
          cmd.txId,
          label,
          false,
          reroute
            ? `NO_CAPACITY on ${c.path.join("–")}. Alternative ${reroute.path.join("–")} is feasible but there is no reroute transition. State stays ADMITTED.`
            : `NO_CAPACITY on ${c.path.join("–")}. State stays ADMITTED.`,
        );
      }
      const nextC: Circuit = {
        ...c,
        state: "RESERVED",
        reservedBps: c.requestedBps,
        heldReservation: true,
      };
      return finish(
        replaceCircuit(reserved, nextC),
        cmd.txId,
        label,
        true,
        `Circuit ${c.id} RESERVED ${formatBps(c.requestedBps)} on ${c.linkIds.join(", ")}.`,
      );
    }
    case "install": {
      if (c.state !== "RESERVED") return illegal(model, cmd.txId, label, c.state);
      const planned = entriesFor(c.path);
      const faultAt = cmd.faultAtHop;
      if (faultAt !== undefined && (faultAt < 0 || faultAt >= planned.length)) {
        return finish(model, cmd.txId, label, false, "Fault hop is outside the path.");
      }
      if (faultAt !== undefined) {
        const nextC: Circuit = {
          ...c,
          state: "FAILED",
          entries: [],
          installCompleted: false,
        };
        return finish(
          replaceCircuit(model, nextC),
          cmd.txId,
          label,
          true,
          `PARTIAL_INSTALL at hop ${faultAt} (${planned[faultAt]!.node}). Written entries rolled back. Circuit ${c.id} FAILED. Bandwidth still held.`,
        );
      }
      const nextC: Circuit = {
        ...c,
        state: "INSTALLED",
        entries: planned,
        installCompleted: true,
      };
      return finish(
        replaceCircuit(model, nextC),
        cmd.txId,
        label,
        true,
        `Circuit ${c.id} INSTALLED. ${planned.map((e) => `${e.node}:${e.ingress}→${e.egress}`).join(" · ")}`,
      );
    }
    case "activate": {
      if (c.state !== "INSTALLED") return illegal(model, cmd.txId, label, c.state);
      return finish(
        replaceCircuit(model, { ...c, state: "ACTIVE" }),
        cmd.txId,
        label,
        true,
        `Circuit ${c.id} ACTIVE. Accounting usage may begin.`,
      );
    }
    case "drain": {
      if (c.state !== "ACTIVE") return illegal(model, cmd.txId, label, c.state);
      return finish(
        replaceCircuit(model, { ...c, state: "DRAINING" }),
        cmd.txId,
        label,
        true,
        `Circuit ${c.id} DRAINING. New data frames will be dropped.`,
      );
    }
    case "fail": {
      if (c.state === "FREE" || c.state === "RELEASED" || c.state === "FAILED" || c.state === "REQUESTED") {
        return illegal(model, cmd.txId, label, c.state);
      }
      return finish(
        replaceCircuit(model, { ...c, state: "FAILED" }),
        cmd.txId,
        label,
        true,
        `Circuit ${c.id} FAILED (${cmd.reason}). ${c.heldReservation ? "Bandwidth still held." : "No bandwidth was held."}`,
      );
    }
    case "release": {
      if (c.state !== "DRAINING" && c.state !== "FAILED") {
        return illegal(model, cmd.txId, label, c.state);
      }
      if (c.finalEmitted) {
        return finish(model, cmd.txId, label, false, "Final accounting event already exists.");
      }
      let next = model;
      if (c.reservedBps > 0) next = subReservation(next, c.linkIds, c.reservedBps);
      const lock = c.tariffLock;
      let finalAmount = 0n;
      let finalDetail = "No tariff lock; final amount 0.";
      if (lock) {
        const priced = charge({
          setup: lock.setup,
          rateBps: lock.rateBps,
          rateByte: lock.rateByte,
          prioMult: lock.prioMult,
          reservedBps: c.reservedBps,
          durationS: c.durationS,
          bytes: c.bytesSent + c.bytesRecv,
          priority: c.priority,
        });
        if (!priced.ok) {
          return finish(model, cmd.txId, label, false, `Settlement rejected: ${priced.reason}. State unchanged.`);
        }
        finalAmount = priced.usage + priced.priority;
        finalDetail = `Usage ${priced.usage} + priority ${priced.priority} minor. Setup and reservation were already posted.`;
      }
      const seq = c.nextEventSeq;
      next = pushLedger(next, {
        circuitId: c.id,
        lifecycle: c.lifecycle,
        seq,
        kind: "FINAL",
        amount: finalAmount.toString(),
        detail: finalDetail,
        second: next.seconds,
      });
      const released: Circuit = {
        ...c,
        state: "RELEASED",
        reservedBps: 0,
        entries: [],
        finalEmitted: true,
        nextEventSeq: seq + 1,
      };
      return finish(
        replaceCircuit(next, released),
        cmd.txId,
        label,
        true,
        `Circuit ${c.id} RELEASED. Final ${finalAmount} minor. Resources returned once.`,
      );
    }
    case "recycle": {
      if (c.state !== "RELEASED") return illegal(model, cmd.txId, label, c.state);
      const recycled: Circuit = {
        ...c,
        state: "FREE",
        lifecycle: c.lifecycle + 1,
        reservedBps: 0,
        path: [],
        linkIds: [],
        entries: [],
        installCompleted: false,
        heldReservation: false,
        durationS: 0,
        bytesSent: 0,
        bytesRecv: 0,
        packetsSent: 0,
        packetsRecv: 0,
        nextSequence: 1,
        nextEventSeq: 1,
        finalEmitted: false,
        tariffLock: null,
        decision: null,
      };
      return finish(
        replaceCircuit(model, recycled),
        cmd.txId,
        label,
        true,
        `Circuit ${c.id} recycled → FREE. Lifecycle ${recycled.lifecycle}.`,
      );
    }
    default:
      return finish(model, cmd.txId, label, false, "Unhandled command.");
  }
}

function illegal(
  model: Model,
  txId: string,
  label: string,
  state: StateName,
): { model: Model; result: Result } {
  return finish(model, txId, label, false, `Illegal transition from ${state}.`);
}

function tick(
  model: Model,
  cmd: Extract<Command, { type: "tick" }>,
  label: string,
): { model: Model; result: Result } {
  let next: Model = { ...model, seconds: model.seconds + 1 };
  const charged: number[] = [];
  for (const c of model.circuits) {
    if (!c.heldReservation || c.reservedBps <= 0 || !HELD.has(c.state) || !c.tariffLock) continue;
    const lock = c.tariffLock;
    const amount = BigInt(c.reservedBps) * BigInt(lock.rateBps) * 1n;
    if (amount > INT64_MAX) {
      return finish(model, cmd.txId, label, false, `INT64_OVERFLOW on circuit ${c.id}. Clock not advanced.`);
    }
    const seq = c.nextEventSeq;
    next = pushLedger(next, {
      circuitId: c.id,
      lifecycle: c.lifecycle,
      seq,
      kind: "RESERVATION",
      amount: amount.toString(),
      detail: `${c.reservedBps} bps × ${lock.rateBps} minor/bps/s × 1s`,
      second: next.seconds,
    });
    next = replaceCircuit(next, {
      ...next.circuits.find((x) => x.id === c.id)!,
      durationS: c.durationS + 1,
      nextEventSeq: seq + 1,
    });
    charged.push(c.id);
  }
  const detail = charged.length
    ? `t=${next.seconds}s. Reservation posted for ${charged.map((id) => `#${id}`).join(", ")}.`
    : `t=${next.seconds}s. No held reservations.`;
  return finish(next, cmd.txId, label, true, detail);
}

function failLink(
  model: Model,
  cmd: Extract<Command, { type: "failLink" }>,
  label: string,
): { model: Model; result: Result } {
  const link = linkById(model, cmd.linkId);
  if (!link) return finish(model, cmd.txId, label, false, "Unknown link.");
  if (link.down) return finish(model, cmd.txId, label, true, `${link.id} was already down.`);
  let next: Model = {
    ...model,
    links: model.links.map((l) => (l.id === link.id ? { ...l, down: true } : l)),
  };
  const hit: number[] = [];
  for (const c of model.circuits) {
    if (!c.linkIds.includes(link.id)) continue;
    if (c.state === "FREE" || c.state === "RELEASED" || c.state === "FAILED" || c.state === "REQUESTED") {
      continue;
    }
    if (c.state === "ADMITTED") {
      next = replaceCircuit(next, { ...next.circuits.find((x) => x.id === c.id)!, decision: {
        circuitId: c.id,
        action: "reject",
        path: c.path,
        linkIds: c.linkIds,
        reservedBps: c.requestedBps,
        tariffId: c.tariffId,
        reasonCode: "LINK_DOWN",
      } });
      continue;
    }
    const current = next.circuits.find((x) => x.id === c.id)!;
    next = replaceCircuit(next, { ...current, state: "FAILED" });
    hit.push(c.id);
  }
  return finish(
    next,
    cmd.txId,
    label,
    true,
    hit.length
      ? `${link.id} down. Failed circuits ${hit.map((id) => `#${id}`).join(", ")}. Bandwidth still held until release.`
      : `${link.id} down. No installed circuit to fail.`,
  );
}

function restoreLink(
  model: Model,
  cmd: Extract<Command, { type: "restoreLink" }>,
  label: string,
): { model: Model; result: Result } {
  const link = linkById(model, cmd.linkId);
  if (!link) return finish(model, cmd.txId, label, false, "Unknown link.");
  if (!link.down) return finish(model, cmd.txId, label, true, `${link.id} was already up.`);
  const next: Model = {
    ...model,
    links: model.links.map((l) => (l.id === link.id ? { ...l, down: false } : l)),
  };
  return finish(
    next,
    cmd.txId,
    label,
    true,
    `${link.id} restored. Failed circuits are not automatically rebuilt.`,
  );
}

function reviseTariff(
  model: Model,
  cmd: Extract<Command, { type: "reviseTariff" }>,
  label: string,
): { model: Model; result: Result } {
  const tariff = model.tariffs.find((t) => t.id === cmd.tariffId);
  if (!tariff) return finish(model, cmd.txId, label, false, "UNKNOWN_TARIFF");
  if (!Number.isInteger(cmd.setup) || cmd.setup < 0) {
    return finish(model, cmd.txId, label, false, "Setup fee must be a non-negative integer minor unit.");
  }
  const next: Model = {
    ...model,
    tariffs: model.tariffs.map((t) =>
      t.id === tariff.id ? { ...t, version: t.version + 1, setup: cmd.setup } : t,
    ),
  };
  return finish(
    next,
    cmd.txId,
    label,
    true,
    `Tariff ${tariff.id} version ${tariff.version + 1}. Already-admitted circuits keep version ${tariff.version}.`,
  );
}

function inject(
  model: Model,
  cmd: Extract<Command, { type: "inject" }>,
  label: string,
): { model: Model; result: Result } {
  const got = requireCircuit(model, cmd.cid, cmd.txId, label);
  if ("result" in got) return got;
  const c = got.circuit;
  if (!Number.isInteger(cmd.payloadBytes) || cmd.payloadBytes < 0 || cmd.payloadBytes > 2048) {
    return finish(model, cmd.txId, label, false, "Payload must be 0..2048 bytes.");
  }
  const payload = new Uint8Array(cmd.payloadBytes);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 17 + c.id) & 0xff;
  let frame = encodeFrame(
    {
      circuitId: c.id,
      priority: c.priority,
      qos: c.qos,
      sequence: c.nextSequence,
      magic: cmd.corrupt === "magic" ? 0x0000 : CONSOLE_MAGIC,
      version: cmd.corrupt === "version" ? 0x02 : SCF_VERSION,
      payloadLength: cmd.corrupt === "length" ? cmd.payloadBytes + 1 : cmd.payloadBytes,
    },
    payload,
  );
  if (cmd.corrupt === "checksum") {
    frame = frame.slice();
    frame[18] = frame[18]! ^ 0xff;
  }
  const parsed = parseFrame(frame);
  const drop = classifyDrop(model, c, frame, parsed);
  const lastFrame: LastFrame = {
    hex: toHex(frame),
    accepted: drop === null,
    reason: drop ?? "ACCEPTED",
    circuitId: c.id,
    parsed,
  };
  let next: Model = { ...model, lastFrame };
  const sender: Circuit = { ...c, nextSequence: c.nextSequence + 1 };
  if (drop === null) {
    next = replaceCircuit(next, {
      ...sender,
      bytesSent: c.bytesSent + cmd.payloadBytes,
      packetsSent: c.packetsSent + 1,
    });
    return finish(
      next,
      cmd.txId,
      label,
      true,
      `Accepted ${cmd.payloadBytes} B on circuit ${c.id}. seq ${c.nextSequence}.`,
    );
  }
  next = replaceCircuit(next, sender);
  return finish(next, cmd.txId, label, false, `Dropped: ${drop}.`);
}

function classifyDrop(
  model: Model,
  c: Circuit,
  frame: Uint8Array,
  parsed: ParsedFrame | null,
): string | null {
  if (!parsed || frame.length < 20) return "TRUNCATED";
  if (parsed.magic !== CONSOLE_MAGIC) return "MAGIC";
  if (parsed.version !== SCF_VERSION) return "VERSION";
  if (parsed.circuitId === 0) return "CIRCUIT_ID";
  if (parsed.payloadLength !== frame.length - 20) return "LENGTH";
  if (!checksumValid(frame)) return "CHECKSUM";
  if ((parsed.flags & 0x02) === 0) return "NOT_DATA";
  if (c.state !== "ACTIVE") return `ADMISSION_${c.state}`;
  const installed = c.entries.length > 0 && c.installCompleted;
  if (!installed) return "NO_TABLE";
  const onFabric = model.circuits.find((x) => x.id === parsed.circuitId && x.namespaceId === parsed.namespaceId);
  if (!onFabric || onFabric.state !== "ACTIVE") return "NO_TABLE";
  return null;
}

function runPricingVector(model: Model, txId: string): { model: Model; result: Result } {
  const steps: Command[] = [];
  const idGuess = model.nextId;
  let tx = model.nextTx;
  const take = (): string => {
    const id = `tx-${tx}`;
    tx += 1;
    return id;
  };
  steps.push({
    type: "create",
    txId: take(),
    src: "N",
    dst: "S",
    bps: 100,
    priority: 2,
    qos: 1,
    tariffId: 1,
  });
  const cid = idGuess;
  steps.push({ type: "request", txId: take(), cid });
  steps.push({ type: "admit", txId: take(), cid });
  steps.push({ type: "reserve", txId: take(), cid });
  steps.push({ type: "install", txId: take(), cid });
  steps.push({ type: "activate", txId: take(), cid });
  steps.push({ type: "inject", txId: take(), cid, payloadBytes: 50 });
  for (let i = 0; i < 10; i++) steps.push({ type: "tick", txId: take(), });
  steps.push({ type: "drain", txId: take(), cid });
  steps.push({ type: "release", txId: take(), cid });

  let cursor = model;
  for (let i = 0; i < steps.length; i++) {
    const step = { ...steps[i]!, txId: `${txId}-step-${i}` } as Command;
    const out = apply(cursor, step);
    if (!out.result.ok) {
      return finish(
        model,
        txId,
        "pricing-vector",
        false,
        `Stopped at ${commandLabel(step)}: ${out.result.detail}`,
      );
    }
    cursor = out.model;
  }
  const events = cursor.ledger.filter((e) => e.circuitId === cid);
  const total = sumMoney(events.map((e) => e.amount));
  const detail =
    total === 2500n
      ? `pricing.erl basic_charge_test reproduced. Circuit ${cid} settled 2500 minor (0.2500).`
      : `Vector finished but total is ${total} minor, not 2500. This is a console defect if tariffs were unchanged.`;
  const merged: Model = {
    ...cursor,
    nextTx: Math.max(cursor.nextTx, tx),
  };
  return finish(merged, txId, "pricing-vector", total === 2500n, detail);
}

export type Invariant = { id: string; ok: boolean; detail: string };

export function checkInvariants(model: Model): Invariant[] {
  const checks: Invariant[] = [];
  const push = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });

  const seen = new Set<string>();
  let dup = false;
  for (const c of model.circuits) {
    if (c.state === "FREE") continue;
    const key = `${c.namespaceId}:${c.id}`;
    if (seen.has(key)) dup = true;
    seen.add(key);
  }
  push("identity", !dup && model.circuits.every((c) => c.id !== 0), "No circuit id 0. Non-FREE identities unique.");

  let freeOk = true;
  let heldOk = true;
  let tableOk = true;
  let finalOk = true;
  for (const c of model.circuits) {
    if (c.state === "FREE" && (c.reservedBps !== 0 || c.entries.length !== 0)) freeOk = false;
    if (
      (c.state === "RESERVED" || c.state === "INSTALLED" || c.state === "ACTIVE" || c.state === "DRAINING") &&
      c.reservedBps <= 0
    ) {
      heldOk = false;
    }
    if (c.state === "FAILED" && c.heldReservation && c.reservedBps <= 0) heldOk = false;
    const shouldHaveTable =
      FORWARDING.has(c.state) || (c.state === "FAILED" && c.installCompleted);
    if (shouldHaveTable !== c.entries.length > 0 && !(c.state === "FAILED" && !c.installCompleted)) {
      if (shouldHaveTable && c.entries.length === 0) tableOk = false;
      if (!shouldHaveTable && c.entries.length > 0) tableOk = false;
    }
    if (c.state === "RELEASED" && !c.finalEmitted) finalOk = false;
    if (c.state !== "RELEASED" && c.finalEmitted) finalOk = false;
  }
  push("free-zero", freeOk, "FREE circuits hold no bandwidth and no table entries.");
  push("reservation-held", heldOk, "From RESERVED until release, bandwidth stays positive. Includes FAILED after a successful reserve.");
  push("tables", tableOk, "Forwarding entries exist only after a completed install, and are cleared on release or rolled-back install.");
  push("final-once", finalOk, "RELEASED iff exactly one final accounting event for this lifecycle.");

  let linkOk = true;
  let over = false;
  for (const link of model.links) {
    const sum = model.circuits
      .filter((c) => c.reservedBps > 0 && c.linkIds.includes(link.id) && c.state !== "RELEASED" && c.state !== "FREE")
      .reduce((acc, c) => acc + c.reservedBps, 0);
    if (sum !== link.reservedBps) linkOk = false;
    if (link.reservedBps < 0 || link.reservedBps > link.capacityBps) over = true;
  }
  push("conservation", linkOk, "Each link's reserved_bps equals the sum of circuits still holding that link.");
  push("no-overcommit", !over, "reserved_bps ≤ capacity_bps on every link.");

  const keys = new Set<string>();
  let ledgerDup = false;
  let badAmount = false;
  for (const e of model.ledger) {
    const key = `${e.circuitId}:${e.lifecycle}:${e.seq}`;
    if (keys.has(key)) ledgerDup = true;
    keys.add(key);
    if (!/^-?\d+$/.test(e.amount)) badAmount = true;
  }
  push("ledger-idempotent", !ledgerDup && !badAmount, "Accounting events unique by (circuit, lifecycle, seq). Amounts are integers.");

  let lockOk = true;
  for (const c of model.circuits) {
    const needs =
      c.state !== "FREE" && c.state !== "REQUESTED";
    if (needs && !c.tariffLock) lockOk = false;
    if ((c.state === "FREE" || c.state === "REQUESTED") && c.tariffLock) lockOk = false;
  }
  push("tariff-lock", lockOk, "Tariff version locks at ADMITTED and clears on recycle.");

  return checks;
}

export type ActionId =
  | "request"
  | "admit"
  | "reject"
  | "timeout"
  | "reserve"
  | "install"
  | "install-fault"
  | "activate"
  | "drain"
  | "release"
  | "fail"
  | "recycle";

export type ActionOption = { id: ActionId; label: string; enabled: boolean; reason: string };

export function actionsFor(model: Model, c: Circuit): ActionOption[] {
  const decision = c.state === "REQUESTED" ? decide(model, c) : c.decision;
  const admitReason =
    c.state !== "REQUESTED"
      ? `Illegal from ${c.state}.`
      : decision?.action === "admit"
        ? `Path ${decision.path.join("–")}.`
        : `Refused: ${decision?.reasonCode ?? "NO_DECISION"}.`;
  return [
    {
      id: "request",
      label: "Request",
      enabled: c.state === "FREE",
      reason: c.state === "FREE" ? "FREE → REQUESTED" : `Illegal from ${c.state}.`,
    },
    {
      id: "admit",
      label: "Admit",
      enabled: c.state === "REQUESTED" && decision?.action === "admit",
      reason: admitReason,
    },
    {
      id: "reject",
      label: "Reject",
      enabled: c.state === "REQUESTED",
      reason: c.state === "REQUESTED" ? "REQUESTED → FREE" : `Illegal from ${c.state}.`,
    },
    {
      id: "timeout",
      label: "Timeout",
      enabled: c.state === "REQUESTED",
      reason: c.state === "REQUESTED" ? "REQUESTED → FREE" : `Illegal from ${c.state}.`,
    },
    {
      id: "reserve",
      label: "Reserve",
      enabled: c.state === "ADMITTED",
      reason: c.state === "ADMITTED" ? `Lock ${formatBps(c.requestedBps)} on ${c.path.join("–") || "path"}.` : `Illegal from ${c.state}.`,
    },
    {
      id: "install",
      label: "Install",
      enabled: c.state === "RESERVED",
      reason: c.state === "RESERVED" ? "Write forwarding entries." : `Illegal from ${c.state}.`,
    },
    {
      id: "install-fault",
      label: "Fault last hop",
      enabled: c.state === "RESERVED" && c.path.length > 1,
      reason:
        c.state === "RESERVED"
          ? "Rollback test. Not a measured hardware fault."
          : `Illegal from ${c.state}.`,
    },
    {
      id: "activate",
      label: "Activate",
      enabled: c.state === "INSTALLED",
      reason: c.state === "INSTALLED" ? "INSTALLED → ACTIVE" : `Illegal from ${c.state}.`,
    },
    {
      id: "drain",
      label: "Drain",
      enabled: c.state === "ACTIVE",
      reason: c.state === "ACTIVE" ? "ACTIVE → DRAINING" : `Illegal from ${c.state}.`,
    },
    {
      id: "release",
      label: "Release",
      enabled: c.state === "DRAINING" || c.state === "FAILED",
      reason:
        c.state === "DRAINING" || c.state === "FAILED"
          ? "Return bandwidth once and post the final event."
          : `Illegal from ${c.state}.`,
    },
    {
      id: "fail",
      label: "Fail",
      enabled: c.state !== "FREE" && c.state !== "REQUESTED" && c.state !== "RELEASED" && c.state !== "FAILED",
      reason:
        c.state === "REQUESTED"
          ? "spec/state_machine.md has no REQUESTED → FAILED. Use reject or timeout. TLA+ is looser; this console follows the spec."
          : "Explicit failure. Bandwidth, if held, stays held.",
    },
    {
      id: "recycle",
      label: "Recycle",
      enabled: c.state === "RELEASED",
      reason: c.state === "RELEASED" ? "RELEASED → FREE" : `Illegal from ${c.state}.`,
    },
  ];
}

export function pathLabel(path: NodeId[]): string {
  return path.length ? path.join("–") : "—";
}

export function linkEndpoints(link: Link): string {
  return `${link.a}–${link.b}`;
}

export function settlement(model: Model, c: Circuit): bigint | null {
  const events = model.ledger.filter((e) => e.circuitId === c.id && e.lifecycle === c.lifecycle);
  if (!events.length) return null;
  return sumMoney(events.map((e) => e.amount));
}
