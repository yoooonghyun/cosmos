import { TerminalPanel } from './TerminalPanel'
import { GeneratedUiPanel } from './GeneratedUiPanel'
import './App.css'

export function App(): React.JSX.Element {
  return (
    <div className="app">
      <header className="app__header">
        <span className="app__title">cosmos</span>
        <span className="app__subtitle">Terminal Panel · Generated UI · Claude Code</span>
      </header>
      {/* FR-013/SC-007: the two channels are independent panels side by side;
          the A2UI panel never shares the TUI stream. */}
      <main className="app__body">
        <div className="app__terminal">
          <TerminalPanel />
        </div>
        <div className="app__ui">
          <GeneratedUiPanel />
        </div>
      </main>
    </div>
  )
}
