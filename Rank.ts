export type RankComparison = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte';

export function rankTarget(argument: number, fieldSize: number, percentage: boolean) {
	return percentage ? Math.round(fieldSize * argument / 100) : argument;
}

export function compareRank(rank: number, comparison: RankComparison, argument: number, fieldSize: number, percentage = false) {
	const target = rankTarget(argument, fieldSize, percentage);
	switch (comparison) {
	case 'eq': return rank === target;
	case 'neq': return rank !== target;
	case 'lt': return rank < target;
	case 'lte': return rank <= target;
	case 'gt': return rank > target;
	case 'gte': return rank >= target;
	}
}

export function assignLongitudinalRanks<T extends {pos: number, rank: number, fieldSize: number}>(runners: T[]) {
	const fieldSize = runners.length;
	runners
		.map((runner, index) => ({runner, index}))
		.sort((a,b) => b.runner.pos - a.runner.pos || a.index - b.index)
		.forEach(({runner}, index) => {
			runner.rank = index + 1;
			runner.fieldSize = fieldSize;
		});
	return runners;
}
