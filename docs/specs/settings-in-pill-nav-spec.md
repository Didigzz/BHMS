# Settings in the Pill Navigation — Specification

Status: **Requirements locked** (interview, 4 rounds / 16 questions, Nov 8 2026).
App: RentEase / Digal Boarding House — Svelte 5 / SvelteKit (`adapter-static`, `ssr = false`) / Tauri 2 / SQLite.
Phone-first; the same single-column layout renders on Windows / macOS desktop.

> **Scope discipline:** this is a **navigation chrome change only** — one file (`src/routes/+layout.svelte`).
> Settings moves into the existing `+` popover ahead of Reservations and Amenities, and the floating gear is
> removed. **No settings page, routing, database, Rust, or Tauri config changes.**

---

## 1. Overview

The request, in the user's words:

> *"Move the settings in side the pill-navigation together woth reservation and Amenities"*

Today the floating dock (`nav.dock`) shows three permanent tabs — Dashboard, Tenants, Rooms — plus a `+`
button whose popover holds **Reservations** and **Amenities**, and a separate floating **gear** in the top-right
corner for Settings. Settings is therefore the only destination that lives outside the pill-navigation's own
popover, and it occupies a second piece of floating chrome that every screen has to dodge.

After this change:

- The pill still shows exactly three tabs; its geometry, thumb and labels are untouched.
- The `+` popover lists **Settings → Reservations → Amenities**, one flat list, same row style, same 30px icon
  tiles, same `+` glyph on the button.
- The floating gear is **deleted**, together with its CSS and its dark / reduced-transparency rules.
- The macOS drag strip, which stopped 58px short of the top-right to keep the gear tappable, runs edge to edge.
- While any settings page is open, the `+` button carries the existing `route-active` accent tint and the
  Settings row in the popover is accent-highlighted, exactly like Reservations/Amenities behave today.

---

## 2. Decisions locked in the interview (source of truth)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Placement | **Inside the `+` popover.** The pill stays at three tabs; no fourth tab, no six-tab pill. |
| 2 | Popover order | **Settings first**, then Reservations, then Amenities. |
| 3 | Menu label | **Gear icon + "Settings"** — same `Settings` Lucide glyph as today, 16px, on the existing 30px tile. |
| 4 | Grouping | **One flat list.** No divider, no group captions between Settings and the two sections. |
| 5 | Floating gear | **Removed entirely.** No replacement floating control. |
| 6 | Other entry points | **None.** The `+` menu is the only path to Settings. |
| 7 | Dock highlight on Settings | **The `+` button tints** (existing `.fab.route-active` accent) for `/settings` and `/settings/sales-report`. |
| 8 | Popover active row | **Accent like other rows** (existing `.pop-item.active`), no trailing check mark. |
| 9 | Navigation mode | **Full-page route, unchanged** — `/settings` behaves like `/tenants` or `/rooms`. Not a sheet. |
| 10 | Same-page tap | Tapping **Settings while already in Settings closes the menu and stays exactly where the user is** — no navigation, no scroll reset, no landing back on the settings root. |
| 11 | FAB glyph | **Keep the drawn `+`** (`.fab-plus`); it is not an "add" affordance here and does not change. |
| 12 | FAB accessible name | **`"More sections"`, unchanged.** |
| 13 | macOS drag strip | **Extend to full width** — drop the 58px clearance that existed only for the gear. |
| 14 | Android back | **Leave it alone** — only Escape dismisses the popover; the system back button keeps its current behaviour. |
| 15 | Sub-route landing | Opening Settings from a non-settings screen always lands on **`/settings` root**; there is no "last settings page" memory. |
| 16 | Verification | **Static checks + phone-size browser preview**, light and dark. No Android device pass required. |

---

## 3. Current state — audit

All navigation chrome lives in `src/routes/+layout.svelte` (711 lines).

| Area | Where | Today |
|------|-------|-------|
| Destination list | `NAV`, lines 32–39 | Dashboard, Tenants, Rooms, Reservations, Amenities. No Settings. |
| Pill tabs | `TABS = NAV.slice(0, 3)`, line 41 | Three constant tabs, unchanged by design. |
| Popover entries | `MORE = NAV.slice(3)`, line 44 | Reservations, Amenities. |
| Pill selection | `activeIndex`, line 47 | `Math.max(0, TABS.findIndex(...))` — falls back to tab 0 (Dashboard) on any non-tab route. |
| `+` active state | `moreActive`, line 48 | True when `pathname` starts with a `MORE` href; drives `class:route-active`. |
| Auto-dismiss | `$effect`, lines 53–56 | Any pathname change closes the popover. |
| Escape | `$effect`, lines 58–67 | Escape closes the popover; Android back intentionally untouched. |
| macOS drag strip | markup lines 173–177; CSS lines 299–308 | `right: 58px`, 24px tall, `z-index: 80` — the 58px exists only to leave the gear tappable (comment at 291–297). |
| Popover markup | lines 208–219 | `role="menu"`, `.pop-icon` 30px slot (surface removed — see `popover-icons-spec.md`), `.pop-label`, `.pop-tail`, `transition:popoverMaterial`. |
| FAB | lines 220–235 | `class:route-active={moreActive}`, `aria-haspopup="menu"`, `aria-label="More sections"`, drawn `+`. |
| Gear | markup lines 238–240 | `<a href="/settings" class="gear" aria-label="Settings" class:active={pathname.startsWith("/settings")}>` with a 20px `Settings` icon. |
| Gear CSS | lines 557–686 | `.gear`, `.gear:active`, `.gear-icon`, hover rotation, `.gear.active`, plus dark-theme (620, 638), reduced-transparency (654, 665, 675) and reduced-motion (689, 690, 698) variants. |
| `+` accent rule | line 455 | `.fab.route-active:not(.open) { color: var(--accent) }`. |
| Active menu row | line 536 | `.pop-item.active { color: var(--accent) }`. |
| Settings routes | `src/routes/settings/+page.svelte`, `src/routes/settings/sales-report/+page.svelte` | Root page and a sub-page linked from `ReportsSection.svelte` line 51 (`href="/settings/sales-report"`). |

Consequences worth stating up front:

- The gear is the **only** Settings entry today; removing it without adding the popover entry would orphan the
  route.
- `moreActive` is derived from `MORE`, so moving Settings into `MORE` gives the `+` tint on `/settings` and
  `/settings/sales-report` **for free** — no new state.
- `.pop-item.active` already uses `pathname.startsWith(item.href)`, so the sub-page highlights correctly.
- The pill's `activeIndex` fallback means Dashboard's lozenge stays highlighted on Settings, exactly as it
  already does on Reservations/Amenities. This work does **not** change that (see Open Question 1).

---

## 4. Requirements

### 4.1 Placement and order

| ID | Requirement |
|----|-------------|
| **R1** | Add Settings to `NAV` as the **fourth** entry: `{ href: "/settings", label: "Settings", icon: Settings, isActive: (p) => p.startsWith("/settings") }`. Because `TABS` slices the first three and `MORE` the rest, the popover order becomes **Settings, Reservations, Amenities**. |
| **R2** | `TABS` stays `NAV.slice(0, 3)` and the pill stays three tabs wide. No fourth tab, no horizontal scrolling, no change to `.thumb`, `--i`, or the sliding transition. |
| **R3** | The popover renders `MORE` in order with the existing markup: 30px `.pop-icon` slot (no surface since `popover-icons-spec.md`), 16px `Icon`, `.pop-label`, `.pop-tail`. No divider, caption, badge, or trailing check is added. |
| **R4** | Settings uses the existing `Settings` icon component (already imported for the gear); no new icon import, no icon rename. |

### 4.2 Removing the gear

| ID | Requirement |
|----|-------------|
| **R5** | Delete the gear anchor markup (lines 238–240) and the now-unused `aria-label="Settings"` anchor. |
| **R6** | Delete **every** `.gear*` style: `.gear` (557–586), `.gear:active` (587), `.gear-icon` (591), the hover-rotation block (596–600), `.gear.active` (603), the dark-theme rules (620, 638), the reduced-transparency rules (654, 665, 675) and the reduced-motion entries (689, 690, 698). **No dead selectors may remain** — including entries inside shared selector lists. |
| **R7** | Update the comments that describe the gear: the `NAV` comment ("Settings is its own gear", line 30), the drag-strip markup comment ("Sits behind the gear…", lines 173–176) and the drag-strip CSS comment (291–303). |
| **R8** | Nothing replaces the gear visually. No new floating button, no Settings shortcut in page headers, no long-press gesture. |

### 4.3 Dock and popover state on settings routes

| ID | Requirement |
|----|-------------|
| **R9** | On `/settings` **and** `/settings/sales-report`, the `+` button shows the existing `route-active` accent (`.fab.route-active:not(.open)`, line 455). It comes from `moreActive`; do not add parallel state. |
| **R10** | The Settings popover row shows `.pop-item.active` on both routes, using the existing `pathname.startsWith(item.href)` check. |
| **R11** | When the popover is open **on** a settings page, the Settings row is the accent one; the other two rows stay normal. |
| **R12** | The pill's thumb is not re-targeted on settings routes; it keeps today's fallback (Dashboard). This is a deliberate preservation of existing behaviour, not an oversight. |

### 4.4 Navigation behaviour

| ID | Requirement |
|----|-------------|
| **R13** | Tapping Settings from any non-settings screen performs a normal SvelteKit navigation to `/settings` (full page, same dock). |
| **R14** | Tapping Settings **while already on `/settings` or `/settings/sales-report`** must `preventDefault()` the anchor, close the popover, and leave the current page untouched: no navigation, no scroll reset, no route re-entry. |
| **R15** | All other popover entries keep their current behaviour (navigate + auto-close via the pathname effect), and their click handling must not be affected by the Settings guard. |
| **R16** | Escape and scrim-tap dismissal are unchanged. Android hardware back is explicitly **not** wired to the popover. |

### 4.5 macOS window drag strip

| ID | Requirement |
|----|-------------|
| **R17** | `.titlebar-drag` extends to the right edge: `right: 58px` → `right: 0`. Height (24px) and `z-index: 80` stay. |
| **R18** | The strip must not capture dock taps: the dock remains `z-index: 100`, so the popover/FAB stay above it. No device-specific JS is added; the strip still renders only when `isMac`. |
| **R19** | Content padding is unchanged (`24px + env(safe-area-inset-top)`), so the full-width strip still has no tappable page content under it. |

### 4.6 Accessibility and preservation

| ID | Requirement |
|----|-------------|
| **R20** | The `+` button keeps `aria-haspopup="menu"`, `aria-expanded`, and `aria-label="More sections"`. The new row is a `role="menuitem"` link with visible text "Settings" (no icon-only name). |
| **R21** | The scrim keeps `aria-label="Close section menu"` and `tabindex="-1"`. |
| **R22** | No dependency, component, route, query, store, or settings-page change. `package.json` is untouched. |
| **R23** | No change to dark mode, `prefers-color-scheme`, `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast`, or the zoom lock. Removing the gear must not change any other surface's appearance. |
| **R24** | The popover keeps its current geometry (`min-width: 196px`, right-anchored, tail at 22px) — three rows fit without a height change. |
| **R25** | *(Superseded by `popover-icons-spec.md`.)* The 30px `.pop-icon` tiles are deleted outright: the glyph sits bare on the popover surface in `var(--label)`, so there is no chip left to theme in either mode. |

---

## 5. Delta list — exact edit sites

| # | File | Location | Current | Required |
|---|------|----------|---------|----------|
| Δ1 | `src/routes/+layout.svelte` | `NAV`, lines 32–39 | 5 entries, no Settings | 6 entries; Settings inserted at index 3 (R1) |
| Δ2 | `src/routes/+layout.svelte` | comment lines 25–31 | "The remaining two … Settings is its own gear." | "The remaining three sit behind the + button, Settings first." |
| Δ3 | `src/routes/+layout.svelte` | markup 173–177 | drag-strip comment mentions the gear | comment says the strip now runs edge to edge |
| Δ4 | `src/routes/+layout.svelte` | `.titlebar-drag`, 299–303 | `right: 58px` + gear comment | `right: 0` + updated comment (R17) |
| Δ5 | `src/routes/+layout.svelte` | 238–240 | gear anchor + icon | **deleted** (R5) |
| Δ6 | `src/routes/+layout.svelte` | 557–603 | `.gear`, `.gear:active`, `.gear-icon`, hover, `.gear.active` | **deleted** (R6) |
| Δ7 | `src/routes/+layout.svelte` | 620, 638, 654, 665, 675, 689–698 | `.gear` entries in dark / transparency / motion blocks | **removed from each selector list** (R6) |
| Δ8 | `src/routes/+layout.svelte` | popover markup 208–219 | renders `MORE` | unchanged markup; order comes from `MORE`; add the same-page guard (R14) |
| Δ9 | `src/routes/+layout.svelte` | FAB 220–235 | `aria-label="More sections"`, `route-active` | unchanged (R20); `moreActive` now covers Settings automatically |
| Δ10 | `src/routes/+layout.svelte` | `.pop-icon` (~549) | flat `#f2f2f7` tile in both themes | **no tile at all** — surface, radius and hairline deleted, the 30px slot kept (`popover-icons-spec.md`) |

Files **not** touched: `src/routes/settings/**` (including `sales-report`), `src/lib/**`, `src/app.css`,
`src/app.html`, `src-tauri/**`, `package.json`, `vite.config.js`, `svelte.config.js`.

---

## 6. Implementation order

1. Add the Settings entry to `NAV` at index 3; confirm `TABS` and `MORE` split as expected (R1–R3).
2. Verify `moreActive` and `.pop-item.active` on `/settings` and `/settings/sales-report` (R9–R11).
3. Add the same-page guard on the popover links (R14–R15).
4. Delete the gear markup and CSS, including every shared selector list (R5–R7).
5. Widen the macOS drag strip and refresh its comments (R17–R19).
6. Static checks, then the browser-preview tap-through in §8.

A minimal guard shape (for the implementer, not final code):

```svelte
onclick={(e) => {
  if (item.href === "/settings" && pathname.startsWith("/settings")) {
    e.preventDefault();
    menuOpen = false;
  }
}}
```

---

## 7. Edge cases

| Case | Required behaviour |
|------|--------------------|
| On `/settings`, tap Settings | Popover closes, page stays put, no scroll jump, no remount (R14). |
| On `/settings/sales-report`, tap Settings | Same: stays on the sales report. It must **not** fall back to `/settings` root (Decision 10). |
| Open popover **on** a settings page | Settings row is accent, `+` is accent; `+` opened while open shows both at once. |
| Tap `+` while the pill's Dashboard tab is highlighted | Unchanged: pill stays usable, popover floats above it. |
| Esc / scrim / navigation | All close the popover exactly as today. Android back does not (Decision 14). |
| Browser back after entering Settings | Returns to the previous route; nothing in this change intercepts history. |
| Deep link or reload on `/settings` | `+` is tinted on first paint (derived from `pathname`); pill thumb is on Dashboard (existing fallback). |
| Sub-page deep link `/settings/sales-report` | Tinted `+`, accent Settings row; back chevron flow in `ReportsSection` unaffected. |
| Wide desktop (1080×720) | Dock stays centered at 560px; popover stays right-anchored to the FAB; three rows fit. |
| Phone 320×720 | Popover min-width 196px still fits right-anchored; labels "Reservations" and "Settings" do not wrap. |
| Dark theme | Popover surface `rgba(30,30,32,.9)` and accent row unchanged; no gear surface to style any more. The icon chip is gone (`popover-icons-spec.md`): glyphs are `--label` directly on the dark surface, with no tile to switch. |
| Reduced transparency | Popover becomes `#1c1c1e`/`#ffffff` as today; **no `.gear` selector may remain** in that block. |
| Reduced motion | Popover transition already collapses to opacity; deleting `.gear` entries must not leave trailing commas or empty selector lists. |
| High contrast | Only `.pill`, `.fab`, `.popover` get borders; gear removal changes nothing here. |
| macOS drag strip | Full width; dock (100) and popover (3 inside the dock) still receive taps; no interactive content under the 24px strip. |
| `isMac` detection | Unchanged; the strip is still rendered only on macOS. |

---

## 8. Verification plan

### 8.1 Static (required)

- `npm run check` — 0 errors; existing warnings unchanged.
- `npm run build` — static adapter build succeeds.
- Grep assertions:
  - `grep -n "class=\"gear\"\\|\\.gear" src/routes/+layout.svelte` → **no matches**.
  - `grep -n "right: 58px" src/routes/+layout.svelte` → **no matches**.
  - `grep -n "aria-label=\"Settings\"" src/routes/+layout.svelte` → **no matches**.
  - `sed -n '32,50p' src/routes/+layout.svelte` shows six `NAV` entries with `/settings` at index 3.

### 8.2 Browser preview (required)

Run `RENTEASE_PREVIEW=1 npm run dev` and review at **390×844** (phone) and once at **1080×720**, light and dark:

1. **Dock** — three tabs, sliding thumb, `+` present; no gear anywhere on screen.
2. **Popover** — opens above `+`; rows read **Settings, Reservations, Amenities**, each with its 16px icon on
   the 30px tile; Settings uses the gear glyph.
3. **Enter Settings** — tap Settings: lands on `/settings`; `+` is accent-tinted; popover closed.
4. **Reopen on Settings** — Settings row is accent; the other two are not.
5. **Same-page tap** — tap Settings again: menu closes, the page does not move, scroll position is preserved,
   and the route does not change (verify with the URL bar and a scrolled settings page).
6. **Sub-route** — open Sales Report from the Reports card: `+` stays tinted, Settings row accent, and tapping
   Settings from there keeps the user on the sales report.
7. **Regressions** — Reservations and Amenities still navigate and highlight; Escape, scrim tap, and the
   popover transition still work; the pill tabs still navigate.
8. **macOS** — cannot be exercised in the browser preview; recorded as a limitation, with the code change
   limited to `right: 0`.

### 8.3 Not required

- Android `adb` device pass (Decision 16).
- Screenshot diffing.
- New unit tests — no test imports `.svelte` files, and this is chrome/presentation; `npm test` stays green as a
  no-regression check only.

---

## 9. Out of scope (explicit)

- **Settings page contents** — Appearance, Backup, Notifications, Receipts, Deposits, About, Reports and
  `/settings/sales-report` are untouched.
- **Routing** — no new routes, no route groups, no scroll restoration work beyond the same-page guard.
- **Pill redesign** — no fourth tab, no width/thumb/geometry change, no "Settings" tab variant.
- **Popover redesign** — no dividers, captions, icon swaps, row heights, or new animations.
- **Alternative entry points** — no dashboard shortcut, no long-press `+`, no keyboard shortcut.
- **Android back integration** with the popover (Decision 14).
- **Gear's leftover space** — nothing new is placed in the top-right corner.
- **Native assets, Rust, Tauri config, dependencies** — none change.

---

## 10. Open questions (recorded, not blockers)

1. **Pill thumb on hidden routes.** `activeIndex` falls back to 0, so Dashboard's lozenge stays lit while on
   Settings (and already on Reservations/Amenities). The interview chose "no pill change" + a tinted `+`, so
   this is preserved; neutralising the thumb on non-tab routes would be a separate decision.
2. **Empty top-right corner.** With the gear gone, nothing occupies the top-right on any page. If a future
   page-level action wants that corner, it now has room — but nothing is added here.
3. **`aria-current` on the menu row.** The active row is visual only today (accent color). Adding
   `aria-current="page"` to the matching `menuitem` would improve announcements but was not requested.
4. **Same-page guard precision.** The guard keys on `pathname.startsWith("/settings")`. If Settings ever gains a
   sibling route outside `/settings` (e.g. `/preferences`), the condition must move with it.

---

## Appendix A — Resulting bottom chrome

```
┌─────────────────────────────────────────────┐
│   Dashboard   Tenants   Rooms          (+)  │   pill: 3 tabs, unchanged
└─────────────────────────────────────────────┘
                       │
                       ▼  (+) opens
              ┌────────────────────┐
              │ ⚙  Settings        │   ← accent on /settings*
              │ 📅 Reservations    │
              │ 🧾 Amenities       │
              └──────────┬─────────┘
                         ▼  tail points at the +
```

`*` including `/settings/sales-report`. The top-right gear that used to sit above every page is gone.

## Appendix B — Interview record

| Round | Questions | Answers |
|-------|-----------|---------|
| 1 | Placement · gear fate · ordering · navigation mode | + popover · remove gear · Settings first · full page |
| 2 | menu label · grouping · dock state · macOS strip | gear + "Settings" · one flat list · `+` tints · full width |
| 3 | FAB glyph · FAB name · other entry points · sub-route landing | keep `+` · "More sections" · none · stay on the current settings page |
| 4 | same-page tap · active row · back button · verification | close menu · accent · leave alone · static + browser preview |
