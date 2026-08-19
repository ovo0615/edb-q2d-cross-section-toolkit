// Canvas 渲染若因異常圖元（NaN 座標、空頂點陣列）拋例外，整個 React 樹會白屏，
// 使用者連日誌都看不到。包起來，壞掉時至少還能顯示錯誤訊息。
import React from 'react'

interface State { error: Error | null }

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode }, State
> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ padding: 24, fontFamily: '"Calibri","Microsoft JhengHei",sans-serif' }}>
        <h2 style={{ color: '#f85149' }}>介面發生錯誤</h2>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#a9b6c4' }}>
          {this.state.error.message}
        </pre>
        <button onClick={() => this.setState({ error: null })}>重試</button>
      </div>
    )
  }
}
