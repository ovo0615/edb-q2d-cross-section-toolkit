# EDB → Q2D Cross-Section Toolkit (front-end showcase)

[繁體中文](README.zh-TW.md) · **English**

Place a cut line on the 2D layout of an Ansys EDB database, extract the layer cross-section
that **actually exists** at that location, rebuild it as a 2D model in Ansys Q2D Extractor,
and solve for characteristic impedance.

> **This repository contains the front end only.** Reading EDB, scanning the cross-section
> and solving in Q2D are done by a private back end that is not published here.
> See [Public scope](#public-scope).

![Cross-section](docs/images/gui-04-cross-section.png)

---

## The problem this solves

When the signal-integrity question is "what is the characteristic impedance of this
cross-section?", a 2D extractor answers it in minutes. A 3D full-wave model takes hours to
build, and the answer still has to be recovered from S-parameters afterwards.

The hard part is **getting the cross-section into the 2D extractor**:

- **Q2D cannot cut a cross-section out of HFSS 3D Layout or EDB.**
- SIwave's *Export to 2D Extractor* generates an idealized cross-section from the
  **stackup**: trace width, spacing, and the reference planes above and below. It cannot
  represent what is actually at that location: locally voided planes, same-layer ground
  conductors on a signal layer, reference planes that exist only as narrow tongues, or
  padstack pads intersecting the cut.
- Redrawing by hand is slow and error-prone. During development, a hand-built model assumed
  a solid reference plane under a pad. That plane **was not there**. The hand-built model
  gave 57 Ω; the faithful model gave 61 Ω.

This tool reads the geometry that is **really in the database**.

---

## One real session

Every screenshot below comes from the **same session**, on a demonstration board that is
Ansys SIwave training material rather than any customer's design.

### 1. Open a board

8 conductor layers, 4608 primitives, rendered exactly, not a degraded approximation. The
SIwave-style layer panel on the right controls Fill / Show / Planes / Traces / Pads / Vias /
Elements per layer.

![Layout](docs/images/gui-01-layout.png)

### 2. Select a working region

Aiming at a 0.1 mm trace on a 200 mm board is not an interface problem, it is a scale
problem. Narrow attention to one stretch first; everything outside dims.

The region is two things at once: **it sets the length of every cut line**, and its left and
right edges are the **lateral truncation boundary** of the cross-section. Too narrow cuts
off the return path and reads the impedance high.

![Working region](docs/images/gui-02-region.png)

### 3. Place a cut line

Choose a direction, click once inside the region, and both ends snap to it.

**Cut lines are X or Y only.** An oblique cut inflates the apparent conductor width (+41% at
45°) and reads the impedance low. A mouse cannot draw a truly horizontal line, either. One
degree off is invisible to you and already wrong in the numbers. So the tool takes a
coordinate, not an angle.

Below the list is the solve plan for that cut: how many signal nets, whether a reference
conductor exists, how many differential pairs can be computed, and which reference nets will
be merged.

![Cut line and solve plan](docs/images/gui-03-cutline.png)

### 4. Check the cross-section

This is a WYSIWYG preview of **the Q2D model about to be built**, and the only place an
error can still be caught before a licence is spent.

**Every stackup layer is listed**, and layers with no conductor on the cut are shown
explicitly as empty: omitting empty layers is exactly how reference planes get misjudged.
Yellow is a signal conductor, grey a reference conductor, dark blue dielectric; click any
conductor to flip its role.

The left panel is the signal-net list: `GND` and `VCC` carry a locked reference tag (decided
by EDB's power/ground flag, not by name), the other five are signals, and each can be
excluded or promoted to a reference.

![Cross-section](docs/images/gui-04-cross-section.png)

### 5. Inspect the model before solving

AEDT runs in the background with no window, so the Q2D model tab shows **AEDT's own picture
of the model**. With no window to look at, this is the only direct evidence of what is
really in Q2D. Anything wrong can be stopped immediately, and finished sections are kept.

![AEDT's picture of the model](docs/images/gui-05-q2d-model.png)

It is to scale, which means 35 µm of copper on a 0.8 mm stackup is a few pixels and nothing
can be measured from it. The schematic view exaggerates the vertical axis instead, and
hovering any rectangle gives its name, material and dimensions.

![Schematic view](docs/images/gui-06-q2d-schematic.png)

### 6. Results

Five signal conductors against a merged `GND`, standard accuracy, 8 GHz, solved in
**24 seconds**.

![Results](docs/images/gui-07-results.png)

The comparison table carries three extra columns on purpose: **conductor count**,
**accuracy**, and **excluded nets**. A difference between two rows means a difference in the
structure only when those three match: a different conductor count means the section
contains different things, one more conductor is one more coupling partner, and it turns the
differential result from exact into approximate.

The off-diagonal terms of the RLGC matrices are the coupling. Here only `ST_CLK_CNT4` and
`ST_DELAY_STROBE` share significant mutual capacitance (−59.8 pF/m) and inductance
(140 nH/m) while every other pairing is essentially zero. The matrix says those two traces
are neighbours.

![RLGC matrices](docs/images/gui-08-rlgc.png)

### The interface

Alongside the ordered step panel there is a File / Run / View / Help menu bar
with `Ctrl+O`, `Ctrl+S`, `F5` and `Esc`. Nothing is reachable only from the
menu, and unavailable entries grey out rather than disappear.

![Menu bar](docs/images/gui-09-menu.png)

---

## What the front end does

| Component | Responsibility |
| --- | --- |
| `Preview2D.tsx` | 2D layout canvas: pan, zoom about the cursor, Fit All, layer solo, SIwave-style layer table, region selection and cut-line dragging |
| `CrossSectionView.tsx` | Cross-section: every stackup layer, conductor role toggling, graded safety findings |
| `Q2DModelView.tsx` | Q2D model: shows AEDT's exported picture, trimming its margins in the browser, or a vertically exaggerated schematic |
| `NetPanel.tsx` | Signal-net list: exclude / promote to reference, list import-export, reference protection |
| `ResultsView.tsx` | Results: differential and single-ended impedance, RLGC matrices, cross-cut comparison with its premises |
| `MenuBar.tsx` / `BrandMark.tsx` / `HelpDialog.tsx` | Application shell: menu bar, brand mark, help dialog |
| `api.ts` | Back-end transport: long jobs run as a job id plus a WebSocket log stream, with REST polling kept as the source of truth so a dropped socket never loses a result |

Stack: React 18 + TypeScript + Vite, Canvas 2D, hand-written SVG, `allotment` for draggable
splitters. Dark engineering-lab styling; Microsoft JhengHei for Chinese, Calibri for Latin
and numerals.

## Running the front end

```bash
cd web_app/frontend
npm install
npm run dev
```

The interface opens at `http://localhost:5180` and the layout, menus and dialogs all work.
**Anything that needs data will fail**, though: open, scan and solve all call `/api`, and
this repository has no back end. The screenshots above show the real behaviour.

---

## Public scope

Public: the front end, roughly 2,700 lines of TypeScript and CSS.
Private: the back end, roughly 3,600 lines of Python.

| Action | Front end | Private back end |
| --- | --- | --- |
| Pick a file | calls `/api/browse` | opens the file dialog |
| Open a board | calls `/api/open` | reads EDB geometry, stackup, materials, padstacks and nets via **pyedb** |
| Scan a section | calls `/api/scan` | samples every layer along the cut, refining span boundaries by bisection |
| Build and solve | calls `/api/build` | builds and solves the model in Q2D Extractor via **pyaedt** |
| Live log | `WebSocket /ws` | streamed from a separate worker process |

In other words, **the front end alone cannot import a board**: it never touches board data;
it is a rendering and interaction layer. Solving additionally needs a local Ansys Electronics
Desktop installation and a Q2D Extractor licence, which a browser cannot provide.

This repository contains **no** customer designs, board data, Touchstone results, or
license-server configuration.

## Verification

Two cross-sections (a gold finger and a routed trace) were re-run end to end on both
**2024 R2** and **2026 R1** and compared item by item against baselines (Zdiff, Z_odd,
Z_even, C11, C12, L11, L12) with a ±2% threshold. The largest measured deviation was
**0.04%**; Zdiff differed by 0.0002% across versions, and both versions extracted identical
segment counts and safety findings.

Load performance is part of acceptance too: on 2026 R1, opening a 2667-primitive board went
from 209 s (with a degraded preview only) to 12.6 s at exact rendering, and rescanning while
dragging a cut line from 24.3 s to 2.7 s.

### Cross-validated against SIwave TDR

All of that compares the tool against itself. It cannot catch a systematic error in the
extracted geometry, because such an error repeats identically and every gate still passes.

So the same microstrip — SURFACE layer, 228.6 µm wide, referenced to L2, with a 29 mm
straight run — was solved a second way with nothing in common: a 2.5D hybrid solve in
SIwave, two
gap ports, swept to 20 GHz, converted to a TDR profile along the line. Six Q2D cuts along
the same run give Z₀(x). Overlaid:

![Cross-validation](docs/images/xval-03-overlay.png)

| | Median | Range | Points |
| --- | --- | --- | --- |
| **Q2D** cross-section | **56.053 Ω** | 56.014 – 56.815 | 6 |
| **SIwave → TDR** | **56.053 Ω** | 55.852 – 56.224 | 146 |

The medians differ by **0.000%**, and five of the six cuts agree to within ±0.19%. For
scale, the Hammerstad closed form gives 58.9 Ω for the same w/h — 5% above both numerical
solutions.

**The single disagreement is the finding.** At x ≈ 130 the Q2D cut reads 1.4% high: a via
0.44 mm away punches an antipad through L2, the reference plane, which the matrices record
as 0.7% less capacitance and 2.0% more inductance. TDR's spatial resolution here is
1.42 mm and the antipad is 0.6–0.9 mm across, so **it structurally cannot see it** and
averages it into the line. The division of labour between the two methods is therefore
measured rather than asserted: TDR locates *where* along a real channel something is wrong;
Q2D gives the exact impedance of a chosen cross-section.

Full method, data and the four obstacles cleared along the way:
[docs/cross-validation-tdr.md](docs/cross-validation-tdr.md).

## Technical collaboration

Professional simulation services and technical engagements are conducted through
Taiwan Auto-Design Co. (TADC) using company-provided Ansys resources and licenses.

- Jeff Hong 洪敬傑 | CAE, Senior Technical Engineer
- Taiwan Auto-Design Co. (TADC) | <https://www.cadmen.com/>
- <jeff.hong@cadmen.com>

## Notice

Demonstration only. All rights reserved. See [NOTICE.md](NOTICE.md).

This is Jeff Hong's personal technical portfolio. It is not an official account of
Taiwan Auto-Design Co. (TADC). Ansys is a trademark of Ansys, Inc.; this portfolio is not
officially affiliated with Ansys, Inc.
