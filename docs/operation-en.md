# EDB to Q2D — Operation Guide

Provided by Jeff Hong 洪敬傑, Senior Technical Engineer, CAE,
Taiwan Auto-Design Co. (TADC).

Place a cut line on the 2D layout of an Ansys EDB database. The tool extracts the layer
cross-section that **actually exists** at that location, rebuilds it as a 2D model in
Ansys Q2D Extractor, and solves for characteristic impedance.

---

## 1. Prerequisites

### What must be installed first

| Item | Notes | How to get it |
| --- | --- | --- |
| Windows 10 / 11, 64-bit | Operating system | — |
| Python 3.10 (64-bit) | Runtime | The launcher detects it automatically; if absent it installs it via WinGet in user scope, without touching an existing Python |
| Ansys Electronics Desktop | **2026 R1** (default) or **2024 R2**, with a **Q2D Extractor** license | Company license |
| Network access | Only for the first package install | — |

On first run the launcher creates an isolated environment at
`web_app\backend\.venv` and installs the packages pinned in `requirements.lock.txt`:

| Package | Purpose |
| --- | --- |
| `pyedb==0.78.2` | Reads EDB geometry, stackup, materials, padstacks, and nets |
| `pythonnet==3.1.0` | .NET bridge pyedb needs to load the Ansys EDB DLLs on Windows |
| `pyaedt==1.1.0` | Builds and solves the Q2D Extractor design |
| `fastapi==0.141.1` | Local HTTP API serving the browser interface |
| `uvicorn[standard]==0.52.3` | ASGI server bound to `127.0.0.1` |

The browse dialogs use `tkinter` from the Python standard library, which the official
Windows Python installer already includes.

### Input

You need a `.aedb` **folder** (not a file). If you only have a SIwave `.siw`, export it
first with `File → Export → EDB`.

**You can try it without a board of your own.** The extracted root contains a
demonstration board, `Example_SYZ.aedb` (8 conductor layers, 4608 primitives, 308 nets).
Every screenshot in this guide was taken with it, and following the steps gives the same
numbers.

---

## 2. Starting the tool

1. **Extract the whole package** to a local folder. Do not run it from inside the archive
   viewer — that extracts a single file and leaves every dependency missing.
2. Double-click `web_app\start.bat`.
3. The first run takes a few minutes to create the environment and install packages.
   Progress is printed in the launcher window.
4. When ready, the browser opens `http://127.0.0.1:8010`. If antivirus or group policy
   blocks that, the launcher prints the URL for you to paste.

**Stopping**: close the launcher window or press `Ctrl+C` in it. The launcher terminates
the whole process tree and then verifies port 8010 was actually released.

**Port already in use**: the launcher reports the owning PID and process name; it never
kills an unknown process on your behalf. Use a different port:

```bash
powershell -ExecutionPolicy Bypass -File web_app\start.ps1 -Port 8011
```

---

## 3. The interface

The interface is in Traditional Chinese. The diagram below shows the labels as they appear,
with English glosses in the tables that follow.

```
┌──────────────────────────────────────────────────────────────┐
│  ▨  EDB to Q2D                                  partner logo │  title bar
├──────────────────────────────────────────────────────────────┤
│  檔案   執行   檢視   說明                服務正常 · 本機運算 │  menu bar
├───────────────┬──────────────────────────────────────────────┤
│ 1 板檔        │  Layout │ 結構剖面 │ Q2D 模型 │ 結果          │
│ 2 工作範圍    │                                              │
│ 3 截面        │                  (stage)                     │
│ 4 訊號線      │                                              │
│ 5 求解        ├──────────────────────────────────────────────┤
│               │                  系統日誌                     │
└───────────────┴──────────────────────────────────────────────┘
```

| Left-panel step | English |
| --- | --- |
| 1 板檔 | Board |
| 2 工作範圍 | Working region |
| 3 截面 | Cross-section (cut lines) |
| 4 訊號線 | Signal nets |
| 5 求解 | Solve |

| Stage tab | English |
| --- | --- |
| Layout | Layout |
| 結構剖面 | Cross-section |
| Q2D 模型 | Q2D model |
| 結果 | Results |

The **left panel** is the path for doing this the first time, in order. The **menu bar**
is the shortcut for someone who already knows what they want. Both point at the same
actions; nothing is reachable only from the menu. Entries that are unavailable grey out
rather than disappear — a fixed position is what makes them findable.

| Menu | Entries |
| --- | --- |
| **檔案 (File)** | Browse EDB… (`Ctrl+O`), Open board, Save cut set (`Ctrl+S`), Copy log, Clear log |
| **執行 (Run)** | Select working region, Add cut line, Delete current cut, Rescan current section, Build and solve (`F5`), Stop solve (`Esc`) |
| **檢視 (View)** | Layout / Cross-section / Q2D model / Results, with the current one ticked |
| **說明 (Help)** | Quick start, About |

Shortcuts do not fire while a text field has focus, so typing a path cannot trigger a save.

![Menu bar](images/gui-09-menu.png)

Every splitter is draggable (left panel / stage, stage / log). Positions are remembered as
**ratios**, so the proportions hold on a machine with a different resolution.

---

## 4. Workflow

### Step 1 — Open a board

1. In **板檔 (Board)**, click **瀏覽… (Browse)** and pick the **`edb.def`** inside the `.aedb` folder.
   The tool folds back to the enclosing `.aedb` folder by itself. You can also paste a path
   directly — quotes, or a path pointing at `edb.def`, are corrected automatically.
2. Choose the **AEDT version**. Default `2026.1`. Picking an unvalidated version shows a
   notice — it still runs, but check the results yourself.
3. Click **開啟 (Open)**.

The **Layout** tab shows the 2D layout with a SIwave-style layer panel on the right.

![Board loaded](images/gui-01-layout.png)

**A cut set saved for this board is restored automatically**, including cut positions, role
assignments, and the previous results. Restored cuts carry a position but no cross-section,
so the tool rescans them for you — you do not have to ask for it.

> **Boards with many primitives**
> Above a threshold the preview degrades to coarse mode (polygons approximated by their
> bounding boxes) and a notice appears. Cut scanning and Q2D model building **always use
> exact geometry**; the degradation affects rendering speed only, never a number.

### Step 2 — The layer panel (Layout tab)

Each row is one **conductor layer**, with seven columns:

| Column | Icon | Controls |
| --- | --- | --- |
| Fill | ■ | Copper planes filled solid vs. outline only |
| Show | ● | Show/hide the whole layer |
| Planes | ▣ | Copper planes |
| Traces | ≡ | Traces |
| Pads | ◉ | Pads |
| Vias | ◎ | Vias |
| Elements | ⊞ | Circuit elements |

**Fill is off by default.** Solid-filled planes hide the traces, pads, and vias underneath —
which is exactly what you need to see when a board first loads.

The panel lists conductor layers only; dielectric layers have no geometry to toggle, and
listing them would produce a long list where half the checkboxes do nothing.
**The cross-section view still lists every layer** — the two lists answer different questions.

**Click a layer name** to show only that layer; click again to restore. Column headers
toggle a whole column. The **◀** at the panel edge collapses it; the same spot becomes **▶**
to bring it back. The **Nets** tab filters by net name, which helps when hunting a
differential pair.

**Navigation**: left-drag to pan, wheel to zoom about the cursor. **⛶ Fit All** returns to
the whole board and **▣ Region** to the current working region. Cursor coordinates are
shown live in the bottom right.

### Step 3 — Select a working region

Aiming at a 0.1 mm trace on a 200 mm board is not an interface problem, it is a scale
problem. Narrow the view first, then cut inside it.

1. In **工作範圍 (Working region)**, click **▣ 框選範圍 (Select region)** (or **執行 → 框選工作範圍**).
2. Drag a rectangle over the stretch you want to analyse.
3. The view zooms to it and everything outside dims.

The region's X/Y extents and size are shown once set. **清除 (Clear)** removes it.

![Working region](images/gui-02-region.png)

> **The working region is two things at once.** It sets the length of every cut line, and
> its left and right edges are the **lateral truncation boundary** of the cross-section.
> Too narrow cuts off the return path and reads the impedance high; too wide makes the
> model larger and the solve slower. Widen it until the number stops moving.

### Step 4 — Place a cut line

1. In **截面 (Cross-section)**, choose the **切線方向 (direction)**: 水平（沿 X）horizontal, or 垂直（沿 Y）vertical.
2. Click **＋ 新增切線 (Add cut line)** (or **執行 → 新增切線**).
3. **Click once** inside the working region. The cut is placed there and both ends snap to
   the region.

> **Cut lines are X or Y only.**
> An oblique cut inflates the apparent conductor width (+41% at 45°) and reads the impedance
> low — and a mouse cannot draw a truly horizontal line. One degree off is invisible to you
> and already wrong in the numbers. So the tool takes a coordinate, not an angle.

The cut is scanned immediately. **To adjust**, drag the cut line; it rescans on release.
Each row in the list shows its name, coordinate, and `Zdiff` (or "not solved"). **刪除 (Delete)**
removes the selected cut.

Below the list, the tool shows the **solve plan** for this cut:

- **N signal nets**, **reference conductor: yes/no**
- If the section contains several reference nets, a notice states that they are **merged
  into a single conductor named `GND`** — which assumes they are at the same AC potential.
  To see the coupling to one of them specifically, turn it back into a signal in step 5.
- **N differential pairs**, **N single-ended conductors**, with each pair's polarity
- Unpaired signals, and why anything could not be paired

![Cut line and solve plan](images/gui-03-cutline.png)

### Step 5 — Signal nets

This lists the nets **the cut line actually crosses** — not every net in the working region.
Listing nets that are not on the cut only makes people decide about irrelevant things.

| Control | Meaning |
| --- | --- |
| Checkbox | Include / exclude this net |
| **設為參考 (Set as reference)** | Promote a signal to a reference plane (e.g. a deliberately grounded neighbour) |
| **參考 ✕ (Reference ✕)** | One you promoted; click to turn it back into a signal |
| **參考 (Reference)**, grey tag | Flagged power/ground in EDB — locked, cannot be excluded |
| 全部納入 / 全部排除 (Include all / Exclude all) | Bulk action over the current filter |
| 匯入清單 / 匯出清單 (Import / Export list) | Plain text, one net per line. The export lists the **signals to keep**, not the ones excluded |

**Excluding a net means "this copper is not there."** That area becomes dielectric; the net
is not merely hidden from the result table. So what you get afterwards is the impedance
without it, not the impedance of the board as designed — the interface says so in orange.

**Reference conductors are decided by EDB's own `is_power_ground` flag, not by whether the
net is called GND.** Without a reference plane, impedance is not defined, so that must not
be a state you can click yourself into by mistake.

<details>
<summary><b>Is treating a power net as a reference right or wrong?</b></summary>

Three questions, in order:

1. **Is that power copper the nearest reference plane to the trace?** If yes, it must be a
   reference. A decoupled power plane is an AC ground at these frequencies — that is the
   standard SI assumption, and *not* making it a reference produces a model with no return
   path at all.
2. **Is there a solid reference plane in between?** If yes, the choice does not matter.
   A measured case: the pair on L01 referenced to L02 only 50 µm below, the power net on L10,
   0.764 mm away and shielded by an L09 plane spanning the whole section. Removing the power
   net entirely and re-solving moved `Zdiff` from 61.554 to 61.554 — smaller than the 0.001
   mesh noise between two identical runs.
3. **Is the power copper a plane or a narrow trace in this section?** A narrow routed trace
   close to the signal makes the flag worth doubting: treating it as an ideal return path is
   an optimistic assumption.

Also, if what you want to see *is* the coupling to the power net (PDN noise), merging it
into `GND` assumes the answer is zero. Make it a signal here instead.

</details>

### Step 6 — Check the cross-section

The **Cross-section** tab is a WYSIWYG preview of **the Q2D model about to be built**. It is
the only place an error can still be caught before a solve is spent.

- **Every stackup layer is listed.** Signal layers with no conductor on the cut are shown
  explicitly as empty — omitting empty layers is exactly how reference planes get misjudged.
- **Yellow** = signal conductor, **grey** = reference conductor, **dark blue** = dielectric.
- An orange outline marks a conductor that comes from a **via pad**.
- Thickness and material for each layer are shown on the right.
- **Click any conductor** to toggle it between signal and reference.

![Cross-section and signal-net list](images/gui-04-cross-section.png)

The left panel in that shot is step 5: `GND` and `VCC` carry the locked **參考**
(reference) tag, the other five are signals. On the right, `L6` and `BASE` are
labelled as having no conductor on the cut.

Safety findings are counted above and listed below, at two severities:

| Severity | Meaning | What to do |
| --- | --- | --- |
| **Must fix** | Almost certainly gives a wrong answer | Fix it before solving |
| **Judgement** | May be deliberate, may be a mistake | Decide yourself |

Common findings:

- **Cut not perpendicular to the trace** — an oblique cut inflates the apparent width and
  reads the impedance low. The finding states the angle and the percentage inflation.
- **Cut passes through a via pad** — a via pad is much wider than the trace and swells the
  section. Ignore it if the via is what you are analysing; otherwise move the cut.
- **No reference conductor** — no reference layer in the section; impedance is undefined.
- **Lateral truncation too close to the signal** — widen the working region until the number
  is stable.

### Step 7 — Solve

1. Choose the **求解精度 (solve accuracy)**:

   | Mode | Setting | When to use |
   | --- | --- | --- |
   | **快速 (Fast)** | Surface impedance, 1% convergence | Trying many cuts on one board. Measured ~0.4% below Accurate, 16–39 s |
   | **標準 (Standard)**, default | Surface impedance, 0.2% convergence | General use. Measured ~0.2% below Accurate, 22–42 s |
   | **高精度 (Accurate)** | Solve inside conductors, 0.2% convergence | When you need frequency-dependent resistance from skin effect. 107–147 s |

2. Confirm the **自適應頻率 (adaptive frequency)**, default `8GHz`.
3. Click **建立並求解 (Build and solve)** (or `F5`).

This starts Ansys Electronics Desktop and **consumes a license**. **AEDT runs in the
background with no window.** The log streams at the bottom; EDB and AEDT both run in a
subprocess, so the browser interface stays responsive.

**The moment the model is built — before the solve starts — the view switches to the
Q2D model tab.** What it shows by default is **AEDT's own picture of the model**: there is
no AEDT window to look at, so this is the only direct evidence of what is really in Q2D.
It is to scale, which means 35 µm of copper on a 0.8 mm stackup is a few pixels and nothing
can be measured from it. Press **示意圖 (Schematic)** for the exaggerated view, where hovering any
rectangle gives its name, material, and dimensions.

![AEDT's picture of the model](images/gui-05-q2d-model.png)

![Schematic view, vertically exaggerated](images/gui-06-q2d-schematic.png)

If something is wrong, press **■ 終止求解 (Stop solve)** (or `Esc`):

- AEDT stops within seconds; you do not have to wait out the run.
- **Sections already finished are kept**, so fixing one cut does not mean re-running the rest.
- Stopping is not a failure; the log states how many cuts completed.

### Step 8 — Read the results

The upper half of the **Results** tab is the selected cut in full:

- **Differential**: `Zdiff` / `Z_odd` / `Z_even` / `Zcomm` per pair, plus a **basis** column.
  *Exact* means the section has exactly two conductors; *approximate* means three or more,
  in which case the pair is taken as a 2×2 sub-block with the remaining conductors held at
  reference potential.
- **Single-ended**: `Z₀` per conductor.
- **RLGC matrices**: `C` (pF/m) and `L` (nH/m).

![Results](images/gui-07-results.png)

The off-diagonal terms are the coupling. In this example `ST_CLK_CNT4` and
`ST_DELAY_STROBE` share −59.8 pF/m of mutual capacitance and 140 nH/m of mutual
inductance while every other pairing is essentially zero — those two traces are
neighbours.

![RLGC matrices](images/gui-08-rlgc.png)

The lower half compares every solved cut side by side. Comparison is what this tool is
mostly used for, and numbers spread across separate screens have to be compared from memory,
which is where mistakes come from. Three columns are there on purpose:

| Column | Why it matters |
| --- | --- |
| **Conductors** | A different count means the section contains different things. One more conductor is one more coupling partner, and it turns the differential result from exact into approximate (`≈`) |
| **Accuracy** | A difference in solver settings, not in the board |
| **Excluded nets** | Which copper was taken away |

**A difference between two rows means a difference in the structure only when those three
columns match.**

### Step 9 — Saving

A completed solve is saved automatically to `<board>.aedb.q2dcuts.json`, next to the `.aedb`.
You can also save at any time with **檔案 → 儲存截面設定** (`Ctrl+S`).

What is stored is not just the impedance but the conductor list, the solve accuracy, and the
excluded nets — two numbers side by side cannot be compared without knowing the premises
behind each.

> If the folder holding the `.aedb` is not writable (a read-only project directory, say), the
> cut set goes to `%USERPROFILE%\.edb-to-q2d\cutsets\` instead, and the interface shows where.

Reopening the same board restores the cut lines, role assignments, and results.

---

## 5. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Launcher shows truncated commands like `'indows'` or `'NCODING'` | `start.bat` line endings were converted to LF. Download again; do not process it with a tool that rewrites line endings. |
| Browser does not open | Antivirus or group policy blocked it. The URL is printed in the launcher window. |
| Opening a board takes a long time | The first open of a large EDB is genuinely slow (`pyedb` has to load .NET assemblies). The log shows progress. |
| Step 4 "Signal nets" is empty | That cut has not been scanned. Selecting it rescans automatically; if it stays empty use **執行 → 重新掃描目前截面**. |
| Solve fails with a licensing message | Check that a Q2D Extractor license is available and no other AEDT session holds it. |
| Impedance clearly too low | Check the safety findings for "cut not perpendicular to the trace" — an oblique cut inflates the width. |
| Impedance clearly too high | Lateral truncation is too tight. Widen the working region until the number stops changing. |
| Two cuts differ a lot | Compare the Conductors / Accuracy / Excluded columns first. With different premises, a difference in the numbers is not a difference in the structure. |
| `≈` next to a differential value | The section has three or more conductors, so the differential value is approximate. Exclude the irrelevant conductors, or check whether they should be references. |
| AEDT still running after closing the window | A solving AEDT is a separate process; the tool will not force-kill a session mid-solve. Check Task Manager. |

---

## 6. Data and privacy

- Everything runs locally on `127.0.0.1`. **No board data or result is ever uploaded.**
- The service binds to loopback only; other machines on the LAN cannot reach it.
- The only time network access is needed is the first package install.

---

Demonstration only. All rights reserved. See [NOTICE.md](../NOTICE.md).
Ansys is a trademark of Ansys, Inc.; this project is not affiliated with Ansys, Inc.
