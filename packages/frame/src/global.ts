/** Script-tag build: `<script src=".../wefter-frame.js">` defines `window.WefterFrame`. */
import { AppCallError, connectToApp } from "./index.js";

declare global {
  interface Window {
    WefterFrame?: { connectToApp: typeof connectToApp; AppCallError: typeof AppCallError };
  }
}

window.WefterFrame = { connectToApp, AppCallError };
