## Summary

What does this PR do?

## Spec reference

Which section(s) of `atrib-spec.md` does this relate to?

## Testing

- [ ] All existing tests pass (`pnpm -r test`)
- [ ] New tests added for changed behavior
- [ ] Typecheck passes (`pnpm -r typecheck`)

## Docs

Run `node scripts/docs-map.mjs --base origin/main`. Each flagged section is edited in this PR or acknowledged in a commit message or this description (`docs-map: <doc>#<section>: <why no edit>`).

## Checklist

- [ ] No `any` types introduced
- [ ] Error handling follows Section 5.8 degradation contract
- [ ] Critical invariants preserved (see CLAUDE.md)
