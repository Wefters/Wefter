import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { onBridgeReady } from '@wefter/core'

const BRIDGE_READY_TIMEOUT_MS = 300

function waitForBridge(): Promise<void> {
  return Promise.race([
    onBridgeReady(),
    new Promise<void>((resolve) => setTimeout(resolve, BRIDGE_READY_TIMEOUT_MS)),
  ])
}

waitForBridge().then(() => {
  createApp(App).mount('#app')
})
