import assert from "node:assert/strict";
import test from "node:test";
import {
  apply,
  charge,
  checkInvariants,
  checksumValid,
  encodeFrame,
  initialModel,
  parseFrame,
  type Command,
  type Model,
} from "./model.ts";

function allOk(model: Model) {
  const bad = checkInvariants(model).filter((c) => !c.ok);
  assert.deepEqual(bad, [], bad.map((b) => `${b.id}: ${b.detail}`).join("; "));
}

let tx = 1;
function cmd<T extends Command["type"]>(
  type: T,
  rest: Omit<Extract<Command, { type: T }>, "type" | "txId">,
): Extract<Command, { type: T }> {
  return { type, txId: `tx-${tx++}`, ...rest } as Extract<Command, { type: T }>;
}

function run(model: Model, command: Command) {
  const out = apply(model, command);
  assert.equal(out.result.ok, true, out.result.detail);
  allOk(out.model);
  return out.model;
}

test("pricing.erl basic_charge_test vector", () => {
  const priced = charge({
    setup: 1000,
    rateBps: 1,
    rateByte: 2,
    prioMult: 10,
    reservedBps: 100,
    durationS: 10,
    bytes: 50,
    priority: 2,
  });
  assert.equal(priced.ok, true);
  if (priced.ok) assert.equal(priced.total, 2500n);
});

test("lifecycle, conservation, replay, and the published pricing vector", () => {
  tx = 1;
  let model = initialModel();
  model = run(
    model,
    cmd("create", { src: "W", dst: "E", bps: 12_000_000, priority: 3, qos: 1, tariffId: 1 }),
  );
  model = run(model, cmd("create", { src: "W", dst: "E", bps: 12_000_000, priority: 1, qos: 0, tariffId: 1 }));
  model = run(model, cmd("request", { cid: 1 }));
  model = run(model, cmd("request", { cid: 2 }));
  model = run(model, cmd("admit", { cid: 1 }));
  model = run(model, cmd("admit", { cid: 2 }));
  assert.deepEqual(model.circuits[0]!.path, ["W", "E"]);
  assert.deepEqual(model.circuits[1]!.path, ["W", "E"]);
  const reserve1 = cmd("reserve", { cid: 1 });
  model = run(model, reserve1);
  const failed = apply(model, cmd("reserve", { cid: 2 }));
  assert.equal(failed.result.ok, false);
  assert.match(failed.result.detail, /NO_CAPACITY/);
  allOk(failed.model);
  assert.equal(failed.model.links.find((l) => l.id === "W-E")!.reservedBps, 12_000_000);

  const replayed = apply(failed.model, reserve1);
  assert.equal(replayed.result.replay, true);
  assert.equal(replayed.model.links.find((l) => l.id === "W-E")!.reservedBps, 12_000_000);

  model = failed.model;
  model = run(model, cmd("install", { cid: 1 }));
  model = run(model, cmd("activate", { cid: 1 }));
  model = run(model, cmd("inject", { cid: 1, payloadBytes: 64 }));
  assert.equal(model.circuits[0]!.packetsSent, 1);
  const magic = apply(model, cmd("inject", { cid: 1, payloadBytes: 8, corrupt: "magic" }));
  assert.equal(magic.result.ok, false);
  assert.match(magic.result.detail, /MAGIC/);
  assert.equal(magic.model.circuits[0]!.packetsSent, 1);

  model = run(magic.model, cmd("drain", { cid: 1 }));
  const dropped = apply(model, cmd("inject", { cid: 1, payloadBytes: 4 }));
  assert.match(dropped.result.detail, /ADMISSION_DRAINING/);
  model = run(dropped.model, cmd("release", { cid: 1 }));
  assert.equal(model.links.find((l) => l.id === "W-E")!.reservedBps, 0);
  const second = apply(model, cmd("release", { cid: 1 }));
  assert.equal(second.result.ok, false);
  assert.equal(model.ledger.filter((e) => e.kind === "FINAL" && e.circuitId === 1).length, 1);
});

test("partial install rolls table entries back and keeps bandwidth", () => {
  tx = 100;
  let model = initialModel();
  model = run(
    model,
    cmd("create", { src: "N", dst: "S", bps: 2_000_000, priority: 0, qos: 0, tariffId: 2 }),
  );
  model = run(model, cmd("request", { cid: 1 }));
  model = run(model, cmd("admit", { cid: 1 }));
  model = run(model, cmd("reserve", { cid: 1 }));
  model = run(model, cmd("install", { cid: 1, faultAtHop: 2 }));
  const c = model.circuits[0]!;
  assert.equal(c.state, "FAILED");
  assert.equal(c.entries.length, 0);
  assert.equal(c.reservedBps, 2_000_000);
  assert.ok(model.links.some((l) => l.reservedBps === 2_000_000));
  model = run(model, cmd("release", { cid: 1 }));
  assert.ok(model.links.every((l) => l.reservedBps === 0));
});

test("frame checksum round-trip and spec header width", () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5]);
  const frame = encodeFrame(
    { circuitId: 7, priority: 3, qos: 1, sequence: 9 },
    payload,
  );
  assert.equal(frame.length, 25);
  assert.equal(frame[0], 0x5c);
  assert.equal(frame[1], 0xf1);
  assert.equal(checksumValid(frame), true);
  const parsed = parseFrame(frame);
  assert.equal(parsed?.circuitId, 7);
  assert.equal(parsed?.payloadLength, 5);
  assert.equal(parsed?.sequence, 9);
});

test("pricing vector command matches 2500 minor units", () => {
  const out = apply(initialModel(), { type: "pricingVector", txId: "tx-1" });
  assert.equal(out.result.ok, true, out.result.detail);
  allOk(out.model);
  const total = out.model.ledger
    .filter((e) => e.circuitId === 1)
    .reduce((acc, e) => acc + BigInt(e.amount), 0n);
  assert.equal(total, 2500n);
});

test("tariff revision does not move an admitted lock", () => {
  tx = 400;
  let model = initialModel();
  model = run(model, cmd("create", { src: "N", dst: "E", bps: 1000, priority: 1, qos: 1, tariffId: 1 }));
  model = run(model, cmd("request", { cid: 1 }));
  model = run(model, cmd("admit", { cid: 1 }));
  assert.equal(model.circuits[0]!.tariffLock?.setup, 1000);
  model = run(model, cmd("reviseTariff", { tariffId: 1, setup: 9000 }));
  assert.equal(model.tariffs[0]!.version, 2);
  assert.equal(model.circuits[0]!.tariffLock?.version, 1);
  assert.equal(model.circuits[0]!.tariffLock?.setup, 1000);
});

test("illegal request from ACTIVE is refused", () => {
  const model = initialModel();
  const created = apply(model, {
    type: "create",
    txId: "tx-1",
    src: "N",
    dst: "W",
    bps: 10,
    priority: 0,
    qos: 0,
    tariffId: 1,
  });
  const again = apply(created.model, { type: "activate", txId: "tx-2", cid: 1 });
  assert.equal(again.result.ok, false);
  assert.match(again.result.detail, /Illegal/);
});
