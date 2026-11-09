# Replace All UI Icons with Lucide — Specification

Status: **Requirements locked** (interview, 4 rounds / 18 questions, Nov 7 2026).
App: RentEase / Digal Boarding House — Svelte 5 / SvelteKit (`adapter-static`, `ssr = false`) / Tauri 2 / SQLite
(`@tauri-apps/plugin-sql`). Android-phone-first, with Windows / macOS desktop builds.

> **Scope discipline:** this is a **frontend icon swap only**. One new npm dependency (`@lucide/svelte`), one new
> component (`src/lib/components/Icon.svelte`), and edits to the component files listed in §7. **No Rust, no
> `tauri.conf.json`, no native icon assets, no layout redesign, no new icons** (Decision 15).

---

## 1. Overview

The request, in the user's words:

> *"all icons will be change using the Lucide Icon ....Install the dependencies"*

What is true of the app today:

- **Zero icon library is installed.** `package.json` has no icon dependency. The frontend draws iconography three
  different ways:
  1. **Color emoji** as text: `📊 👤 🛏️ 📅 🧾 ⚙ 🔴 🟡 🕐 ✏️ 🚪 💵 🗑️ 📞 💰 ⛔ ⬆ ⬇ ↗ ℹ` (36 UI occurrences).
  2. **Five hand-written inline SVGs** in `src/routes/reservations/ReservationCard.svelte` — phone, bed,
     calendar, money bag, clock. These are already Lucide-shaped 24×24 stroke paths, duplicated as local
     `{#snippet}` blocks.
  3. **Text glyphs** used as controls: `⋮ › ‹ ▾ ▸ ◀ ▶ ✕ •`, the CSS-drawn `+` FAB, and the `+ Add Reservation`
     label. These are typography, not emoji, and are **explicitly out of scope** (Decision 2).
- Emoji rendering therefore depends on the platform emoji font. On Windows, Android, and macOS the same glyph
  looks different, cannot inherit `currentColor`, cannot be sized precisely (advance widths vary), and has no
  consistent optical weight next to the app's system-typography labels.
- The app already has the right primitives for a clean swap: a CSS-variable palette (`--label`, `--label-2`,
  `--label-3`, `--accent`, `--green-deep`, `--red-deep`, `--amber-deep`), a `prefers-reduced-motion` contract,
  decorative-icon convention (`aria-hidden="true"`), and a shared component folder (`src/lib/components/`).

The change is a **one-for-one replacement**: every emoji and every inline SVG becomes a Lucide Svelte component,
delivered through one shared `Icon` wrapper. Nothing is added, removed, or rearranged beyond that.

---

## 2. Decisions locked in the interview (source of truth)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Replacement scope | **Emoji + the five inline SVGs.** Every color emoji in the UI and the five `ReservationCard` SVG snippets become Lucide. |
| 2 | Text-glyph controls | **Unchanged:** `⋮`, `›`, `‹`, `▾`, `▸`, `◀`, `▶`, `✕` close buttons, `•` separators, the CSS-drawn `+` FAB, and text `+ Add …` labels stay as they are. |
| 3 | Package | **`@lucide/svelte`** — the official Svelte 5 package (`lucide-svelte` is deprecated on npm). Installed with `npm install`. |
| 4 | Inline prose emoji | **Small inline Lucide icon** (16px) before the phrase; sentence wording is unchanged. |
| 5 | Status emoji | **Lucide with inherited color** — status icons take the banner's existing red/amber/green/accent text color. |
| 6 | Architecture | **One shared wrapper** (`src/lib/components/Icon.svelte`); no direct Lucide usage scattered in markup without it. |
| 7 | Icon choice | **Best semantic fit**, not a literal emoji twin. Full table in §5. |
| 8 | Sizing | **Unified 16 / 20 / 24 scale.** No ad-hoc `1.05rem`, `18px`, `1.2rem`, `30px` icon sizes remain. |
| 9 | Stroke width | **2** (Lucide default, matching the existing hand-written SVGs). |
| 10 | Imports | **Per-icon subpath imports**, e.g. `import BedDouble from "@lucide/svelte/icons/bed-double"`. |
| 11 | Colors | **Keep today's per-icon colors**: reservation rows keep red phone / purple bed / gray calendar / amber money / blue clock; tenant danger-red and refund-green stay. |
| 12 | Settings ✓ ticks | **Dropped entirely** from `Saved ✓`, `Preferences saved ✓`, `Notifications enabled ✓` — the colored text carries the success state. |
| 13 | `ConfirmModal` note | **Widen `note` to `string \| Snippet`** so a note can carry an inline icon; existing string callers keep working. |
| 14 | Accessibility | **Every icon is decorative**: `aria-hidden="true"`, meaning comes from adjacent text or the control's `aria-label`. Icons never become the only accessible name. |
| 15 | Net-new icons | **Replacement only.** No icons added to page headers, stat cards, segmented controls, or text-only buttons. |
| 16 | Popover tiles | ~~**Keep the 30px `#f2f2f7` tile** in the `+` popover; monochrome icons sit centered on it.~~ **Superseded by `popover-icons-spec.md`**: the plate was drawn for color emoji and reads as a white block behind Lucide strokes. The 30px *slot* stays; the surface is gone. |
| 17 | Empty state | Room-sheet `🛏️` becomes a **24px `BedDouble` in `--label-3`** (part of the standard scale), not a 40–48px hero glyph. |
| 18 | Verification | **Static checks + a phone-size browser preview** of dock, popover, tenant card, settings, toasts, and the room sheet. No Android device pass required. |
| 19 | Native icons | **Out of scope:** Tauri app icons, tray icon, and favicon are untouched. |

---

## 3. Current state — audit

### 3.1 Counts

| Category | Sites | Notes |
|----------|-------|-------|
| Color emoji in UI | **36** | 39 regex matches in `src/` minus 3 `✕` close glyphs excluded by Decision 2. |
| Dropped (not replaced) | **3** | The three Settings ✓ marks (Decision 12). |
| Inline SVG snippets | **5** | `ReservationCard.svelte`: phone, bed, calendar, money bag, clock. |
| **Total Lucide insertions** | **38** | 33 emoji replacements + 5 SVG replacements. |
| Files touched | **14** | Listed in §7. |

### 3.2 Files that contain in-scope iconography

| File | Emoji / SVG today |
|------|-------------------|
| `src/routes/+layout.svelte` | 5 nav emoji (`📊 👤 🛏️ 📅 🧾`) + gear `⚙` |
| `src/routes/+page.svelte` | `🔴` overdue, `🟡` due this week |
| `src/routes/DashboardRoomCard.svelte` | `📅` reserved line |
| `src/routes/rooms/RoomCard.svelte` | `📅` reserved line |
| `src/routes/EarningsCard.svelte` | `◀ ▶` month arrows — **out of scope** (text glyphs) |
| `src/routes/tenants/TenantCard.svelte` | `🕐 ✏️ 🚪 💵 🗑️` mini actions |
| `src/routes/tenants/TenantFormModal.svelte` | `⛔ ×3`, `🛏️`, `💰 ×2` |
| `src/routes/tenants/MoveOutModal.svelte` | `💰 ×2` |
| `src/routes/tenants/PaymentHistoryModal.svelte` | `💰` held amount |
| `src/routes/tenants/+page.svelte` | `✕` search clear — **out of scope** |
| `src/routes/tenants/TenantDetailModal.svelte` | `✕` close — **out of scope** |
| `src/routes/reservations/ReservationCard.svelte` | 5 inline SVGs |
| `src/routes/reservations/ConvertModal.svelte` | `🛏️`, `💰` |
| `src/routes/reservations/+page.svelte` | `💰` inside `ConfirmModal` note |
| `src/routes/settings/BackupSection.svelte` | `⬆ ⬇ ↗` |
| `src/routes/settings/NotificationsSection.svelte` | `✓ ×2` — **dropped** |
| `src/routes/settings/DepositRefundSection.svelte` | `✓` — **dropped** |
| `src/routes/settings/sales-report/+page.svelte` | `◀ ▶` — **out of scope** |
| `src/lib/components/ToastHost.svelte` | `✓ ✕ ℹ` variant glyphs |
| `src/lib/components/RoomDetailSheet.svelte` | `📞 ×2`, `🛏️` empty state; `✕` close **out of scope** |

### 3.3 Why emoji is the wrong primitive here

1. **No color inheritance.** A `📅` cannot become red on overdue or accent-blue on active; Lucide icons take
   `currentColor` and follow the existing state classes for free.
2. **No size control.** The code resorts to `font-size: 1.25rem` / `18px` / `0.95rem` on wrapper spans, and
   emoji advance width still varies by platform, so vertical rhythm shifts between Windows, Android, and iOS.
3. **Inconsistent rendering.** Noto Color Emoji (Android), Segoe UI Emoji (Windows), and Apple Color Emoji (macOS)
   are three different drawings of the same character; the dock and popover are the app's most visible chrome.
4. **Baseline alignment.** Emoji sit on the text baseline with their own internal padding; Lucide SVGs align
   predictably with a wrapper (`display: inline-flex`, `vertical-align`).
5. **Duplication.** `ReservationCard.svelte` already hand-copies five Lucide paths (phone, bed, calendar, money
   bag, clock) as snippets — proof the design already wants stroke icons, without the library.

---

## 4. Requirements

### 4.1 Dependency and wrapper

| ID | Requirement |
|----|-------------|
| **R1** | Add **`@lucide/svelte`** (v1.x, peer `svelte ^5`) to `package.json` **`dependencies`** — it ships runtime components. Install with `npm install @lucide/svelte`; `package-lock.json` is committed with the change. |
| **R2** | Do **not** install `lucide-svelte` (deprecated) or any other icon package. No icon font, no sprite sheet, no CDN. |
| **R3** | Create **`src/lib/components/Icon.svelte`** — the only icon abstraction in the app. It accepts the icon **component** as a prop, applies the size/stroke defaults, and always renders decorative. |
| **R4** | The wrapper API is: `icon` (required Lucide component), `size` (`16 \| 20 \| 24`, default `20`), `strokeWidth` (default `2`), plus `class`/rest props passthrough. |
| **R5** | The wrapper sets `aria-hidden="true"` and `focusable="false"` unconditionally (Decision 14). Call sites never pass an accessible name to an icon. |
| **R6** | The wrapper is layout-neutral: `display: inline-flex`, `flex: 0 0 auto`, `line-height: 0`, and a small negative `vertical-align` so inline prose icons sit on the text baseline. It must not add margins. |
| **R7** | Icons are imported **per subpath** at the call site (`@lucide/svelte/icons/<kebab-name>`) and passed to the wrapper — no barrel import of the full icon set (Decision 10). |
| **R8** | `vite.config.js`, `svelte.config.js`, and `app.html` are **not modified**. If Vite dev-optimization complains about the package's `.svelte` sources, exclude it via `optimizeDeps.exclude` — but only if the warning actually appears. |

Wrapper sketch (for implementation, not final code):

```svelte
<!-- src/lib/components/Icon.svelte -->
<script lang="ts">
  import type { Component } from "svelte";

  let {
    icon: Glyph,
    size = 20,
    strokeWidth = 2,
    class: className = "",
    ...rest
  }: {
    icon: Component<{ size?: number; strokeWidth?: number }>;
    size?: 16 | 20 | 24;
    strokeWidth?: number;
    class?: string;
  } = $props();
</script>

<Glyph {size} {strokeWidth} aria-hidden="true" focusable="false" class="icon {className}" {...rest} />

<style>
  .icon {
    display: inline-flex;
    flex: 0 0 auto;
    line-height: 0;
    vertical-align: -0.125em;
  }
</style>
```

Call site:

```svelte
<Icon icon={BedDouble} size={20} />
```

### 4.2 Icon mapping

| ID | Requirement |
|----|-------------|
| **R9** | Use the exact icon assignments in **§5**. The table is the authority; if a Lucide name is missing/renamed in the installed version, use the listed fallback and record the substitution in the commit description. |
| **R10** | Navigation (`NAV` in `+layout.svelte`) stores the **component reference**, not a string, e.g. `{ href: "/", label: "Dashboard", icon: LayoutDashboard, … }`. The dock tab and popover render `<Icon icon={item.icon} size={20} />` and `size={16}` respectively. |
| **R11** | Icon choice is semantic, not a literal emoji twin: Dashboard is `LayoutDashboard` (not a chart), Tenants is `Users` (not a single person), Amenities is `ReceiptText`. |

### 4.3 Sizing, stroke, and color

| ID | Requirement |
|----|-------------|
| **R12** | Only three icon sizes exist after the change: **16px** (inline prose, meta rows, buttons-with-labels, toast, popover, summary strip, backups), **20px** (dock tabs, gear, tenant mini actions), **24px** (the room-sheet empty state). No `font-size`-driven icon sizing remains. |
| **R13** | Stroke width is **2** everywhere (Decision 9). No per-call overrides unless a specific optical problem is found and documented. |
| **R14** | Icons inherit color via `currentColor`. Existing per-icon colors are preserved exactly: reservation phone `var(--red)`, bed `#af52de`, calendar `var(--label-3)`, money `var(--amber)`, clock `var(--accent)`; tenant danger `var(--red-deep)`, refund `var(--green-deep)`. |
| **R15** | No new color tokens are introduced. The hard-coded purple `#af52de` stays because Decision 11 keeps today's reservation palette (the existing comment documenting it as the one fixed-color exception remains accurate). |
| **R16** | Wrapper spans that existed only to size an emoji (`.tab-icon`, `.pop-icon`, `.gear-icon`, `.mini-icon`, `.toast-icon`, `.empty-emoji`) lose their `font-size`/`line-height`/`font-weight` rules and become layout-only containers. |
| **R17** | *(Superseded by `popover-icons-spec.md`.)* The `+` popover keeps its 30px slot — the centering container survives **without** the `#f2f2f7` chip. |
| **R18** | Active/inactive states still work through the existing classes: `.tab.active` / `.pop-item.active` recolor the icon, `.tab.active .tab-icon` scale, `.gear:hover` rotation, `.mini.danger` red, `.mini.refund` green. The wrapper must not block these inherited colors or transforms. |

### 4.4 Inline and prose icons

| ID | Requirement |
|----|-------------|
| **R19** | Emoji that introduce a sentence become a **16px inline icon followed by the text**: `📞 {contact}`, `💰 Held …`, `🛏️ Room: …`, `⛔ {room} is full …`, `📅 Reserved — …`. |
| **R20** | Containers that hold icon + text become flex rows with a small gap (`6px`) and `align-items: center` (or `flex-start` for multi-line warnings). Do **not** rely on a literal space character for spacing. |
| **R21** | The dashboard summary strip renders `CircleAlert` (overdue, inherits `--red-deep`) and `Clock` (due this week, inherits `--amber-deep`), each 16px, inside the existing pills. |
| **R22** | `ConfirmModal`'s `note` prop becomes `string \| Snippet`; it renders the string in a `<p>` or `{@render note()}` respectively. The reservations page passes a snippet containing `<Icon icon={HandCoins} size={16} />` plus the existing sentence. |
| **R23** | The three Settings ✓ ticks are **removed without replacement** (Decision 12): the text stays, the `✓` goes. Do not substitute a `CircleCheck` there. |

### 4.5 Toast and status semantics

| ID | Requirement |
|----|-------------|
| **R24** | `ToastHost` maps `success → CircleCheck`, `error → CircleX`, `info → Info`, all 16px, colored by the toast variant's existing text color (`--green-deep`, `--red-deep`, `--accent-deep`). The ternary that returned `"✓" / "✕" / "ℹ"` is replaced. |
| **R25** | Status meaning never depends on the icon alone: every toast has a message, every summary pill has a number + label, and every warning sentence keeps its words. |

### 4.6 Preservation

| ID | Requirement |
|----|-------------|
| **R26** | No route behaviour, data query, prop contract, or event handler changes beyond the `ConfirmModal` note type (R22). |
| **R27** | No new icons are introduced (Decision 15); no emoji is moved, duplicated, or reordered. |
| **R28** | Dark mode, `prefers-color-scheme`, `prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast` behaviour is unchanged. |
| **R29** | Touch target sizes and hit areas are unchanged: the mini actions keep their existing padding and 44px rows; only the glyph inside changes. |
| **R30** | No emoji remains in rendered UI markup after the change, except the deliberately excluded text glyphs (Appendix A) and emoji inside test fixtures (`src/lib/backup-format.test.ts`, not UI). |
| **R31** | Comments and docs describing emoji (e.g. `mobile-optimization-spec.md`) are **not** rewritten. The specification documents are historical records. |

---

## 5. Icon mapping table

Sizes: **16** = inline/meta; **20** = nav/actions; **24** = empty state.

### 5.1 Navigation and chrome

| Slot | Today | Lucide | Import path | Size | Color source |
|------|-------|--------|-------------|------|--------------|
| Dashboard tab | `📊` | `LayoutDashboard` | `@lucide/svelte/icons/layout-dashboard` | 20 | `.tab` (`--label-2`, `.active` `--label`) |
| Tenants tab | `👤` | `Users` | `@lucide/svelte/icons/users` | 20 | same |
| Rooms tab | `🛏️` | `BedDouble` | `@lucide/svelte/icons/bed-double` | 20 | same |
| Reservations popover | `📅` | `CalendarDays` | `@lucide/svelte/icons/calendar-days` | 16 | `.pop-item` / `.active` |
| Amenities popover | `🧾` | `ReceiptText` | `@lucide/svelte/icons/receipt-text` | 16 | same |
| Settings gear | `⚙` | `Settings` | `@lucide/svelte/icons/settings` | 20 | `.gear` (`--label-2`, `.active` `--accent`) |

*Fallbacks:* `ChartColumn` for Dashboard, `UserRound` for Tenants, `Receipt` for Amenities, `Cog` for Settings.

### 5.2 Status and summary

| Slot | Today | Lucide | Import path | Size | Color source |
|------|-------|--------|-------------|------|--------------|
| Dashboard overdue pill | `🔴` | `CircleAlert` | `@lucide/svelte/icons/circle-alert` | 16 | inherits `--red-deep` |
| Dashboard due-this-week pill | `🟡` | `Clock` | `@lucide/svelte/icons/clock` | 16 | inherits `--amber-deep` |
| Reserved line (dashboard + rooms card) | `📅` | `CalendarCheck` | `@lucide/svelte/icons/calendar-check` | 16 | inherits the line's color |
| Toast success | `✓` | `CircleCheck` | `@lucide/svelte/icons/circle-check` | 16 | `--green-deep` |
| Toast error | `✕` | `CircleX` | `@lucide/svelte/icons/circle-x` | 16 | `--red-deep` |
| Toast info | `ℹ` | `Info` | `@lucide/svelte/icons/info` | 16 | `--accent-deep` |
| Settings success ticks | `✓` | **removed** | — | — | — |

### 5.3 Tenant actions and money

| Slot | Today | Lucide | Import path | Size | Color source |
|------|-------|--------|-------------|------|--------------|
| History | `🕐` | `History` | `@lucide/svelte/icons/history` | 20 | `.mini` (`--label-2`) |
| Edit | `✏️` | `Pencil` | `@lucide/svelte/icons/pencil` | 20 | `.mini` |
| Move Out | `🚪` | `LogOut` | `@lucide/svelte/icons/log-out` | 20 | `.mini.danger` (`--red-deep`) |
| Deposit Refunded | `💵` | `HandCoins` | `@lucide/svelte/icons/hand-coins` | 20 | `.mini.refund` (`--green-deep`) |
| Delete | `🗑️` | `Trash2` | `@lucide/svelte/icons/trash-2` | 20 | `.mini.danger` |
| Held balance / deposit note / holding deposit | `💰` | `HandCoins` | `@lucide/svelte/icons/hand-coins` | 16 | inherits the row's color |
| Beds hint / room-fixed line | `🛏️` | `BedDouble` | `@lucide/svelte/icons/bed-double` | 16 | inherits |
| Blocked room warnings | `⛔` | `CircleAlert` | `@lucide/svelte/icons/circle-alert` | 16 | inherits the `.full` warning color |
| Boarder contact | `📞` | `Phone` | `@lucide/svelte/icons/phone` | 16 | inherits |
| Room sheet empty state | `🛏️` | `BedDouble` | `@lucide/svelte/icons/bed-double` | 24 | `--label-3` |

*Fallbacks:* `ClockFading` for History, `Wallet` for money, `DoorOpen` for Move Out, `Banknote` for refund.

### 5.4 Backup actions

| Slot | Today | Lucide | Import path | Size | Color source |
|------|-------|--------|-------------|------|--------------|
| Export backup | `⬆` | `Upload` | `@lucide/svelte/icons/upload` | 16 | inherits button text |
| Import backup | `⬇` | `Download` | `@lucide/svelte/icons/download` | 16 | inherits |
| Share backup | `↗` | `Share2` | `@lucide/svelte/icons/share-2` | 16 | inherits |

### 5.5 Reservation rows (replacing local SVGs)

| Row | Lucide | Import path | Size | Color source |
|-----|--------|-------------|------|--------------|
| Contact phone | `Phone` | `@lucide/svelte/icons/phone` | 16 | `.icon-phone` → `var(--red)` |
| Room | `BedDouble` | `@lucide/svelte/icons/bed-double` | 16 | `.icon-bed` → `#af52de` |
| Reserved date | `CalendarDays` | `@lucide/svelte/icons/calendar-days` | 16 | `.icon-cal` → `var(--label-3)` |
| Move-in date | `CalendarDays` | same component | 16 | `.icon-cal` |
| Holding deposit | `HandCoins` | `@lucide/svelte/icons/hand-coins` | 16 | `.icon-bag` → `var(--amber)` |
| Move-in countdown banner | `Clock` | `@lucide/svelte/icons/clock` | 16 | `.icon-clock` → `var(--accent)` |

---

## 6. Delta list — exact edit sites

| # | File | Lines | Current | Required |
|---|------|-------|---------|----------|
| Δ1 | `src/routes/+layout.svelte` | 26–30 | `NAV` icons are emoji strings | component references per §5.1 (R10) |
| Δ2 | `src/routes/+layout.svelte` | 184 | `<span class="tab-icon">{tab.icon}</span>` | `<span class="tab-icon"><Icon icon={tab.icon} size={20} /></span>` |
| Δ3 | `src/routes/+layout.svelte` | 209 | `<span class="pop-icon">{item.icon}</span>` | `<span class="pop-icon"><Icon icon={item.icon} size={16} /></span>` (tile removed — see `popover-icons-spec.md`) |
| Δ4 | `src/routes/+layout.svelte` | 232 | `<span class="gear-icon">⚙</span>` | `<span class="gear-icon"><Icon icon={Settings} size={20} /></span>` |
| Δ5 | `src/routes/+layout.svelte` | 379–391, 533–545, 587–591 | `.tab-icon` / `.pop-icon` / `.gear-icon` font sizing | remove `font-size`/`line-height`; keep layout only (R16) |
| Δ6 | `src/routes/+page.svelte` | 166, 169 | `🔴 …` / `🟡 …` | `CircleAlert` / `Clock` at 16px with inherited pill color (R21) |
| Δ7 | `src/routes/DashboardRoomCard.svelte` | 46 | `📅 Reserved — …` | `CalendarCheck` 16px inline (R19–R20) |
| Δ8 | `src/routes/rooms/RoomCard.svelte` | 142 | `📅 Reserved — …` | same as Δ7 |
| Δ9 | `src/routes/tenants/TenantCard.svelte` | 88, 93, 99, 105, 111 | five emoji mini icons | `History` / `Pencil` / `LogOut` / `HandCoins` / `Trash2` at 20px (R12) |
| Δ10 | `src/routes/tenants/TenantCard.svelte` | 312–315 | `.mini-icon { font-size: 18px }` | remove font sizing; wrapper handles 20px |
| Δ11 | `src/routes/tenants/TenantFormModal.svelte` | 339, 341, 343 | `⛔ {room} …` | `CircleAlert` 16px + text in a flex row |
| Δ12 | `src/routes/tenants/TenantFormModal.svelte` | 355 | `🛏️ Set how many beds …` | `BedDouble` 16px |
| Δ13 | `src/routes/tenants/TenantFormModal.svelte` | 394, 401 | `💰 Held as balance …` | `HandCoins` 16px |
| Δ14 | `src/routes/tenants/MoveOutModal.svelte` | 50, 52 | `💰 …` | `HandCoins` 16px |
| Δ15 | `src/routes/tenants/PaymentHistoryModal.svelte` | 141 | `💰 … held` | `HandCoins` 16px inside `.held-amount` |
| Δ16 | `src/routes/reservations/ReservationCard.svelte` | 46–82 | five `{#snippet}` SVGs | delete snippets; use `Icon` per §5.5 |
| Δ17 | `src/routes/reservations/ReservationCard.svelte` | 99–143 | `{@render …Icon()}` | `<Icon icon={…} size={16} />` inside existing `.icon-*` spans |
| Δ18 | `src/routes/reservations/ConvertModal.svelte` | 149 | `🛏️ Room: …` | `BedDouble` 16px |
| Δ19 | `src/routes/reservations/ConvertModal.svelte` | 175 | `💰 Holding deposit …` | `HandCoins` 16px |
| Δ20 | `src/routes/reservations/+page.svelte` | 207 | `note={`💰 Remember …`}` string | snippet with `<Icon icon={HandCoins} size={16} />` (R22) |
| Δ21 | `src/routes/settings/BackupSection.svelte` | 182, 185, 188 | `⬆ / ⬇ / ↗` inside button labels | `Upload` / `Download` / `Share2` 16px + text in flex row |
| Δ22 | `src/routes/settings/NotificationsSection.svelte` | 90, 128 | `✓` ticks | remove the tick (R23) |
| Δ23 | `src/routes/settings/DepositRefundSection.svelte` | 60 | `Saved ✓` | `Saved` (R23) |
| Δ24 | `src/lib/components/ToastHost.svelte` | 30–32 | ternary returning `✓ / ✕ / ℹ` | `CircleCheck` / `CircleX` / `Info` per variant (R24) |
| Δ25 | `src/lib/components/ToastHost.svelte` | 78–81 | `.toast-icon { font-weight: 800; font-size: .95rem }` | layout-only container |
| Δ26 | `src/lib/components/RoomDetailSheet.svelte` | 586, 825 | `📞 {contact}` | `Phone` 16px + text |
| Δ27 | `src/lib/components/RoomDetailSheet.svelte` | 787 | `<p class="empty-emoji">🛏️</p>` | 24px `BedDouble` in `--label-3`; rename class to `.empty-icon` and delete emoji sizing CSS |
| Δ28 | `src/lib/components/ConfirmModal.svelte` | 18–32, 66–68 | `note?: string`, `<p class="note">{note}</p>` | `note?: string \| Snippet`, render string or snippet (R22) |
| Δ29 | `src/lib/components/Icon.svelte` | new | — | the shared wrapper (R3–R6) |
| Δ30 | `package.json` / `package-lock.json` | — | no icon dependency | `@lucide/svelte` in `dependencies` (R1) |

> Files **not** touched: all `src-tauri/**`, `src/app.css` (no icon styles live there), `src/app.html`,
> `svelte.config.js`, `vite.config.js`, `src/routes/settings/sales-report/+page.svelte`,
> `src/routes/EarningsCard.svelte`, and every modal that contains only text glyphs.

---

## 7. Implementation order

1. `npm install @lucide/svelte`; confirm the version and the subpath import works (`icons/bed-double`).
2. Add `src/lib/components/Icon.svelte` (R3–R6) and typecheck it in isolation.
3. Migrate the highest-visibility chrome first: `+layout.svelte` (dock, popover, gear).
4. Migrate status/toast surfaces: dashboard summary, `ToastHost`.
5. Migrate cards and sheets: `DashboardRoomCard`, `RoomCard`, `TenantCard`, `RoomDetailSheet`.
6. Migrate forms/modals: `TenantFormModal`, `MoveOutModal`, `PaymentHistoryModal`, `ConvertModal`,
   `BackupSection`, and the `ConfirmModal` note type (R22).
7. Delete the five `ReservationCard` snippets and their now-dead styles.
8. Remove the three Settings ticks (R23).
9. CSS cleanup pass: every icon wrapper loses emoji font sizing (R16); add `gap: 6px` flex rows where the
   icon used to rely on an inline space (R20).

---

## 8. Edge cases

| Case | Required behaviour |
|------|--------------------|
| Dock active state | Icon inherits `.tab.active` color; the `.tab-icon` scale transition still runs; no fill is added to the SVG. |
| Popover open/close transition | The `popoverMaterial` transition targets `.popover`, not the icon — unchanged. |
| Gear hover rotation | `.gear:hover { transform: rotate(30deg) }` rotates the anchor, icon included — preserved. |
| Long tenant names | The name chevron (`›`, out of scope) and mini action icons keep `flex-shrink: 0`; the wrapper sets it (R6). |
| Danger/refund colors | `.mini.danger` and `.mini.refund` set container color; `currentColor` carries into the SVG. No `stroke` prop overrides. |
| Dark theme | All colors are tokens except the fixed purple `#af52de`; verify that purple and `--amber` remain visible on `#000`/`#1c1c1e`. |
| High contrast / forced colors | Icons are strokes with `currentColor`; no `forced-color-adjust` hacks. Existing `prefers-contrast` borders unaffected. |
| Inline icon + wrapped text | Warning rows in `TenantFormModal` can wrap to two lines; use `align-items: flex-start` so the icon stays on the first line. |
| Emoji used as a separator | None in scope; `•` and `·` separators stay typographic (Appendix A). |
| Empty state | 24px `BedDouble` in `--label-3` sits above the existing empty message with a small bottom margin; `.empty-emoji` rules are deleted, not left dangling. |
| `ConfirmModal` string callers | Existing `note="…"` string call sites must keep rendering identically (R22 type union). |
| Toasts stacking | Icon is 16px and vertically centered against a 1.35 line-height message; multi-line toasts must not stretch the icon. |
| Bundle size | Only imported icons ship (R7); no barrel import, so the full ~1,700-icon set never enters the graph. |
| Browser dev server (no Tauri) | Icon rendering is pure Svelte/SVG; no platform branching, no change to the preview build. |
| Old Android WebView | `currentColor` strokes and inline SVG are supported; no new CSS feature is required. |
| Reduced motion | No icon animation is added; existing transitions on containers are untouched. |
| Test fixtures containing emoji | `src/lib/backup-format.test.ts` uses `🧑‍🌾` to prove Unicode round-trips through backup JSON — **leave it**. |
| Lockfile / clean install | `npm ci` must succeed with the new dependency; peer `svelte ^5` is already satisfied (`svelte ^5.0.0`). |

---

## 9. Verification plan

### 9.1 Static (required)

- `npm run check` — Svelte + TypeScript clean, including the `Component` typing on the wrapper and the
  `string \| Snippet` note union.
- `npm run build` — the static adapter build succeeds with per-icon subpath imports.
- Emoji sweep: `rg -n "[\\x{1F000}-\\x{1FAFF}\\x{2600}-\\x{27BF}\\x{2B00}-\\x{2BFF}]" src -g '!*.test.ts'`
  returns **only** the excluded `✕` close glyphs in `tenants/+page.svelte`, `TenantDetailModal.svelte`,
  `RoomDetailSheet.svelte` (Appendix A).
- `rg -n "lucide-svelte|@lucide/svelte" package.json src/` shows only `@lucide/svelte` and subpath imports.

### 9.2 Phone-size browser preview (Decision 18)

Run `npm run dev` and review at **390×844** (and once at desktop width, since the layout is the same):

1. **Dock** — three icons render at 20px, inherit active color, and the lozenge still slides.
2. **`+` popover** — Reservations/Amenities icons centered on the 30px tiles, active row recolors.
3. **Dashboard** — summary pills show `CircleAlert`/`Clock` in red/amber; room cards show `CalendarCheck` on the
   reserved line; earnings card arrows are unchanged text glyphs.
4. **Tenants** — expand "More options": five 20px icons aligned above their labels; Record Payment text button
   unchanged; search-clear `✕` unchanged.
5. **Room sheet** — contact rows show `Phone`, empty bed grid shows the 24px muted `BedDouble`.
6. **Reservations** — the five rows now render Lucide icons with their original red/purple/gray/amber/blue colors;
   the date bullets are still text.
7. **Settings** — backup buttons show upload/download/share icons; the three success lines read without a tick.
8. **Toasts** — trigger a success, error, and info toast; each shows the matching 16px icon in its variant color.
9. **Dark theme** — toggle Appearance and repeat steps 1–8.

### 9.3 Not required

- Android `adb` device pass (Decision 18).
- New unit tests. No existing test imports a `.svelte` component, and icon rendering is visual; `npm test`
  should stay green as a no-regression check only.
- Screenshot diffing.

---

## 10. Out of scope (explicit)

- **Text-glyph controls** (Appendix A): `⋮`, `›`, `‹`, `▾`, `▸`, `◀`, `▶`, `✕`, `•`, the CSS-drawn `+` FAB, and
  `+ Add …` button labels.
- **Net-new iconography** — page headers, stat cards, segmented controls, empty lists, and text-only buttons gain
  no icons (Decision 15).
- **Native assets** — `src-tauri/icons/**`, tray icon, favicon (`src/app.html`), splash screens (Decision 19).
- **Generated documents** — the jsPDF sales report, PNG receipts (`html-to-image` / `share.ts`), and OS
  notification text contain no emoji today and are untouched.
- **Data and tests** — emoji inside `backup-format.test.ts` fixtures stays (Unicode round-trip coverage).
- **Documentation** — historical specs and comments that contain emoji/arrows are not rewritten.
- **Layout or motion redesign** — spacing, dock geometry, sheet behaviour, and theme transitions are unchanged
  except where an emoji's advance width forced a small flex-gap cleanup (R20).
- **Dependency upgrades** beyond adding `@lucide/svelte`.

---

## 11. Open questions (recorded, not blockers)

1. **Close buttons stay text while Settings ticks were dropped.** `✕` close buttons remain typographic (Decision 2),
   yet the `✓` success ticks were removed (Decision 12). Both are dingbats of similar weight. The interview chose
   each deliberately; revisit only if the preview shows the `✕` reading as an odd one-off.
2. **Popover tiles with monochrome icons — *resolved*.** The 30px `#f2f2f7` tile was designed for color emoji. It was
   kept by decision (16), and the predicted follow-up is exactly what happened: the plate read as a white block
   behind the stroke and was removed in `popover-icons-spec.md` (Decision 2 there). The 30px slot remains.
3. **Tenant mini icons grow 18 → 20px.** This is the intended unified scale, but it may add ~2px to the expanded
   "More options" band. Accept unless it clips the 44px touch rows.
4. **Icon naming drift.** `ReceiptText`, `HandCoins`, `CircleX`, `Share2`, and `History` are the least stable names
   across Lucide major versions; confirm against the installed version at implementation time and use §5 fallbacks.

---

## Appendix A — Deliberately excluded glyphs

These are typography, not iconography, and stay in place:

| Glyph | Where | Why excluded |
|-------|-------|--------------|
| `⋮` | `RoomCard` actions trigger | Character-drawn control, not emoji (Decision 2). |
| `›` `‹` | "View details", tenant chevron, report row, sheet back | Navigation affordance drawn as type; no font/color issue. |
| `▾` `▸` | "More options" chevron, payment-history toggle | Rotates via CSS `transform`; replacing it would require re-implementing the rotation. |
| `◀` `▶` | `EarningsCard`, `sales-report` period pickers | Character arrows inside buttons with `aria-label`s. |
| `✕` | Tenant search clear, `TenantDetailModal`, `RoomDetailSheet` close | Excluded by Decision 2; see Open Question 1. |
| `•` | Reservation date rows | A separator dot, not an icon. |
| CSS `+` | Dock FAB (`.fab-plus`) | Drawn with pseudo-elements so it can inherit the gradient state's white. |
| `+` text | "`+ Add Reservation`" | Part of the button label. |

## Appendix B — Resulting dependency

```jsonc
// package.json (dependencies)
"@lucide/svelte": "^1.x"
```

Installed with `npm install @lucide/svelte`, adding one package (zero transitive dependencies per its package
metadata) plus its lockfile entry. `lucide-svelte` is **not** installed.
