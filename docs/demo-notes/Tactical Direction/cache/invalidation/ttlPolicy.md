---
status: agreed
created: 2026-10-02T09:41:26
updated: 2026-10-05T16:13:44
tags: [tactical-direction, cache/invalidation]
aliases: ["Purge cached pages on price change instead of lowering the TTL", "Cache invalidation TTL policy"]
implementation: "storefront/docs/summaries/2026-10-05-price-purge.md"
cssclasses: [agent-note]
---

# Purge cached pages on price change instead of lowering the TTL

> [!success|banner] Agreed 2026-10-02 09:43:12, extended 2026-10-05 16:09:16, implemented 2026-10-05 16:13:44
> Keep the 3600s page-cache TTL and purge `/p/{sku}` plus the category pages that list the SKU on every `price.updated` event.
> Never purge the homepage on a price change, even when the SKU is featured there.

## 1. Context

Product pages served stale prices for up to an hour after a price change, because the page cache used a fixed 3600s TTL.

On 2026-10-05 the agent implemented the agreed event-driven purge in `cache/purge.ts`.
During implementation the agent also purged category pages, which had not been discussed, and asked the user to confirm.

## 2. Agent Proposal

> [!abstract] Proposed 2026-10-02
> Lower the TTL to 60 seconds for all product pages.

> [!abstract] Proposed 2026-10-05 (implementation deviation)
> Also purge the category pages that list the SKU on `price.updated`, not only `/p/{sku}`.
> Agent observation: without it, category listings kept showing the old price for up to an hour.

## 3. User Disagreement

> [!warning] User direction
> - 2026-10-02: Rejected the 60s TTL because it would 10x origin load. Keep 3600s and purge the page on price change events instead.
> - 2026-10-05: Accepted the category-page purge ("keep it").
> - 2026-10-05: Do not purge the homepage, even if the SKU is featured there, because the homepage is regenerated every 5 minutes.

### Exchange (verbatim)

> [!quote|user] User · 2026-10-02 09:41:26
> ```text
> 60s TTL everywhere will 10x our origin load. Keep 3600s but purge the page on price change events instead.
> ```

> [!quote|agent] Agent · 2026-10-02 09:43:12
> ```text
> Makes sense. I'll keep the 3600s TTL and add an event-driven purge on `price.updated`, with the TTL as the fallback if a purge is missed.
> ```

> [!quote|agent] Agent · 2026-10-05 16:05:32
> ```text
> The event-driven purge is implemented: `cache/purge.ts` subscribes to `price.updated` and purges `/p/{sku}` and the category pages that list the SKU. Integration tests pass (`pnpm test cache` - 14 passed). I saved the implementation summary to `docs/summaries/2026-10-05-price-purge.md` with an HTML companion at `docs/summaries/2026-10-05-price-purge.html`.
>
> One deviation: category pages are purged too, which we didn't discuss. Without it, category listings kept showing the old price for up to an hour.
> ```

> [!quote|user] User · 2026-10-05 16:06:55
> ```text
> Category purge is fine, keep it. But do not purge the homepage even if the SKU is featured there - homepage is regenerated every 5 min anyway.
> ```

> [!quote|agent] Agent · 2026-10-05 16:09:16
> ```text
> Confirmed: the homepage is not purged; `cache/purge.ts` only targets `/p/{sku}` and category pages. No code change needed.
> ```

## 4. Reconciliation

| Point | Proposed | Changed to | Why |
| --- | --- | --- | --- |
| Product page TTL | 60s for all product pages | Keep 3600s | User: 60s everywhere would 10x origin load. |
| Freshness mechanism | Short TTL | Purge on `price.updated`, TTL as fallback | User direction; agent agreed 2026-10-02. |
| Category pages | Not discussed | Purge category pages that list the SKU | Agent deviation during implementation; user accepted 2026-10-05. |
| Homepage | Not discussed | Never purge on `price.updated` | User direction 2026-10-05: homepage regenerates every 5 min. |

User operating assumption (not verified by the agent): the homepage is regenerated every 5 minutes, so a featured SKU's stale price on the homepage lasts at most about 5 minutes.

## 5. Final agreement

> [!success] Agreed rules
> 1. The product page cache TTL stays at 3600s; do not lower it globally.
> 2. Every `price.updated` event purges `/p/{sku}` for that SKU.
> 3. Every `price.updated` event purges every category page that lists that SKU.
> 4. A `price.updated` event never purges the homepage, even when the SKU is featured there.
> 5. The 3600s TTL is the fallback when a purge is missed.

### Implementation

Status: implemented 2026-10-05 in `cache/purge.ts`.

- Implementation summary: [2026-10-05-price-purge.md](<../../storefront/docs/summaries/2026-10-05-price-purge.md>)
- HTML companion: [2026-10-05-price-purge.html](<storefront/docs/summaries/2026-10-05-price-purge.html>)
- Paths are relative to the `storefront` project; the project's docs are not in this notes vault.

Validation evidence, as reported by the agent on 2026-10-05:

- Rules 2 and 3: `pnpm test cache` passed (14 tests).
- Rule 4: the agent confirmed by reading `cache/purge.ts` that it only targets `/p/{sku}` and category pages; no code change was needed. No test was named that asserts the homepage is excluded.

> [!todo] Open follow-up
> Consider a test in `pnpm test cache` asserting that `price.updated` never purges the homepage, so rule 4 is guarded against regressions.
