// 2D Layout 預覽（HTML5 Canvas，SIwave 風格圖層面板）
// 渲染引擎沿用 PCB SI 3D Simulation Toolkit 驗證過的作法，並加上本工具特有的
// 任意角度 CutLine：命中測試從「距離某軸」改為「距離某直線」，才能處理斜向走線。
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Primitive, PreviewData } from '../api'

export interface CutMarker {
  name: string
  axis: Axis
  coord: number
  color: string
  active?: boolean
}

/** 工作範圍：先把注意力縮到板子的一小塊，再在裡面裁切。 */
export type Region = { x0: number; y0: number; x1: number; y1: number }

/** 切線方向。只允許正 X／正 Y——斜切會讓線寬看起來變寬，阻抗直接失真。 */
export type Axis = 'x' | 'y'

export function normalizeRegion(a: [number, number], b: [number, number]): Region {
  return {
    x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]),
    x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]),
  }
}

/** 切線在工作範圍內的兩個端點。軸向與座標已足夠決定一條切線。 */
export function cutEnds(axis: Axis, coord: number, region: Region):
    { p1: [number, number]; p2: [number, number] } {
  if (axis === 'x') {
    const y = Math.min(Math.max(coord, region.y0), region.y1)
    return { p1: [region.x0, y], p2: [region.x1, y] }
  }
  const x = Math.min(Math.max(coord, region.x0), region.x1)
  return { p1: [x, region.y0], p2: [x, region.y1] }
}

interface Props {
  data: PreviewData | null
  cuts: CutMarker[]
  activeIndex: number
  onCutChange?: (index: number, coord: number) => void
  onSelectCut?: (index: number) => void
  onPlaceCut?: (coord: number) => void
  placing?: boolean
  axis: Axis
  region: Region | null
  selectingRegion?: boolean
  onRegionChange?: (region: Region | null) => void
}

interface LayerMode {
  filled: boolean; visible: boolean; planes: boolean
  traces: boolean; pads: boolean; vias: boolean; components: boolean
}

// filled 預設關閉：銅箔平面實心填滿會蓋住底下的走線、Pad 與 Via，
// 而剛載入一片板子時最需要看的正是那些。
const DEFAULT_MODE: LayerMode = {
  filled: false, visible: true, planes: true,
  traces: true, pads: true, vias: true, components: true,
}

// tone 存完整的 class 名稱而不是後綴：拼接出來的 class 名稱，
// 靜態檢查（tests_smoke 的 className↔CSS 比對）看不到完整名稱，
// 拼錯或漏寫規則就會溜過去。
const LAYER_COLS: { key: keyof LayerMode; icon: string; title: string; tone: string }[] = [
  { key: 'filled', icon: '■', title: 'Fill / Unfill All', tone: 'col-gold' },
  { key: 'visible', icon: '●', title: 'Show / Hide All', tone: 'col-grey' },
  { key: 'planes', icon: '▣', title: 'Planes（銅箔平面）', tone: 'col-blue' },
  { key: 'traces', icon: '≡', title: 'Traces（走線）', tone: 'col-blue' },
  { key: 'pads', icon: '◉', title: 'Pads（焊盤）', tone: 'col-blue' },
  { key: 'vias', icon: '◎', title: 'Vias（過孔）', tone: 'col-blue' },
  { key: 'components', icon: '⊞', title: 'Circuit Elements（元件外框）', tone: 'col-blue' },
]

const BG = '#0c0e12'
// 板面。深綠是 PCB 檢視器的通用語言——它讓「板子在哪、板外是哪裡」一眼可辨。
// 沒有它，走線浮在純黑上，使用者分不出「這裡沒有銅」和「這裡不是板子」。
const BOARD_FILL = 'rgba(18, 62, 28, 0.85)'
const BOARD_STROKE = '#4caf50'
// 板子以公釐為單位，scale 是「每公釐幾個像素」。
// 下限讓 1 公尺的板子仍看得見，上限約可看到 1 微米的細節。
const MIN_SCALE = 0.05
const MAX_SCALE = 20000
const VIRTUAL = new Set(['Vias', 'Ports', 'Board', 'Components'])
// 虛擬層不在疊構裡，但同樣要能被單層聚焦收掉
// 虛擬層：不在疊構裡，但同樣要能開關。順序照 SIwave 的習慣放在導體層之後。
const VIRTUAL_LAYERS = ['Board', 'Vias', 'Components']

export default function Preview2D({
  data, cuts, activeIndex, onCutChange, onSelectCut, onPlaceCut, placing,
  axis, region, selectingRegion, onRegionChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [dragCut, setDragCut] = useState<number | null>(null)
  const [rubber, setRubber] = useState<[number, number] | null>(null)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const [modes, setModes] = useState<Record<string, LayerMode>>({})
  const [tab, setTab] = useState<'layers' | 'comps' | 'nets'>('layers')
  const [netFilter, setNetFilter] = useState('')
  const [panelOpen, setPanelOpen] = useState(true)
  const [hiddenNets, setHiddenNets] = useState<Record<string, boolean>>({})
  const [compFilter, setCompFilter] = useState('')
  const [hiddenComps, setHiddenComps] = useState<Record<string, boolean>>({})
  const down = useRef({ x: 0, y: 0 })

  const mode = (layer: string) => modes[layer] || DEFAULT_MODE

  /** 疊構完整性：以後端的 layer_order 為基準，切線上沒有幾何的層仍要留在面板。 */
  const stackupLayers = useCallback((): string[] => {
    if (!data) return []
    const inData = Object.keys(data.layers).filter((l) => !VIRTUAL.has(l))
    const ordered = data.layer_order || []
    return [...ordered.filter((l) => !VIRTUAL.has(l)),
            ...inData.filter((l) => !ordered.includes(l))]
  }, [data])

  /** 實際畫得出來的內容範圍。

   *  刻意不直接用 data.bounds：那是板框，可能被一個離群的圖元撐大，
   *  fit 之後整片板子縮在角落，使用者只會覺得「畫面壞了」。
   */
  const contentBounds = useCallback((): Region | null => {
    if (!data) return null
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    const exp = (x: number, y: number) => {
      if (!isFinite(x) || !isFinite(y)) return
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
    for (const layer of Object.keys(data.layers)) {
      if (!mode(layer).visible) continue
      for (const it of data.layers[layer] || []) {
        if (it.points) for (const pt of it.points) exp(pt[0], pt[1])
        else if (it.kind === 'rect') { exp(it.x!, it.y!); exp(it.x! + it.w!, it.y! + it.h!) }
        else if (it.kind === 'circle') { exp(it.x! - it.r!, it.y! - it.r!); exp(it.x! + it.r!, it.y! + it.r!) }
      }
    }
    if (!isFinite(x0) || x1 - x0 <= 0 || y1 - y0 <= 0) {
      const [bx0, by0] = data.bounds.min
      const [bx1, by1] = data.bounds.max
      if (bx1 - bx0 <= 0 || by1 - by0 <= 0) return null
      return { x0: bx0, y0: by0, x1: bx1, y1: by1 }
    }
    return { x0, y0, x1, y1 }
  }, [data, modes])

  /** 把某個範圍填滿畫布。Fit All 與「縮到工作範圍」共用同一段數學。 */
  const fitTo = useCallback((box: Region | null) => {
    const wrap = wrapRef.current
    if (!wrap || !box) return
    const r = wrap.getBoundingClientRect()
    if (!r.width || !r.height) return
    const w = Math.max(box.x1 - box.x0, 1e-9)
    const h = Math.max(box.y1 - box.y0, 1e-9)
    const scale = Math.min(Math.max(
      Math.min(r.width / w, r.height / h) * 0.88, MIN_SCALE), MAX_SCALE)
    setTransform({
      x: r.width / 2 - ((box.x0 + box.x1) / 2) * scale,
      // screenY = y + H - worldY*scale，要讓範圍中心落在畫布中心：
      // H/2 = y + H - cy*scale  =>  y = cy*scale - H/2
      y: ((box.y0 + box.y1) / 2) * scale - r.height / 2,
      scale,
    })
  }, [])

  const fitAll = useCallback(() => fitTo(contentBounds()), [fitTo, contentBounds])

  // 換板子時自動 fit；之後只有按鈕會觸發，不會在使用者操作中途把畫面拉走。
  useEffect(() => { fitAll() }, [data])   // eslint-disable-line react-hooks/exhaustive-deps

  // 面板收合、視窗縮放都會改變畫布尺寸。canvas 的實際像素是在繪製時依 wrap 量測的，
  // 沒有這個觀察者，畫面會維持舊尺寸直到下一次狀態變動才更新。
  const [canvasTick, setCanvasTick] = useState(0)
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => setCanvasTick((n) => n + 1))
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  // 設定工作範圍後把畫面縮過去——「縮小範圍」的重點就是眼睛也要跟著縮。
  useEffect(() => { if (region) fitTo(region) }, [region, fitTo])

  const toWorld = (e: React.MouseEvent): [number, number] | null => {
    const c = canvasRef.current
    if (!c) return null
    const r = c.getBoundingClientRect()
    return [
      (e.clientX - r.left - transform.x) / transform.scale,
      (r.height + transform.y - (e.clientY - r.top)) / transform.scale,
    ]
  }

  /** 游標下的切線。切線貼齊範圍，所以只需比對它固定的那個座標。 */
  const cutUnderCursor = (e: React.MouseEvent): number | null => {
    if (!cuts.length || !region) return null
    const w = toWorld(e)
    if (!w) return null
    const tol = 7 / transform.scale
    let best: number | null = null
    let bestD = Infinity
    cuts.forEach((cut, index) => {
      const along = cut.axis === 'x' ? w[0] : w[1]
      const lo = cut.axis === 'x' ? region.x0 : region.y0
      const hi = cut.axis === 'x' ? region.x1 : region.y1
      if (along < lo - tol || along > hi + tol) return
      const d = Math.abs((cut.axis === 'x' ? w[1] : w[0]) - cut.coord)
      if (d <= tol && d < bestD) { bestD = d; best = index }
    })
    return best
  }

  const onMouseDown = (e: React.MouseEvent) => {
    down.current = { x: e.clientX, y: e.clientY }
    if (selectingRegion) {
      const w = toWorld(e)
      if (w) setRubber(w)
      return
    }
    if (placing) return          // 放開時才建立，放下去就是最終位置
    const hit = cutUnderCursor(e)
    if (hit !== null) {
      // 抓到切線就只拖切線，不要同時平移畫面，否則圖跟著跑永遠對不準。
      setDragCut(hit)
      onSelectCut?.(hit)
      return
    }
    setDragging(true)
    setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y })
  }

  // 滑鼠移動一秒可以觸發上百次。座標顯示與拖曳預覽只需要跟上畫面更新率，
  // 每個事件都進 React state 是純粹的浪費。
  const cursorFrame = useRef(0)
  const queueCursor = (w: [number, number] | null) => {
    if (cursorFrame.current) return
    cursorFrame.current = requestAnimationFrame(() => {
      cursorFrame.current = 0
      setCursor(w)
    })
  }
  useEffect(() => () => {
    if (cursorFrame.current) cancelAnimationFrame(cursorFrame.current)
  }, [])

  /** 世界座標 -> 切線的那一個座標值（沿 X 的切線由 y 定位，反之亦然）。 */
  const coordOf = (w: [number, number]) => (axis === 'x' ? w[1] : w[0])

  const onMouseMove = (e: React.MouseEvent) => {
    const w = toWorld(e)
    if (w) queueCursor(w)
    if (dragCut !== null && onCutChange && w && region) {
      const cut = cuts[dragCut]
      const value = cut.axis === 'x' ? w[1] : w[0]
      const lo = cut.axis === 'x' ? region.y0 : region.x0
      const hi = cut.axis === 'x' ? region.y1 : region.x1
      onCutChange(dragCut, Math.min(Math.max(value, lo), hi))
      return
    }
    if (dragging) {
      setTransform((p) => ({ ...p, x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }))
    }
  }

  const onMouseUp = (e: React.MouseEvent) => {
    if (selectingRegion && rubber) {
      const w = toWorld(e)
      // 太小的框視為誤點。整片板子縮到幾微米的框裡只會讓人以為畫面壞了。
      if (w && Math.abs(w[0] - rubber[0]) > 1e-3 && Math.abs(w[1] - rubber[1]) > 1e-3) {
        onRegionChange?.(normalizeRegion(rubber, w))
      }
      setRubber(null)
      return
    }
    if (placing && region) {
      const w = toWorld(e)
      const moved = Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y)
      // 拖曳是平移畫面，不是放切線；只有單純點一下才建立。
      if (w && moved < 5) onPlaceCut?.(coordOf(w))
      return
    }
    if (dragCut !== null) { setDragCut(null); return }
    setDragging(false)
  }

  const onWheel = (e: React.WheelEvent) => {
    const c = canvasRef.current
    if (!c) return
    const r = c.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    setTransform((p) => {
      // 夾住縮放倍率：滑鼠滾輪一次給的 deltaY 在不同裝置上差很多，
      // 不夾的話一次手勢就可能把板子縮到看不見或放大到只剩一片顏色。
      const f = Math.min(Math.max(Math.exp(-e.deltaY * 0.001), 0.2), 5)
      const scale = Math.min(Math.max(p.scale * f, MIN_SCALE), MAX_SCALE)
      const k = scale / p.scale
      // 世界→螢幕是 screenY = y + H - worldY * scale（y 軸朝上，見繪製區的
      // ctx.scale(scale, -scale)）。把 y 當成一般螢幕座標去縮放會漏掉 H 項，
      // 每縮放一格畫面就垂直跳 H×(k−1) 像素——這正是「畫面會自己跑掉」。
      const H = r.height
      return {
        x: mx - (mx - p.x) * k,
        y: my - H + (p.y + H - my) * k,
        scale,
      }
    })
  }

  // ── 繪製 ──────────────────────────────────────────
  //
  // 分成兩層：板子畫進離屏畫布，覆蓋層每次只把它貼上再畫幾條線。
  //
  // 板子有數千個圖元；覆蓋層（游標座標、拖曳中的切線與範圍框）則是每次滑鼠移動
  // 都要更新的。把兩者放在同一個 effect、讓 cursor 進相依陣列，等於每動一下滑鼠
  // 就重畫整片板子——實際結果是「一畫完線就當機卡住」。
  const boardRef = useRef<HTMLCanvasElement | null>(null)
  const [boardEpoch, setBoardEpoch] = useState(0)

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || !data) return
    const dpr = window.devicePixelRatio || 1
    const rect = wrap.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    if (!boardRef.current) boardRef.current = document.createElement('canvas')
    const canvas = boardRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, rect.width, rect.height)

    ctx.save()
    ctx.translate(transform.x, transform.y + rect.height)
    ctx.scale(transform.scale, -transform.scale)
    const px = (n: number) => n / transform.scale

    const drawItems = (layer: string, items: Primitive[], color: string) => {
      const m = mode(layer)
      if (!m.visible) return
      for (const it of items) {
        if (it.net && hiddenNets[it.net]) continue
        if (it.kind === 'polygon' && !m.planes) continue
        if (it.kind === 'path' && !m.traces) continue
        if (it.kind === 'circle' || it.kind === 'rect') {
          const isVia = !!it.via
          if (isVia && !m.vias) continue
          if (!isVia && it.kind === 'circle' && !m.pads) continue
        }
        if (it.kind === 'comp') {
          if (!m.components) continue
          if (it.name && hiddenComps[it.name]) continue
        }

        ctx.strokeStyle = color
        ctx.fillStyle = color
        ctx.lineWidth = px(1)

        if (it.kind === 'polygon' && it.points) {
          ctx.beginPath()
          trace(ctx, it.points)
          for (const hole of it.holes || []) trace(ctx, hole)
          if (m.filled) { ctx.globalAlpha = 0.5; ctx.fill('evenodd'); ctx.globalAlpha = 1 }
          ctx.stroke()
        } else if (it.kind === 'path' && it.points) {
          ctx.beginPath()
          trace(ctx, it.points)
          ctx.globalAlpha = m.filled ? 0.65 : 1
          if (m.filled) ctx.fill(); else ctx.stroke()
          ctx.globalAlpha = 1
        } else if (it.kind === 'rect') {
          ctx.strokeRect(it.x!, it.y!, it.w!, it.h!)
          if (m.filled) { ctx.globalAlpha = 0.5; ctx.fillRect(it.x!, it.y!, it.w!, it.h!); ctx.globalAlpha = 1 }
        } else if (it.kind === 'circle') {
          ctx.beginPath()
          ctx.arc(it.x!, it.y!, Math.max(it.r!, px(1)), 0, Math.PI * 2)
          ctx.stroke()
        } else if (it.kind === 'comp') {
          // 元件只畫外框，且用虛線——它不是銅箔，不該看起來像。
          ctx.setLineDash([px(3), px(2)])
          ctx.strokeRect(it.x!, it.y!, it.w!, it.h!)
          ctx.setLineDash([])
        }
      }
    }

    // 板面先畫，其餘都疊在上面。
    if (mode('Board').visible) {
      for (const it of data.layers['Board'] || []) {
        ctx.fillStyle = BOARD_FILL
        ctx.fillRect(it.x!, it.y!, it.w!, it.h!)
        ctx.strokeStyle = BOARD_STROKE
        ctx.lineWidth = px(1.2)
        ctx.strokeRect(it.x!, it.y!, it.w!, it.h!)
      }
    }

    const colors = data.layer_colors || {}
    for (const layer of stackupLayers()) {
      const rgb = colors[layer] || [120, 160, 200]
      drawItems(layer, data.layers[layer] || [], `rgb(${rgb.join(',')})`)
    }
    drawItems('Vias', data.layers['Vias'] || [], '#ff8a65')
    drawItems('Components', data.layers['Components'] || [], '#90caf9')
    ctx.restore()
    setBoardEpoch((n) => n + 1)
  }, [data, transform, modes, hiddenNets, hiddenComps, stackupLayers, canvasTick])

  // 覆蓋層：貼上快取好的板子，再畫範圍、切線與拖曳預覽。
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    const board = boardRef.current
    if (!canvas || !wrap || !board) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const rect = wrap.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    canvas.width = board.width
    canvas.height = board.height
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(board, 0, 0)

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.save()
    ctx.translate(transform.x, transform.y + rect.height)
    ctx.scale(transform.scale, -transform.scale)
    const px = (n: number) => n / transform.scale

    // 工作範圍：範圍外壓暗，讓注意力真的縮到框內
    if (region) {
      ctx.save()
      ctx.fillStyle = 'rgba(12,14,18,0.62)'
      ctx.beginPath()
      ctx.rect(-1e6, -1e6, 2e6, 2e6)
      ctx.rect(region.x0, region.y0, region.x1 - region.x0, region.y1 - region.y0)
      ctx.fill('evenodd')
      ctx.strokeStyle = '#3fb950'
      ctx.setLineDash([px(6), px(4)])
      ctx.lineWidth = px(1.4)
      ctx.strokeRect(region.x0, region.y0,
                     region.x1 - region.x0, region.y1 - region.y0)
      ctx.setLineDash([])
      ctx.restore()
    }

    // 正在拉的範圍框
    if (rubber && cursor) {
      ctx.strokeStyle = '#3fb950'
      ctx.lineWidth = px(1.4)
      ctx.setLineDash([px(5), px(4)])
      ctx.strokeRect(Math.min(rubber[0], cursor[0]), Math.min(rubber[1], cursor[1]),
                     Math.abs(cursor[0] - rubber[0]), Math.abs(cursor[1] - rubber[1]))
      ctx.setLineDash([])
    }

    // 游標所在位置的切線預覽：放下去就是這個位置，不必先拉再看
    if (placing && region && cursor) {
      const at = cutEnds(axis, axis === 'x' ? cursor[1] : cursor[0], region)
      ctx.strokeStyle = '#58a6ff'
      ctx.lineWidth = px(2)
      ctx.setLineDash([px(4), px(3)])
      ctx.beginPath()
      ctx.moveTo(at.p1[0], at.p1[1])
      ctx.lineTo(at.p2[0], at.p2[1])
      ctx.stroke()
      ctx.setLineDash([])
    }

    // CutLine：兩端貼齊工作範圍
    if (region) {
      cuts.forEach((cut, i) => {
        const { p1, p2 } = cutEnds(cut.axis, cut.coord, region)
        ctx.strokeStyle = cut.color
        ctx.lineWidth = px(i === activeIndex ? 2.4 : 1.5)
        ctx.beginPath()
        ctx.moveTo(p1[0], p1[1])
        ctx.lineTo(p2[0], p2[1])
        ctx.stroke()
        for (const pt of [p1, p2]) {
          ctx.beginPath()
          ctx.arc(pt[0], pt[1], px(i === activeIndex ? 5 : 3.5), 0, Math.PI * 2)
          ctx.fillStyle = cut.color
          ctx.fill()
        }
      })
    }
    ctx.restore()
  }, [boardEpoch, transform, cuts, activeIndex,
      region, rubber, cursor, placing, axis])

  /** 單層聚焦：只留這一層，再點一次還原全部。

   *  17 層的板子上，關掉 16 個核取方塊再一個一個打開是不切實際的操作。
   */
  const soloLayer = (layer: string) => {
    const layers = stackupLayers().concat(VIRTUAL_LAYERS)
    const onlyThis = layers.every((l) => (l === layer) === mode(l).visible)
    setModes((prev) => {
      const next = { ...prev }
      for (const l of layers) {
        next[l] = { ...(next[l] || DEFAULT_MODE), visible: onlyThis ? true : l === layer }
      }
      return next
    })
  }

  const toggleAll = (col: keyof LayerMode) => {
    if (!data) return
    const layers = stackupLayers().concat(VIRTUAL_LAYERS)
    const anyOn = layers.some((l) => mode(l)[col])
    setModes((prev) => {
      const next = { ...prev }
      for (const l of layers) next[l] = { ...(next[l] || DEFAULT_MODE), [col]: !anyOn }
      return next
    })
  }

  const nets = (data?.nets || []).filter((n) =>
    !netFilter || n.toLowerCase().includes(netFilter.toLowerCase()))
  const components = (data?.layers?.Components || [])
    .map((c) => c.name || '')
    .filter((n) => n && (!compFilter || n.toLowerCase().includes(compFilter.toLowerCase())))
    .sort()

  return (
    <div className="p2d">
      <div ref={wrapRef} className="p2d-canvas"
           style={{ cursor: placing ? 'crosshair' : dragCut ? 'move' : 'grab' }}>
        <canvas ref={canvasRef}
                onMouseDown={onMouseDown} onMouseMove={onMouseMove}
                onMouseUp={onMouseUp} onMouseLeave={() => { setDragging(false); setDragCut(null) }}
                onWheel={onWheel} />
        {data?.preview_mode === 'coarse' && (
          <div className="p2d-coarse">
            粗略模式：顯示 {data.rendered_primitive_count.toLocaleString()} /{' '}
            {data.source_primitive_count.toLocaleString()} 個圖元
          </div>
        )}
        {data && !selectingRegion && !placing && (
          <div className="p2d-guide">
            左鍵平移 · 滾輪以游標為中心縮放 · 右側 ◀ 收合圖層面板
          </div>
        )}
        {selectingRegion && (
          <div className="p2d-hint">拖出一個矩形，把注意力縮到板子的這一塊</div>
        )}
        {placing && !selectingRegion && (
          <div className="p2d-hint">
            {region
              ? `點一下放置 ${axis === 'x' ? '水平（沿 X）' : '垂直（沿 Y）'} 切線；兩端會貼齊工作範圍`
              : '請先框選工作範圍——切線的長度由範圍決定'}
          </div>
        )}
        {data && (
          <div className="p2d-tools" onMouseDown={(e) => e.stopPropagation()}>
            {cursor && (
              <span className="p2d-coord">
                {cursor[0].toFixed(3)}, {cursor[1].toFixed(3)} mm
              </span>
            )}
            {region && (
              <button type="button" onClick={() => fitTo(region)} title="縮放至工作範圍">
                ▣ 範圍
              </button>
            )}
            <button type="button" onClick={fitAll} title="縮放至全板 (Fit All)">
              ⛶ Fit All
            </button>
          </div>
        )}
      </div>

      <button className="p2d-handle" title={panelOpen ? '收起圖層面板' : '展開圖層面板'}
              onClick={() => setPanelOpen((p) => !p)}>
        {panelOpen ? '◀' : '▶'}
      </button>

      <aside className={'p2d-panel' + (panelOpen ? '' : ' collapsed')}>
        <div className="p2d-tabs">
          <button className={tab === 'layers' ? 'on' : ''} onClick={() => setTab('layers')}>Layers</button>
          <button className={tab === 'comps' ? 'on' : ''} onClick={() => setTab('comps')}>Components</button>
          <button className={tab === 'nets' ? 'on' : ''} onClick={() => setTab('nets')}>Nets</button>
        </div>

        {tab === 'layers' && (
          <table className="p2d-lt">
            <thead>
              <tr>
                <th className="lname">Name</th>
                {LAYER_COLS.map((c) => (
                  <th key={c.key} className={c.tone}
                      title={`${c.title}（點擊切換全部）`}
                      onClick={() => toggleAll(c.key)}>{c.icon}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stackupLayers().concat(VIRTUAL_LAYERS).map((layer) => {
                const m = mode(layer)
                const rgb = layer === 'Vias' ? [255, 138, 101]
                  : layer === 'Components' ? [144, 202, 249]
                  : layer === 'Board' ? [76, 175, 80]
                  : (data?.layer_colors || {})[layer] || [120, 160, 200]
                const count = (data?.layers?.[layer] || []).length
                return (
                  <tr key={layer} className={m.visible ? '' : 'off'}>
                    <td className="lname" onClick={() => soloLayer(layer)}
                        title={`只顯示 ${layer}（再點一次還原全部）　${count} 個物件`}>
                      <i className="dot" style={{ background: `rgb(${rgb.join(',')})` }} />
                      {layer}
                    </td>
                    {LAYER_COLS.map((c) => (
                      <td key={c.key} className="chk">
                        <input type="checkbox" checked={m[c.key]}
                               onChange={() => setModes((p) => ({
                                 ...p, [layer]: { ...(p[layer] || DEFAULT_MODE), [c.key]: !m[c.key] },
                               }))} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {tab === 'comps' && (
          <div className="p2d-nets">
            <input type="text" placeholder="搜尋元件…" value={compFilter}
                   onChange={(e) => setCompFilter(e.target.value)} spellCheck={false} />
            <div className="p2d-netlist">
              {components.map((c) => (
                <label key={c}>
                  <input type="checkbox" checked={!hiddenComps[c]}
                         onChange={() => setHiddenComps((p) => ({ ...p, [c]: !p[c] }))} />
                  <span>{c}</span>
                </label>
              ))}
              {components.length === 0 && (
                <span className="hint">
                  這片板子沒有元件資料，或 Components 層被關閉。
                </span>
              )}
            </div>
          </div>
        )}

        {tab === 'nets' && (
          <div className="p2d-nets">
            <input type="text" placeholder="搜尋網路…" value={netFilter}
                   onChange={(e) => setNetFilter(e.target.value)} />
            <div className="p2d-netlist">
              {nets.map((n) => (
                <label key={n}>
                  <input type="checkbox" checked={!hiddenNets[n]}
                         onChange={() => setHiddenNets((p) => ({ ...p, [n]: !p[n] }))} />
                  <span>{n}</span>
                </label>
              ))}
              {nets.length === 0 && <span className="hint">沒有符合的網路</span>}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}

function trace(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  if (pts.length < 2) return
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
}
