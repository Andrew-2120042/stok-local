# Stripe / Payments — Deferred Work (TODO)

Status as of 2026-06-20 (Phase 5). **Stripe Connect and Razorpay are intentionally
deferred.** The platform currently collects the full buyer payment into the
platform Stripe account; what each seller is owed is tracked in the
`seller_earnings` ledger (see below). No money is transferred/split to sellers yet.
"Payment split infrastructure comes in a later phase."

This file is the single source of truth for what to wire back up later.

---

## What still works today (kept — NOT Connect)
- `POST /v1/order` (live path) creates a real Stripe **PaymentIntent** charging the
  buyer into the platform account. ✅ keep.
- `POST /v1/webhooks/stripe` verifies signatures and confirms `payment_intent.succeeded`
  → marks order paid, decrements stock, fires developer webhooks. ✅ keep.
- Sandbox orders use mock PIs (`pi_test_mock_*`), no Stripe call. ✅ keep.
- `STRIPE_PLATFORM_FEE_PERCENT` (=10) is used to compute the ledger split. ✅ keep.

---

## TODO — Stripe Connect (deferred)

- [ ] **Enable Connect** on the Stripe account (dashboard.stripe.com/connect).
      Probe currently fails: "you can only create new accounts if you've signed up for Connect".
- [ ] **Seller onboarding** — recreate the removed routes in `seller-portal.ts`:
      - `POST /portal/sellers/stripe-connect` → `stripe.accounts.create({type:'express', country:'IN', ...})`
        + `stripe.accountLinks.create({type:'account_onboarding'})`. NOTE: `business_profile.url`
        MUST be a public https URL (Stripe rejects localhost) — use `https://stok.dev/sellers/:id`.
      - `GET /portal/sellers/onboarding/status` → `stripe.accounts.retrieve()`, set
        `sellers.stripe_onboarding_complete = true` when `details_submitted && charges_enabled && payouts_enabled`.
      - Re-add the seller middleware gate: block product listing until `stripe_onboarding_complete`.
      - Columns already exist on `sellers`: `stripe_account_id`, `stripe_onboarding_complete` (kept, currently unused).
- [ ] **Payment split** — in `apps/api/src/routes/order.ts` (live path), re-add:
      - `transfer_data: { destination: seller.stripe_account_id, amount: total - platformFee }`
      - the `requireConnect` 503 guard (was: `if (STRIPE_REQUIRE_CONNECT !== 'false' && !seller_stripe_account_id) → 503`).
      (Both were REMOVED in Phase 5 — they were dead code since no seller had a Connect account.)
- [ ] **Payouts UI** (`/sellers/dashboard/payouts`) — replace the `seller_earnings`
      ledger view with real `stripe.transfers.list({ destination: seller.stripe_account_id })`.
- [ ] **Refund transfer-reversal** (Part 4) — when a refund is issued on a Connect
      payment, `stripe.refunds.create({ payment_intent, amount })` auto-reverses the seller transfer.
      Until Connect: returns are a state machine only (no real refund — see RETURNS).

## TODO — Razorpay (not started)
- [ ] Evaluate Razorpay Route for INR seller payouts (Stripe Connect has limited India support).

## Removed in this phase (code deleted, behaviour preserved via ledger)
- `seller-portal.ts`: `POST /portal/sellers/stripe-connect`, `GET /portal/sellers/onboarding/status`,
  and the `Stripe` import / `getStripe()` helper.
- `order.ts` live path: `requireConnect` 503 guard + `transfer_data` block + `platformFee` calc used only for it.
- Existing helper script `scripts/setup-stripe-connect.ts` is now dormant (kept for reference).

## Earnings ledger (current substitute for payouts)
- Table `seller_earnings` (migration `00017_seller_earnings.sql`): one row per paid order,
  `gross_amount`, `platform_fee`, `seller_amount`, `status` (pending|paid).
- Inserted automatically when an order transitions to `paid` (sandbox confirm + Stripe webhook).
- Seller dashboard shows `total_earned` (paid) + `pending_payout` (pending).
- [ ] When Connect lands: on a real transfer, flip the matching `seller_earnings.status` → `paid`.
