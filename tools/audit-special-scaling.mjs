import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// The global bundle preserves the game metadata that the legacy source data
// predates, including ability-time and ability-value usage codes.
const skills = require('../../umalator-global/skill_data.json');
const names = require('../data/skillnames.json');

const implementedDurationScaling = new Set([1, 3, 4]);
const durationFindings = new Map();
const effectFindings = new Map();

function add(map, code, id) {
	if (!map.has(code)) map.set(code, new Set());
	map.get(code).add(id);
}

for (const [id, data] of Object.entries(skills)) {
	for (const alternative of data.alternatives || []) {
		const durationScaling = alternative.durationScaling ?? 1;
		if (!implementedDurationScaling.has(durationScaling)) add(durationFindings, durationScaling, id);
		for (const effect of alternative.effects || []) {
			const effectScaling = effect.scaling ?? 1;
			if (effectScaling != 1) add(effectFindings, effectScaling, id);
		}
	}
}

function report(title, findings) {
	console.log(title);
	if (findings.size == 0) return console.log('  none');
	for (const [code, ids] of [...findings.entries()].sort(([a], [b]) => +a - +b)) {
		console.log(`  scaling ${code}:`);
		for (const id of [...ids].sort((a, b) => +a - +b)) {
			console.log(`    ${id}  ${names[id]?.[1] || names[id]?.[0] || '(unnamed)'}`);
		}
	}
}

report('Unhandled duration-scaling modes:', durationFindings);
report('Unhandled effect-scaling modes:', effectFindings);
