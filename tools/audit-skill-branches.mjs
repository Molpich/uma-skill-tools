import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const skills = require('../../umalator-global/skill_data.json');
const names = require('../data/skillnames.json');
// Kept in sync with RaceSolverBuilder's explicit priority-effect handling.
const implementedPriorityVariants = new Set(['100421', '900421']);

// These are evaluated against RaceState, rather than being converted into a
// course region by the condition parser.  An @ expression is unsafe in the
// current parser only when *both* these terms and region-defining terms differ
// between branches.
const dynamicTerms = new Set([
	'accumulatetime', 'activate_count_all', 'activate_count_end_after', 'activate_count_heal',
	'activate_count_later_half', 'activate_count_middle', 'activate_count_start',
	'bashin_diff_behind', 'bashin_diff_infront', 'behind_near_lane_time',
	'behind_near_lane_time_set1', 'blocked_all_continuetime', 'blocked_front',
	'blocked_front_continuetime', 'blocked_side_continuetime', 'change_order_onetime',
	'change_order_up_end_after', 'change_order_up_finalcorner_after', 'change_order_up_middle',
	'compete_fight_count', 'distance_diff_rate', 'distance_diff_top', 'distance_diff_top_float',
	'hp_per', 'infront_near_lane_time', 'is_activate_any_skill', 'is_activate_other_skill_detail',
	'is_badstart', 'is_behind_in', 'is_hp_empty_onetime', 'is_last_straight_onetime',
	'is_move_lane', 'is_overtake', 'is_surrounded', 'near_count',
	'overtake_target_no_order_up_time', 'overtake_target_time', 'running_style_count_same',
	'running_style_count_same_rate', 'running_style_equal_popularity_one', 'visiblehorse'
]);

function skillName(id) {
	return names[id]?.[1] || names[id]?.[0] || '(unnamed)';
}

function terms(branch) {
	return branch.split('&').filter(Boolean).map(term => ({
		name: /^([a-z_]+)/.exec(term)?.[1] || term,
		term
	}));
}

function signature(branch, dynamic) {
	return terms(branch).filter(({name}) => dynamicTerms.has(name) === dynamic)
		.map(({term}) => term).sort().join('&');
}

function riskyAtExpression(expression) {
	const branches = expression.split('@');
	if (branches.length < 2) return false;
	const dynamic = new Set(branches.map(branch => signature(branch, true)));
	const staticPart = new Set(branches.map(branch => signature(branch, false)));
	return dynamic.size > 1 && staticPart.size > 1;
}

const unsafeAt = [];
const suppressedAlternatives = [];
for (const [id, data] of Object.entries(skills)) {
	for (const [index, alternative] of (data.alternatives || []).entries()) {
		for (const [where, expression] of [['condition', alternative.condition], ['precondition', alternative.precondition]]) {
			if (expression?.includes('@') && riskyAtExpression(expression)) {
				unsafeAt.push({id, index, where, expression});
			}
		}
	}
	if (!implementedPriorityVariants.has(id) && (data.alternatives || []).length > 1 && !data.alternatives.some(a => /is_activate_other_skill_detail|is_used_skill_id/.test(a.condition))) {
		suppressedAlternatives.push({id, alternatives: data.alternatives});
	}
}

console.log('Potentially unsafe @ expressions (dynamic and static branches both differ):');
if (unsafeAt.length === 0) console.log('  none');
for (const finding of unsafeAt) {
	console.log(`  ${finding.id}  ${skillName(finding.id)}  alternative ${finding.index + 1}, ${finding.where}`);
	console.log(`    ${finding.expression}`);
}

console.log('\nMulti-alternative skills without an explicit activation policy:');
console.log('  Review each for priority/fallback behavior versus genuinely separate activations.');
if (suppressedAlternatives.length === 0) console.log('  none');
for (const {id, alternatives} of suppressedAlternatives) {
	console.log(`  ${id}  ${skillName(id)}`);
	for (const [index, alternative] of alternatives.entries()) {
		const effects = (alternative.effects || []).map(effect => `${effect.type}:${effect.modifier}`).join(', ');
		console.log(`    ${index + 1}. ${alternative.condition}  [${effects}]`);
	}
}
