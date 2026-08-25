import type { RaceSolver } from './RaceSolver';
import { assignLongitudinalRanks } from './Rank.ts';

function sameStrategy(a, b) {
	if (a == b) return true;
	const normalize = value => typeof value == 'string' ? value.toUpperCase() : value;
	a = normalize(a); b = normalize(b);
	return (a == 'NIGE' || a == 'OONIGE' || a == 1 || a == 5)
		&& (b == 'NIGE' || b == 'OONIGE' || b == 1 || b == 5);
}

function continueTimer(value: number, condition: boolean, dt: number) {
	return condition ? value + dt : 0;
}

const HORSE_WIDTHS_PER_COURSE_WIDTH = 18;

export function initializeFieldLanes(runners: RaceSolver[], postOrder: number[], synchronizeGateRoll = false) {
	runners.forEach((runner, index) => {
		const post = postOrder[index] || 0;
		runner.lanePosition = post;
		runner.laneTarget = runner.lanePosition;
		runner.laneSpeed = 0;
		runner.laneInitialized = true;
		// post_number conditions derive their gate from gateRoll % fieldSize.
		// In lane-enabled full-field runs, make the unique visible post
		// permutation authoritative for those conditions as well.
		if (synchronizeGateRoll) runner.gateRoll = post;
	});
}

function sideBlocked(runner: RaceSolver, runners: RaceSolver[], direction: number) {
	return runners.some(other => {
		if (other == runner || Math.abs(other.pos - runner.pos) >= 1.05) return false;
		const lateral = other.lanePosition - runner.lanePosition;
		return lateral * direction > 0 && Math.abs(lateral) < 2;
	});
}

function laneClear(runner: RaceSolver, runners: RaceSolver[], target: number) {
	return !runners.some(other => other != runner
		&& Math.abs(other.pos - runner.pos) < 1.05
		&& Math.abs(other.lanePosition - target) < 1);
}

function chooseTargetLane(runner: RaceSolver, runners: RaceSolver[]) {
	const maxLane = Math.max(runners.length, ...runners.map(other => other.lanePosition));
	if (!runner.hasOvertakeTarget && !runner.blockedFront) {
		// Normal mode works progressively toward the rail. Re-evaluation after
		// reaching each target supplies the documented one-horse-width steps.
		return runner.phase < 2 ? Math.max(0, runner.lanePosition - 1) : runner.lanePosition;
	}

	// Approximate the documented recursive pack boundary with the transitive
	// closure of runners up to 3m ahead and within two horse-widths.
	const pack = runners.filter(other => other != runner && other.pos >= runner.pos && other.pos - runner.pos <= 3);
	let inner = runner.lanePosition, outer = runner.lanePosition, changed = true;
	while (changed) {
		changed = false;
		for (const other of pack) {
			if (other.lanePosition >= inner - 2 && other.lanePosition <= outer + 2) {
				if (other.lanePosition < inner) { inner = other.lanePosition; changed = true; }
				if (other.lanePosition > outer) { outer = other.lanePosition; changed = true; }
			}
		}
	}
	const candidates = [Math.max(0, inner - 1), Math.min(maxLane, outer + 1), runner.lanePosition]
		.filter((target, index, all) => all.indexOf(target) == index)
		.filter(target => target != runner.lanePosition || !runner.blockedFront)
		.filter(target => target == runner.lanePosition || (!sideBlocked(runner, runners, Math.sign(target - runner.lanePosition))
			&& laneClear(runner, runners, target)));
	return candidates.reduce((best, target) => {
		const directionPenalty = target > runner.lanePosition ? (runner.phase == 0 ? 100 : runner.phase >= 2 ? 1.15 : 1) : 1;
		const score = Math.abs(target - runner.lanePosition) * directionPenalty;
		return score < best.score ? {target, score} : best;
	}, {target: runner.lanePosition, score: Infinity}).target;
}

function updateLaneMovement(runner: RaceSolver, runners: RaceSolver[], dt: number) {
	runner.laneMovementType = 0;
	if (!runner.laneInitialized) return;
	const direction = Math.sign(runner.laneTarget - runner.lanePosition);
	if (Math.abs(runner.laneTarget - runner.lanePosition) <= 0.5
		|| (direction != 0 && sideBlocked(runner, runners, direction))) {
		runner.laneTarget = chooseTargetLane(runner, runners);
	}
	const newDirection = Math.sign(runner.laneTarget - runner.lanePosition);
	if (newDirection == 0) {
		runner.laneSpeed = 0;
		return;
	}
	const laneCoursePosition = runner.lanePosition / HORSE_WIDTHS_PER_COURSE_WIDTH;
	const maxCoursePosition = Math.max(runners.length, ...runners.map(other => other.lanePosition)) / HORSE_WIDTHS_PER_COURSE_WIDTH;
	const startModifier = runner.phase < 2 ? 1 + 0.05 * laneCoursePosition / Math.max(maxCoursePosition, 1 / 18) : 1;
	const rankModifier = runner.phase >= 2 ? 1 + 0.01 * runner.rank : 1;
	const targetSpeed = 0.02 * (0.3 + 0.001 * runner.horse.power)
		* startModifier * rankModifier * HORSE_WIDTHS_PER_COURSE_WIDTH;
	const lateralAccel = 0.02 * 1.5 * HORSE_WIDTHS_PER_COURSE_WIDTH;
	runner.laneSpeed = Math.min(targetSpeed, runner.laneSpeed + lateralAccel * dt);
	if (sideBlocked(runner, runners, newDirection)) return;
	const oldPosition = runner.lanePosition;
	const inwardModifier = newDirection < 0 ? 1 + laneCoursePosition : 1;
	const movement = newDirection * runner.laneSpeed * inwardModifier * dt;
	const remaining = runner.laneTarget - runner.lanePosition;
	if (Math.abs(movement) >= Math.abs(remaining)) {
		runner.lanePosition = runner.laneTarget;
		runner.laneSpeed = 0;
	} else {
		runner.lanePosition += movement;
	}
	const actualDirection = Math.sign(runner.lanePosition - oldPosition);
	// Existing skills accept either 1 or 2; preserve the distinction for future
	// conditions as inward (1) versus outward (2) movement.
	if (actualDirection != 0) runner.laneMovementType = actualDirection < 0 ? 1 : 2;
}

/** Update the live, lane-free relationships used by full-field skill conditions.
 *  Lane-qualified checks deliberately enforce only their necessary longitudinal bounds. */
export function updateLongitudinalFieldState(runners: RaceSolver[], dt: number, useLanes = false) {
	assignLongitudinalRanks(runners);
	const ordered = runners.slice().sort((a, b) => b.pos - a.pos || a.rank - b.rank);
	const leaderPos = ordered[0].pos;
	const lastPos = ordered[ordered.length - 1].pos;
	for (let index = 0; index < ordered.length; ++index) {
		const runner = ordered[index];
		const previousRank = runner.lastFieldRank > 0 ? runner.lastFieldRank : runner.rank;
		const orderDelta = runner.rank - previousRank;
		const upwardChanges = Math.max(0, -orderDelta);
		runner.changeOrderOneTime = orderDelta;
		if (upwardChanges > 0) {
			// This is an event, distinct from the cumulative order-change values
			// below.  Skills such as Bamboo Memory only react to passes that occur
			// during their active duration; conditions that inspect a prior pass
			// continue to use the history counters unchanged.
			runner.onRaceEvent?.({type: 'overtake', count: upwardChanges});
			const middleStart = runner.course.distance / 6;
			const lateStart = runner.course.distance * 2 / 3;
			if (runner.pos >= middleStart && runner.pos < lateStart) runner.changeOrderUpMiddle += upwardChanges;
			if (runner.pos >= lateStart) runner.changeOrderUpEndAfter += upwardChanges;
			const finalCorner = runner.course.corners[runner.course.corners.length - 1];
			if (finalCorner != null && runner.pos >= finalCorner.start) runner.changeOrderUpFinalCornerAfter += upwardChanges;
		}
		if (orderDelta > 0) runner.onRaceEvent?.({type: 'overtaken', count: orderDelta});
		runner.sameStrategyCount = runners.reduce((count, other) => count
			+ +sameStrategy(runner.horse.strategy, other.horse.strategy), 0);
		runner.sameStrategyRate = runner.sameStrategyCount / runners.length * 100;
		runner.popularityOneSameStrategy = runners.some(other => other.horse.popularity == 1
			&& sameStrategy(runner.horse.strategy, other.horse.strategy));
		// Continue-rank conditions describe the runner's history, not just its
		// current rank. The game gives runners an opening setup period (the
		// first five seconds) before this history starts, so initialize the
		// bounds from the first live rank after that grace period.
		if (runner.accumulatetime == null) {
			// Keep lightweight field-state test doubles usable as well.
			runner.bestFieldRank = Math.min(runner.bestFieldRank ?? runner.rank, runner.rank);
			runner.worstFieldRank = Math.max(runner.worstFieldRank ?? runner.rank, runner.rank);
		} else if (!runner.fieldRankHistoryStarted && runner.accumulatetime.t >= 5) {
			runner.bestFieldRank = runner.rank;
			runner.worstFieldRank = runner.rank;
			runner.fieldRankHistoryStarted = true;
		} else if (runner.fieldRankHistoryStarted) {
			runner.bestFieldRank = Math.min(runner.bestFieldRank, runner.rank);
			runner.worstFieldRank = Math.max(runner.worstFieldRank, runner.rank);
		}
		const ahead = index > 0 ? ordered[index - 1] : null;
		const behind = index + 1 < ordered.length ? ordered[index + 1] : null;
		const aheadGap = ahead == null ? Infinity : Math.max(0, ahead.pos - runner.pos);
		const behindGap = behind == null ? Infinity : Math.max(0, runner.pos - behind.pos);
		// Lane coordinate zero is the inner rail. `is_behind_in` refers to the
		// immediately trailing runner being closer to that rail than this runner.
		runner.isBehindIn = useLanes && behind != null && behind.lanePosition < runner.lanePosition;
		const rankChanged = orderDelta != 0;
		if (rankChanged) {
			runner.infrontNearLaneTime = 0;
			runner.behindNearLaneTime = 0;
			runner.behindNearLaneTimeSet1 = 0;
		}

		runner.nearestAheadDistance = aheadGap;
		runner.nearestBehindDistance = behindGap;
		runner.distanceFromLeader = Math.max(0, leaderPos - runner.pos);
		runner.distanceFromLast = Math.max(0, runner.pos - lastPos);
		runner.fieldSpread = Math.max(0, leaderPos - lastPos);
		runner.nearCount = runners.reduce((n, other) => n + +(other != runner && Math.abs(other.pos - runner.pos) < 3), 0);
		runner.visibleHorseCount = runners.reduce((n, other) => n + +(other != runner && other.pos >= runner.pos && other.pos - runner.pos <= 20), 0);

		const frontBlocker = useLanes ? ordered.slice(0, index).filter(other => {
			const gap = other.pos - runner.pos;
			const threshold = (1 - 0.6 * gap / 2) * 0.75;
			return gap > 0 && gap < 2 && Math.abs(other.lanePosition - runner.lanePosition) <= threshold;
		}).sort((a, b) => a.pos - b.pos)[0] : ahead;
		runner.blockedFront = frontBlocker != null && frontBlocker.pos - runner.pos > 0 && frontBlocker.pos - runner.pos < 2;
		const blockedSide = useLanes
			? runners.some(other => other != runner && Math.abs(other.pos - runner.pos) < 1.05
				&& Math.abs(other.lanePosition - runner.lanePosition) > 0
				&& Math.abs(other.lanePosition - runner.lanePosition) < 2)
			: runners.some(other => other != runner && Math.abs(other.pos - runner.pos) < 1.05);
		runner.blockedFrontTime = continueTimer(runner.blockedFrontTime, runner.blockedFront, dt);
		runner.blockedSideTime = continueTimer(runner.blockedSideTime, blockedSide, dt);
		runner.blockedAllTime = continueTimer(runner.blockedAllTime, runner.blockedFront && blockedSide, dt);
		const aheadSameLane = ahead != null && (!useLanes || Math.abs(ahead.lanePosition - runner.lanePosition) <= 1);
		const behindSameLane = behind != null && (!useLanes || Math.abs(behind.lanePosition - runner.lanePosition) <= 1);
		runner.infrontNearLaneTime = continueTimer(runner.infrontNearLaneTime, aheadGap < 2.5 && aheadSameLane, dt);
		runner.behindNearLaneTime = continueTimer(runner.behindNearLaneTime, behindGap < 2.5 && behindSameLane, dt);
		runner.behindNearLaneTimeSet1 = continueTimer(runner.behindNearLaneTimeSet1, behindGap < 5 && behindSameLane, dt);
		runner.isSurrounded = aheadGap < 3 && behindGap < 3 && runner.nearCount >= 3;

		const overtakeTarget = ordered.slice(0, index).some(other => {
			const gap = other.pos - runner.pos;
			if (runner.blockedFront && other == frontBlocker) return true;
			const speedGap = runner.currentSpeed - other.currentSpeed;
			return gap >= 1 && gap <= 20 && speedGap > 0 && gap / speedGap < 15 && runner.targetSpeed > other.targetSpeed;
		});
		runner.hasOvertakeTarget = overtakeTarget;
		runner.overtakeTargetTime = continueTimer(runner.overtakeTargetTime, overtakeTarget, dt);
		runner.overtakeTargetNoOrderUpTime = continueTimer(runner.overtakeTargetNoOrderUpTime, overtakeTarget && !rankChanged, dt);
		runner.lastFieldRank = runner.rank;
	}
	if (useLanes) runners.forEach(runner => updateLaneMovement(runner, runners, dt));
	else runners.forEach(runner => { runner.laneMovementType = 0; });
	return runners;
}
