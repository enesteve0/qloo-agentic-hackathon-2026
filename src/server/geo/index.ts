import 'server-only';

// Public surface of the lift engine (ARCHITECTURE §6). Pure functions; no I/O.
export { computeWhere, liftMultiplier, HEAT_MAX_CELLS, MULTIPLIER_BASE, MULTIPLIER_MAX, MULTIPLIER_MIN } from './where';
export type { WhereInput, WhereOutput } from './where';
export { computeAnchorLifts, anchorMetric, liftOver } from './lift';
export type { AnchorLift, LiftInput, LiftOutput } from './lift';
export { detectFlags, sameTopOrder } from './detect';
export { aggregateNtas, combineLift, confidenceOf, smoothLift } from './aggregate';
export { gridIndex, gridNeighbors, projectToGrid } from './grid';
export { percentileRanks, probit, rankZ, spearman } from './rankz';
export { DEFAULT_LIFT_CONFIG, scoreConfigs, scoreTrial } from './calibration';
export type { CalibrationChoice, ConfigTrial, TrialScore } from './calibration';
export type { AnchorMapInput, GridProjection, GridSpec, HeatMetric } from './types';
