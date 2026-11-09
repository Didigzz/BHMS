# Bare Popover Icons — Specification

Status: **Requirements locked** (interview, 3 rounds / 13 questions, Nov 8 2026).
App: RentEase / Digal Boarding House — Svelte 5 / SvelteKit (`adapter-static`, `ssr = false`) / Tauri 2 / SQLite.
Phone-first; the same single-column layout renders on Windows / macOS desktop.

> **Scope discipline:** this is a **popover cosmetic fix in one file** — `src/routes/+layout.svelte`.
> The 30px `#f2f2f7` chip behind each `+` popover icon is removed (the 30px *slot* stays), the glyph stays
> monochrome in `--label` in every state, and the row's accent on the current page moves to the label only.
> **No markup changes, no icon-size changes, no hover/focus behaviour changes, no `Icon.svelte`, no `app.css`,
> no `package.json`, no Rust/Tauri changes.**

---

## 1. Overview

The request, in the user's words:

> *"fix in the pill pop hover the reservation and Amenities has white icon, but if clicked, then only it shows
> the icon, make the icon same as Dashboard tenants.... that has no color"*

Translation, confirmed in the interview: in the `+` popover (the "pill pop"), each row's icon sits on a
**30px near-white chip** (`#f2f2f7`). Against the translucent popover surface that chip reads as a white block —
a "white icon" — and the glyph inside it is only clearly legible once the row becomes the current page, because
`.pop-item.active` recolors both icon and label to `var(--accent)`. The Dashboard / Tenants / Rooms tabs in the
pill have **no chip at all**: bare strokes in the tab's own color. The popover rows should look like those.

After this change:

- Reservations, Amenities **and** Settings render a bare 16px Lucide stroke on the popover surface — no
  background, no hairline, no radius.
- The glyph is `var(--label)` — identical to `.pop-item`'s own text color — in the default, press, and active
  states. It never turns accent.
- On the current route (`/reservations`, `/amenities`, `/settings`, `/settings/sales-report`) only the **label**
  goes accent.
- Labels do not move (a 30px slot is preserved), rows stay ~52px tall, and the popover's height, width, tail and
  transition are untouched.

---

## 2. Diagnosis — why it looks white

| Fact | Evidence |
|------|----------|
| The pill's tab icons have no surface behind them. | `.tab-icon` (`+layout.svelte` ~line 396) is an empty `display: grid` container with a transform transition and **no** `background`; color comes from `.tab` → `--label-2`, `.tab.active` → `--label`. |
| The popover's icons have a dedicated light chip. | `.pop-icon` (`+layout.svelte` 549–562): `width/height: 30px`, `border-radius: 8px`, `background: #f2f2f7`, `box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.08)`. |
| The chip is a leftover from the emoji era. | The comment on line 557 says *"The mockup keeps these tiles light on both themes behind the icon"* — it was drawn to hold a **color emoji**, which needs a neutral plate. Lucide strokes do not. |
| Dark mode already fights the chip. | `:global(:root[data-theme="dark"]) .pop-icon` and the `prefers-color-scheme` twin (564–577) repaint it `rgba(255,255,255,0.12)` with a comment admitting *"the icon inherits the near-white label and disappears into it."* |
| "Only when clicked it shows the icon." | `.pop-item.active { color: var(--accent) }` (546–548) recolors the whole anchor, so the glyph turns accent blue and finally separates from the near-white plate. Every other row keeps `--label` strokes on that plate. |
| Nothing else sets an icon color. | `Icon.svelte` is layout-neutral and Lucide v1.70 renders `stroke="currentColor"` (`node_modules/@lucide/svelte/dist/utils/defaultAttributes.js`), so the glyph color is exactly `.pop-item`'s `color`. |

So the "white icon" is the **chip**, not the stroke: `#f2f2f7` is ~97% white against a `rgba(250,250,252,0.9)`
popover. The fix is to delete the plate, not to recolor the glyph.

---

## 3. Current state — anatomy of a row

Markup (`+layout.svelte` 214–234, rendered once per `MORE` entry: Settings, Reservations, Amenities):

```svelte
<a href={item.href} role="menuitem" class="pop-item" class:active={pathname.startsWith(item.href)} …>
  <span class="pop-icon" aria-hidden="true"><Icon icon={item.icon} size={16} /></span>
  <span class="pop-label">{item.label}</span>
</a>
```

CSS, and the geometry it produces:

| Rule | Line | Value | Consequence |
|------|------|-------|-------------|
| `.pop-item` | 526–537 | `display: flex`, `align-items: center`, `gap: 11px`, `padding: 11px 14px`, `color: var(--label)` | 14px inset, 11px icon→label gap; color is the icon's color source |
| `.pop-item + .pop-item` | 538–540 | `border-top: 1px solid var(--separator)` | row separators — untouched |
| `.pop-item:active` | 542–544 | `background: var(--fill)` | press feedback — untouched |
| `.pop-item.active` | 546–548 | `color: var(--accent)` | tints **label and icon** on the current route |
| `.pop-icon` | 549–562 | `flex-shrink: 0`, `30×30`, `display: grid`, `place-items: center`, `border-radius: 8px`, `background: #f2f2f7`, `box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.08)` | the white plate; also reserves the 30px slot |
| dark `.pop-icon` | 564–577 | `background: rgba(255,255,255,0.12)`, `box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.16)` in both `[data-theme="dark"]` and `prefers-color-scheme` | chip follows the theme; both rules die with the chip |
| `.pop-label` | 579–582 | `font-size: 0.95rem`, `font-weight: 500` | untouched |

Derived measurements that must be preserved:

- **Label origin:** `14 (padding) + 30 (slot) + 11 (gap) = 55px` from the popover's inner left edge.
- **Row height:** `11 (padding) + 30 (slot) + 11 (padding) = 52px`.
- Popover `min-width: 196px`, right-anchored, tail at `right: 22px`, `transform-origin: calc(100% - 29px) 100%`.

---

## 4. Decisions locked in the interview (source of truth)

| # | Topic | Decision |
|---|-------|----------|
| 1 | What "white icon" means | **The 30px rounded tile behind the glyph.** The stroke is not the problem. |
| 2 | Target treatment | **Bare monochrome icon, no tile.** Delete the chip so the glyph sits directly on the popover surface, like the pill tabs. |
| 3 | Icon color, default state | **`var(--label)`** — same as the row label, matching the active pill tab. Not `--label-2`, not `--label-3`. |
| 4 | Icon color, current-page row | **Stays monochrome `--label`.** Only the label goes accent. The icon never tints. |
| 5 | Horizontal alignment | **Keep a 30px slot so labels do not move.** The slot keeps its width/height/centering and loses only its surface. |
| 6 | Icon size | **Keep 16px.** No call-site or `Icon` prop change. |
| 7 | Row height | **Keep the current ~52px.** The preserved 30px slot does this by itself; no `min-height` is added. |
| 8 | Chip CSS | **Delete it all** — chip rule, both dark overrides, the hairline, the radius, and the mockup comment. No dead selectors. |
| 9 | Hover | **None added.** Rows stay press-only (`.pop-item:active`), as today. |
| 10 | Keyboard focus ring | **Out of scope.** No `:focus-visible` style is added to popover rows. |
| 11 | CSS location | **`src/routes/+layout.svelte` scoped style block only.** `Icon.svelte`, `app.css`, and the global design system are untouched. |
| 12 | Existing spec docs | **Amend both** `lucide-icons-spec.md` (Decision 16, R17, Open Question 2) and `settings-in-pill-nav-spec.md` (R25, Δ10) so they no longer mandate the tile. |
| 13 | Verification | **Static checks + phone-size browser preview (390×844) in light and dark.** No desktop-width pass required. |

---

## 5. Requirements

### 5.1 Removing the chip

| ID | Requirement |
|----|-------------|
| **R1** | `.pop-icon` keeps `flex-shrink: 0`, `width: 30px`, `height: 30px`, `display: grid`, `place-items: center`. These are the **slot**: they hold the label at 55px and the row at 52px. |
| **R2** | `.pop-icon` loses `background: #f2f2f7`, `box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.08)`, and `border-radius: 8px`. A rounded corner with no fill and no hairline is meaningless; remove it rather than leave a latent radius. |
| **R3** | The comment on line 557 (*"The mockup keeps these tiles light on both themes behind the icon."*) is **deleted**. It documents a decision this spec reverses and would be false afterwards. |
| **R4** | Replace it with a short comment in the codebase's voice stating the slot is intentionally **empty of any surface**: the glyph must read like the dock's tabs, and the 30px box exists only to hold the label's 55px origin. Reference this spec's rationale (bare stroke, no plate), not the emoji history. |
| **R5** | Delete `:global(:root[data-theme="dark"]) .pop-icon` (564–568) and its `@media (prefers-color-scheme: dark)` twin (569–576) in full — selectors, braces, properties, and the four-line comment above them (560–563). Nothing else lives in those blocks. |
| **R6** | No `.pop-icon` background, `box-shadow`, `border-radius`, or `color` declaration may survive anywhere in the file. Only layout (box size, centering, shrink) and the color neutraliser from R9 remain. |

### 5.2 Monochrome color in every state

| ID | Requirement |
|----|-------------|
| **R7** | In the default state the glyph is `var(--label)`. It already inherits this from `.pop-item` (`color: var(--label)`); do not hard-code a hex, a `#000`, or a Lucide `color` prop. |
| **R8** | `.pop-item:active` (press fill `var(--fill)`) must not change the glyph color — no rule is added for the pressed state. |
| **R9** | On the current route, `.pop-item.active` still tints the **label** with `var(--accent)`, but the glyph must stay `--label`. Add exactly one rule of the form `.pop-item.active .pop-icon { color: var(--label); }` (or an equivalent scoped selector) so the icon never inherits the anchor's accent. |
| **R10** | The neutraliser must be scoped to the active row only. Do not set `color` on `.pop-icon` globally in a way that would fight a future deliberate treatment; keep it readable and adjacent to `.pop-item.active`. |
| **R11** | Contrast is acceptable in both themes without any chip: `--label` is `#1c1c1e` on the light popover (`rgba(250,250,252,0.9)`) and `#f6f6f6` on the dark popover (`rgba(30,30,32,0.9)`). No new token, tint, or opacity is introduced. |

### 5.3 Preserved geometry and behaviour

| ID | Requirement |
|----|-------------|
| **R12** | Label origin stays `14 + 30 + 11 = 55px`; row height stays `11 + 30 + 11 = 52px`. Because the 30px slot survives (R1), neither a `min-height` nor a padding change is required — and none may be added. |
| **R13** | `.pop-item`'s `gap: 11px`, `padding: 11px 14px`, flex alignment, and `color` are unchanged. |
| **R14** | `.pop-label` is unchanged (`0.95rem`, `500`). On the active row it stays accent; no weight bump, no underline, no check mark. |
| **R15** | Popover surface, `min-width: 196px`, `max-height`, right anchoring, `.pop-tail` (`right: 22px`), `transform-origin`, `popoverMaterial` transition, `.scrim`, FAB, `route-active` tint, and `aria-*` are all untouched. |
| **R16** | Markup is **byte-for-byte unchanged**: `<span class="pop-icon" aria-hidden="true"><Icon icon={item.icon} size={16} /></span>`. The wrapper class keeps its name — only its styling changes — so no `.svelte` template edit and no `Icon` prop change are needed. |
| **R17** | All three rows are treated identically (Settings included). There is no per-row inheritance, no `.pop-icon.settings` variant, and no special case for `/settings/sales-report`. |
| **R18** | Reduced transparency keeps its existing popover override (`#ffffff` / `#1c1c1e`); icons inherit `--label` there with no additional rule. High contrast keeps its `.pill` / `.fab` / `.popover` borders — no `.pop-icon` entry exists in that block, so nothing is removed from it. |
| **R19** | Reduced motion: the popover transition already collapses to opacity; removing chip rules must leave no empty selector lists or trailing commas in that block. |
| **R20** | No new dependency, no `package.json` edit, no `app.css` edit, no change to `Icon.svelte`, `Settings`, `ReceiptText`, or `CalendarDays` imports. |

---

## 6. Delta list — exact edit sites

All in `src/routes/+layout.svelte` (654 lines in the working tree).

| # | Location | Current | Required |
|---|----------|---------|----------|
| Δ1 | `.pop-icon`, 549–556 | `flex-shrink: 0; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px;` | keep the five layout declarations; **delete `border-radius: 8px`** (R2) |
| Δ2 | `.pop-icon`, 557 | comment: *"The mockup keeps these tiles light on both themes behind the icon."* | replace with the slot rationale comment (R3–R4) |
| Δ3 | `.pop-icon`, 558 | `background: #f2f2f7;` | **deleted** (R2) |
| Δ4 | `.pop-icon`, 559 | `box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.08);` | **deleted** (R2) |
| Δ5 | 561–568 | comment (*"Monochrome strokes need a tile…"*) + `:global(:root[data-theme="dark"]) .pop-icon { … }` | **deleted in full** (R5) |
| Δ6 | 569–576 | `@media (prefers-color-scheme: dark) { :global(:root:not([data-theme="light"])) .pop-icon { … } }` | **deleted in full** (R5) |
| Δ7 | after `.pop-item.active` (546–548) | only `color: var(--accent)` on the anchor | add `.pop-item.active .pop-icon { color: var(--label); }` (R9–R10) |
| Δ8 | markup, 229 | `<span class="pop-icon" aria-hidden="true"><Icon … size={16} /></span>` | **unchanged** (R16 — listed so the implementer does not "fix" it in the template) |
| Δ9 | `.pop-item` 526–537, `.pop-label` 579–582, `.pop-tail`, `.popover`, `.scrim`, `.fab`, `.pop-item:active`, `.pop-item + .pop-item` | — | **unchanged** (R13–R15) |
| Δ10 | `app.css`, `src/lib/components/Icon.svelte`, `package.json`, `src-tauri/**` | — | **not touched** (R20) |

Resulting `.pop-icon` block (illustrative shape, not final prose):

```css
  /* A bare slot, not a chip: the 30px box exists only to hold the label's
     55px origin and the row's 52px height. The glyph sits directly on the
     popover surface, like the dock's tabs — no plate, no hairline. */
  .pop-icon {
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
  }

  /* The current page tints the label only; the glyph stays monochrome. */
  .pop-item.active .pop-icon {
    color: var(--label);
  }
```

---

## 7. Implementation order

1. Strip the surface from `.pop-icon`: delete `border-radius`, `background`, `box-shadow`, swap the mockup comment for the slot comment (Δ1–Δ4).
2. Delete the two dark `.pop-icon` blocks and their comment (Δ5–Δ6). Leave the `[data-theme="dark"]` / `prefers-color-scheme` `.pill`, `.fab`, `.popover` rules that follow intact.
3. Add the active-row icon neutraliser (Δ7).
4. Amend the two existing spec docs (§9). No source changes there.
5. Static checks, then the phone-size preview (§8.2).

---

## 8. Verification plan

### 8.1 Static (required)

- `npm run check` — 0 errors; existing warnings unchanged. The markup does not change, so this should be a no-op pass; it is required as a guard, not as evidence of the visual fix.
- Grep assertions on `src/routes/+layout.svelte`:
  - `rg -n "#f2f2f7" src/routes/+layout.svelte` → **no matches**. (`src/app.css` keeps its unrelated `--bg: #f2f2f7` token — do not touch it.)
  - `rg -n "pop-icon" src/routes/+layout.svelte` → exactly three hits: the markup span (229), the layout rule, and the `.pop-item.active .pop-icon` neutraliser. No `background`, `box-shadow`, `border-radius`, or `@media`/`data-theme` wrapper may appear on the same rule.
  - `rg -n "inset 0 0 0 0.5px" src/routes/+layout.svelte` → **no matches** (the chip's hairline was the only remaining one after the gear removal).
  - `rg -n "mockup keeps these tiles light" src/routes/+layout.svelte` → **no matches**.
- `npm test` is **not** required (no test imports a `.svelte` file); run it only if the implementer wants a no-regression token.
- `npm run build` is optional: no template or script change, so `check` covers the risk.

### 8.2 Phone-size browser preview (required, Decision 13)

`RENTEASE_PREVIEW=1 npm run dev`, review at **390×844**:

1. **Open the `+` popover on any page.** All three rows show a bare stroke glyph — no white square, no hairline, no rounded plate. Settings, Reservations, Amenities look like siblings.
2. **Compare with the pill.** The popover glyphs read at the same weight and same neutral color as Dashboard / Tenants / Rooms. The only intended difference is 16px vs 20px.
3. **Alignment check.** The label's left edge is unchanged from before the fix (55px from the popover edge). Nothing shifts when the popover opens; the popover's overall height is unchanged at three rows.
4. **Active row.** Navigate to Reservations: reopen the popover — the Reservations **label** is accent blue and its **icon** is still neutral. Repeat for Amenities and for Settings / Settings → Sales Report.
5. **Press state.** Touch-hold a row: the `var(--fill)` press background still appears and the glyph color does not change.
6. **Dark theme.** Settings → Appearance → Dark, then repeat 1–5: glyphs are near-white on the dark popover surface, no chip, no residue of the old `rgba(255,255,255,0.12)` tile. Also spot-check once with `data-theme` removed (follow-the-device) if the OS is in dark mode.
7. **Regressions.** Popover opens/closes and animates as before; `+` still tints accent on Reservations / Amenities / Settings; scrim tap and Escape still dismiss; row separators still render; the `pop-tail` still points at the `+`.

No screenshot diffing. Desktop width is **not** required (Decision 13) — the dock is capped at 560px and the rows do not reflow.

---

## 9. Amendments to existing spec documents

Both files currently mandate the chip and would contradict the code afterwards. Amend them in the same change; do **not** rewrite them.

### 9.1 `lucide-icons-spec.md`

| Site | Current text | Amendment |
|------|--------------|-----------|
| §2 Decision **16** | "Popover tiles — **Keep the 30px `#f2f2f7` tile** in the `+` popover; monochrome icons sit centered on it." | Mark it **superseded by `popover-icons-spec.md`**: the plate was drawn for color emoji; with Lucide strokes it reads as a white block. The 30px *slot* remains, the surface does not. |
| §4.3 **R17** | "The `+` popover keeps its 30px `#f2f2f7` tile (Decision 16); the 16px icon is centered in it." | Note that the centering container survives **without** the chip. |
| §6 **Δ3** | "(tile kept)" | Change to "tile removed — see `popover-icons-spec.md`". |
| §11 **Open Question 2** | "Popover tiles with monochrome icons … if the preview looks like an empty gray chip behind a thin stroke, the follow-up is either removing the tile or tinting it with `--accent-soft`." | Record it as **resolved**: the tile was removed (`popover-icons-spec.md`, Decision 2). This question predicted the exact complaint the user filed. |

### 9.2 `settings-in-pill-nav-spec.md`

| Site | Current text | Amendment |
|------|--------------|-----------|
| §4.1 **R3** | Lists "30px `.pop-icon` tile" in the popover markup description. | Note the slot now carries no surface. |
| §4.6 **R25** | "The 30px `.pop-icon` tiles follow the theme (`#f2f2f7` in light, `rgba(255,255,255,.12)` in dark …)"; phrased as a dark-mode fix. | Mark **superseded** by `popover-icons-spec.md` R1–R6: the tiles are deleted. |
| §5 **Δ10** | "add dark-theme tile overrides so monochrome Lucide strokes stay visible (R25)" | Change to "no tile at all — `popover-icons-spec.md`". |
| §7 edge-case row "Dark theme" | Describes the `rgba(255,255,255,.12)` tile switch. | Note the chip is gone. |
| §3 audit table row "Popover markup" | mentions "`.pop-icon` 30px tile". | Note the slot carries no surface. |

Leave every other statement in both files alone — the popover order, the same-page Settings guard, the removed gear, the `+` tint and the arithmetic of the dock are all still accurate (verified against the working tree).

---

## 10. Out of scope (explicit)

- **The pill itself** — `.pill`, `.thumb`, `--i`, the sliding transition, tab sizes, tab colors and the 20px tab icons.
- **Popover behaviour** — order, dismissal (scrim / Escape / navigation), the same-page Settings guard, `aria-*`, `role="menu"`/`menuitem`, and the `popoverMaterial` transition.
- **Popover geometry** — `min-width`, anchoring, `pop-tail`, `transform-origin`, padding, `gap`, row height, separators.
- **Row interaction states** — no hover style (Decision 9), no focus-visible ring (Decision 10).
- **Icon semantics and sizing** — no icon swaps, no 20px bump, no stroke-width change, no `Icon.svelte` API change.
- **Global design system** — `app.css` keeps its palette and its unrelated `#f2f2f7` background token.
- **Other 30px chips** — none exist outside the popover; nothing else is restyled.
- **Desktop-width verification, screenshots, unit tests** — not required (Decision 13).
- **Anything outside `src/routes/+layout.svelte`** except the two spec-doc amendments in §9.

---

## 11. Open questions (recorded, not blockers)

1. **The 30px slot is now invisible padding.** Keeping it preserves label alignment and row height (R12), but if the rows later feel over-indented, the alternative is the rejected "let everything shift left" option — a 32px left move for every label. Revisit only with a visual complaint; not now.
2. **`--label` on the current-page row.** The active label is accent while its icon is `--label`. That is the requested behaviour (Decision 4) and it mirrors the pill (active tab darkens its label *and* icon, while the accent lives on the `+`). If it ever reads as two competing weights, the follow-up is tinting the active glyph with `--accent` again — one line, no structural change.
3. **`.pop-icon` name.** The class name now describes a slot with no icon-specific styling. Renaming it to something like `.pop-slot` would be more honest but touches markup for no visual gain; the name was kept (R16) to keep the change to CSS.
4. **High-contrast / forced-colors.** No `.pop-icon` rule exists in the `prefers-contrast` block, so nothing needed removing. In a forced-colors mode the glyph falls back to the system text color exactly as the pill tabs do.

---

## Appendix A — Before / after

Before (light theme, current page = Tenants):

```
┌──────────────────────────────┐
│ ┌────┐                       │   ← #f2f2f7 chip, 30×30, 8px radius,
│ │ ⚙  │  Settings             │     inset 0.5px hairline
│ └────┘                       │
├──────────────────────────────┤
│ ┌────┐                       │
│ │ 📅 │  Reservations         │   ← glyph is --label on a ~97%-white plate
│ └────┘                       │
├──────────────────────────────┤
│ ┌────┐                       │
│ │ 🧾 │  Amenities            │
│ └────┘                       │
└──────────────────────────────┘
```

After:

```
┌──────────────────────────────┐
│  ⚙   Settings                │   ← bare 16px stroke in --label,
│                              │     centered in the same 30px slot
├──────────────────────────────┤
│  📅  Reservations            │   ← on its own page: label accent,
│                              │     icon still --label
├──────────────────────────────┤
│  🧾  Amenities               │
└──────────────────────────────┘
```

Label x-position, row height, popover height and the tail geometry are identical in both drawings.

---

## Appendix B — Interview record

| Round | Questions | Answers |
|-------|-----------|---------|
| 1 | Which part reads as "white" · target treatment · default icon color · icon on the current-page row | the 30px tile · bare monochrome icon, no tile · `--label` · stays monochrome, label goes accent |
| 2 | Label alignment · icon size · row height · fate of the chip CSS | keep a 30px slot so labels don't move · keep 16px · keep ~52px (no min-height) · delete all chip CSS and comments |
| 3 | Hover state · existing spec docs · verification depth · CSS location · focus ring | none added · amend both specs · static + phone preview in both themes · layout file only · leave focus as-is |
