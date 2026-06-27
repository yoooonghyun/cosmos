/**
 * Visual test harness entry — a standalone Vite+React page that mounts
 * cosmos renderer components with FIXTURE data so Playwright can assert
 * computed layout/pixels without a live Electron app, Slack tokens, or agent.
 *
 * Each "scene" is routed by ?scene=<name> in the URL. Playwright navigates to
 * the appropriate URL and then asserts computed styles / getBoundingClientRect.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'
import './test-app.css'
import { PerListScrollScene } from './scenes/PerListScrollScene'
import { ScrollToLatestScene } from './scenes/ScrollToLatestScene'
import { PdfScene } from './scenes/PdfScene'
import { ChannelNameAboveListScene } from './scenes/ChannelNameAboveListScene'

const scenes: Record<string, React.ComponentType> = {
  'per-list-scroll': PerListScrollScene,
  'scroll-to-latest': ScrollToLatestScene,
  pdf: PdfScene,
  'channel-name-above-list': ChannelNameAboveListScene,
}

const params = new URLSearchParams(window.location.search)
const sceneName = params.get('scene') ?? ''
const Scene = scenes[sceneName]

const root = document.getElementById('root')!
createRoot(root).render(
  Scene ? (
    <Scene />
  ) : (
    <div style={{ padding: 24, fontFamily: 'monospace' }}>
      <p>cosmos visual test harness</p>
      <p>Available scenes:</p>
      <ul>
        {Object.keys(scenes).map((s) => (
          <li key={s}>
            <a href={`?scene=${s}`}>{s}</a>
          </li>
        ))}
      </ul>
    </div>
  )
)
