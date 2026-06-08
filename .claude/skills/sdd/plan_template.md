# Plan: [Feature Name] — v[N]

**Status**: Draft | In Progress | Done
**Created**: YYYY-MM-DD
**Last updated**: YYYY-MM-DD
**Spec**: [docs/specs/feature-vN.md]

---

## Summary

> One paragraph: what built + chosen technical approach.

## Technical Context

| Item              | Value                  |
|-------------------|------------------------|
| Language          |                        |
| Key dependencies  |                        |
| Files to create   |                        |
| Files to modify   |                        |

---

## Implementation Checklist

> Update checklist as work progresses. Add inline notes when step deviates from plan.

### Phase 1 — Interface

- [ ] Read spec doc, confirm no open questions remain
- [ ] Define TypeScript types in `src/types.ts`
- [ ] Review types vs spec — no invented properties

### Phase 2 — Testing

- [ ] Write happy-path test
- [ ] Write test for missing optional fields
- [ ] Write test for invalid / missing required fields

### Phase 3 — Implementation

- [ ] Implement component / module
- [ ] All tests pass
- [ ] Reused shared utilities — no duplicated logic

### Phase 4 — Docs

- [ ] Mark item done in `docs/roadmap.md`
- [ ] Update this plan with deviations
- [ ] Update `docs/ARCHITECTURE.md` if new patterns/decisions introduced

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **YYYY-MM-DD**: [What changed + why]