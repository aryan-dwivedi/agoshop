# agoshop — UI/UX revamp, committed direction

One direction, no options. Every claim about the current build is cited as `file:line`.
Contrast ratios are computed, not estimated.

Two surfaces, named:

- **Shop** — the customer storefront (today `apps/web/index.html` → `src/customer`, `:5173`).
- **Studio** — the operator console (today `apps/web/seller.html` → `src/seller`, `:5174`).

**Admin is not a third surface.** It is already a role-scoped section of Studio: same origin,
same shell, nav filtered by `account.role` (`SellerLayout.tsx:26-33`), re-checked per page by
`RoleGate`, enforced server-side by `requireRole` (`middleware/session.ts`). It becomes the
**Rules** section. Anything else invents a third deployment for two pages.

---

## 1. Aesthetic thesis

**A confident storefront first; live video is the best aisle in it.**

The product is e-commerce with live selling, not a video room with checkout attached. Shop and
Studio therefore use one light, high-contrast commerce system: warm neutral canvas, white product
surfaces, deep ink, a cobalt purchase action, and red reserved for on-air or destructive status.
Product imagery, price, availability, fulfilment, and trust cues lead every page. Live video enters
as a prominent discovery module, a PDP media mode, and a focused show page; it does not dictate the
global theme or navigation.

Nothing glows, blurs, or sparkles. Manrope gives headings and merchandising moments a distinctive
voice; Inter keeps prices, controls, and dense Studio data stable. Lucide supplies one coherent
outline icon family instead of mixed bespoke glyphs. The video canvas may be dark where contrast
requires it, but its surrounding product rail, assistant, navigation, and buying controls remain
light.

---

## 2. Information architecture and navigation

### 2.1 What dies

| Dies                                                                            | Why                                                 | Replaced by                                                                                     |
| ------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Two stacked header bars (`Layout.tsx:327`, `:398`)                              | 1998 catalog IA on a video product                  | one 56px bar                                                                                    |
| "Deliver to / India 110001" (`Layout.tsx:331-341`)                              | dead UI — no handler, hardcoded                     | pincode at PDP delivery block, cart summary, checkout step 1 (`PincodeCheck` already does this) |
| Scoped search + `All` category `<select>` (`Layout.tsx:39-104`)                 | asks the shopper to pre-classify their own question | one field: products, shows, creators                                                            |
| "Hello, `<name>` / Account & Lists" (`Layout.tsx:175-190`)                      | marketplace account chrome                          | avatar → menu                                                                                   |
| 9-destination category rail (`Layout.tsx:398-464`)                              | chrome doing content's job                          | `Browse` menu panel + category chips inside the home feed                                       |
| "Seller console ↗" / "Admin rules ↗" in the shopper rail (`Layout.tsx:434-453`) | three audiences on one nav                          | Studio link in the account menu, role-gated, cross-origin (`origins.ts:24-28`)                  |
| Header promo string "{n}% off, live sessions only" (`Layout.tsx:456-464`)       | ambient noise; the offer belongs on the show        | live pill + the show's own price ladder                                                         |
| Floating assistant pill (`AssistantDock.tsx:106-121`)                           | third entry point; crops content                    | one entry point per surface (§7)                                                                |
| Home assistant promo band (`Home.tsx:295-345`)                                  | repetition reads as low confidence                  | deleted                                                                                         |
| Duplicate mobile search block (`Layout.tsx:396`)                                | two search bars in one header                       | one field, responsive                                                                           |
| Two container widths (1500 header / 1440 main)                                  | nothing lines up                                    | one `--page-max: 1440px`                                                                        |
| Breadcrumb on `/live/:slug` (`Live.tsx:193-197`)                                | a breadcrumb trail on a video page                  | show title, on the frame                                                                        |

### 2.2 Shop — the one bar

```
┌ 56px, sticky, --surface, 1px --border bottom ─────────────────────────────────────────┐
│ agoshop   Browse ▾   [ Search products, shows, creators        ]   ● 3 live   Ask   ₹2,480 ▾   ◍ │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

- **`Browse ▾`** opens one panel (categories, Live now, Replays, Wishlist, Orders). The category
  rail's nine destinations survive as _content_: chips at the top of the home feed and rows in this
  panel. Nothing is lost; it stops being permanent furniture.
- **Search** is one field. `q` already drives Postgres FTS (`GET /api/products?q=`); the results page
  keeps its facets (`FacetSidebar`) because a real catalog needs them — but the _header_ stops
  asking for a category up front.
- **`● 3 live`** is the only red in the chrome. Zero live sessions → the pill disappears (not "0 live").
  Links to `/live`; single session → straight to `/live/:slug` (`Layout.tsx:315` logic, kept).
- **`Ask`** is the assistant's only entry point on browse surfaces. A word, not a sparkle.
- **Cart shows the money**, not just a count: `₹2,480 ▾`. The cart is repriced server-side on every
  read (`domain/cart.ts`) and a live discount can appear or vanish under the shopper — a number that
  moves is the honest affordance. Opens a right sheet; never navigates away from a running session.
- **Account** avatar → Orders, Wishlist, Addresses, Language, **Studio** (roles `seller|admin` only),
  Sign out. Demo persona logins move to `/login` only — one place, not two (`Layout.tsx:249-283`
  currently duplicates `Login.tsx:188-216`).

**Mobile (<640px):** `agoshop`, search icon, live pill, cart total, avatar. `Browse` collapses into
a bottom tab bar of four: **Live · Browse · Cart · You**. No hamburger.

### 2.3 Shop — from "live now" to "checked out" without leaving the stream

```
home feed live tile
      │ FLIP: poster → stage, 320ms                       (§3.6 motion)
      ▼
/live/:slug ── pin bar under the frame ── [ Add · ₹1,499 ]   ← 48px, amber, in-flow
      │ POST /api/cart/items {liveSessionId}  (exists, Idempotency-Key)
      ▼
cart sheet opens in the SIDEBAR column (380px). Video keeps playing. Audio keeps playing.
      │ "Checkout" inside the sheet: pincode + method remembered → one screen
      ▼
Pay ₹ ─── POST /api/orders (Idempotency-Key) ─── confirmation INSIDE the sheet
      │
      ▼
sheet collapses to an order chip in the pin bar: "Order placed · ₹1,499 ✓"
```

The full-page `/checkout` stays for browse-surface carts, deep links, and as the fallback when the
sheet is unavailable. Rationale: a shopper who navigates away from a live session to pay has left
the room, and the room is the product. The three numbered `StepHeader` cards
(`Checkout.tsx:76-79`) collapse to one screen in the sheet because for a live buyer we already
know the pincode and the method; they expand to three only on first purchase.

### 2.4 Shop route map

| Route                             | Change                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                               | rebuilt: video-first feed (§4.1)                                                                                                                        |
| `/c/:slug`, `/search`, `/p/:slug` | kept; restyled                                                                                                                                          |
| `/live/:slug`                     | rebuilt (§4.2)                                                                                                                                          |
| `/replay/:slug`                   | inherits the viewer layout, transcript-first sidebar                                                                                                    |
| `/live`                           | folded into `/` as the "All shows" view; route kept as a deep link                                                                                      |
| `/cart`, `/checkout`              | kept as pages; primary path is the sheet                                                                                                                |
| `/orders`                         | kept; **`+ /orders/:id`** (server route `GET /api/orders/:id` already exists, `routes/orders.ts:71`)                                                    |
| **`+ /creator/:sellerSlug`**      | creator profile — feature 6 has no route today (confirmed: `sellerName` renders as plain text at `Product.tsx:287`, `Home.tsx:242`, `LiveIndex.tsx:79`) |
| `/wishlist`, `/login`             | kept                                                                                                                                                    |

`/creator/:sellerSlug` composes from what exists: `GET /api/products?sellerId=` (catalog),
`GET /api/sessions?status=live,scheduled,ended` filtered client-side by `sellerName`. **Gap:** there
is no `GET /api/sellers/:slug` and `/api/sessions` has no `sellerId` filter — one small server
addition, named here rather than faked.

### 2.5 Studio — how a seller gets in, and how the surfaces stay apart

Three doors, none of them through the shopping catalog:

1. Account menu → **Studio** (role-gated, cross-origin anchor via `sellerUrl()`).
2. The console origin directly (`:5174` in dev, `console.` subdomain in production).
3. During a show: the shopper-side session tile already renders a host link for the owner
   (`LiveIndex.tsx:127`) — kept, but it is the _only_ cross-surface link on the shop side.

The separation is already structural and stays that way: two Vite entries, two origins, one
host-scoped cookie (`vite.base.ts:16-27`), so a shopper never downloads console code and Studio
can be firewalled or redeployed independently.

### 2.6 Studio navigation: rail **and** palette

A left rail teaches the surface; a command palette is the only thing usable while you are talking
to a camera. Both, deliberately.

```
┌ 224px rail (collapses to 64, ⌘\) ┬──────────────────────────────────────────────┐
│ ◍ agoshop Studio                 │  ⌘K  Command palette                         │
│                                  │                                              │
│ ▸ Today                          │  pin 3            price 20%       end show   │
│ ▸ Shows              2 live      │  go to catalog    mute            open chat  │
│ ▸ Catalog            4 low       │                                              │
│ ▸ Orders                         │                                              │
│ ▸ Payouts                        │                                              │
│ ▸ Audience                       │                                              │
│ ▸ Rules            admin only    │                                              │
│ ▸ Settings                       │                                              │
└──────────────────────────────────┴──────────────────────────────────────────────┘
```

Badge counts on the rail are the only ambient alerting in Studio: live shows, low stock, unfulfilled
orders, pending payouts. No toasts in Studio outside the broadcast room.

| Today              | Becomes                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `/` Overview       | `/` **Today**                                                            |
| `/sessions`        | `/shows`                                                                 |
| `/sessions/:id`    | `/shows/:id/report`                                                      |
| `/host/:slug`      | `/live/:slug` — the broadcast room, own chrome, no rail                  |
| `/products`        | `/catalog`                                                               |
| `/products/new`    | `/catalog/new`                                                           |
| `/moderation`      | `/audience` (moderation log + banned words + viewers)                    |
| `/promotions`      | `/rules/promotions` (admin)                                              |
| `/checkout-policy` | `/rules/checkout` (admin)                                                |
| —                  | **`/orders`**, **`/payouts`** — new; server prerequisites named in §4.14 |

The broadcast room is the one Studio screen that drops the rail entirely: full-bleed, its own 48px
strip, 48–56px controls. Everything else is a dense console.

---

## 3. Design tokens

### 3.1 Accent system

| Role            | Token            | Use                                                    |
| --------------- | ---------------- | ------------------------------------------------------ |
| Commerce action | cobalt `#2457E6` | Add to cart, checkout, publish, pin                    |
| Live / danger   | red `#D91E36`    | Filled `LIVE` status; text/outline destructive actions |
| Success         | green `#16784B`  | Paid, in stock, connected; semantic only               |

Cobalt replaces the old amber, iris, navy, and Amazon-derived action colours. It reads as a
conventional trustworthy action on a light storefront and remains distinct from live status.
Red carries both on-air and destructive semantics, separated by form: live is a filled pill with a
dot and the word `LIVE`; destructive actions are never filled until a confirmation surface.

### 3.2 Core tokens

```css
:root,
[data-theme='light'] {
  --bg: #f7f7f5;
  --surface: #ffffff;
  --elev: #ffffff;
  --menu: #ffffff;
  --border: #e3e4df;
  --border-ctl: #a1a49c;

  --text-1: #171816;
  --text-2: #555952;
  --text-3: #72766e;

  --accent: #2457e6;
  --accent-text: #1f4ccc;
  --accent-press: #1d46bb;
  --accent-ink: #ffffff;
  --accent-wash: rgb(36 87 230 / 0.09);

  --live: #d91e36;
  --live-ink: #ffffff;
  --live-wash: rgb(217 30 54 / 0.08);
  --danger-text: #bd1730;
  --success: #16784b;

  --font-sans: 'Inter Variable', 'Noto Sans Devanagari', system-ui, sans-serif;
  --font-display: 'Manrope Variable', 'Inter Variable', system-ui, sans-serif;

  --r-chip: 6px;
  --r-ctl: 10px;
  --r-panel: 14px;
  --r-sheet: 18px;

  --e-1: 0 1px 2px rgb(20 24 18 / 0.06), 0 4px 14px rgb(20 24 18 / 0.04);
  --e-sheet: 0 24px 64px -20px rgb(20 24 18 / 0.3);
}
```

Spacing remains a 4pt base. Shop controls stay at 44–48px; Studio uses the same system at
34–38px. Product surfaces use subtle borders and elevation rather than nested grey panels.

### 3.3 Theme rule

Light is the global default across Shop and Studio: home, search, creator storefronts, PDP, cart,
checkout, orders, assistant, seller dashboards, catalog, rules, and show management.

Dark is opt-in, not a route theme. It is limited to the video rectangle and controls directly
over moving media. The live page's header, product rail, conversation panel, pinned product,
assistant, and all content below the player remain light. This keeps the product legible as
e-commerce while preserving reliable contrast on unpredictable video frames.

### 3.4 Type system

```css
@import '@fontsource-variable/inter';
@import '@fontsource-variable/manrope';
```

**Inter Variable** is the body and UI family: excellent small-size legibility, stable tabular
figures for INR, and broad language coverage. **Manrope Variable** is the display family for
`h1`–`h3`, merchandising headings, and the wordmark; its weight is held near 650 and its tracking
at `-0.025em`. Noto Sans Devanagari remains the fallback for Hindi. Icons come from
`lucide-react`, using the default 2px stroke at 16/18/20/24px; labels accompany unfamiliar actions.
Do not mix emoji, text glyphs, and hand-drawn SVG paths into the icon set.

**Scale — ratio 1.2 (minor third), 16px base on Shop:**

| Token    | px / line-height | Use                                                     |
| -------- | ---------------- | ------------------------------------------------------- |
| `--t-11` | 11 / 16          | eyebrow, table micro-labels (**Latin only**, see below) |
| `--t-13` | 13 / 20          | metadata, chat timestamps, captions of captions         |
| `--t-14` | 14 / 20          | **minimum size over video**, chat body, chips           |
| `--t-16` | 16 / 24          | body, product titles, prices in lists                   |
| `--t-19` | 19 / 28          | card titles, section headings                           |
| `--t-23` | 23 / 32          | page headings, buy-box price                            |
| `--t-28` | 28 / 36          | show title on the frame                                 |
| `--t-33` | 33 / 40          | hero                                                    |
| `--t-40` | 40 / 48          | one per page maximum                                    |

**Weights:** 400 body · 500 UI labels and chips · 600 headings, prices, numbers · 700 reserved for
`LIVE` and the broadcast deck. No 800/900 — Noto Devanagari's heavy weights outweigh Inter's at
the same value and mixed lines look bolded at random.

**Tracking:**

```
≥28px  → -0.02em      19–23px → -0.01em      16px → 0
13–14px → +0.005em    11px caps → +0.08em
[lang|='hi'], :lang(hi) { letter-spacing: 0 !important; }
```

Devanagari is **never tracked**: positive tracking detaches matras and breaks conjuncts, and
negative tracking collides them. This is why `--t-11` uppercase eyebrows are Latin-only — Devanagari
has no case, so the eyebrow style degrades to weight 600 + `--text-3` + no transform, which is a
component variant, not a CSS accident (today's `.eyebrow` at `index.css:58` applies
`uppercase tracking-widest` unconditionally).

**Money:** `font-variant-numeric: tabular-nums` on every price, count and metric.
`formatInr` already produces `en-IN` grouping (`packages/shared/src/money.ts:11-12`) — `₹1,49,900.00`.
Studio tables additionally set `font-feature-settings: 'tnum' 1, 'zero' 1`.

**~30% expansion:** no fixed-width buttons anywhere; primary CTAs are allowed two lines and never
truncate; chips wrap rather than scroll; every table header can wrap to two lines with a 32px row
still holding. `text-overflow: ellipsis` is permitted only on product titles (`line-clamp: 2`) and
chat display names.

**Over video:** minimum 14px / weight 500, and never `--t-11` caps. A 500-weight 14px label on
`--chip` clears AA against a white frame at 9.4:1 (§5).

### 3.5 Spacing, radius, elevation as used

- **Shop rhythm:** 8pt outer (`--s-2/4/6/8`), 4pt inner. Minimum touch target 44×44 with an 8px gap;
  no hover-only affordance exists anywhere on Shop.
- **Studio rhythm:** 4pt throughout. Control height 32, table row 32, section padding 12–16.
- **Radius:** never above `--r-panel` on anything containing video; 16px corners on a 16:9 frame
  visibly clip the subject at typical stage sizes.
- **Elevation on dark = surface steps.** `--bg → --surface → --elev → --menu` is the whole ladder;
  shadows are invisible at these luminances and cost a composite layer. Shadows exist only for
  genuinely detached overlays (`--e-sheet`) and drag (`--e-drag`). Light-theme paperwork gets one
  card shadow because paper implies it.

### 3.6 Motion language

| Token             | Where                                                          | Meaning it carries                                 |
| ----------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| `--d-echo` 80ms   | pressed state, price swap, add-to-cart tick                    | "I received that"                                  |
| `--d-ctl` 140ms   | buttons, chips, tab underline, hover                           | none — it just isn't instant                       |
| `--d-panel` 220ms | assistant panel, cart sheet, pin bar, moderation drawer        | "a layer arrived beside the content, not over it"  |
| `--d-stage` 320ms | joining a session                                              | "you moved rooms"                                  |
| 1.8s loop         | `LIVE` dot                                                     | "still on air" — opacity only, no scale, no layout |
| 1.4s              | reaction float (existing `flyingReactions.ts`, canvas, pooled) | "other people are here"                            |

Three transitions are load-bearing:

1. **Joining a session.** The feed tile's poster is the stage. FLIP: measure tile rect, mount the
   stage, transform from tile→stage over `--d-stage` `--ease-out`, drop the transform. The title and
   `LIVE` pill fade in at 140ms _after_ the frame lands, so the video is the first thing that moves.
   **Fallback:** `prefers-reduced-motion`, or `navigator.deviceMemory < 4`, or `hardwareConcurrency <= 4`
   → 140ms crossfade, no transform.
2. **Pinning a product.** The line-up tile translates into the pin bar (`--d-panel`, `--ease-emphatic`)
   and a 2px amber underline wipes across the bar (140ms). The **price never animates** — money that
   moves reads as money that is being manipulated. A price change is an 80ms opacity echo in place.
3. **Assistant opening.** Content swap in the sidebar column at `--d-panel`, opacity + 8px Y only.
   No scale, no gradient sweep, no icon spin. It is a panel, not an entrance.

`@media (prefers-reduced-motion: reduce)` → all transforms become opacity ≤140ms; the reaction
canvas already opts out (`FlyingReactionsOverlay.tsx`); the `LIVE` dot stops pulsing and stays at
full opacity.

### 3.7 Studio overrides and the density contract

```css
/* Studio = the same tokens at 0.75× density. Loaded only by seller.html. */
[data-surface='studio'] {
  /* ---- type scale: base 13, same 1.2 ratio ---- */
  --t-body: 13px;
  --lh-body: 18px; /* Shop: 16 / 24 */
  --t-label: 12px;
  --lh-label: 16px;
  --t-micro: 11px;
  --lh-micro: 14px;
  --t-h3: 15px;
  --t-h2: 17px;
  --t-h1: 20px; /* Shop: 19 / 23 / 33 */
  --t-metric: 24px; /* the only large type in Studio */

  /* ---- control sizing ---- */
  --ctl-h: 32px; /* Shop: 44px minimum */
  --ctl-h-sm: 26px; /* table-inline actions; keyboard-reachable, never touch-only */
  --row-h: 32px; /* table row; Shop list rows are 56–72 */
  --pad-section: var(--s-3); /* 12px; Shop uses 16–24 */
  --pad-cell: var(--s-2) var(--s-3);
  --gap-grid: var(--s-3);

  /* ---- elevation: flat. Borders only. ---- */
  --e-1: none;
  --e-sheet: 0 12px 32px -12px rgb(0 0 0 / 0.6);
}

/* The broadcast room is the exception INSIDE Studio: two seconds of attention. */
[data-surface='studio'][data-room='broadcast'] {
  --t-body: 15px;
  --lh-body: 20px;
  --t-metric: 28px;
  --ctl-h: 48px; /* deck controls */
  --ctl-h-lg: 56px; /* pin, end */
  --pad-section: var(--s-4);
}
```

**The density contract, stated explicitly.**

|                  | Shop                                | Studio                         | Broadcast room             |
| ---------------- | ----------------------------------- | ------------------------------ | -------------------------- |
| Body type        | 16 / 24                             | 13 / 18                        | 15 / 20                    |
| Largest type     | 40                                  | 24 (metrics only)              | 28 (metrics)               |
| Control height   | 44 min                              | 32 (26 inline)                 | 48–56                      |
| Row height       | 56–72                               | 32                             | 40                         |
| Grid rhythm      | 8pt outer / 4pt inner               | 4pt                            | 8pt                        |
| Section padding  | 16–24                               | 12                             | 16                         |
| Elevation        | steps + 1 shadow on light paperwork | steps only, flat               | steps only, flat           |
| Input assumption | touch, no hover, no keyboard        | keyboard + hover + real screen | keyboard-first, glanceable |
| Data density     | one decision per screenful          | tables, 20+ rows visible       | one decision, zero reading |

**Shared, and never forked:** every colour token, radius, motion token and easing, the focus ring,
the type _family_ and tracking rules, `PriceTag`, the `LIVE` pill, the icon set, `formatInr`, and the
over-video legibility rules (Studio has video too).

**Forked deliberately:** type _scale_, spacing multiplier, control and row heights, elevation, and
whether hover may carry meaning (Studio yes, Shop never).

---

## 4. Screen-by-screen specs

### 4.1 Shop — Home / discovery

**First thing noticed: a playing video, edge to edge, with a price on it.**

```
┌ top bar 56 ─────────────────────────────────────────────────────────────────────┐
├─────────────────────────────────────────────────────────────────────────────────┤
│ ┌ STAGE (hero) ─ 16:9, --r-panel, full --page-max width ──────────────────────┐ │
│ │  [LIVE ● ] [ 1,204 watching ]                                              │ │  top scrim
│ │                                                                            │ │
│ │                        (muted autoplay, poster-first)                      │ │
│ │                                                                            │ │
│ │  Monsoon Kurta Drop                                    ┌──────────────────┐ │ │  bottom scrim
│ │  Meera · Aurum Label                                   │ ₹1,499  ₹1,899   │ │ │
│ │                                                        │ 21% while live   │ │ │
│ │  [ Watch now ]                                         │ [ Add · ₹1,499 ] │ │ │
│ └────────────────────────────────────────────────────────┴──────────────────┘ │ │
│                                                                                 │
│  Live now (3)                                                        See all →  │
│  [tile] [tile] [tile]            ← 16:9 posters, LIVE pill, viewers, price from  │
│                                                                                 │
│  Starting soon (2)                                                              │
│  [tile 8:00 PM] [tile Sat 6:00]  ← countdown from serverNowMs, no urgency copy   │
│                                                                                 │
│  Watch again (6)                                                                │
│  [replay tiles with duration]                                                   │
│                                                                                 │
│  Shop by category    [Electronics] [Fashion] [Home] [Beauty] [Fitness]          │
│                        ← the dead category rail, now content, chips not tiles    │
│  For you  ·  Recently viewed  ·  Because you wishlisted                         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- **Autoplay policy:** exactly **one** video plays at a time — the hero, muted, and only when
  `matchMedia('(min-width: 768px)')` and `navigator.connection.effectiveType` is `4g`. Everything
  else is a poster (`LivePreviewMedia` already renders still frames — keep it and stop there).
  On `2g`/`3g`/`saveData`, the hero is a poster too, with a play affordance.
- Hierarchy: stage → live rail → schedule → replays → catalog. The catalog is _below_ the shows.
  That inversion is the whole redesign in one screen.
- Data: `GET /api/sessions?status=live,scheduled,ended` (exists), `GET /api/categories`,
  `GET /api/recommendations?basedOn=`.
- **States:** _loading_ — one stage-shaped skeleton plus two rail skeletons, no spinner;
  _no live sessions_ — the hero becomes the **next scheduled show** with a countdown and the copy
  "Next show, 8:00 PM" (never "no live sessions"); _nothing scheduled either_ — the hero becomes the
  top replay, labelled `REPLAY`; _offline_ — a single `--surface` bar under the top bar:
  "You're offline. Showing what we already loaded." (the current build has no offline state anywhere).
- Retire: `AssistantStrip` (`Home.tsx:295-345`), `TrustStrip`, the `npm run db:seed` copy
  (`Home.tsx:490`, `:512`, `:572`).

### 4.2 Shop — Live session viewer ⟵ flagship

**First thing noticed: the video, and nothing black around it.**

The letterboxing fix, precisely. Today the theatre grid fixes its own height
(`lg:h-[min(78vh,46rem)]`, `Live.tsx:257`) and the video is `object-contain`
(`VideoStage.tsx:386`) with RTC `fit:'contain'` (`VideoStage.tsx:244`) — so any frame whose aspect differs from
the column's gets bars, and the title sits in one of them (`Live.tsx:389-447`).

**The box is sized from the stream, not the layout:**

```css
.stage {
  aspect-ratio: var(--stream-ar, 16 / 9); /* set from JoinSessionDto, corrected on loadedmetadata */
  max-height: calc(100dvh - var(--bar-h) - var(--pin-bar-h) - var(--s-4));
  width: 100%;
}
.stage video {
  width: 100%;
  height: 100%;
  object-fit: cover;
} /* cover is now lossless: the box matches */
```

The sidebar becomes the flex absorber (`align-self: stretch`, own scroll), so leftover height goes
to chat instead of to black bars. Portrait publishes (9:16, phone-hosted shows — common in this
market) clamp the stage to 62% width and the pin bar moves _beside_ the frame rather than under it.

**Wide desktop, ≥1440px:**

```
┌ top bar 56 ───────────────────────────────────────────────────────────────────────────┐
├────────────────────────────────────────────────────────┬──────────────────────────────┤
│ ┌ STAGE  aspect-ratio: var(--stream-ar) ─────────────┐ │  Chat │ Shop │ Transcript    │ 380
│ │ [LIVE ●] [1,204 watching] [CC]                     │ │ ──────┴───────┴───────────── │
│ │  Monsoon Kurta Drop · Meera                        │ │  meera  Next up, the indigo… │
│ │                                          ┌───────┐ │ │  asha   size for 5'4"?       │
│ │                                          │ poll  │ │ │  ravi   ordered ✓            │
│ │  ····· captions ·····                    └───────┘ │ │                              │
│ │                                     [♡] [mute] [⛶] │ │                              │
│ └────────────────────────────────────────────────────┘ │                              │
│ ┌ PIN BAR 96 — in flow, never floating ──────────────┐ │                              │
│ │ [img] Indigo Kurta, hand-block   ₹1,499  ₹1,899    │ │                              │
│ │       21% while live                [ Add · ₹1,499 ]│ │                             │
│ └────────────────────────────────────────────────────┘ │ ┌ composer ─────────────────┐│
│                                                        │ │[Chat|Ask] type…    [mic]▸ ││
└────────────────────────────────────────────────────────┴─┴───────────────────────────┘│
```

**One navigation model.** The sidebar has exactly one: three segments — **Chat · Shop · Transcript**.
The bottom segmented toggle dies as _navigation_ and survives as a _destination switch inside the
composer_ (`[Chat|Ask]`), because it answers "where does this text go", which is a control, not a
place. The floating assistant button dies. Net visible nav controls: 3 segments + 1 destination
switch, down from 3 tabs + 2 segments + 1 floating button.

**The rail that makes the money is never covered.** The pinned product lives in an **in-flow bar
directly under the frame**, full stage width, 96px, with a single 48px amber `Add · ₹1,499`. Nothing
floats over it — the assistant opens in the sidebar column, the cart opens in the sidebar column,
polls sit _on the frame_ (top-right, inside the top scrim), and reactions are a stage-edge control.
The full line-up lives in the **Shop** segment on desktop and _only_ there — the duplicate
below-theatre rail (`Live.tsx:571` alongside `Live.tsx:551`) renders at `<1024px` only.

**Laptop, 1024–1439px:** sidebar 320, pin bar 88, stage `max-height: calc(100dvh - 56 - 88 - 16)`.
Captions move to two lines. Poll collapses to a chip on the frame that expands on click.

**Mobile browser, <1024px:**

```
top bar 56 (condensed)
STAGE      position: sticky; top: var(--bar-h);  aspect-ratio from stream
PIN BAR 72 position: sticky; top: calc(var(--bar-h) + stageH)   ← both stay while you scroll
[ Chat · Shop · Transcript ]  segments, sticky under the pin bar
   panel content scrolls
composer   position: fixed; bottom: env(safe-area-inset-bottom); height uses dvh
```

The stage and the buy affordance are the two things that never scroll away. Reactions become a
single tap zone on the stage's right edge (long-press opens the 5-emoji picker) instead of a bar
that eats 40% of the width. Landscape: stage goes full-screen, segments become a swipe-up sheet at
40dvh.

**States:** `connecting` (frame-shaped skeleton + "Connecting"), `waiting for host` (standby feed,
labelled "Standby — the host hasn't started yet"; the "Simulated feed · synced for every viewer"
string at `VideoStage.tsx:420` dies), `scheduled` (`ScheduledStage` countdown on cover art),
`ended` ("This show has ended" + `Watch the replay` as the single primary), `tier handover`
(RTC→CDN: **no UI at all** — today `LiveBadge` accepts `deliveryTier` and renders nothing, which is
correct; keep it silent), `chat joining` (progress from `useChat`), `chat reconnecting`,
`muted by moderator`, `rate limited`, `low viewer count` (**show nothing** — "1 watching" dies;
viewer count renders only at ≥10, otherwise the pill is absent), `offline`
(stage keeps its last frame + "Reconnecting" chip, sidebar goes read-only).

### 4.3 Shop — Assistant, collapsed and expanded

Specified in full in §7.

### 4.4 Shop — Product detail: in-session vs standalone

Two different components, one price primitive.

**In-session (opened from the line-up while a show runs).** Never a navigation. A sheet in the
sidebar column, 380px, dark:

```
[ ← back to chat ]
image 380×285 (object-fit: contain on #FFFFFF tile)
Indigo Kurta, hand-block                        --t-19
₹1,499   ₹1,899   21% while live                PriceTag lg, --accent price
Size  [ S ][ M ][ L ][ XL ]                     44px targets
[ Add · ₹1,499 ]                                48px, full width, amber
Delivery to 560001 · 3 days                     one line, tappable to change
Highlights · 3 bullets max
[ Ask about this ]                              → assistant, context = this product
```

No breadcrumb, no compare, no similar-products rail, no reviews section: a shopper watching a
video will not read a spec table, and every one of those is a route out of the room.

**Standalone `/p/:slug`** keeps the full PDP — light theme, gallery, variants, `PincodeCheck`,
comparison, similar rail — with three changes: the gallery drops `aspect-square object-contain`
padding in favour of a `contain`-fit _inside_ a fixed 4:5 tile so card and PDP crop identically;
the buy box's two buttons collapse to one cobalt `Add to cart` plus a text `Buy now` (one action
colour, one hierarchy); and if the product is in a live or scheduled show, a single row above the
price: `● Live now in "Monsoon Kurta Drop" — ₹1,499 while live  [ Watch ]`.

### 4.5 Shop — Cart and checkout

Light theme. The cart is a **sheet** from a session, a **page** from browse; same component.

```
Cart (3)                                      ← --t-23
──────────────────────────────────────────────
[img] Indigo Kurta · M                        --t-16
      ₹1,499  ₹1,899                          PriceTag
      ● Live price — locked while the show runs
      qty [− 1 +]                    Remove
──────────────────────────────────────────────
Subtotal                            ₹4,297
Live discount (LIVE20)             −₹1,074    --success
Total                               ₹3,223    --t-23, tabular
[ Checkout · ₹3,223 ]                         48px cobalt
```

The live-pricing states already exist server-side and only need honest copy:

| State                        | Today                                                            | Becomes                                                                     |
| ---------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| line bound to a running show | "Live session line"                                              | `● Live price — locked while the show runs`                                 |
| show ended                   | "Session ended — live pricing withdrawn"                         | `Show ended — back to ₹1,899`                                               |
| banner, active               | "Eligibility is re-evaluated server-side on every cart read…"    | _deleted_                                                                   |
| banner, expired              | "The live session ended — its live-only offer no longer applies" | `The show ended, so its live price came off. Everything else is unchanged.` |
| suppressed promo             | "cannot be combined" + reason code                               | `LIVE20 is better than WELCOME10, so we applied it`                         |

**Checkout**, three steps on a page, one screen in the sheet: `Deliver to` (pincode, ETA,
serviceability), `Pay with` (methods from `GET /api/checkout/options`), `Review`. All the
implementation leaks go: the mock-card paragraph (`Checkout.tsx:346-351`), the idempotency
explainer (`Checkout.tsx:542-545`), the `/admin/checkout-policy` pointer (`Checkout.tsx:278-279`), the atomic-decrement
sentence (`Checkout.tsx:425-427`).

**States:** `declined` → `That payment didn't go through. Nothing was charged. [ Try another method ]`;
`out_of_stock` → names the line, offers to remove it; `pricing_changed` → the existing reconfirm,
relabelled `Price changed to ₹3,223 — confirm?` with a diff row; `below minimum` → `Add ₹277 to
check out`; `pincode blocked` → the reason, plus `Change pincode`.

### 4.6 Shop — Creator profile `/creator/:sellerSlug`

**First thing noticed: whether they are live right now.**

```
┌ cover: live stage if live, else next-show cover, else top replay ──────────┐
│  [LIVE ●]  Meera · Aurum Label        1,204 watching   [ Watch now ]       │
└───────────────────────────────────────────────────────────────────────────┘
 Next show  Sat 6:00 PM · Festive edit          [ Remind me ]   ← needs no server work: local
 ────────────────────────────────────────────────────────────────────────────
 [ Shows 12 ] [ Catalog 48 ] [ About ]        ← one nav model, three segments
 grid of replays / product grid / plain prose
```

New route; composition and the one server gap are named in §2.4. `Remind me` is a client-side
calendar link (`.ics` / Google Calendar URL) so it ships without a notifications backend — stated
plainly rather than mocked.

### 4.7 Shop — Empty, loading, offline, low-viewer, session-ended

One rule: **a state is a sentence about what is true, plus at most one action.** No illustrations,
no mascots, no "oops".

| State                   | Treatment                                                                                                                                                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading                 | Shape-matched skeletons (`--surface` blocks, `animate-pulse` at 1.6s). Never a centered spinner on a route that has a known shape. The `Suspense` spinner (`App.tsx:27-32`) is replaced by a route-level skeleton.                                                                                                   |
| Empty cart              | `Nothing in your cart yet.` + `[ See what's live ]` — links to shows, not to the catalog.                                                                                                                                                                                                                            |
| Empty wishlist / orders | one line + one action. The `has_wishlisted` segment explainer (`Wishlist.tsx:43-45`) dies.                                                                                                                                                                                                                           |
| No search results       | `No matches for "kurta silk". [ Clear filters ]` + the 5 category chips (already built).                                                                                                                                                                                                                             |
| Offline                 | A single `--surface` bar under the top bar, persistent, with a retry: `You're offline. [ Retry ]`. On `/live/:slug` the stage holds its last frame and the sidebar goes read-only. **This state does not exist today anywhere in the app** — `useServerEvents` reopens silently and the viewer count simply freezes. |
| Low viewer count        | Render nothing below 10 viewers. "1 watching" is a fact nobody benefits from.                                                                                                                                                                                                                                        |
| Session ended           | Full-stage card: `This show has ended.` `[ Watch the replay ]` (primary, amber) · `[ See what's live ]` (text). If the recording is not ready: `The replay will be here in a few minutes.` — no `recording: pending` status string.                                                                                  |
| Sold out                | `Out of stock` on the tile, add button disabled, no numeric count anywhere on Shop.                                                                                                                                                                                                                                  |

**Two judgment calls, named.** (1) _Countdowns._ The brief bans countdown timers as manufactured
urgency, and I keep exactly one: the time remaining until a **scheduled show starts**, anchored on
`serverNowMs`. A broadcast start time is a fact about the world, not a scarcity device, and without
it a shopper cannot decide whether to wait. What I gave up: the rule is no longer absolute, so it
needs policing — the countdown is only ever attached to a _session start_, never to a price, an
offer, or a stock level, and it renders in `--text-2`, never in `--live` or `--accent`.
(2) _Reaction tallies._ Still absent, as today. A visible count invites brigading and tells the
shopper nothing; the drifting particles already carry "other people are here".

**Deliberate trade:** exact stock counts ("Only 2 left", `ProductCard.tsx:88-89`) are removed
from Shop entirely. They are the most effective conversion lever in Indian e-commerce and I am
giving it up, because the brief bans manufactured urgency and a truthful count is
indistinguishable from a manufactured one at a glance. Numeric stock stays in Studio, where it is
an operational fact.

### 4.8 Studio — Today (console home)

**First thing noticed: the next thing that requires the seller.**

```
┌ rail ┬ Today ────────────────────────────────────────────────────────────────────┐
│      │ ┌ NEXT UP — only rendered when a show starts within 60 minutes ─────────┐ │
│      │ │ Festive Edit · starts in 38 min · 6 products · live price 20%         │ │
│      │ │ ▸ camera not tested   ▸ 1 product out of stock                        │ │
│      │ │ [ Pre-flight ]  [ Edit line-up ]                                      │ │  48px
│      │ └──────────────────────────────────────────────────────────────────────┘ │
│      │ ── live now (if any) ──────────────────────────────────────────────────── │
│      │ ● Monsoon Kurta Drop · 00:42:11 · 1,204 watching · ₹1,84,200  [ Open ]   │
│      │ ── today ───────────────────────────────────────────────────────────────  │
│      │ GMV ₹1,84,200   Orders 122   Conv. 3.4%   Peak 1,204   Discount ₹34,100  │  --t-metric 24
│      │ ── needs you ───────────────────────────────────────────────────────────  │
│      │ 4 products low stock · 2 orders unfulfilled · payout ₹1,02,400 on 12 Sep │
│      │ ── last 5 shows ────────────────────────────────────────────────────────  │
│      │ table, 32px rows: show · when · peak · orders · GMV · conv. · [report]   │
└──────┴──────────────────────────────────────────────────────────────────────────┘
```

The `NEXT UP` block is conditional and is the answer to "what does it surface when a session is
scheduled in the next hour": it is the only card on the screen with 48px controls, it lists
_blockers_ (untested camera, out-of-stock line items, missing cover), and it links straight to
pre-flight. Outside that window it is not rendered — no empty "no upcoming shows" card.

Data: `GET /api/seller/overview` covers GMV, orders, conversion, peak, unique, add-to-carts,
discount, AI counts, `recentSessions` (`analytics.ts:274`). "Unfulfilled orders" and "payout"
are gated on the gaps in §4.14 — until those land, those two rows are **not rendered**, not zeroed.

### 4.9 Studio — Session builder `/shows/new`, `/shows/:id`

Three columns, one screen, no wizard. `SessionScheduler.tsx` already models all of this; it becomes
a layout instead of a 655-line form.

```
┌ Details ───────────┬ Line-up ───────────────────┬ Pricing & schedule ─────────┐
│ Title              │ [ search catalog        ]  │ Live price   [ −20% ]        │
│ Slug (auto)        │ ┌──────────────────────┐   │  10% · 20% · 30% · custom    │
│ Description        │ │ ☑ Indigo Kurta  ★    │   │  applies only while live     │
│ Language  [hi-IN]  │ │ ☑ Silk Dupatta       │   │                              │
│ Cover image        │ │ ☐ Cotton Stole       │   │ Starts    [ 06 Sep 18:00 ]   │
│ Expected peak 1500 │ └──────────────────────┘   │ Mode  ( ) I'll go live        │
│                    │ drag to reorder            │       (•) Premiere a video    │
│                    │ ★ = on camera first        │       ( ) Go live now         │
│                    │ 6 selected · 1 out of stock│ Video  [ upload .mp4 ]        │
└────────────────────┴────────────────────────────┴──────────────────────────────┘
                                      [ Save draft ]   [ Schedule show ]
```

- The `★ featured` product is what the pin bar shows at t=0. One star only (server already enforces
  `multiple_featured`).
- Out-of-stock items in the line-up are flagged at build time, not discovered on air.
- Upload failure is already separable from creation (`SessionScheduler` tracks `uploadError`
  independently) — surface it as a retry row on the saved show, not a lost form.
- **States:** draft (autosaved), scheduled, live (line-up editable, schedule locked), ended
  (read-only + `[ Duplicate ]`), `slug_taken`, `premiere needs a video`, `discount out of range`.

### 4.10 Studio — Pre-flight `/live/:slug/preflight`

The screen that prevents the failures in 4.11. Full-bleed, no rail, three checks, one button.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  Festive Edit — starts in 38 min                                  [ Skip ]     │
│  ┌ camera & mic ───────────────────────┐  ┌ checks ───────────────────────────┐│
│  │                                     │  │ ✓ Camera    Logitech C920         ││
│  │        self preview, mirrored       │  │ ✓ Mic       level ▁▃▅▃▁ speak now  ││
│  │        aspect-ratio from track      │  │ ✓ Uplink    2.4 Mbps · 42 ms · 0%  ││
│  │                                     │  │ ⚠ Recording browser mp4 only      ││
│  │  [ camera ▾ ] [ mic ▾ ] [ 720p ▾ ]  │  │ ✓ Line-up   6 products, 1 low     ││
│  └─────────────────────────────────────┘  └───────────────────────────────────┘│
│  Recording consent: ☑ Viewers are told this show is recorded                    │
│                                                    [ Hold to go live ]  56px    │
└────────────────────────────────────────────────────────────────────────────────┘
```

The uplink check runs a 10-second publish to a throwaway channel and reads
`getLocalVideoStats()` + `getRTCStats()` (§4.11 data contract) so the number shown is measured,
not promised. `[ Skip ]` exists because a seller who is already late must be able to go live in one
click; skipping marks the show so the broadcast room's first 30 seconds show the health ribbon
expanded.

### 4.11 Studio — Broadcast control room `/live/:slug` ⟵ flagship

**First thing noticed: your own face, correctly framed, with a green ribbon under it.**

Attention budget is ~2 seconds. Therefore: no rail, no tabs that hide state, no number that must be
read to be understood, every control reachable by one key.

```
┌ 48 ── Festive Edit ── ● LIVE ── 00:42:11 ── 1,204 watching ────── health ▓▓▓▓▓▓▓░ ── [Hold to end] ┐
├──────────────────────────────────────────────────────────────────┬─────────────────────────────────┤
│ ┌ MONITOR  aspect-ratio from the published track ─────────────┐  │  Chat │ Moderation               │
│ │                                                             │  │ ─────┴───────────                │
│ │                    self (+ co-host PiP)                     │  │ asha   size for 5'4"?     [⋯]   │
│ │                                                             │  │ ravi   ordered ✓                 │
│ │  ····· your captions, as viewers see them ·····             │  │ ⚑ neha  <flagged word>    [⋯]   │
│ ├─────────────────────────────────────────────────────────────┤  │                                 │
│ │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  Uplink good · 2.4 Mbps            │  │ [ Pin a message ]               │
│ └─────────────────────────────────────────────────────────────┘  │                                 │
│ ┌ LINE-UP — one keystroke each ───────────────────────────────┐  │ ── this show ──                 │
│ │ [1 PINNED Indigo Kurta ₹1,499] [2 Dupatta] [3 Stole] [4 …]  │  │ Units 122   ₹1,84,200          │
│ └─────────────────────────────────────────────────────────────┘  │ Conv. 3.4%  Carts 512          │
│ ┌ DECK 64 ────────────────────────────────────────────────────┐  │ Stock: Kurta 38 · Dupatta 4     │
│ │ [Mic M] [Cam V] [Price D] [Poll P] [Captions C]             │  │                                 │
│ └─────────────────────────────────────────────────────────────┘  │                                 │
└──────────────────────────────────────────────────────────────────┴─────────────────────────────────┘
```

**Keyboard map** (none of this exists today — `Host.tsx` has no shortcuts at all):
`1`–`9` pin that line-up slot · `0` unpin · `M` mic · `V` camera · `D` price · `P` poll ·
`C` captions · `⌘K` palette · `Shift+E` (held) end · `?` overlay of this map.
Every shortcut has a visible label on its control; nothing is keyboard-only.

**Stream health, readable peripherally.** A 6px ribbon welded to the monitor's bottom edge — in the
seller's peripheral vision while they look at the lens above the screen. 60 one-second cells,
three states only, plus two words. Encoding is redundant (colour + height + position + word), so it
survives colour-blindness and a glance:

| State  | Rule                                                                                                              | Ribbon                              | Escalation                                                   |
| ------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| good   | `sendBitrate ≥ 0.8 × targetSendBitrate` **and** `currentPacketLossRate < 0.02` **and** `uplinkNetworkQuality ≤ 2` | 6px, `--success`, "Uplink good"     | none                                                         |
| strain | bitrate 0.5–0.8×, or loss 2–8%, or uplink 3–4                                                                     | 10px, `--accent`, "Uplink weak"     | monitor gains a 2px `--accent` inset border                  |
| bad    | below that, or `connection-state` ∈ {RECONNECTING, DISCONNECTED}                                                  | 10px, `--live`, "Losing connection" | inset border `--live` + the chip in the failure states below |

The border-on-the-monitor is the important part: a 2px change at the edge of the thing you are
already staring at is detectable without reading, and it costs one `box-shadow: inset`. No sound,
no modal, no number you must parse.

**Data contract — verified available in `agora-rtc-sdk-ng@4.24.8`, and not read today.**

| Source                                                             | Fields                                                                                                                             | Verified at                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `client.on('network-quality')`                                     | `uplinkNetworkQuality`, `downlinkNetworkQuality` (0–6)                                                                             | `rtc-sdk_en.d.ts:5194-5222` |
| `client.getLocalVideoStats()`                                      | `sendBitrate`, `targetSendBitrate`, `sendFrameRate`, `captureFrameRate`, `currentPacketLossRate`, `totalFreezeTime`, `encodeDelay` | `:5029-5116`                |
| `client.getRTCStats()`                                             | `RTT`, `OutgoingAvailableBandwidth`                                                                                                | `:141-178`                  |
| `client.on('connection-state-change')`                             | connection state transitions                                                                                                       | `:2633`                     |
| `client.on('token-privilege-will-expire')` + `client.renewToken()` | token refresh                                                                                                                      | `:2723`, usage `:1526`      |

`useHostBroadcast.ts` currently exposes only `state`, `error`, `micEnabled`, `cameraEnabled`,
`source`, recorder state and `remotePublishers` — **zero telemetry, no `connection-state-change`
listener, no token renewal**. Polling these at 1 Hz inside that hook is the single prerequisite for
this screen and needs no server work.

**Failure states — designed, not assumed away.**

1. **Connection drops mid-session.** `RECONNECTING` → monitor dims to 60%, one centered chip:
   `Reconnecting — viewers are seeing the standby feed` (that is literally true: the server does not
   detect a vanished publisher, `domain/sessions.ts:285`, so the room falls back to `liveSourceUrl`).
   Elapsed reconnect timer. Publish-affecting controls disable; chat stays live. At 8 seconds the
   chip offers `[ Audio only ]` — unpublish video, keep talking, because talking through a bad
   uplink is better than a dead room. On `DISCONNECTED`: full-monitor takeover, two buttons,
   `[ Rejoin ]` (re-mint via `POST /api/rtc/token`, re-publish) and `[ End show ]`. The show stays
   `live` server-side; the copy says so.
2. **Token expiry.** `token-privilege-will-expire` → silent `renewToken()`; a chip appears only if
   renewal fails. Today this is unhandled and a long show dies silently at
   `AGORA_TOKEN_TTL_SECONDS`.
3. **A pinned product sells out.** Pinned tile flips to outline with `SOLD OUT` in `--danger-text`
   (never a fill); one deck banner: `Indigo Kurta is out of stock — [ Pin Dupatta (2) ]`.
   **Never auto-unpin** — the seller may be mid-sentence about it. Shopper side: the pin bar's Add
   becomes a disabled `Out of stock`. **Prerequisite:** `SessionProductDto` carries `price` but no
   stock (`packages/shared/src/types.ts`), so this needs a stock field on the session rail, driven
   by the existing `catalog.price_changed` event.
4. **Payment gateway error.** The shopper path already classifies `payment_declined` /
   `out_of_stock` / `pricing_changed` (`Checkout.tsx:30-77`) and gets the copy in §4.5. Studio's
   deck shows `Checkout attempts · declines` beside units — **but a declined pre-auth writes no row
   today** (`domain/orders.ts:240`), so until a decline emits an `analytics_events` row that tile
   renders `—`, never `0`. Honest dash over false zero.
5. **Recorder failure.** `useHostRecorder` fails terminally with no retry. The room shows a
   non-blocking deck chip `Replay capture failed` and the post-show report carries
   `[ Retry upload ]` — valid only while the tab lives, because the blob dies with it. The report
   says that in one sentence instead of pretending it can retry later.
6. **Chat transport degraded.** Already handled server-side (`chat.moderated` with
   `action:'degraded_chat'`). UI: a single line at the top of the chat column, `Chat is running on a
backup route`. The `s{shardIndex}` debug string (`ChatPanel.tsx:224`) dies.

**Destructive action protection.** `[ Hold to end ]` — 700ms press, linear fill inside the button,
release early = nothing happens, `Esc` aborts, `Shift+E` held does the same from the keyboard. While
filling, the button's second line reads `1,204 watching`. No dialog, no typed confirmation: the
intentional case is one gesture and 0.7s, the accidental case is impossible.
**Traded away:** discoverability — a hold gesture is less obvious than a dialog, so the label says
"Hold to end" and a one-time inline hint appears the first time it is focused. Today this button is
a single unguarded click (`Host.tsx`, "no confirmation dialog on End session").

**What the room deliberately does not contain:** the co-host invite form, the recording-consent
card, the session-stats `<dl>`, the poll composer's long form, and the moderation participant list
(`Host.tsx` renders all of these inline). They move to pre-flight, the palette, or the right column's
Moderation tab. A control room shows what changes during a show, and nothing else.

### 4.12 Studio — Post-session report `/shows/:id/report`

**First thing noticed: where viewers left, against what was on camera.**

```
Festive Edit · 06 Sep · 58 min                                  [ Replay ] [ Duplicate ]
Peak 1,204   Unique 3,410   Avg watch 4m 12s   Units 122   GMV ₹1,84,200   Conv. 3.4%
┌ viewers over time, with pin markers ─────────────────────────────────────────────┐
│  1204 ┤        ╭──╮                                                              │
│       ┤    ╭───╯  ╰──╮        ╭─╮                                                │
│       ┤ ╭──╯         ╰────────╯ ╰────╮                                           │
│       └─┴──┬────┬────┬────┬────┬────┬┴──────                                     │
│         [1 Kurta][2 Dupatta]  [poll]  [3 Stole]     ← pin windows as bands        │
└──────────────────────────────────────────────────────────────────────────────────┘
Per product: units · add-to-carts · conversion while pinned · minutes pinned
Discount by code: LIVE20 ₹34,100 (91%)  ·  WELCOME10 ₹3,400
Chat 1,842 · Reactions 12,400 · Poll votes 611 · Assistant conversations 214 / 512 tool calls
```

The pin-window bands under the viewer curve are the one genuinely new analysis, and they are
already computable: `viewerSeries` is per-minute (`analytics.ts`), and `topProducts` is _already_
attributed through pin windows (`analytics.ts:55`). Drop-off is read off the same curve; there is no
join/leave-derived drop-off model server-side and this design does not pretend there is one.
Replay/clip performance is **not** on this screen: no view metrics exist for recordings, and no clip
feature exists. Named, not faked.

### 4.13 Studio — Catalog and inventory `/catalog`

Light theme, dense table, 32px rows. `Inventory.tsx` is already close; the changes are hierarchy.

```
Catalog                                   [ search        ] ☐ low stock only   [ + List a product ]
Products 48   Low stock 4   Out of stock 1   Stock value ₹18,42,000
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Product                    Category    Price      Stock   Rating   In shows          │
│ ▸ Indigo Kurta             Fashion     ₹1,499     38      4.4      Festive Edit      │
│ ▾ Silk Dupatta             Fashion     ₹899       4 LOW   4.6      —                 │
│     M   SKU-DUP-M   MRP ₹1,199  Price ₹899  Stock [  4 ]              [ Save ]       │
│     L   SKU-DUP-L   MRP ₹1,199  Price ₹899  Stock [ 12 ]                             │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- Stock is the second-most-important column, so it sits at a fixed position with tabular figures;
  `LOW` and `OUT` are text badges in `--accent` / `--danger-text`, not coloured numbers (a coloured
  number reads as a different number).
- New column **In shows** — which scheduled shows this product is attached to. It is the question a
  seller asks before editing a price, and it is one join away from data that already exists.
- Inline variant editing stays exactly as built (dirty/invalid/pending, server-keyed remount on
  `catalog.price_changed`) — that pattern is correct and gets kept verbatim.
- Retire the copy leak `Checkout decrements atomically, so these cannot be oversold.`
  (`Inventory.tsx:261`).

### 4.14 Studio — Orders and payouts `/orders`, `/payouts`

**These screens have no server behind them today.** Stating that precisely is part of the deliverable.

Exists: `OrderDto` with a single `status: 'paid'`, `items[].liveSessionId` attribution, per-line
discounts, `paymentRef` (`domain/orders.ts`). Missing: any fulfilment or shipping state, any payout
or settlement concept (zero hits for `payout` in `apps/server` and `packages/shared`), and any row
at all for a declined payment.

So the design is scoped to what is real, and the rest is named:

```
Orders                        [ all · live-attributed · this show ]     [ export CSV ]
┌───────────────────────────────────────────────────────────────────────────────────┐
│ Order      When        Items  Total      Discount   From show          Payment    │
│ #A7F2C1    12:04 PM    2      ₹3,223     −₹1,074    Festive Edit       UPI        │
└───────────────────────────────────────────────────────────────────────────────────┘
```

Order detail: lines, the show each line came from, applied promotion codes, `paymentRef`, pincode.
**Fulfilment is not rendered** — no status chips, no "mark as shipped", no tracking field — because
the model does not exist and a disabled control is worse than an absent one.

`/payouts` renders a single honest block until a payout model exists:
`Payouts are not enabled on this account yet.` plus the _computable_ figure — GMV net of discount for
the period, labelled `Gross sales`, never `Payable`. The alternative (a mocked payout schedule) is
the exact failure this brief is trying to escape.

---

## 5. Legibility over video

**Chosen approach: opaque chips plus two static gradient scrims. No `backdrop-filter` over a
playing frame, anywhere, ever.**

Rules:

1. Anything over video is either **on a chip** — `background: rgb(11 12 14 / .78)`, 1px
   `rgb(255 255 255 / .10)` hairline, `--r-pill` for status, `--r-ctl` for controls — or **inside a
   scrim band whose opacity at the text's own baseline is ≥ 0.60**.
2. Minimum type over video: 14px / weight 500. Never 11px caps.
3. `text-shadow: 0 1px 2px rgb(0 0 0 / .5)` is applied as a belt. It is never the mechanism.
4. Icon-only controls over video get the chip, always, because a stroke icon has no mass.

Measured against worst-case frames (computed sRGB WCAG 2.1):

| Foreground                | Backdrop  | Worst-case frame     | Ratio                           |
| ------------------------- | --------- | -------------------- | ------------------------------- |
| `--text-1` on chip @ .78  | composite | pure white `#FFFFFF` | **9.40:1**                      |
| `--text-1` on chip @ .78  | composite | saffron `#F2C744`    | **11.21:1**                     |
| `--text-1` on chip @ .78  | composite | mid grey `#7A7A7A`   | **14.34:1**                     |
| white in scrim band @ .65 | composite | pure white           | **6.21:1**                      |
| white in scrim band @ .55 | composite | pure white           | 4.35:1 — **rejected**, below AA |
| white + text-shadow only  | —         | pure white           | 2.32:1 — **rejected**           |

Hence the 0.60 floor in rule 1, and the ban on shadow-only text.

**Why not blur, and what blur costs.** `backdrop-filter: blur()` over a `<video>` forces the
compositor to snapshot the backdrop _every frame_ and run a separate blur pass on it — the cost is
paid continuously even when the UI is static, and on a mid-range Android GPU (Mali-G52 / Adreno 610
class, which is the majority of this market) that pass is the difference between a stage that holds
30fps and one that sits in the low twenties, plus measurable battery. A gradient scrim is two
`linear-gradient` layers painted once into the same layer as the video wrapper, at zero per-frame
cost, and — per the table above — it produces _higher_ measured contrast than blur does, because
blur preserves luminance while a scrim removes it.

**Where blur is allowed:** only when the source is not playing — the recording-consent gate, the
scheduled-show cover (`ScheduledStage` already blurs cover art), the session-ended card, and a
paused replay. Those are static backdrops, so the blur pass runs once.

**Low-end device policy, as one rule:** `prefers-reduced-motion`, `navigator.deviceMemory < 4`, or
`hardwareConcurrency <= 4` → no FLIP transitions, no reaction canvas (the overlay already opts out
of reduced motion), poster-first hero, and captions capped at two lines instead of three.

---

## 6. Where this lands in the code

| Action                                                | Files                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rewrite**                                           | `components/Layout.tsx` (one bar), `pages/Live.tsx` (stage sizing, one nav model, in-flow pin bar), `pages/Host.tsx` → `pages/studio/Broadcast.tsx`, `seller/SellerLayout.tsx` (rail + palette), `ai/AiPanel.tsx` (states, copy, cards), `index.css` (token-backed component layer)                                   |
| **Retire**                                            | `ai/AssistantDock.tsx` (floating pill), `ai/AssistantToasts.tsx` (the card is the receipt), `Home.tsx` `AssistantStrip`, `components/live/ChatPanel.tsx` (fold into `RoomConversation`, they already duplicate `ROLE_TAG`/`NAME_COLORS`/`hashOf`), the second `SessionProductRail` mount at `Live.tsx:571` above `lg` |
| **Add**                                               | `useStreamHealth.ts` (the 1 Hz telemetry hook, §4.11), `components/HoldToConfirm.tsx`, `components/CommandPalette.tsx`, `pages/Creator.tsx`, `pages/studio/{Orders,Payouts,Preflight}.tsx`, `tokens.css`                                                                                                              |
| **Token migration**                                   | delete `brand`, `iris`, `cta`, `saffron`, `page` and `navy-*` from `tailwind.config.js`; map Tailwind's `colors` to `var(--*)`; delete `.btn-cart`, `.btn-buy`, `.chip-action`, `.card-dark`, `.input-dark`, `.skeleton-dark` (one set of classes reads the theme instead)                                            |
| **Server gaps to close** (named, not designed around) | `stock` on `SessionProductDto`; `GET /api/sellers/:slug` + `sellerId` filter on `/api/sessions`; `analytics_events` row on payment decline; fulfilment status on `orders`; payout model; configurable banned-words list; pinned chat message                                                                          |

---

## 7. The assistant, redesigned

**One entry point per surface. It is a tool, so it looks like a tool.**

| Surface                           | The one entry point                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| Browse (home, catalog, PDP, cart) | the word **`Ask`** in the top bar                                                  |
| Live session / replay             | the **`[Chat｜Ask]`** destination switch inside the composer, plus `/` to focus it |

Everything else dies: the floating pill (`AssistantDock.tsx:106-121`), the home promo band
(`Home.tsx:295-345`), the in-band CTA, the replay `Open assistant` button (`Replay.tsx:228`), and the
per-line hover `Ask AI` buttons collapse into one **quote** affordance on the message row's `⋯`
menu.

**Stripped:** the sparkle glyph everywhere (`SparkleIcon` is deleted from `icons.tsx`), the
iris/purple ramp (deleted from the token set), the gradient bubbles, the halo ring, the avatar, and
all copy that explains its own mechanics — `Full catalog · delivery · payments`,
`anything I mention shows up here as a card you can add`, `you are on text (degraded)`,
`Private to you · reads this room's captions, live chat…`.

**What it looks like instead:** the same `--surface` panel as the cart sheet, the same type, the
same amber only on the `Add` button inside a product card. Its identity comes from position and
behaviour, not colour.

### States

**Collapsed.** A text control. No badge, no glow, no animation, no unread count. On mobile browse
it is the `You` tab's first row and the composer switch in a session — not a floating element.

**Expanded.** 380px right panel on desktop (the same column as chat and cart — mutually exclusive,
one at a time, same z-index), 92dvh bottom sheet on mobile.

```
┌ Ask ───────────────── [ This show ▾ ]  [ EN ▾ ]  ✕ ┐   header 48
│                                                    │
│  What's this kurta made of?                    ▸   │   user turn, right, --elev
│                                                    │
│  Hand-block cotton, 120 GSM. Runs slightly        │   assistant turn, left, no bubble
│  large — size down if you're between sizes.       │
│  ┌────────────────────────────────────────────┐   │
│  │ [img] Indigo Kurta, hand-block             │   │   product card, 72px, in the turn
│  │       ₹1,499  ₹1,899        [ Add ]        │   │   Add = 32px amber
│  └────────────────────────────────────────────┘   │
│                                                    │
├────────────────────────────────────────────────────┤
│ [Chat｜Ask]  Ask about anything here…   [🎤] [ ▸ ] │   composer 56
└────────────────────────────────────────────────────┘
```

- **Context chip** (`This show` / `Indigo Kurta` / `Catalog`) is a control, not a caption: tapping it
  changes scope. It replaces the `contextLabel` prose.
- **Language** is a compact `[ EN ▾ ]` in the header — `hi-IN`, `en-IN`, `en-US`, `es-ES` from
  `GET /api/config supportedLanguages`, plus `Auto`. Already persisted to
  `localStorage['shop.assistant.language']`; keep that.
- **Empty state:** three real prompts from the current context (`browseExamples.ts` already does
  this per surface), no greeting, no explanation of what it can do.

**Listening (voice).** The composer's mic becomes a 40px filled amber circle containing a
**three-bar level meter** driven by RMS off the local track at 30fps (`transform: scaleY` on three
1px divs — no canvas, no halo, no pulse). Label: `Listening`. `Esc` stops. The existing halo
animation (`tailwind.config.js:101-104`) is deleted: a pulsing ring is decoration, a level meter is
feedback — it tells you the mic is actually picking you up, which is the one thing a voice UI must
prove.

**Thinking.** A 2px indeterminate sweep under the header, 1.2s loop, and the user's last turn stays
put. No typing dots — dots imply a person typing, and this is not a person. Nothing is said. After
4s the header note becomes `Still looking`.

**Voice call (ConvoAI active).** The header gains a call strip:

```
┌ Ask ─────────── ● 00:42 · Speaking ── [ Interrupt ] [ End ] ┐
│ Show audio lowered                                          │   one line, --text-3, no icon
```

Agent state maps to exactly one word — `Listening` / `Thinking` / `Speaking` / `Idle` — rendered as
_text in the strip only_. The current build styles agent state twice with two different accent maps
(`AiPanel.tsx:52-68` uses iris/saffron/deal, `RoomConversation.tsx:87-93` uses brand/saffron/deal);
both are replaced by one word and no colour change. The existing audio duck to 15/100 is surfaced as
`Show audio lowered` — a fact the shopper needs, in five words.

**Error / at capacity.** An inline row above the composer, `--surface`, no amber:
`Voice is busy right now — keep typing and I'll answer.` The `(degraded)` and
`disabled in this deployment` strings die.

**Product → add-to-cart card.** Driven by what already exists: `ai.products_shown`
(`{turnId, products: AiProductCard[] ≤6}`) and `ai.tool_executed`. The card renders **inside the
turn**, full panel width, 72px: 56px thumb on a white tile, one-line title, `PriceTag` with the live
price leading, `Add` 32px amber. Multiple products stack vertically, three visible, then
`See 3 more` — the 168px horizontal snap-scroll carousel inside a 380px panel
(`AssistantProducts.tsx`) dies, because a scroll inside a scroll inside a sheet is unusable on a
phone. `AssistantToasts` dies entirely: the card _is_ the receipt, and the toasts collided with the
composer and the unread pill anyway (`bottom-32` vs `bottom-[7.5rem]`).

**Add flow:** `POST /api/cart/items` with `Idempotency-Key` and `liveSessionId` when in a session
(unchanged), then the button becomes `Added ✓` for 1.2s and the top bar's cart total does an 80ms
echo. Errors map in place: `out_of_stock` → `Out of stock`, `invalid_live_session_product` →
`That price ended with the show`.

---

## 8. Component inventory

Framed as a build list. **K** = keep as built, **R** = rewrite, **N** = new, **✕** = delete.

### 8.1 Primitives (shared by both surfaces)

| Component                             | Variants                                                                                                         | States                                                | Notes                                                                                                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button` **R**                        | `commit` (cobalt fill), `standard` (outline `--border-ctl`), `quiet` (text), `danger` (outline, `--danger-text`) | rest, hover, active, focus-visible, loading, disabled | Sizes: `lg` 48 / `md` 44 (Shop) / `sm` 32 / `xs` 26 (Studio). Replaces `.btn-primary/.btn-cart/.btn-buy/.btn-live/.btn-dark/.btn-ghost` — six classes to one component with four intents |
| `HoldToConfirm` **N**                 | 700ms                                                                                                            | idle, holding (fill %), aborted, done                 | `Esc` aborts; keyboard equivalent; used by End show, Delete product, Ban viewer                                                                                                          |
| `PriceTag` **K**                      | `sm/md/lg`, `onMedia`                                                                                            | mrp-only, shop, live                                  | Three-tier ladder off the server DTO, never client-computed. Live price uses `--accent-text` outside the video canvas                                                                    |
| `Money` **N**                         | inline                                                                                                           | —                                                     | `tabular-nums` wrapper over `formatInr`; stops ad-hoc `.toLocaleString` calls                                                                                                            |
| `Chip` **R**                          | `filter`, `status`, `on-video`                                                                                   | rest, selected, disabled                              | `on-video` variant carries `--chip` + hairline. Kills `.chip/.chip-dark/.chip-action`                                                                                                    |
| `LivePill` **R**                      | `default`, `on-video`                                                                                            | live, scheduled, ended                                | One implementation. Today it exists twice (`Live.tsx:391-397` and `LiveBadge.tsx:37-43`)                                                                                                 |
| `Input` / `Select` / `Textarea` **R** | Shop 44, Studio 32                                                                                               | rest, focus, invalid, disabled, loading               | One themed set; `.input-dark` dies                                                                                                                                                       |
| `Field` **N**                         | —                                                                                                                | error, hint                                           | Label + control + message; Devanagari-safe label (no `uppercase`)                                                                                                                        |
| `Segments` **N**                      | 2–4 items                                                                                                        | selected, disabled                                    | The single tab primitive for both surfaces (sidebar nav, creator profile, chat/moderation)                                                                                               |
| `Skeleton` **R**                      | block, text, tile, stage                                                                                         | —                                                     | One component, theme-aware; `.skeleton-dark` dies                                                                                                                                        |
| `StateBlock` **R**                    | empty, error, offline                                                                                            | with/without action                                   | Replaces `EmptyState` + `ErrorState`; max one action; never renders a raw `error.message`                                                                                                |
| `Sheet` **N**                         | right 380, bottom 92dvh                                                                                          | opening, open, closing                                | The one overlay: cart, assistant, in-session PDP, moderation. Mutually exclusive by design                                                                                               |
| `Menu` **R**                          | anchored                                                                                                         | open, keyboard nav                                    | `--menu` surface, roving tabindex                                                                                                                                                        |
| `Toast` **R**                         | one at a time, bottom-center, 4s                                                                                 | —                                                     | Shop only. Never over the pin bar. Studio has no toasts outside the broadcast room                                                                                                       |
| `Icon` **R**                          | 16/20/24                                                                                                         | —                                                     | `SparkleIcon` deleted; icons never carry colour meaning alone                                                                                                                            |
| `Rating` **K**                        | `sm/md`, `onMedia`                                                                                               | rated, unrated                                        | Stars use the commerce action colour outside media                                                                                                                                       |

### 8.2 Shop components

| Component                | Variants                                                  | States                                                                                                   |
| ------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `TopBar` **R**           | desktop, mobile                                           | signed-in, guest, offline, N-live, cart-total                                                            |
| `BrowsePanel` **N**      | —                                                         | loading, loaded, error                                                                                   |
| `MobileTabBar` **N**     | 4 tabs                                                    | active, cart badge                                                                                       |
| `SearchField` **R**      | bar, page                                                 | idle, typing, suggestions (products / shows / creators), no-match                                        |
| `ShowTile` **R**         | live, scheduled, replay                                   | poster, playing (hero only), countdown, ended, viewers ≥10                                               |
| `Stage` **R**            | `stream-ar` driven                                        | idle, connecting, waiting-for-host, playing, standby, reconnecting, tier-handover (silent), ended, error |
| `StageScrim` **N**       | top, bottom                                               | —                                                                                                        |
| `PinBar` **N**           | desktop 96, laptop 88, mobile 72, beside-frame (portrait) | pinned, none pinned, out-of-stock, adding, added, order-placed chip                                      |
| `LineupPanel` **R**      | column (sidebar), rail (<1024)                            | loading, empty, pinned-first, out-of-stock                                                               |
| `ProductCard` **R**      | grid, rail, in-turn (72px)                                | rest, out-of-stock, compare-selected. **No stock counter**                                               |
| `RoomConversation` **R** | chat, chat+assistant lane                                 | joining (progress), live, reconnecting, read-only, muted, rate-limited, degraded                         |
| `MessageRow` **R**       | viewer, host, co-host, moderated, assistant-private       | hover `⋯` (quote / report), deleted                                                                      |
| `TranscriptPanel` **K**  | live, replay                                              | off, listening, empty, results, no-match                                                                 |
| `ReactionControl` **R**  | bar (desktop), tap-zone (mobile)                          | rest, rate-limited                                                                                       |
| `PollCard` **R**         | on-frame chip, expanded                                   | open, voted, closed, results                                                                             |
| `CaptionOverlay` **K**   | 2-line, 3-line                                            | on, off                                                                                                  |
| `CartSheet` **N**        | sheet, page                                               | empty, lines, live-price-active, live-price-expired, checkout, paid                                      |
| `CheckoutSteps` **R**    | 3-step page, 1-screen sheet                               | per-step + declined / out-of-stock / pricing-changed / below-min / blocked-pincode                       |
| `AssistantPanel` **R**   | browse, session, replay                                   | collapsed, expanded, listening, thinking, voice-call, capacity, error, empty                             |
| `CreatorHeader` **N**    | live, next-show, replay                                   | —                                                                                                        |
| `OfflineBar` **N**       | —                                                         | offline, retrying                                                                                        |

### 8.3 Studio components

| Component               | Variants                           | States                                                                                           |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ConsoleRail` **R**     | 224, 64 collapsed                  | active, badge counts                                                                             |
| `CommandPalette` **N**  | global                             | closed, open, filtering, executing, no-match                                                     |
| `MetricRow` **R**       | 3–6 metrics                        | value, unavailable (`—`, never `0`), loading                                                     |
| `DataTable` **R**       | 32px rows, sortable, sticky header | loading, empty, error, row-expanded, inline-editing (dirty / invalid / saving / saved / failed)  |
| `NextUpCard` **N**      | ≤60 min to start                   | blockers, ready                                                                                  |
| `LineupPicker` **R**    | catalog search + selected          | selected, featured (★), out-of-stock, reorder                                                    |
| `PricingControl` **R**  | quick 10/20/30 + custom            | off, set, out-of-range, applying                                                                 |
| `Monitor` **R**         | self, self+co-host PiP             | idle, preview, publishing, reconnecting, disconnected, audio-only                                |
| `HealthRibbon` **N**    | 6px, 10px escalated                | good, strain, bad, unknown (pre-publish)                                                         |
| `LineupStrip` **N**     | keys 1–9                           | pinned, unpinned, sold-out                                                                       |
| `Deck` **N**            | 64px, 48px controls                | mic, cam, price, poll, captions — each on/off/disabled                                           |
| `ModerationList` **R**  | chat, participants                 | flagged, muted, banned, deleted                                                                  |
| `PreflightChecks` **N** | 5 checks                           | pass, warn, fail, running                                                                        |
| `ViewerCurve` **R**     | recharts Area + pin bands          | data, empty, single-point                                                                        |
| `ReportSection` **R**   | per-product, per-code              | data, unattributed, empty                                                                        |
| `RoleGate` **K**        | —                                  | loading, denied, allowed. Only change: the demo-password copy (`RoleGate.tsx:74-78`) is dev-only |

---

## 9. Three risks, and what I'd do about them

**1. A conventional light storefront can make the live differentiator feel secondary.**
If the home page becomes a generic product grid, the core advantage disappears; if live dominates
the entire shell, ordinary browse and checkout feel bolted on.
_Mitigation:_ reserve the first merchandising slot for active shows, use live badges only on real
on-air content, and let show cards carry movement or host imagery while the rest of the page follows
ordinary commerce hierarchy. Measure entry into live shows from home and category pages alongside
product-detail conversion; neither metric is allowed to improve by collapsing the other journey.

**2. Sizing the stage from the stream removes letterboxing but makes layout depend on a value that
arrives late.**
`--stream-ar` is unknown until the first frame, and a host who rotates their phone changes it
mid-show. Naively applied, the page reflows on join and again on rotation, which is worse than a
black bar.
_Mitigation:_ default `16/9`; set from `JoinSessionDto` where the publisher's ratio is known, correct
once on `loadedmetadata`; animate the change exactly once within the first 5 seconds and never
after (later changes snap, because a snap is honest and a slow reflow during a sale is not); the
sidebar is the flex absorber so nothing below the fold moves; portrait publishes clamp the stage to
62% width with the pin bar beside the frame. Trade accepted: on a mid-show rotation the layout
snaps. That is one jarring frame instead of permanent bars.

**3. Half of the Studio design depends on data that does not exist, so shipping the UI first
produces a console full of dashes.**
Verified missing: stream telemetry in `useHostBroadcast` (no `getLocalVideoStats`, no
`connection-state-change`, no `renewToken`), `stock` on `SessionProductDto`, any decline event, any
fulfilment status, any payout model, any drop-off computation, any clip or replay-view metric. The
health ribbon, the sold-out-while-pinned state, the decline readout, orders and payouts all hang off
those.
_Mitigation, in order:_ (a) build `useStreamHealth.ts` first — it is pure client work against APIs
already in the installed SDK, and it unlocks the flagship screen, pre-flight, and two of the six
failure states; (b) add `stock` to the session rail DTO, which is one field and unlocks the
sold-out-while-pinned path; (c) ship the four report tiles that are already computable
(`viewerSeries`, pin-window `topProducts`, `discountByCode`, `gmvMinorUnits`/`conversionRate`) and
render _nothing_ for the rest — a tile that is absent reads as "not built", a tile showing `0`
reads as "you sold nothing", and that lie is worse than the gap; (d) treat payouts and fulfilment as
product decisions, not design ones, and keep `/payouts` at one honest sentence until they exist.
