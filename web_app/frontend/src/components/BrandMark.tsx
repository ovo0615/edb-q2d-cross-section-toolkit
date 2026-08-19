// 品牌識別：把這個工具在做的事畫成一張圖——3D 疊構被切一刀，馬上得到 2D 截面。
//
// 用內嵌 SVG 而不是點陣圖：標題列的高度會隨版面調整，點陣圖放大會糊；
// 而且顏色直接引用介面的變數，換主題時不會只剩這張圖對不上。
import React from 'react'

const ACC = '#58a6ff'
const ACC2 = '#a371f7'
const SIG = '#e3b341'
const REF = '#6e7681'

interface Props {
  /** 顯示高度（px）。寬度依比例自動決定。 */
  height?: number
}

export default function BrandMark({ height = 46 }: Props) {
  const w = (72 / 46) * height
  return (
    <svg className="brandmark" width={w} height={height} viewBox="0 0 72 46"
         role="img" aria-label="EDB to Q2D：從 3D 疊構取出 2D 截面">
      <defs>
        <linearGradient id="bm-cut" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={ACC} />
          <stop offset="100%" stopColor={ACC2} />
        </linearGradient>
      </defs>

      {/* 3D：等角投影的三層疊構，由下往上畫，上層才會壓在下層前面 */}
      <g strokeLinejoin="round">
        {/* 底層：參考平面 */}
        <polygon points="4,29 15,24.5 26,29 15,33.5" fill={REF} opacity=".5" />
        <polygon points="4,29 15,33.5 15,36 4,31.5" fill="#3a424c" />
        <polygon points="26,29 15,33.5 15,36 26,31.5" fill="#2b323c" />

        {/* 中層：介電 */}
        <polygon points="4,19 15,14.5 26,19 15,23.5" fill="#2c3a4d" />
        <polygon points="4,19 15,23.5 15,26 4,21.5" fill="#212b38" />
        <polygon points="26,19 15,23.5 15,26 26,21.5" fill="#1a222c" />

        {/* 頂層：訊號層，上面有一對走線 */}
        <polygon points="4,9 15,4.5 26,9 15,13.5" fill="#3a4a60" />
        <polygon points="4,9 15,13.5 15,16 4,11.5" fill="#2a3546" />
        <polygon points="26,9 15,13.5 15,16 26,11.5" fill="#212a38" />
        <path d="M8.6 10.4 L17.6 6.7" stroke={SIG} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M11.4 11.6 L20.4 7.9" stroke={SIG} strokeWidth="1.7" strokeLinecap="round" />
      </g>

      {/* 切線：一刀直直切下去，穿過整個疊構 */}
      <path d="M11 2 L11 39" stroke="url(#bm-cut)" strokeWidth="4.5"
            strokeLinecap="round" opacity=".22" />
      <path d="M11 2 L11 39" stroke={ACC} strokeWidth="1.6" strokeLinecap="round" />

      {/* 快速：兩個朝右的箭頭，後面那個淡一些帶出速度 */}
      <g fill="none" stroke={ACC} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 15 L38.5 23 L32 31" opacity=".38" />
        <path d="M39 15 L45.5 23 L39 31" />
      </g>

      {/* 2D：切出來的截面——上面兩條訊號線，下面一片參考平面 */}
      <rect x="50" y="10" width="24" height="26" rx="2" fill="#0f141b"
            stroke={ACC} strokeWidth="1.3" />
      <rect x="53" y="14.5" width="6" height="3.5" rx=".6" fill={SIG} />
      <rect x="62" y="14.5" width="6" height="3.5" rx=".6" fill={SIG} />
      <rect x="50.7" y="27" width="22.6" height="4" fill={REF} />
      <rect x="50.7" y="31" width="22.6" height="4.3" fill="#2c3a4d" />
    </svg>
  )
}
