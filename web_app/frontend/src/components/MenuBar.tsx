// 桌面應用程式那種選單列：檔案／執行／檢視／說明。
//
// 左側的步驟面板是「照順序做一次」的路徑；選單列是「已經知道要做什麼」的路徑。
// 兩者指向同一批動作，所以這裡不自己實作任何行為——每一項都只是呼叫上層傳進來的
// 函式，狀態也由上層決定。選單自己判斷能不能按，就會和面板上的按鈕說法不一致。
//
// 沒有可用的項目一律 disabled 而不是隱藏：位置固定，使用者才記得住東西在哪裡；
// 消失的項目會讓人以為這個版本沒有這個功能。
import React, { useEffect, useRef, useState } from 'react'

export interface MenuItem {
  /** 分隔線：其餘欄位忽略 */
  separator?: boolean
  label?: string
  /** 右側的快捷鍵提示，只是提示，實際綁定在上層 */
  hint?: string
  disabled?: boolean
  /** 打勾：用於「目前在哪個檢視」這類狀態 */
  checked?: boolean
  onSelect?: () => void
}

export interface Menu {
  label: string
  items: MenuItem[]
}

interface Props {
  menus: Menu[]
  /** 靠右顯示的東西，例如連線狀態 */
  right?: React.ReactNode
}

export default function MenuBar({ menus, right }: Props) {
  const [open, setOpen] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // 點到選單以外的任何地方就關閉——包含畫布，否則選單會蓋住使用者正要點的板子。
  useEffect(() => {
    if (open === null) return
    const away = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="menubar" ref={rootRef}>
      <div className="menubar-menus">
        {menus.map((m, i) => (
          <div key={m.label} className="menu">
            <button className={'menu-label' + (open === i ? ' on' : '')}
                    onClick={() => setOpen(open === i ? null : i)}
                    // 已經開著的時候滑過去就換一個，和桌面程式一樣
                    onMouseEnter={() => open !== null && setOpen(i)}>
              {m.label}
            </button>
            {open === i && (
              <div className="menu-pop">
                {m.items.map((it, j) =>
                  it.separator ? (
                    <div key={j} className="menu-sep" />
                  ) : (
                    <button key={j} className="menu-item" disabled={it.disabled}
                            onClick={() => { setOpen(null); it.onSelect?.() }}>
                      <span className="menu-tick">{it.checked ? '✓' : ''}</span>
                      <span className="menu-text">{it.label}</span>
                      {it.hint && <span className="menu-hint">{it.hint}</span>}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {right && <div className="menubar-right">{right}</div>}
    </div>
  )
}
