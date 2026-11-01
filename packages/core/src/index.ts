// Marker module. The domain of this package arrives through specs
// (docs/specs/CHEQ-<nnn>.md), never through an agent's invention: nothing in this
// repository describes the product yet, so nothing here models it yet.
//
// The invariant THIS package enforces: everything exported from here runs with no
// DOM, no node builtins and no clock of its own — time and I/O enter as arguments.

export const CORE_PACKAGE = '@cheq/core' as const;
