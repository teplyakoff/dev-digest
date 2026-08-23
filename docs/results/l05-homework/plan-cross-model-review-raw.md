The plan is not executable as written and has several tests that can pass while required behavior remains broken.

## BLOCKER

- **S6 depends on a service created three steps later.** The measurement CLI must assemble input “through the service,” but `BriefService` is not created until S9. S6 therefore cannot compile or run in the mandated order. `docs/plans/L05-pr-brief.md:335-357`, `docs/plans/L05-pr-brief.md:412-414`

- **The production token budget measures the wrong artifact.** S5/S7 measure rendered source blocks, while the actual system prompt, injection guard, wrappers, labels, and message framing are only assembled in S8. Thus `test_brief_budget` can report ≤8,000 while the messages sent to the model exceed NFR-1, which explicitly measures complete system and user messages. `docs/plans/L05-pr-brief.md:320-325`, `docs/plans/L05-pr-brief.md:362-379`, `docs/plans/L05-pr-brief.md:388-407`, `server/docs/specs/07-pr-brief.md:417-421`

- **Drop levels 4 and 5 are silently consumed before budgeting.** S5 always caps callers at five and file stats at fifty; S7 later claims those same reductions are observable budget levels. Production can therefore never record those drops, while a unit test can manufacture uncapped input and pass. This violates AC-64/65 and NFR-8’s “no silent truncation.” `docs/plans/L05-pr-brief.md:324-328`, `docs/plans/L05-pr-brief.md:369-378`, `server/docs/specs/07-pr-brief.md:272-279`, `server/docs/specs/07-pr-brief.md:475-477`

- **AC-59 has nowhere to go.** S4 promises `unavailable` survives into the response, but neither `PrBriefRecord` nor the DB columns include it. The later integration test cannot make the declared contract carry the value. `docs/plans/L05-pr-brief.md:212-218`, `docs/plans/L05-pr-brief.md:239-248`, `docs/plans/L05-pr-brief.md:310-313`, `server/docs/specs/07-pr-brief.md:133-134`

## MAJOR

- **The prompt plan does not explicitly wrap the PR title.** The title is non-droppable but is absent from S4’s named blocks; S8 only promises to wrap “each block.” Its test can inspect those blocks and miss an unwrapped title, despite NFR-4 expressly covering the title/body. `docs/plans/L05-pr-brief.md:296-299`, `docs/plans/L05-pr-brief.md:375-376`, `docs/plans/L05-pr-brief.md:393-407`, `server/docs/specs/07-pr-brief.md:454-458`

- **AC-26’s proposed proof is impossible at S7.** `fitToBudget` is deliberately pure and has no container or LLM, yet its Done condition injects an `llm()` stub to prove no call occurred. That proof belongs at the service boundary after S9; a pure-function test only proves that an exception was returned. `docs/plans/L05-pr-brief.md:366-367`, `docs/plans/L05-pr-brief.md:377-384`

- **Grounding is defeatable in two concrete shapes.** Existing `Risk.file_refs` permits `[]`, so a check that only rejects out-of-allowlist references can vacuously accept an uncited risk. Also, file paths and endpoint routes share one string allowlist, letting `review_focus.path` equal a real endpoint and survive, although the client then has no file card to open. Even a valid file can be attached to an unrelated explanation; membership proves existence, not relevance. `server/src/vendor/shared/contracts/brief.ts:69-75`, `docs/plans/L05-pr-brief.md:441-446`, `docs/plans/L05-pr-brief.md:610-611`

- **AC-42 is bound to the wrong test seam.** `PrBriefCard.test.tsx` can prove only that a callback received a path. No planned test covers `OverviewTab → PrDetailView → setParams({tab,view,file})`; S17 tests only `SmartDiffViewer`. The app can omit or miswire navigation while AC-42 remains green. `docs/plans/L05-pr-brief.md:581-585`, `docs/plans/L05-pr-brief.md:599-617`, `docs/plans/L05-pr-brief.md:692-694`

- **Client steps are also out of order.** S15 renders and tests `brief.*` translations, but those keys are not added until S18. Missing next-intl messages prevent S15’s stated verification from succeeding cleanly. `docs/plans/L05-pr-brief.md:558-563`, `docs/plans/L05-pr-brief.md:621-628`

- **The cache has undocumented races and invalidation holes.** Concurrent unconditional POSTs make duplicate paid calls and race their upserts; an older build can overwrite a newer-head build. Separately, changing the configured model or deploying a revised prompt/schema does not invalidate a same-head cache. Only document/index drift was acknowledged. `docs/plans/L05-pr-brief.md:256-258`, `docs/plans/L05-pr-brief.md:462-473`, `docs/plans/L05-pr-brief.md:771-772`

- **“Entire server suite” is not actually verified.** S13 runs `gates.sh --unit`, which explicitly excludes every `*.it.test.ts`; final verification runs only the new brief integration file, not existing integration workflows affected by container and intent changes. `docs/plans/L05-pr-brief.md:502-507`, `docs/plans/L05-pr-brief.md:749-753`, `.claude/skills/pr-self-review/scripts/gates.sh:8-17`

## MINOR

- The manual live-stack check performs a real brief generation but carries no explicit billing warning or no-key guard. `docs/plans/L05-pr-brief.md:756-760`

I checked both specs, the complete plan, root/package instructions and insights, testing policy, existing Risk/Blast contracts, DI, intent, and client navigation state. I did not run tests. I could not establish real prompt sizes, whether `pr_brief` is still empty in the target DB, or whether intended UI fixtures use a normally collapsed file; the plan itself leaves the measurement unresolved. `docs/plans/L05-pr-brief.md:785-794`

First changes:

1. Reorder S6 after final prompt assembly and budget the exact messages; remove pre-budget caps and add a service-level AC-26 test.
2. Add unavailable-input provenance and discriminator/nonempty constraints for grounding.
3. Repair step ordering and seam tests: translations before card tests, full navigation wiring coverage, concurrency/cache-version handling, and the full integration suite.
