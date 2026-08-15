// 求解前後顯示「Q2D 裡實際被建出來的東西」。
//
// 剖視圖畫的是掃描結果；這裡畫的是那個結果被切成 Q2D 物件之後的樣子。兩者不同：
// 每一層都被橫向切成互不重疊的補集，導體與填充各自成為獨立矩形。錯誤最常出現在
// 這一步，而唯一還來得及便宜地發現的時機，是求解開始之前。
//
// 預設顯示的是 AEDT 自己畫的那張圖。AEDT 現在跑在背景，沒有視窗可看，所以這張圖
// 就是「Q2D 裡真的有什麼」的唯一直接證據——示意圖是我們自己畫的，畫錯了也看不出來。
// 但它是等比例的：35 µm 的銅箔在 0.8 mm 的疊構上只有幾個像素，量不了尺寸。
// 要看層厚與線寬請切到示意圖，那裡縱向被刻意放大，並且標明比例不相等。
//
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
import React, { useMemo, useRef, useState } from 'react'
import type { Q2DGeometry, Q2DRect } from '../api'

interface Props {
  models: Q2DGeometry[]
  solving?: boolean
  onCancel?: () => void
}

const SIG = '#e3b341'
const REF = '#6e7681'
const DIE = '#233041'
const LINE = '#2b323c'

const PAD = 16
const AXIS = 26

// AEDT 出的圖四周留了大量白邊，模型只佔畫面約三分之一——背景模式下相機是固定的，
// 給多大的畫布都一樣。因此在瀏覽器裡裁掉白邊再顯示。
//
// 判斷依據是「有沒有顏色」而不是「不是白色」：右上角那行 Ansys 版本字樣是灰的，
// 物件外框是深灰的，兩者都會被略過；材料填色是有彩度的，而每個物件都有填色，
// 所以填色的範圍就是模型的範圍，外框正好落在填色邊界上，不會裁掉東西。
const SATURATION = 12
const TRIM_PAD = 10

function trimToContent(img: HTMLImageElement): string | null {
  const w = img.naturalWidth, h = img.naturalHeight
  if (!w || !h) return null
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  let d: Uint8ClampedArray
  try {
    d = ctx.getImageData(0, 0, w, h).data
  } catch {
    return null   // 畫布被污染就照原圖顯示，不值得為了裁邊讓畫面消失
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = d[i], g = d[i + 1], b = d[i + 2]
      if (Math.max(r, g, b) - Math.min(r, g, b) < SATURATION) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < x0 || y1 < y0) return null
  x0 = Math.max(0, x0 - TRIM_PAD); y0 = Math.max(0, y0 - TRIM_PAD)
  x1 = Math.min(w - 1, x1 + TRIM_PAD); y1 = Math.min(h - 1, y1 + TRIM_PAD)
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1
  const octx = out.getContext('2d')
  if (!octx) return null
  octx.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return out.toDataURL('image/jpeg', 0.92)
}

/** AEDT 截圖：載入後裁掉白邊；還沒裁好之前先顯示原圖，不要留空白。 */
function AedtPicture({ src }: { src: string }) {
  const [trimmed, setTrimmed] = useState<string | null>(null)
  React.useEffect(() => {
    setTrimmed(null)
    const img = new Image()
    img.onload = () => setTrimmed(trimToContent(img))
    img.src = src
  }, [src])
  return (
    <div className="q2d-shot">
      <img src={trimmed || src} alt="AEDT 建出的 Q2D 截面" />
    </div>
  )
}

export default function Q2DModelView({ models, solving, onCancel }: Props) {
  const [index, setIndex] = useState(0)
  const [schematic, setSchematic] = useState(false)
  const [hover, setHover] = useState<Q2DRect | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)

  React.useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(420, el.clientWidth - 20)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 新的設計進來時自動跳到它，使用者才看得到當下正在解的那一個。
  React.useEffect(() => {
    if (models.length) setIndex(models.length - 1)
  }, [models.length])

  const model = models[Math.min(index, models.length - 1)]

  const bounds = useMemo(() => {
    if (!model?.geometry?.length) return null
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const r of model.geometry) {
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y)
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h)
    }
    if (!isFinite(x0) || x1 - x0 <= 0 || y1 - y0 <= 0) return null
    return { x0, y0, x1, y1 }
  }, [model])

  if (!models.length) {
    return (
      <div className="q2d-empty">
        求解開始後，這裡會顯示 Q2D 裡實際建出來的模型。
      </div>
    )
  }

  const H = 300
  const innerW = width - PAD * 2 - AXIS
  const innerH = H - PAD * 2 - AXIS

  // 疊構高度通常遠小於截面寬度。等比例畫會壓成一條線，因此兩軸各自縮放，
  // 並在圖上標明比例不相等——不講的話會讓人誤判線寬與層厚的比例。
  const sx = bounds ? innerW / (bounds.x1 - bounds.x0) : 1
  const sy = bounds ? innerH / (bounds.y1 - bounds.y0) : 1
  const X = (v: number) => AXIS + PAD + (v - (bounds?.x0 ?? 0)) * sx
  const Y = (v: number) => PAD + innerH - (v - (bounds?.y0 ?? 0)) * sy

  const fill = (r: Q2DRect) =>
    r.role === 'signal' ? SIG : r.role === 'reference' ? REF : DIE

  return (
    <div className="q2d-root">
      <div className="q2d-head">
        <span>
          Q2D 模型 <b>{model?.design}</b>　導體{' '}
          <b>{model?.conductors?.join('、') || '—'}</b>　參考物件{' '}
          <b>{model?.reference_objects ?? 0}</b>　矩形{' '}
          <b>{model?.geometry?.length ?? 0}</b>
        </span>
        <span className="q2d-actions">
          {models.length > 1 && (
            <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
              {models.map((m, i) => (
                <option key={i} value={i}>{m.design}</option>
              ))}
            </select>
          )}
          {model?.picture && (
            <button className="mini" onClick={() => setSchematic((v) => !v)}
                    title={schematic
                      ? '切回 AEDT 實際畫面（等比例）'
                      : '切到示意圖：縱向放大，可看層厚與線寬'}>
              {schematic ? 'AEDT 畫面' : '示意圖'}
            </button>
          )}
          {solving && (
            <button className="danger" onClick={onCancel}>■ 終止求解</button>
          )}
        </span>
      </div>

      <div className="q2d-canvas" ref={wrapRef}>
        {model?.picture && !schematic ? (
          <AedtPicture src={model.picture} />
        ) : (
        <svg width={width} height={H} style={{ display: 'block' }}>
          {bounds && model.geometry.map((r, i) => {
            const x = X(r.x), y = Y(r.y + r.h)
            const w = Math.max(r.w * sx, 0.6)
            const h = Math.max(r.h * sy, 0.6)
            return (
              <rect key={i} x={x} y={y} width={w} height={h}
                    fill={fill(r)} stroke={LINE} strokeWidth={0.5}
                    opacity={r.role === 'dielectric' ? 0.85 : 1}
                    onMouseEnter={() => setHover(r)}
                    onMouseLeave={() => setHover(null)}>
                <title>
                  {`${r.name}\n${r.material}\n`}
                  {`x ${r.x.toFixed(4)} ~ ${(r.x + r.w).toFixed(4)} mm　寬 ${r.w.toFixed(4)} mm\n`}
                  {`y ${r.y.toFixed(4)} ~ ${(r.y + r.h).toFixed(4)} mm　厚 ${(r.h * 1000).toFixed(2)} µm`}
                  {r.net ? `\n導體：${r.net}` : ''}
                </title>
              </rect>
            )
          })}
          {bounds && (
            <>
              <line x1={AXIS + PAD} y1={PAD + innerH} x2={AXIS + PAD + innerW}
                    y2={PAD + innerH} stroke={LINE} />
              {[bounds.x0, (bounds.x0 + bounds.x1) / 2, bounds.x1].map((v, i) => (
                <text key={i} x={X(v)} y={PAD + innerH + 15} textAnchor="middle"
                      fontSize="10" fill="#6e7681">{v.toFixed(3)}</text>
              ))}
              <text x={AXIS + PAD + innerW / 2} y={H - 2} textAnchor="middle"
                    fontSize="10" fill="#5a6673">
                截面寬度 (mm)　※ 橫縱比例不相等
              </text>
            </>
          )}
        </svg>
        )}
      </div>

      <div className="q2d-legend">
        {model?.picture && !schematic ? (
          <span className="hint">
            這是 AEDT 在背景建出來的實際模型（等比例，看得出相對位置但量不了厚度）。
            要量尺寸請按「示意圖」。
          </span>
        ) : (
        <>
        <span><i className="sw" style={{ background: SIG }} />訊號導體</span>
        <span><i className="sw" style={{ background: REF }} />參考導體</span>
        <span><i className="sw" style={{ background: DIE, border: `1px solid ${LINE}` }} />介電／填充</span>
        {hover ? (
          <span className="hint">
            {hover.name}｜{hover.material}｜寬 {hover.w.toFixed(4)} mm｜
            厚 {(hover.h * 1000).toFixed(2)} µm
          </span>
        ) : (
          <span className="hint">滑過任一矩形可看它的名稱、材料與尺寸</span>
        )}
        </>
        )}
      </div>
    </div>
  )
}
