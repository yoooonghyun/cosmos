import type { CosmosApi } from '../shared/ipc'

declare global {
  interface Window {
    cosmos: CosmosApi
  }
}

export {}
