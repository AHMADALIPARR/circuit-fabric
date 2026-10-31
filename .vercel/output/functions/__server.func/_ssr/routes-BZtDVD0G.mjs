import { i as __toESM } from "../_runtime.mjs";
import { a as require_jsx_runtime, o as require_react } from "../_libs/@radix-ui/react-collection+[...].mjs";
import { a as BadgeCheck, i as Cable, r as ScrollText, t as Waypoints } from "../_libs/lucide-react.mjs";
import { i as TabsTrigger, n as TabsContent, r as TabsList, t as Tabs } from "../_libs/radix-ui__react-tabs.mjs";
import { n as create, t as persist } from "../_libs/zustand.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-BZtDVD0G.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
/**
* spec/circuit_frame.md writes Magic 0xSCF1. `S` is not a hex digit, and the
* P4 literal has not been compiled here, so the 16-bit wire value is
* unresolved. 0x5CF1 is a console-local stand-in for exercising length,
* checksum, and admission. It is not a reading of the spec.
*/
var CONSOLE_MAGIC = 23793;
var INT64_MAX = (1n << 63n) - 1n;
var NODES = [
	"N",
	"E",
	"S",
	"W"
];
var HELD = /* @__PURE__ */ new Set([
	"RESERVED",
	"INSTALLED",
	"ACTIVE",
	"DRAINING",
	"FAILED"
]);
var FORWARDING = /* @__PURE__ */ new Set([
	"INSTALLED",
	"ACTIVE",
	"DRAINING"
]);
function initialTariffs() {
	return [{
		id: 1,
		version: 1,
		name: "T1 reference",
		setup: 1e3,
		rateBps: 1,
		rateByte: 2,
		prioMult: 10,
		origin: "accounting/pricing.erl basic_charge_test"
	}, {
		id: 2,
		version: 1,
		name: "T2 bulk",
		setup: 2500,
		rateBps: 2,
		rateByte: 1,
		prioMult: 5,
		origin: "Console tariff. Not defined in pricing.erl."
	}];
}
function initialLinks() {
	return [
		{
			id: "N-E",
			a: "N",
			b: "E",
			capacityBps: 1e7,
			reservedBps: 0,
			down: false
		},
		{
			id: "N-W",
			a: "N",
			b: "W",
			capacityBps: 1e7,
			reservedBps: 0,
			down: false
		},
		{
			id: "S-E",
			a: "S",
			b: "E",
			capacityBps: 1e7,
			reservedBps: 0,
			down: false
		},
		{
			id: "S-W",
			a: "S",
			b: "W",
			capacityBps: 1e7,
			reservedBps: 0,
			down: false
		},
		{
			id: "W-E",
			a: "W",
			b: "E",
			capacityBps: 2e7,
			reservedBps: 0,
			down: false
		}
	];
}
function initialModel() {
	return {
		seconds: 0,
		nextId: 1,
		nextTx: 1,
		links: initialLinks(),
		tariffs: initialTariffs(),
		circuits: [],
		ledger: [],
		transcript: [{
			txId: "boot",
			second: 0,
			command: "exchange boot",
			result: "ok",
			detail: "Reference topology loaded. Capacities are chosen so exhaustion is observable. They are not measured hardware."
		}],
		applied: {},
		lastFrame: null
	};
}
function formatMinor(amount) {
	const neg = amount.startsWith("-");
	const padded = (neg ? amount.slice(1) : amount).padStart(5, "0");
	const whole = padded.slice(0, -4) || "0";
	const frac = padded.slice(-4);
	return `${neg ? "−" : ""}${whole}.${frac}`;
}
function formatBps(bps) {
	const abs = Math.abs(bps);
	if (abs >= 1e6) {
		const mb = bps / 1e6;
		return `${Number.isInteger(mb) ? String(mb) : mb.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} Mb/s`;
	}
	if (abs >= 1e3) {
		const kb = bps / 1e3;
		return `${Number.isInteger(kb) ? String(kb) : kb.toFixed(1).replace(/\.0$/, "")} kb/s`;
	}
	return `${bps} b/s`;
}
function sumMoney(amounts) {
	return amounts.reduce((acc, a) => acc + BigInt(a), 0n);
}
/** Charge formula from accounting/pricing.erl. Integer only. Rejects above int64. */
function charge(input) {
	if (input.reservedBps < 0 || input.durationS < 0 || input.bytes < 0) return {
		ok: false,
		reason: "NEGATIVE_INPUT"
	};
	if (input.priority < 0 || input.priority > 7) return {
		ok: false,
		reason: "BAD_PRIORITY"
	};
	const setup = BigInt(input.setup);
	const reserved = BigInt(input.reservedBps) * BigInt(input.rateBps) * BigInt(input.durationS);
	const usage = BigInt(input.bytes) * BigInt(input.rateByte);
	const priority = (setup + reserved) * BigInt(input.prioMult) * BigInt(input.priority) / 100n;
	const total = setup + reserved + usage + priority;
	if (total > INT64_MAX || reserved > INT64_MAX || usage > INT64_MAX) return {
		ok: false,
		reason: "INT64_OVERFLOW"
	};
	return {
		ok: true,
		total,
		setup,
		reserved,
		usage,
		priority
	};
}
function internetChecksum(bytes) {
	let sum = 0;
	for (let i = 0; i + 1 < bytes.length; i += 2) sum += bytes[i] << 8 | bytes[i + 1];
	if (bytes.length % 2 === 1) sum += bytes[bytes.length - 1] << 8;
	while (sum > 65535) sum = (sum & 65535) + (sum >>> 16);
	return ~sum & 65535;
}
function checksumValid(bytes) {
	let sum = 0;
	for (let i = 0; i + 1 < bytes.length; i += 2) sum += bytes[i] << 8 | bytes[i + 1];
	if (bytes.length % 2 === 1) sum += bytes[bytes.length - 1] << 8;
	while (sum > 65535) sum = (sum & 65535) + (sum >>> 16);
	return sum === 65535;
}
function encodeFrame(fields, payload) {
	const bytes = new Uint8Array(20 + payload.length);
	const view = new DataView(bytes.buffer);
	view.setUint16(0, fields.magic ?? 23793);
	view.setUint8(2, fields.version ?? 1);
	view.setUint8(3, fields.flags ?? 2);
	view.setUint32(4, fields.circuitId);
	view.setUint16(8, fields.namespaceId ?? 0);
	view.setUint8(10, fields.priority);
	view.setUint8(11, fields.qos);
	view.setUint32(12, fields.sequence);
	view.setUint16(16, fields.payloadLength ?? payload.length);
	view.setUint16(18, 0);
	bytes.set(payload, 20);
	view.setUint16(18, internetChecksum(bytes));
	return bytes;
}
function parseFrame(bytes) {
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
		payloadBytes: bytes.length - 20
	};
}
function toHex(bytes) {
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexGroups(hex) {
	return hex.replace(/(.{2})/g, "$1 ").trim();
}
function linkById(model, id) {
	return model.links.find((l) => l.id === id);
}
function neighbors(model, node, opts) {
	const out = [];
	for (const link of model.links) {
		if (opts.ignoreDown && link.down) continue;
		if (link.a === node) out.push(link.b);
		else if (link.b === node) out.push(link.a);
	}
	out.sort();
	return out;
}
function linkBetween(model, a, b) {
	return model.links.find((l) => l.a === a && l.b === b || l.a === b && l.b === a);
}
/** Shortest feasible path. Neighbor order is alphabetical, so the choice is deterministic. */
function findPath(model, src, dst, bps) {
	if (src === dst) return null;
	const prev = /* @__PURE__ */ new Map();
	const queue = [src];
	prev.set(src, null);
	while (queue.length) {
		const node = queue.shift();
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
	const path = [];
	let cursor = dst;
	while (cursor) {
		path.push(cursor);
		cursor = prev.get(cursor) ?? null;
	}
	path.reverse();
	const linkIds = [];
	for (let i = 0; i < path.length - 1; i++) {
		const link = linkBetween(model, path[i], path[i + 1]);
		if (!link) return null;
		linkIds.push(link.id);
	}
	return {
		path,
		linkIds
	};
}
function decide(model, circuit) {
	const base = {
		circuitId: circuit.id,
		path: [],
		linkIds: [],
		reservedBps: circuit.requestedBps,
		tariffId: circuit.tariffId
	};
	if (circuit.src === circuit.dst) return {
		...base,
		action: "reject",
		reasonCode: "SAME_ENDPOINT"
	};
	if (!Number.isInteger(circuit.requestedBps) || circuit.requestedBps <= 0) return {
		...base,
		action: "reject",
		reasonCode: "BAD_BANDWIDTH"
	};
	if (circuit.priority < 0 || circuit.priority > 7) return {
		...base,
		action: "reject",
		reasonCode: "BAD_PRIORITY"
	};
	if (circuit.qos < 0 || circuit.qos > 15) return {
		...base,
		action: "reject",
		reasonCode: "BAD_QOS"
	};
	if (!model.tariffs.some((t) => t.id === circuit.tariffId)) return {
		...base,
		action: "reject",
		reasonCode: "UNKNOWN_TARIFF"
	};
	const found = findPath(model, circuit.src, circuit.dst, circuit.requestedBps);
	if (!found) {
		const structural = findPath({
			...model,
			links: model.links.map((l) => ({
				...l,
				reservedBps: 0,
				down: l.down
			}))
		}, circuit.src, circuit.dst, 1);
		return {
			...base,
			action: "reject",
			reasonCode: structural ? "NO_CAPACITY" : "NO_ROUTE"
		};
	}
	return {
		...base,
		action: "admit",
		path: found.path,
		linkIds: found.linkIds,
		reasonCode: "OK"
	};
}
function circuit(model, cid) {
	return model.circuits.find((c) => c.id === cid);
}
function replaceCircuit(model, next) {
	return {
		...model,
		circuits: model.circuits.map((c) => c.id === next.id ? next : c)
	};
}
function pushLedger(model, event) {
	return {
		...model,
		ledger: [...model.ledger, event]
	};
}
function note(model, txId, command, result, detail) {
	const line = {
		txId,
		second: model.seconds,
		command,
		result,
		detail
	};
	const transcript = [...model.transcript, line].slice(-120);
	return {
		...model,
		transcript
	};
}
function finish(model, txId, command, ok, detail) {
	const withNote = note(bumpTx(model, txId), txId, command, ok ? "ok" : "error", detail);
	const applied = {
		...withNote.applied,
		[txId]: {
			ok,
			detail
		}
	};
	return {
		model: {
			...withNote,
			applied
		},
		result: {
			ok,
			replay: false,
			detail
		}
	};
}
function bumpTx(model, txId) {
	const match = /^tx-(\d+)$/.exec(txId);
	if (!match) return model;
	const next = Number(match[1]) + 1;
	return {
		...model,
		nextTx: Math.max(model.nextTx, next)
	};
}
function replay(model, txId, prior) {
	return {
		model: note(model, txId, "replay", "replay", `Idempotent. Prior result kept: ${prior.detail}`),
		result: {
			ok: prior.ok,
			replay: true,
			detail: prior.detail
		}
	};
}
function entriesFor(path) {
	return path.map((node, i) => ({
		node,
		ingress: i === 0 ? "edge" : path[i - 1],
		egress: i === path.length - 1 ? "edge" : path[i + 1]
	}));
}
function addReservation(model, linkIds, bps) {
	const next = model.links.map((l) => ({ ...l }));
	for (const id of linkIds) {
		const link = next.find((l) => l.id === id);
		if (!link || link.down) return null;
		if (link.reservedBps + bps > link.capacityBps) return null;
	}
	for (const id of linkIds) {
		const link = next.find((l) => l.id === id);
		link.reservedBps += bps;
	}
	return {
		...model,
		links: next
	};
}
function subReservation(model, linkIds, bps) {
	const next = model.links.map((l) => ({ ...l }));
	for (const id of linkIds) {
		const link = next.find((l) => l.id === id);
		if (!link) continue;
		link.reservedBps = Math.max(0, link.reservedBps - bps);
	}
	return {
		...model,
		links: next
	};
}
function commandLabel(cmd) {
	switch (cmd.type) {
		case "create": return `create ${cmd.src} ${cmd.dst} ${cmd.bps} p${cmd.priority} q${cmd.qos} t${cmd.tariffId}`;
		case "request": return `request ${cmd.cid}`;
		case "admit": return `admit ${cmd.cid}`;
		case "reject": return `reject ${cmd.cid}`;
		case "timeout": return `timeout ${cmd.cid}`;
		case "reserve": return `reserve ${cmd.cid}`;
		case "install": return cmd.faultAtHop === void 0 ? `install ${cmd.cid}` : `install ${cmd.cid} fault-hop ${cmd.faultAtHop}`;
		case "activate": return `activate ${cmd.cid}`;
		case "drain": return `drain ${cmd.cid}`;
		case "release": return `release ${cmd.cid}`;
		case "fail": return `fail ${cmd.cid} ${cmd.reason}`;
		case "recycle": return `recycle ${cmd.cid}`;
		case "tick": return "tick 1s";
		case "inject": return `inject ${cmd.cid} ${cmd.payloadBytes}B${cmd.corrupt ? ` corrupt-${cmd.corrupt}` : ""}`;
		case "failLink": return `fail-link ${cmd.linkId}`;
		case "restoreLink": return `restore-link ${cmd.linkId}`;
		case "reviseTariff": return `revise-tariff ${cmd.tariffId} setup ${cmd.setup}`;
		case "pricingVector": return "pricing-vector";
		case "reset": return "reset";
	}
}
function apply(model, cmd) {
	const prior = model.applied[cmd.txId];
	if (prior) return replay(model, cmd.txId, prior);
	const label = commandLabel(cmd);
	switch (cmd.type) {
		case "reset": return finish({
			...initialModel(),
			nextTx: 1
		}, cmd.txId, label, true, "Exchange reset to the reference topology.");
		case "pricingVector": return runPricingVector(model, cmd.txId);
		case "reviseTariff": return reviseTariff(model, cmd, label);
		case "tick": return tick(model, cmd, label);
		case "failLink": return failLink(model, cmd, label);
		case "restoreLink": return restoreLink(model, cmd, label);
		case "create": return createCircuit(model, cmd, label);
		case "inject": return inject(model, cmd, label);
		default: return transition(model, cmd, label);
	}
}
function createCircuit(model, cmd, label) {
	if (!NODES.includes(cmd.src) || !NODES.includes(cmd.dst)) return finish(model, cmd.txId, label, false, "Unknown endpoint.");
	if (cmd.src === cmd.dst) return finish(model, cmd.txId, label, false, "SAME_ENDPOINT");
	if (!Number.isInteger(cmd.bps) || cmd.bps <= 0) return finish(model, cmd.txId, label, false, "BAD_BANDWIDTH");
	if (!Number.isInteger(cmd.priority) || cmd.priority < 0 || cmd.priority > 7) return finish(model, cmd.txId, label, false, "BAD_PRIORITY");
	if (!Number.isInteger(cmd.qos) || cmd.qos < 0 || cmd.qos > 15) return finish(model, cmd.txId, label, false, "BAD_QOS");
	if (!model.tariffs.some((t) => t.id === cmd.tariffId)) return finish(model, cmd.txId, label, false, "UNKNOWN_TARIFF");
	const created = {
		id: model.nextId,
		namespaceId: 0,
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
		decision: null
	};
	return finish({
		...model,
		nextId: model.nextId + 1,
		circuits: [...model.circuits, created]
	}, cmd.txId, label, true, `Circuit ${created.id} FREE. ${cmd.src}→${cmd.dst} ${formatBps(cmd.bps)}.`);
}
function requireCircuit(model, cid, txId, label) {
	const found = circuit(model, cid);
	if (!found) return finish(model, txId, label, false, `Unknown circuit ${cid}.`);
	return { circuit: found };
}
function transition(model, cmd, label) {
	if (!("cid" in cmd)) return finish(model, cmd.txId, label, false, "Missing circuit.");
	const got = requireCircuit(model, cmd.cid, cmd.txId, label);
	if ("result" in got) return got;
	const c = got.circuit;
	switch (cmd.type) {
		case "request":
			if (c.state !== "FREE") return illegal(model, cmd.txId, label, c.state);
			return finish(replaceCircuit(model, {
				...c,
				state: "REQUESTED",
				decision: null
			}), cmd.txId, label, true, `Circuit ${c.id} REQUESTED.`);
		case "reject": {
			if (c.state !== "REQUESTED") return illegal(model, cmd.txId, label, c.state);
			const decision = decide(model, c);
			return finish(replaceCircuit(model, {
				...c,
				state: "FREE",
				decision: {
					...decision,
					action: "reject",
					reasonCode: decision.reasonCode === "OK" ? "OPERATOR_REJECT" : decision.reasonCode
				}
			}), cmd.txId, label, true, `Circuit ${c.id} rejected → FREE.`);
		}
		case "timeout":
			if (c.state !== "REQUESTED") return illegal(model, cmd.txId, label, c.state);
			return finish(replaceCircuit(model, {
				...c,
				state: "FREE",
				decision: null
			}), cmd.txId, label, true, `Circuit ${c.id} timeout → FREE.`);
		case "admit": {
			if (c.state !== "REQUESTED") return illegal(model, cmd.txId, label, c.state);
			const decision = decide(model, c);
			if (decision.action !== "admit") return finish(replaceCircuit(model, {
				...c,
				decision
			}), cmd.txId, label, false, `Admission refused: ${decision.reasonCode}. State stays REQUESTED.`);
			const tariff = model.tariffs.find((t) => t.id === c.tariffId);
			const lock = {
				id: tariff.id,
				version: tariff.version,
				setup: tariff.setup,
				rateBps: tariff.rateBps,
				rateByte: tariff.rateByte,
				prioMult: tariff.prioMult
			};
			let next = replaceCircuit(model, {
				...c,
				state: "ADMITTED",
				decision,
				path: decision.path,
				linkIds: decision.linkIds,
				tariffLock: lock
			});
			const seq = c.nextEventSeq;
			next = pushLedger(next, {
				circuitId: c.id,
				lifecycle: c.lifecycle,
				seq,
				kind: "ESTABLISHMENT",
				amount: String(lock.setup),
				detail: `Setup fee. Tariff ${lock.id} version ${lock.version} locked.`,
				second: model.seconds
			});
			next = replaceCircuit(next, {
				...next.circuits.find((x) => x.id === c.id),
				nextEventSeq: seq + 1
			});
			return finish(next, cmd.txId, label, true, `Circuit ${c.id} ADMITTED on ${decision.path.join("–")}. Tariff v${lock.version} locked. Setup ${lock.setup} minor.`);
		}
		case "reserve": {
			if (c.state !== "ADMITTED") return illegal(model, cmd.txId, label, c.state);
			if (!c.linkIds.length) return finish(model, cmd.txId, label, false, "No admitted path.");
			const reserved = addReservation(model, c.linkIds, c.requestedBps);
			if (!reserved) {
				const alt = findPath(model, c.src, c.dst, c.requestedBps);
				const reroute = alt ? {
					circuitId: c.id,
					action: "reroute",
					path: alt.path,
					linkIds: alt.linkIds,
					reservedBps: c.requestedBps,
					tariffId: c.tariffId,
					reasonCode: "ALT_PATH"
				} : null;
				return finish(replaceCircuit(model, {
					...c,
					decision: reroute ?? c.decision
				}), cmd.txId, label, false, reroute ? `NO_CAPACITY on ${c.path.join("–")}. Alternative ${reroute.path.join("–")} is feasible but there is no reroute transition. State stays ADMITTED.` : `NO_CAPACITY on ${c.path.join("–")}. State stays ADMITTED.`);
			}
			return finish(replaceCircuit(reserved, {
				...c,
				state: "RESERVED",
				reservedBps: c.requestedBps,
				heldReservation: true
			}), cmd.txId, label, true, `Circuit ${c.id} RESERVED ${formatBps(c.requestedBps)} on ${c.linkIds.join(", ")}.`);
		}
		case "install": {
			if (c.state !== "RESERVED") return illegal(model, cmd.txId, label, c.state);
			const planned = entriesFor(c.path);
			const faultAt = cmd.faultAtHop;
			if (faultAt !== void 0 && (faultAt < 0 || faultAt >= planned.length)) return finish(model, cmd.txId, label, false, "Fault hop is outside the path.");
			if (faultAt !== void 0) return finish(replaceCircuit(model, {
				...c,
				state: "FAILED",
				entries: [],
				installCompleted: false
			}), cmd.txId, label, true, `PARTIAL_INSTALL at hop ${faultAt} (${planned[faultAt].node}). Written entries rolled back. Circuit ${c.id} FAILED. Bandwidth still held.`);
			return finish(replaceCircuit(model, {
				...c,
				state: "INSTALLED",
				entries: planned,
				installCompleted: true
			}), cmd.txId, label, true, `Circuit ${c.id} INSTALLED. ${planned.map((e) => `${e.node}:${e.ingress}→${e.egress}`).join(" · ")}`);
		}
		case "activate":
			if (c.state !== "INSTALLED") return illegal(model, cmd.txId, label, c.state);
			return finish(replaceCircuit(model, {
				...c,
				state: "ACTIVE"
			}), cmd.txId, label, true, `Circuit ${c.id} ACTIVE. Accounting usage may begin.`);
		case "drain":
			if (c.state !== "ACTIVE") return illegal(model, cmd.txId, label, c.state);
			return finish(replaceCircuit(model, {
				...c,
				state: "DRAINING"
			}), cmd.txId, label, true, `Circuit ${c.id} DRAINING. New data frames will be dropped.`);
		case "fail":
			if (c.state === "FREE" || c.state === "RELEASED" || c.state === "FAILED" || c.state === "REQUESTED") return illegal(model, cmd.txId, label, c.state);
			return finish(replaceCircuit(model, {
				...c,
				state: "FAILED"
			}), cmd.txId, label, true, `Circuit ${c.id} FAILED (${cmd.reason}). ${c.heldReservation ? "Bandwidth still held." : "No bandwidth was held."}`);
		case "release": {
			if (c.state !== "DRAINING" && c.state !== "FAILED") return illegal(model, cmd.txId, label, c.state);
			if (c.finalEmitted) return finish(model, cmd.txId, label, false, "Final accounting event already exists.");
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
					priority: c.priority
				});
				if (!priced.ok) return finish(model, cmd.txId, label, false, `Settlement rejected: ${priced.reason}. State unchanged.`);
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
				second: next.seconds
			});
			const released = {
				...c,
				state: "RELEASED",
				reservedBps: 0,
				entries: [],
				finalEmitted: true,
				nextEventSeq: seq + 1
			};
			return finish(replaceCircuit(next, released), cmd.txId, label, true, `Circuit ${c.id} RELEASED. Final ${finalAmount} minor. Resources returned once.`);
		}
		case "recycle": {
			if (c.state !== "RELEASED") return illegal(model, cmd.txId, label, c.state);
			const recycled = {
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
				decision: null
			};
			return finish(replaceCircuit(model, recycled), cmd.txId, label, true, `Circuit ${c.id} recycled → FREE. Lifecycle ${recycled.lifecycle}.`);
		}
		default: return finish(model, cmd.txId, label, false, "Unhandled command.");
	}
}
function illegal(model, txId, label, state) {
	return finish(model, txId, label, false, `Illegal transition from ${state}.`);
}
function tick(model, cmd, label) {
	let next = {
		...model,
		seconds: model.seconds + 1
	};
	const charged = [];
	for (const c of model.circuits) {
		if (!c.heldReservation || c.reservedBps <= 0 || !HELD.has(c.state) || !c.tariffLock) continue;
		const lock = c.tariffLock;
		const amount = BigInt(c.reservedBps) * BigInt(lock.rateBps) * 1n;
		if (amount > INT64_MAX) return finish(model, cmd.txId, label, false, `INT64_OVERFLOW on circuit ${c.id}. Clock not advanced.`);
		const seq = c.nextEventSeq;
		next = pushLedger(next, {
			circuitId: c.id,
			lifecycle: c.lifecycle,
			seq,
			kind: "RESERVATION",
			amount: amount.toString(),
			detail: `${c.reservedBps} bps × ${lock.rateBps} minor/bps/s × 1s`,
			second: next.seconds
		});
		next = replaceCircuit(next, {
			...next.circuits.find((x) => x.id === c.id),
			durationS: c.durationS + 1,
			nextEventSeq: seq + 1
		});
		charged.push(c.id);
	}
	const detail = charged.length ? `t=${next.seconds}s. Reservation posted for ${charged.map((id) => `#${id}`).join(", ")}.` : `t=${next.seconds}s. No held reservations.`;
	return finish(next, cmd.txId, label, true, detail);
}
function failLink(model, cmd, label) {
	const link = linkById(model, cmd.linkId);
	if (!link) return finish(model, cmd.txId, label, false, "Unknown link.");
	if (link.down) return finish(model, cmd.txId, label, true, `${link.id} was already down.`);
	let next = {
		...model,
		links: model.links.map((l) => l.id === link.id ? {
			...l,
			down: true
		} : l)
	};
	const hit = [];
	for (const c of model.circuits) {
		if (!c.linkIds.includes(link.id)) continue;
		if (c.state === "FREE" || c.state === "RELEASED" || c.state === "FAILED" || c.state === "REQUESTED") continue;
		if (c.state === "ADMITTED") {
			next = replaceCircuit(next, {
				...next.circuits.find((x) => x.id === c.id),
				decision: {
					circuitId: c.id,
					action: "reject",
					path: c.path,
					linkIds: c.linkIds,
					reservedBps: c.requestedBps,
					tariffId: c.tariffId,
					reasonCode: "LINK_DOWN"
				}
			});
			continue;
		}
		const current = next.circuits.find((x) => x.id === c.id);
		next = replaceCircuit(next, {
			...current,
			state: "FAILED"
		});
		hit.push(c.id);
	}
	return finish(next, cmd.txId, label, true, hit.length ? `${link.id} down. Failed circuits ${hit.map((id) => `#${id}`).join(", ")}. Bandwidth still held until release.` : `${link.id} down. No installed circuit to fail.`);
}
function restoreLink(model, cmd, label) {
	const link = linkById(model, cmd.linkId);
	if (!link) return finish(model, cmd.txId, label, false, "Unknown link.");
	if (!link.down) return finish(model, cmd.txId, label, true, `${link.id} was already up.`);
	return finish({
		...model,
		links: model.links.map((l) => l.id === link.id ? {
			...l,
			down: false
		} : l)
	}, cmd.txId, label, true, `${link.id} restored. Failed circuits are not automatically rebuilt.`);
}
function reviseTariff(model, cmd, label) {
	const tariff = model.tariffs.find((t) => t.id === cmd.tariffId);
	if (!tariff) return finish(model, cmd.txId, label, false, "UNKNOWN_TARIFF");
	if (!Number.isInteger(cmd.setup) || cmd.setup < 0) return finish(model, cmd.txId, label, false, "Setup fee must be a non-negative integer minor unit.");
	return finish({
		...model,
		tariffs: model.tariffs.map((t) => t.id === tariff.id ? {
			...t,
			version: t.version + 1,
			setup: cmd.setup
		} : t)
	}, cmd.txId, label, true, `Tariff ${tariff.id} version ${tariff.version + 1}. Already-admitted circuits keep version ${tariff.version}.`);
}
function inject(model, cmd, label) {
	const got = requireCircuit(model, cmd.cid, cmd.txId, label);
	if ("result" in got) return got;
	const c = got.circuit;
	if (!Number.isInteger(cmd.payloadBytes) || cmd.payloadBytes < 0 || cmd.payloadBytes > 2048) return finish(model, cmd.txId, label, false, "Payload must be 0..2048 bytes.");
	const payload = new Uint8Array(cmd.payloadBytes);
	for (let i = 0; i < payload.length; i++) payload[i] = i * 17 + c.id & 255;
	let frame = encodeFrame({
		circuitId: c.id,
		priority: c.priority,
		qos: c.qos,
		sequence: c.nextSequence,
		magic: cmd.corrupt === "magic" ? 0 : CONSOLE_MAGIC,
		version: cmd.corrupt === "version" ? 2 : 1,
		payloadLength: cmd.corrupt === "length" ? cmd.payloadBytes + 1 : cmd.payloadBytes
	}, payload);
	if (cmd.corrupt === "checksum") {
		frame = frame.slice();
		frame[18] = frame[18] ^ 255;
	}
	const parsed = parseFrame(frame);
	const drop = classifyDrop(model, c, frame, parsed);
	const lastFrame = {
		hex: toHex(frame),
		accepted: drop === null,
		reason: drop ?? "ACCEPTED",
		circuitId: c.id,
		parsed
	};
	let next = {
		...model,
		lastFrame
	};
	const sender = {
		...c,
		nextSequence: c.nextSequence + 1
	};
	if (drop === null) {
		next = replaceCircuit(next, {
			...sender,
			bytesSent: c.bytesSent + cmd.payloadBytes,
			packetsSent: c.packetsSent + 1
		});
		return finish(next, cmd.txId, label, true, `Accepted ${cmd.payloadBytes} B on circuit ${c.id}. seq ${c.nextSequence}.`);
	}
	next = replaceCircuit(next, sender);
	return finish(next, cmd.txId, label, false, `Dropped: ${drop}.`);
}
function classifyDrop(model, c, frame, parsed) {
	if (!parsed || frame.length < 20) return "TRUNCATED";
	if (parsed.magic !== 23793) return "MAGIC";
	if (parsed.version !== 1) return "VERSION";
	if (parsed.circuitId === 0) return "CIRCUIT_ID";
	if (parsed.payloadLength !== frame.length - 20) return "LENGTH";
	if (!checksumValid(frame)) return "CHECKSUM";
	if ((parsed.flags & 2) === 0) return "NOT_DATA";
	if (c.state !== "ACTIVE") return `ADMISSION_${c.state}`;
	if (!(c.entries.length > 0 && c.installCompleted)) return "NO_TABLE";
	const onFabric = model.circuits.find((x) => x.id === parsed.circuitId && x.namespaceId === parsed.namespaceId);
	if (!onFabric || onFabric.state !== "ACTIVE") return "NO_TABLE";
	return null;
}
function runPricingVector(model, txId) {
	const steps = [];
	const idGuess = model.nextId;
	let tx = model.nextTx;
	const take = () => {
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
		tariffId: 1
	});
	const cid = idGuess;
	steps.push({
		type: "request",
		txId: take(),
		cid
	});
	steps.push({
		type: "admit",
		txId: take(),
		cid
	});
	steps.push({
		type: "reserve",
		txId: take(),
		cid
	});
	steps.push({
		type: "install",
		txId: take(),
		cid
	});
	steps.push({
		type: "activate",
		txId: take(),
		cid
	});
	steps.push({
		type: "inject",
		txId: take(),
		cid,
		payloadBytes: 50
	});
	for (let i = 0; i < 10; i++) steps.push({
		type: "tick",
		txId: take()
	});
	steps.push({
		type: "drain",
		txId: take(),
		cid
	});
	steps.push({
		type: "release",
		txId: take(),
		cid
	});
	let cursor = model;
	for (let i = 0; i < steps.length; i++) {
		const step = {
			...steps[i],
			txId: `${txId}-step-${i}`
		};
		const out = apply(cursor, step);
		if (!out.result.ok) return finish(model, txId, "pricing-vector", false, `Stopped at ${commandLabel(step)}: ${out.result.detail}`);
		cursor = out.model;
	}
	const total = sumMoney(cursor.ledger.filter((e) => e.circuitId === cid).map((e) => e.amount));
	const detail = total === 2500n ? `pricing.erl basic_charge_test reproduced. Circuit ${cid} settled 2500 minor (0.2500).` : `Vector finished but total is ${total} minor, not 2500. This is a console defect if tariffs were unchanged.`;
	return finish({
		...cursor,
		nextTx: Math.max(cursor.nextTx, tx)
	}, txId, "pricing-vector", total === 2500n, detail);
}
function checkInvariants(model) {
	const checks = [];
	const push = (id, ok, detail) => checks.push({
		id,
		ok,
		detail
	});
	const seen = /* @__PURE__ */ new Set();
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
		if ((c.state === "RESERVED" || c.state === "INSTALLED" || c.state === "ACTIVE" || c.state === "DRAINING") && c.reservedBps <= 0) heldOk = false;
		if (c.state === "FAILED" && c.heldReservation && c.reservedBps <= 0) heldOk = false;
		const shouldHaveTable = FORWARDING.has(c.state) || c.state === "FAILED" && c.installCompleted;
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
		if (model.circuits.filter((c) => c.reservedBps > 0 && c.linkIds.includes(link.id) && c.state !== "RELEASED" && c.state !== "FREE").reduce((acc, c) => acc + c.reservedBps, 0) !== link.reservedBps) linkOk = false;
		if (link.reservedBps < 0 || link.reservedBps > link.capacityBps) over = true;
	}
	push("conservation", linkOk, "Each link's reserved_bps equals the sum of circuits still holding that link.");
	push("no-overcommit", !over, "reserved_bps ≤ capacity_bps on every link.");
	const keys = /* @__PURE__ */ new Set();
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
		if (c.state !== "FREE" && c.state !== "REQUESTED" && !c.tariffLock) lockOk = false;
		if ((c.state === "FREE" || c.state === "REQUESTED") && c.tariffLock) lockOk = false;
	}
	push("tariff-lock", lockOk, "Tariff version locks at ADMITTED and clears on recycle.");
	return checks;
}
function actionsFor(model, c) {
	const decision = c.state === "REQUESTED" ? decide(model, c) : c.decision;
	const admitReason = c.state !== "REQUESTED" ? `Illegal from ${c.state}.` : decision?.action === "admit" ? `Path ${decision.path.join("–")}.` : `Refused: ${decision?.reasonCode ?? "NO_DECISION"}.`;
	return [
		{
			id: "request",
			label: "Request",
			enabled: c.state === "FREE",
			reason: c.state === "FREE" ? "FREE → REQUESTED" : `Illegal from ${c.state}.`
		},
		{
			id: "admit",
			label: "Admit",
			enabled: c.state === "REQUESTED" && decision?.action === "admit",
			reason: admitReason
		},
		{
			id: "reject",
			label: "Reject",
			enabled: c.state === "REQUESTED",
			reason: c.state === "REQUESTED" ? "REQUESTED → FREE" : `Illegal from ${c.state}.`
		},
		{
			id: "timeout",
			label: "Timeout",
			enabled: c.state === "REQUESTED",
			reason: c.state === "REQUESTED" ? "REQUESTED → FREE" : `Illegal from ${c.state}.`
		},
		{
			id: "reserve",
			label: "Reserve",
			enabled: c.state === "ADMITTED",
			reason: c.state === "ADMITTED" ? `Lock ${formatBps(c.requestedBps)} on ${c.path.join("–") || "path"}.` : `Illegal from ${c.state}.`
		},
		{
			id: "install",
			label: "Install",
			enabled: c.state === "RESERVED",
			reason: c.state === "RESERVED" ? "Write forwarding entries." : `Illegal from ${c.state}.`
		},
		{
			id: "install-fault",
			label: "Fault last hop",
			enabled: c.state === "RESERVED" && c.path.length > 1,
			reason: c.state === "RESERVED" ? "Rollback test. Not a measured hardware fault." : `Illegal from ${c.state}.`
		},
		{
			id: "activate",
			label: "Activate",
			enabled: c.state === "INSTALLED",
			reason: c.state === "INSTALLED" ? "INSTALLED → ACTIVE" : `Illegal from ${c.state}.`
		},
		{
			id: "drain",
			label: "Drain",
			enabled: c.state === "ACTIVE",
			reason: c.state === "ACTIVE" ? "ACTIVE → DRAINING" : `Illegal from ${c.state}.`
		},
		{
			id: "release",
			label: "Release",
			enabled: c.state === "DRAINING" || c.state === "FAILED",
			reason: c.state === "DRAINING" || c.state === "FAILED" ? "Return bandwidth once and post the final event." : `Illegal from ${c.state}.`
		},
		{
			id: "fail",
			label: "Fail",
			enabled: c.state !== "FREE" && c.state !== "REQUESTED" && c.state !== "RELEASED" && c.state !== "FAILED",
			reason: c.state === "REQUESTED" ? "spec/state_machine.md has no REQUESTED → FAILED. Use reject or timeout. TLA+ is looser; this console follows the spec." : "Explicit failure. Bandwidth, if held, stays held."
		},
		{
			id: "recycle",
			label: "Recycle",
			enabled: c.state === "RELEASED",
			reason: c.state === "RELEASED" ? "RELEASED → FREE" : `Illegal from ${c.state}.`
		}
	];
}
function pathLabel(path) {
	return path.length ? path.join("–") : "—";
}
function linkEndpoints(link) {
	return `${link.a}–${link.b}`;
}
function settlement(model, c) {
	const events = model.ledger.filter((e) => e.circuitId === c.id && e.lifecycle === c.lifecycle);
	if (!events.length) return null;
	return sumMoney(events.map((e) => e.amount));
}
function usable(model) {
	return !!model && Array.isArray(model.links) && Array.isArray(model.circuits) && Array.isArray(model.ledger);
}
var useFabric = create()(persist((set, get) => ({
	model: initialModel(),
	hydrated: false,
	tab: "fabric",
	selectedId: null,
	setTab: (tab) => set({ tab }),
	select: (selectedId) => set({ selectedId }),
	dispatch: (partial) => {
		const current = get().model;
		const txId = partial.txId ?? `tx-${current.nextTx}`;
		const out = apply(current, {
			...partial,
			txId
		});
		const patch = { model: out.model };
		if (partial.type === "create" && out.result.ok) {
			patch.selectedId = out.model.nextId - 1;
			patch.tab = "circuits";
		}
		if (partial.type === "reset" && out.result.ok) {
			patch.selectedId = null;
			patch.tab = "fabric";
		}
		if (partial.type === "pricingVector") patch.tab = "ledger";
		set(patch);
		return out.result;
	}
}), {
	name: "scf-exchange-v1",
	partialize: (state) => ({
		model: state.model,
		tab: state.tab,
		selectedId: state.selectedId
	}),
	merge: (persisted, current) => {
		const saved = persisted;
		if (!usable(saved?.model)) return current;
		return {
			...current,
			model: saved.model,
			tab: saved.tab ?? current.tab,
			selectedId: saved.selectedId ?? null
		};
	},
	onRehydrateStorage: () => (_state, error) => {
		if (error) useFabric.setState({
			model: initialModel(),
			hydrated: true
		});
		else useFabric.setState({ hydrated: true });
	}
}));
var primaryBtn = "inline-flex min-h-11 items-center justify-center rounded-sm bg-brass px-4 text-sm font-medium text-brass-ink";
var ghostBtn = "inline-flex min-h-11 items-center justify-center rounded-sm border border-line bg-surface px-3 text-sm text-fg";
var choiceBtn = "inline-flex min-h-11 items-center justify-center rounded-sm border border-line bg-surface px-1 text-sm text-fg";
var field = "min-h-11 w-full rounded-sm border border-line bg-raised px-3 text-base text-fg";
var PRESETS = [
	{
		bps: 100,
		label: "100 b/s",
		note: "Pricing sample"
	},
	{
		bps: 2e6,
		label: "2 Mb/s",
		note: "Fits an edge"
	},
	{
		bps: 6e6,
		label: "6 Mb/s",
		note: "Leaves a second path"
	},
	{
		bps: 12e6,
		label: "12 Mb/s",
		note: "Oversubscribes 10 Mb/s"
	}
];
var HAPPY = [
	"request",
	"admit",
	"reserve",
	"install",
	"activate",
	"drain",
	"release",
	"recycle"
];
var POS = {
	N: {
		x: 160,
		y: 42
	},
	E: {
		x: 274,
		y: 148
	},
	S: {
		x: 160,
		y: 254
	},
	W: {
		x: 46,
		y: 148
	}
};
function Console() {
	const hydrated = useFabric((s) => s.hydrated);
	(0, import_react.useEffect)(() => {
		if (useFabric.persist.hasHydrated()) useFabric.setState({ hydrated: true });
		return useFabric.persist.onFinishHydration(() => {
			useFabric.setState({ hydrated: true });
		});
	}, []);
	if (!hydrated) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Boot, {});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Exchange, {});
}
function Boot() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "flex h-dvh flex-col bg-bg text-fg",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "border-t-2 border-brass px-4 pt-5",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "font-mono text-xs tracking-widest text-brass",
					children: "SCF · NS 0"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h1", {
					className: "mt-1 text-xl font-medium leading-tight tracking-tight",
					children: ["Sovereign", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "block",
						children: "Circuit Fabric"
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 text-sm text-muted",
					children: "Opening the exchange record."
				})
			]
		})
	});
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
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "flex h-dvh flex-col bg-bg text-fg",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "border-t-2 border-brass px-4 pt-4 pb-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-start justify-between gap-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "min-w-0",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "font-mono text-xs tracking-widest text-brass",
									children: "SCF · NS 0"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h1", {
									className: "mt-1 text-xl font-medium leading-tight tracking-tight",
									children: ["Sovereign", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "block",
										children: "Circuit Fabric"
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "mt-1 text-sm text-muted",
									children: "Phase I model, running here. Toolchains not executed."
								})
							]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: primaryBtn,
							onClick: () => dispatch({ type: "tick" }),
							children: "+1 s"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-4",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-baseline justify-between gap-3 font-mono text-xs",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "text-muted",
								children: [
									"t = ",
									model.seconds,
									" s"
								]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [formatBps(reserved), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "text-muted",
								children: [" / ", formatBps(capacity)]
							})] })]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "mt-2 h-1 bg-raised",
							"aria-hidden": "true",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "h-1 bg-brass",
								style: { width: `${capacity === 0 ? 0 : Math.min(100, reserved / capacity * 100)}%` }
							})
						})]
					}),
					broken && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 text-sm",
						children: "Stored state breaks an invariant. Reset it from Evidence."
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Tabs, {
				className: "flex min-h-0 flex-1 flex-col",
				value: tab,
				onValueChange: (value) => setTab(value),
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(TabsList, {
					className: "grid grid-cols-4 border-b border-line",
					"aria-label": "Exchange sections",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabButton, {
							value: "fabric",
							icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Waypoints, { className: "size-4" }),
							label: "Fabric"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabButton, {
							value: "circuits",
							icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Cable, { className: "size-4" }),
							label: "Circuits"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabButton, {
							value: "ledger",
							icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScrollText, { className: "size-4" }),
							label: "Ledger"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabButton, {
							value: "evidence",
							icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BadgeCheck, { className: "size-4" }),
							label: "Evidence"
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "min-h-0 flex-1 overflow-y-auto px-4 py-4",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabsContent, {
							value: "fabric",
							tabIndex: -1,
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FabricView, {})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabsContent, {
							value: "circuits",
							tabIndex: -1,
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CircuitsView, {})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabsContent, {
							value: "ledger",
							tabIndex: -1,
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LedgerView, {})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabsContent, {
							value: "evidence",
							tabIndex: -1,
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EvidenceView, {})
						})
					]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("footer", {
				className: "safe-bottom border-t border-line px-4 pt-3",
				"aria-live": "polite",
				children: last && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "line-clamp-4 font-mono text-xs leading-relaxed",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: last.result === "error" ? "text-fg" : "text-brass",
							children: last.result
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: "text-muted",
							children: [" · ", last.command]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "mt-1 block text-fg",
							children: last.detail
						})
					]
				})
			})
		]
	});
}
function TabButton({ value, icon, label }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(TabsTrigger, {
		value,
		className: "flex min-h-11 flex-col items-center justify-center gap-1 border-b-2 border-transparent py-2 text-xs text-muted data-[state=active]:border-brass data-[state=active]:text-brass",
		children: [icon, label]
	});
}
function FabricView() {
	const model = useFabric((s) => s.model);
	const dispatch = useFabric((s) => s.dispatch);
	const setTab = useFabric((s) => s.setTab);
	const [focus, setFocus] = (0, import_react.useState)(null);
	const active = model.links.find((link) => link.id === focus) ?? null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 320 296",
				className: "w-full",
				role: "img",
				"aria-label": "Four-node reference fabric",
				children: [model.links.map((link) => {
					const a = POS[link.a];
					const b = POS[link.b];
					const util = link.capacityBps === 0 ? 0 : link.reservedBps / link.capacityBps;
					return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("line", {
						x1: a.x,
						y1: a.y,
						x2: b.x,
						y2: b.y,
						stroke: link.down ? "var(--color-muted)" : "var(--color-brass)",
						strokeWidth: link.reservedBps > 0 ? 4 : 1.5,
						strokeDasharray: link.down ? "5 4" : void 0,
						opacity: link.down ? .7 : .35 + util * .65
					}, link.id);
				}), NODES.map((node) => {
					const pos = POS[node];
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
						cx: pos.x,
						cy: pos.y,
						r: "22",
						fill: "var(--color-surface)",
						stroke: "var(--color-brass)"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("text", {
						x: pos.x,
						y: pos.y + 4,
						textAnchor: "middle",
						fill: "var(--color-fg)",
						fontFamily: "var(--font-mono)",
						fontSize: "13",
						children: node
					})] }, node);
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Reference capacities, not a measured link. Edge links 10 Mb/s. Backbone W–E 20 Mb/s. A down link keeps existing reservations until release."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "flex flex-col gap-2",
				children: model.links.map((link) => {
					const holders = model.circuits.filter((c) => c.reservedBps > 0 && c.linkIds.includes(link.id) && c.state !== "FREE" && c.state !== "RELEASED");
					const util = link.capacityBps === 0 ? 0 : link.reservedBps / link.capacityBps;
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "border border-line bg-surface px-3 py-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex items-center justify-between gap-3",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "min-h-11 text-left",
									onClick: () => setFocus(link.id),
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "block font-mono text-sm",
										children: linkEndpoints(link)
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
										className: "block text-sm text-muted",
										children: [
											formatBps(link.reservedBps),
											" reserved · ",
											formatBps(link.capacityBps),
											link.down ? " · down" : ""
										]
									})]
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: ghostBtn,
									onClick: () => dispatch(link.down ? {
										type: "restoreLink",
										linkId: link.id
									} : {
										type: "failLink",
										linkId: link.id
									}),
									children: link.down ? "Restore" : "Fail link"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "mt-2 h-1 bg-raised",
								"aria-hidden": "true",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "h-1 bg-brass",
									style: { width: `${Math.min(100, util * 100)}%` }
								})
							}),
							holders.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "mt-2 font-mono text-xs text-muted",
								children: ["Held by ", holders.map((c) => `#${c.id}`).join(" ")]
							})
						]
					}, link.id);
				})
			}),
			active && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "text-sm text-muted",
				children: [
					linkEndpoints(active),
					" is ",
					active.down ? "down" : "up",
					". New admissions will not use a down link. Restoration does not rebuild failed circuits."
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "border border-line bg-surface px-3 py-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "text-sm font-medium",
					children: "Try the conservation rules"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ol", {
					className: "mt-2 flex list-decimal flex-col gap-2 pl-4 text-sm text-muted",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Open two W→E circuits at 12 Mb/s. Admit both, then reserve. The second reserve must fail." }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Activate one, inject a frame, then inject a bad magic. Only the good frame counts." }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "text-brass underline",
								onClick: () => setTab("evidence"),
								children: "Run the pricing.erl vector"
							}),
							" ",
							"and read the ledger. The published total is 0.2500."
						] })
					]
				})]
			})
		]
	});
}
function CircuitsView() {
	const model = useFabric((s) => s.model);
	const selectedId = useFabric((s) => s.selectedId);
	const select = useFabric((s) => s.select);
	const dispatch = useFabric((s) => s.dispatch);
	const [src, setSrc] = (0, import_react.useState)("N");
	const [dst, setDst] = (0, import_react.useState)("S");
	const [bps, setBps] = (0, import_react.useState)(2e6);
	const [priority, setPriority] = (0, import_react.useState)(3);
	const [qos, setQos] = (0, import_react.useState)(1);
	const [tariffId, setTariffId] = (0, import_react.useState)(1);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", {
				open: true,
				className: "border border-line bg-surface",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", {
					className: "min-h-11 px-3 py-3 text-sm font-medium",
					children: "Open a circuit"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "flex flex-col gap-3 px-3 pb-3",
					onSubmit: (event) => {
						event.preventDefault();
						dispatch({
							type: "create",
							src,
							dst,
							bps,
							priority,
							qos,
							tariffId
						});
					},
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "grid grid-cols-2 gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex flex-col gap-1 text-xs tracking-wide text-muted",
								children: ["Source", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
									className: field,
									value: src,
									onChange: (event) => setSrc(event.target.value),
									children: NODES.map((node) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: node,
										children: node
									}, node))
								})]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex flex-col gap-1 text-xs tracking-wide text-muted",
								children: ["Destination", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
									className: field,
									value: dst,
									onChange: (event) => setDst(event.target.value),
									children: NODES.map((node) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: node,
										children: node
									}, node))
								})]
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", {
							className: "text-xs tracking-wide text-muted",
							children: "Bandwidth"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "mt-1 grid grid-cols-2 gap-2",
							children: PRESETS.map((preset) => {
								const on = preset.bps === bps;
								return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: on ? primaryBtn : ghostBtn,
									onClick: () => setBps(preset.bps),
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
										className: "flex flex-col items-start",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: preset.label }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
											className: on ? "text-xs text-brass-ink" : "text-xs text-muted",
											children: preset.note
										})]
									})
								}, preset.bps);
							})
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("legend", {
							className: "text-xs tracking-wide text-muted",
							children: ["Priority ", priority]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "mt-1 grid grid-cols-8 gap-1",
							children: [
								0,
								1,
								2,
								3,
								4,
								5,
								6,
								7
							].map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: value === priority ? "inline-flex min-h-11 items-center justify-center rounded-sm bg-brass px-1 text-sm font-medium text-brass-ink" : choiceBtn,
								onClick: () => setPriority(value),
								"aria-pressed": value === priority,
								children: value
							}, value))
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "flex flex-col gap-1 text-xs tracking-wide text-muted",
							children: ["QoS class 0–15", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								className: field,
								inputMode: "numeric",
								type: "number",
								min: 0,
								max: 15,
								value: qos,
								onChange: (event) => setQos(Number(event.target.value))
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", {
							className: "flex flex-col gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", {
								className: "text-xs tracking-wide text-muted",
								children: "Tariff locked at admission"
							}), model.tariffs.map((tariff) => {
								const on = tariff.id === tariffId;
								return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									type: "button",
									className: `min-h-11 border px-3 py-2 text-left ${on ? "border-brass bg-brass text-brass-ink" : "border-line bg-raised text-fg"}`,
									onClick: () => setTariffId(tariff.id),
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
										className: "block text-sm font-medium",
										children: [
											tariff.name,
											" · v",
											tariff.version
										]
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
										className: `block text-xs ${on ? "text-brass-ink" : "text-muted"}`,
										children: [
											"Setup ",
											tariff.setup,
											" minor · ",
											tariff.rateBps,
											"/bps/s · ",
											tariff.rateByte,
											"/byte · priority ×",
											tariff.prioMult,
											"/100"
										]
									})]
								}, tariff.id);
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "submit",
							className: primaryBtn,
							disabled: src === dst,
							children: "Create in FREE"
						}),
						src === dst && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-sm",
							children: "Source and destination must differ."
						})
					]
				})]
			}),
			model.circuits.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "No circuits. Capacity is idle."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "flex flex-col gap-3",
				children: model.circuits.map((circuit) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CircuitCard, {
					circuit,
					open: circuit.id === selectedId,
					onOpen: () => select(circuit.id)
				}) }, `${circuit.id}-${circuit.lifecycle}`))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs text-muted",
				children: "Commands carry transaction ids. Replaying one does not reserve twice or post the same accounting event again."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: ghostBtn,
				onClick: () => {
					const line = model.transcript.filter((entry) => entry.txId.startsWith("tx-")).at(-1);
					if (!line) return;
					dispatch({
						type: "tick",
						txId: line.txId
					});
				},
				children: "Replay last tx"
			})
		]
	});
}
function CircuitCard({ circuit, open, onOpen }) {
	const model = useFabric((s) => s.model);
	const dispatch = useFabric((s) => s.dispatch);
	const [bytes, setBytes] = (0, import_react.useState)(64);
	const options = actionsFor(model, circuit);
	const primary = HAPPY.map((id) => options.find((option) => option.id === id)).find((option) => option?.enabled);
	const secondary = options.filter((option) => option.enabled && option.id !== primary?.id);
	const decision = circuit.state === "REQUESTED" ? decide(model, circuit) : circuit.decision;
	const owed = settlement(model, circuit);
	const frame = model.lastFrame?.circuitId === circuit.id ? model.lastFrame : null;
	function fire(id) {
		const cid = circuit.id;
		if (id === "request") dispatch({
			type: "request",
			cid
		});
		else if (id === "admit") dispatch({
			type: "admit",
			cid
		});
		else if (id === "reject") dispatch({
			type: "reject",
			cid
		});
		else if (id === "timeout") dispatch({
			type: "timeout",
			cid
		});
		else if (id === "reserve") dispatch({
			type: "reserve",
			cid
		});
		else if (id === "install") dispatch({
			type: "install",
			cid
		});
		else if (id === "install-fault") dispatch({
			type: "install",
			cid,
			faultAtHop: Math.max(0, circuit.path.length - 1)
		});
		else if (id === "activate") dispatch({
			type: "activate",
			cid
		});
		else if (id === "drain") dispatch({
			type: "drain",
			cid
		});
		else if (id === "release") dispatch({
			type: "release",
			cid
		});
		else if (id === "fail") dispatch({
			type: "fail",
			cid,
			reason: "OPERATOR"
		});
		else if (id === "recycle") dispatch({
			type: "recycle",
			cid
		});
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
		className: open ? "border border-brass bg-surface" : "border border-line bg-surface",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
			type: "button",
			className: "flex w-full items-start justify-between gap-3 px-3 py-3 text-left",
			onClick: onOpen,
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "block font-mono text-sm",
				children: [
					"#",
					circuit.id,
					" · ",
					circuit.src,
					"→",
					circuit.dst
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "mt-1 block text-sm text-muted",
				children: [
					formatBps(circuit.requestedBps),
					" · p",
					circuit.priority,
					" · q",
					circuit.qos,
					circuit.path.length ? ` · ${pathLabel(circuit.path)}` : ""
				]
			})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StateMark, { state: circuit.state })]
		}), open && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex flex-col gap-3 px-3 pb-3",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
					className: "grid grid-cols-2 gap-x-3 gap-y-2 text-sm",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pair, {
							label: "Held",
							value: formatBps(circuit.reservedBps)
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pair, {
							label: "Duration",
							value: `${circuit.durationS} s`
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pair, {
							label: "Sent",
							value: `${circuit.bytesSent} B · ${circuit.packetsSent} pkt`
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pair, {
							label: "Lifecycle",
							value: String(circuit.lifecycle)
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pair, {
							label: "Tariff",
							value: circuit.tariffLock ? `T${circuit.tariffLock.id} v${circuit.tariffLock.version} locked` : `T${circuit.tariffId} unlocked`
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pair, {
							label: "This lifecycle",
							value: owed === null ? "—" : formatMinor(owed.toString())
						})
					]
				}),
				decision && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "font-mono text-xs leading-relaxed text-muted",
					children: [
						"decision ",
						decision.action,
						" · ",
						decision.reasonCode,
						decision.path.length ? ` · ${pathLabel(decision.path)}` : "",
						decision.action === "reroute" ? " · alternative is not applied. The state machine has no reroute transition." : ""
					]
				}),
				circuit.entries.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "font-mono text-xs text-muted",
					children: circuit.entries.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
						entry.node,
						" ",
						entry.ingress,
						"→",
						entry.egress
					] }, `${entry.node}-${entry.ingress}`))
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-wrap gap-2",
					children: [primary && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: primaryBtn,
						onClick: () => fire(primary.id),
						children: primary.label
					}), secondary.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: ghostBtn,
						onClick: () => fire(option.id),
						children: option.label
					}, option.id))]
				}),
				primary && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-xs text-muted",
					children: primary.reason
				}),
				circuit.state === "ACTIVE" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "flex flex-col gap-2 border-t border-line pt-3",
					onSubmit: (event) => {
						event.preventDefault();
						dispatch({
							type: "inject",
							cid: circuit.id,
							payloadBytes: bytes
						});
					},
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "flex flex-col gap-1 text-xs tracking-wide text-muted",
						children: ["Payload bytes", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							className: field,
							inputMode: "numeric",
							type: "number",
							min: 0,
							max: 2048,
							value: bytes,
							onChange: (event) => setBytes(Number(event.target.value))
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap gap-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "submit",
								className: primaryBtn,
								children: "Inject data"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: ghostBtn,
								onClick: () => dispatch({
									type: "inject",
									cid: circuit.id,
									payloadBytes: bytes,
									corrupt: "magic"
								}),
								children: "Bad magic"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: ghostBtn,
								onClick: () => dispatch({
									type: "inject",
									cid: circuit.id,
									payloadBytes: bytes,
									corrupt: "checksum"
								}),
								children: "Bad checksum"
							})
						]
					})]
				}),
				frame && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FrameDump, {
					hex: frame.hex,
					accepted: frame.accepted,
					reason: frame.reason
				})
			]
		})]
	});
}
function FrameDump({ hex, accepted, reason }) {
	const header = hexGroups(hex.slice(0, 40));
	const payload = hexGroups(hex.slice(40));
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "border-t border-line pt-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "font-mono text-xs",
				children: [
					accepted ? "ACCEPTED" : "DROPPED",
					" · ",
					reason
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 font-mono text-xs leading-relaxed break-all text-brass",
				children: header
			}),
			payload && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "font-mono text-xs leading-relaxed break-all text-muted",
				children: payload
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-2 text-xs text-muted",
				children: [
					"20-byte header, then payload. Magic on this console is ",
					CONSOLE_MAGIC.toString(16),
					" — a stand-in, not the unresolved spec literal 0xSCF1."
				]
			})
		]
	});
}
function LedgerView() {
	const model = useFabric((s) => s.model);
	const dispatch = useFabric((s) => s.dispatch);
	const [setup, setSetup] = (0, import_react.useState)(model.tariffs[0]?.setup ?? 1e3);
	const total = sumMoney(model.ledger.map((event) => event.amount));
	const rows = [...model.ledger].reverse();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "border border-line bg-surface px-3 py-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs tracking-wide text-muted",
						children: "Posted minor units · 1/10000"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 font-mono text-2xl tabular-nums",
						children: formatMinor(total.toString())
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-sm text-muted",
						children: "Setup posts at admission. Reservation posts once per clock second while bandwidth is held, including FAILED. Usage and priority post once, on release."
					})
				]
			}),
			model.tariffs.map((tariff) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "border border-line px-3 py-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", {
						className: "text-sm font-medium",
						children: [
							tariff.name,
							" · v",
							tariff.version
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-sm text-muted",
						children: tariff.origin
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-2 font-mono text-xs text-muted",
						children: [
							"setup ",
							tariff.setup,
							" · rate ",
							tariff.rateBps,
							"/bps/s · byte ",
							tariff.rateByte,
							" · prio ",
							tariff.prioMult
						]
					})
				]
			}, tariff.id)),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "flex flex-col gap-2",
				onSubmit: (event) => {
					event.preventDefault();
					dispatch({
						type: "reviseTariff",
						tariffId: 1,
						setup
					});
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "flex flex-col gap-1 text-xs tracking-wide text-muted",
						children: ["New T1 setup fee, minor units", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							className: field,
							inputMode: "numeric",
							type: "number",
							min: 0,
							value: setup,
							onChange: (event) => setSetup(Number(event.target.value))
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "submit",
						className: ghostBtn,
						children: "Publish T1 version"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs text-muted",
						children: "Circuits already admitted keep the version they locked."
					})
				]
			}),
			rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "No accounting events yet."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "flex flex-col",
				children: rows.map((event) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "border-t border-line py-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-baseline justify-between gap-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "font-mono text-xs",
							children: [
								"#",
								event.circuitId,
								" · ",
								event.kind,
								" · seq ",
								event.seq
							]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "font-mono text-sm tabular-nums",
							children: formatMinor(event.amount)
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-1 text-sm text-muted",
						children: [
							"t=",
							event.second,
							"s · lifecycle ",
							event.lifecycle,
							" · ",
							event.detail
						]
					})]
				}, `${event.circuitId}-${event.lifecycle}-${event.seq}`))
			})
		]
	});
}
function EvidenceView() {
	const model = useFabric((s) => s.model);
	const dispatch = useFabric((s) => s.dispatch);
	const checks = checkInvariants(model);
	const [armed, setArmed] = (0, import_react.useState)(false);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "text-sm font-medium",
				children: "Evidence or silence"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm text-muted",
				children: "This console executes the Phase I exchange: legal transitions, per-link reservation, integer tariffs, and 20-byte frame checks. A passing row below is a property of this running model. It is not a TLC log, a Why3 discharge, a p4c run, or a synthesis report."
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: primaryBtn,
				onClick: () => dispatch({ type: "pricingVector" }),
				children: "Reproduce pricing.erl vector"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "text-sm font-medium",
				children: "What was actually run"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-2 border-t border-line",
				children: CLAIMS.map((claim) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "border-b border-line py-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm",
						children: claim.title
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-sm text-muted",
						children: claim.body
					})]
				}, claim.title))
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "text-sm font-medium",
				children: "Invariants of this model"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-2",
				children: checks.map((check) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "flex gap-3 border-t border-line py-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: `font-mono text-xs ${check.ok ? "text-brass" : "text-fg"}`,
						children: check.ok ? "PASS" : "FAIL"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "block font-mono text-xs",
						children: check.id
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "mt-1 block text-sm text-muted",
						children: check.detail
					})] })]
				}, check.id))
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "text-sm text-muted",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-fg",
						children: "spec/README.md"
					}), " names circuit_id.md and invariants.md. Those files are not in the repository."] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-2",
						children: [
							"Magic is written as 0xSCF1. S is not a hexadecimal digit, and p4c was not run, so the wire value is unresolved. Frames here use console-local 0x",
							CONSOLE_MAGIC.toString(16),
							"."
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2",
						children: "TLA+ Fail allows REQUESTED. The spec does not. The Erlang actor also fails from REQUESTED and records bandwidth at request time. This console follows spec/state_machine.md: reserve is the only event that holds bandwidth, and REQUESTED ends in admit, reject, or timeout."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
							className: "text-brass underline",
							href: "https://github.com/AHMADALIPARR/sovereign-circuit-fabric",
							children: "Source repository"
						})
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: ghostBtn,
				onClick: () => {
					if (!armed) {
						setArmed(true);
						return;
					}
					dispatch({ type: "reset" });
					setArmed(false);
				},
				children: armed ? "Confirm reset" : "Reset exchange"
			})
		]
	});
}
function StateMark({ state }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: `shrink-0 border px-2 py-1 font-mono text-xs tracking-wide ${state === "ACTIVE" || state === "RESERVED" || state === "INSTALLED" ? "border-brass text-brass" : state === "FAILED" || state === "RELEASED" ? "border-fg text-fg" : "border-line text-muted"}`,
		children: state
	});
}
function Pair({ label, value }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
		className: "text-xs text-muted",
		children: label
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
		className: "font-mono text-xs",
		children: value
	})] });
}
var CLAIMS = [
	{
		title: "Phase I definitions",
		body: "Executing. State machine, resource conservation, tariff formula, frame layout."
	},
	{
		title: "accounting/pricing.erl",
		body: "Formula executing. basic_charge_test constants are T1. Expected settlement is 2500 minor units."
	},
	{
		title: "TLA+ CircuitState.tla",
		body: "Source is in the repository. TLC was not run. Status: unchecked."
	},
	{
		title: "WhyML / Why3 and Dafny",
		body: "Not in the repository. No proofs discharged."
	},
	{
		title: "P4_16 circuit_forward.p4",
		body: "Source only. p4c was not run. That program drops bad magic, bad version, and table misses. It does not yet enforce admission state. This console does, as model policy, not as a claim about the P4."
	},
	{
		title: "VHDL scf_crossbar",
		body: "Source only. No GHDL log. No resource or timing numbers."
	},
	{
		title: "Gödel",
		body: "Blocked. No compiler. Admission here is a TypeScript transcription of the relations in control/godel/README.md. It is not a Gödel execution."
	},
	{
		title: "Dylan, Tcl, BEAM",
		body: "Not executed in this console. No scalability measurement. No bare-metal BEAM."
	}
];
var SplitComponent = Console;
//#endregion
export { SplitComponent as component };
