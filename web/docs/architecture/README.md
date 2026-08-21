# Fleet Prime architecture notes

The web workspace (`web/`) is a standalone product layer over the in-tree
prime-agent runtime. Long-form design documents live here rather than at the
repository root.

- [`fleet-adapter-contract-v1.md`](./fleet-adapter-contract-v1.md) — the
  audited adapter contract: transport frames, capability negotiation
  (`reasoning-summary-v1`, `plan-presentation-v1`), privacy invariants, and
  the deferred capability backlog.
- [`fleet-adapter-contract-plan.md`](./fleet-adapter-contract-plan.md) — the
  working plan the v1 contract was distilled from.
- [`react-doctor.md`](./react-doctor.md) — React Doctor audit baseline,
  evidence-backed waivers, and how to re-run the scan.
