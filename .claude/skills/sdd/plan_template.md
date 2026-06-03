# Plan: [Feature Name] — v[N]

**Status**: Draft | In Progress | Done
**Created**: YYYY-MM-DD
**Last updated**: YYYY-MM-DD
**Spec**: [docs/specs/feature-vN.md]

---

## Summary

> One paragraph: what is being built and the chosen technical approach.

## Technical Context

| Item              | Value                  |
|-------------------|------------------------|
| Language          |                        |
| Key dependencies  |                        |
| Files to create   |                        |
| Files to modify   |                        |

---

## Implementation Checklist

> Update this checklist as work progresses. Add notes inline when a step deviates from the original plan.

### Phase 1 — Interface

- [ ] Read spec document and confirm no open questions remain
- [ ] Define TypeScript types in `src/types.ts`
- [ ] Review types with the spec — no invented properties

### Phase 2 — Testing

- [ ] Write happy-path test
- [ ] Write test for missing optional fields
- [ ] Write test for invalid / missing required fields

### Phase 3 — Implementation

- [ ] Implement component / module
- [ ] All tests pass
- [ ] Reused shared utilities — no duplicated logic

### Phase 4 — Docs

- [ ] Mark item as done in `docs/roadmap.md`
- [ ] Update this plan with any deviations
- [ ] Update `docs/ARCHITECTURE.md` if new patterns or decisions were introduced

---

## Deviations & Notes

> Record here anything that differed from the plan during implementation. Date each entry.

- **YYYY-MM-DD**: [What changed and why]
