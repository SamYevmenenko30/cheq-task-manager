// Marker module. The routes arrive through specs; an adapter with no spec behind it
// would be invented behaviour.
//
// The invariant THIS app enforces: no rule lives here. A decision that belongs to the
// product is taken in @cheq/core and only transported by this layer.

export const API_PACKAGE = '@cheq/api' as const;
