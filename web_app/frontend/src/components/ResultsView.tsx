// 結果分頁：上半是選中切線的完整結果，下半是所有已求解切線的並排比較。
//
// 並排是重點。這個工具最常見的用法是對照——同一個位置，有干擾源與沒有干擾源；
// 或同一條線，兩個不同的工作範圍。把數字分散在不同畫面上，比較就得靠記憶，
// 而記憶會出錯。
//
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
import React from 'react'
import type { BuildResult, PairResult } from '../api'

export interface ResultRow {
  name: string
  color: string
  result: BuildResult | null
  excluded: string[]
}

interface Props {
  rows: ResultRow[]
  activeIndex: number
  onSelect?: (index: number) => void
}

const n3 = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(v) ? '—' : v.toFixed(3)
const n2 = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(v) ? '—' : v.toFixed(2)

function PairTable({ pairs }: { pairs: PairResult[] }) {
  if (!pairs.length) {
    return <span className="hint">這條切線沒有配成對的差分，只有單端結果。</span>
  }
  return (
    <table>
      <thead>
        <tr>
          <th>差分對</th><th className="num">Zdiff (Ω)</th><th className="num">Z_odd</th>
          <th className="num">Z_even</th><th className="num">Zcomm</th><th>依據</th>
        </tr>
      </thead>
      <tbody>
        {pairs.map((p) => (
          <tr key={p.name}>
            <td>{p.name}<br /><span className="sub">{p.positive} / {p.negative}</span></td>
            <td className="num strong">{n3(p.Zdiff)}</td>
            <td className="num">{n3(p.Z_odd)}</td>
            <td className="num">{n3(p.Z_even)}</td>
            <td className="num">{n3(p.Zcomm)}</td>
            <td>
              {p.error ? <span className="bad">{p.error}</span>
                : p.exact
                  ? <span className="ok">精確</span>
                  : <span className="warn" title="截面上有三個以上的導體；此對取 2×2 子區塊，其餘導體視為參考電位。">
                      近似
                    </span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MatrixTable({ conductors, matrix }: { conductors: string[]; matrix: any }) {
  if (!conductors.length || !matrix) return null
  const cell = (kind: string, a: string, b: string) => matrix[`${kind}(${a},${b})`]
  return (
    <div className="matrix-wrap">
      {(['C', 'L'] as const).map((kind) => (
        <table key={kind}>
          <thead>
            <tr>
              <th>{kind === 'C' ? 'C (pF/m)' : 'L (nH/m)'}</th>
              {conductors.map((c) => <th key={c} className="num">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {conductors.map((a) => (
              <tr key={a}>
                <td>{a}</td>
                {conductors.map((b) => (
                  <td key={b} className="num">{n3(cell(kind, a, b))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  )
}

export default function ResultsView({ rows, activeIndex, onSelect }: Props) {
  const solved = rows.filter((r) => r.result?.impedance)
  const current = rows[activeIndex]
  const z = current?.result?.impedance

  if (!solved.length) {
    return (
      <div className="q2d-empty">
        還沒有結果。建立切線後按「建立並求解」，結果會出現在這裡。
      </div>
    )
  }

  return (
    <div className="results-root">
      <div className="results-detail">
        {z ? (
          <>
            <div className="results-head">
              <span>
                <b>{current.name}</b>　導體 {(z.conductors || []).join('、') || '—'}
              </span>
              {current.excluded.length > 0 && (
                <span className="warn">已排除：{current.excluded.join('、')}</span>
              )}
            </div>

            <h3>差分</h3>
            <PairTable pairs={current.result?.pairs || []} />

            <h3>單端</h3>
            <table>
              <thead><tr><th>導體</th><th className="num">Z₀ (Ω)</th></tr></thead>
              <tbody>
                {(z.conductors || []).map((c) => (
                  <tr key={c}>
                    <td>{c}</td>
                    <td className="num">{n3(z.Zse?.[c])}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>RLGC 矩陣（每公尺）</h3>
            <MatrixTable conductors={z.conductors || []} matrix={(z as any).matrix} />
          </>
        ) : (
          <span className="hint">
            {current ? `${current.name} 尚未求解。` : '請在左側選擇一條切線。'}
          </span>
        )}
      </div>

      <div className="results-compare">
        <h3>所有已求解的切線</h3>
        <table>
          <thead>
            <tr>
              <th>切線</th><th className="num">Zdiff (Ω)</th><th className="num">Z_odd</th>
              <th className="num">Z_even</th><th className="num">導體</th>
              <th>精度</th><th>排除的 net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const rz = row.result?.impedance
              if (!rz) return null
              const pair = (row.result?.pairs || [])[0]
              return (
                <tr key={i} className={i === activeIndex ? 'active' : ''}
                    onClick={() => onSelect?.(i)}>
                  <td>
                    <i className="swatch" style={{ background: row.color }} />
                    {row.name}
                  </td>
                  <td className="num strong">{n3(pair?.Zdiff ?? rz.Zdiff)}</td>
                  <td className="num">{n2(pair?.Z_odd ?? rz.Z_odd)}</td>
                  <td className="num">{n2(pair?.Z_even ?? rz.Z_even)}</td>
                  <td className="num" title={(rz.conductors || []).join('、')}>
                    {(rz.conductors || []).length}
                    {pair && !pair.exact && <span className="warn"> ≈</span>}
                  </td>
                  <td>{row.result?.solve_mode || '—'}</td>
                  <td>{row.excluded.length ? row.excluded.join('、') : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <span className="hint">
          兩列的差異只有在前提相同時才代表結構的差異。導體數不同代表截面上的東西
          不一樣——多一條導體就是多一個耦合對象，而且會讓差分值從精確變成近似（≈）。
          精度不同則是求解設定的差別，不是板子的差別。
        </span>
      </div>
    </div>
  )
}
