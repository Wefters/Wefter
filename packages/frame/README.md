# @wefterjs/frame

For websites shown inside a Wefter app: in an iframe of one of the app's pages, or in a web window the app opened. The site calls the methods the app exposes to it and exchanges events with it. Outside an app (a normal browser tab), `connectToApp()` resolves to `null` and the site works on its own.

```ts
import { connectToApp } from "@wefterjs/frame";

const app = await connectToApp({
  // The app pages that may embed this site: the bundled app on Android and iOS.
  appOrigins: ["https://appassets.androidplatform.net", "app://local"],
});

if (app) {
  const user = await app.call("getUser");
  app.on("cart:updated", (cart) => render(cart));
  app.emit("resize", { height: document.body.scrollHeight });
}
```

Without a bundler, load `dist/wefter-frame.js` with a `<script>` tag; it defines `window.WefterFrame.connectToApp`.

On the app's side, `exposeToFrames()` (iframes) or `openWebWindow()` (web windows) from `@wefterjs/core` lists the methods each site may call. In an iframe, the site must also be allowed to load with `frames.allow` in `wefter.config.json`.

`appOrigins` keeps hostile web pages from embedding the site and talking to it. It can't tell one app from another: every Android app using the default asset domain has the same origin, as does every Wefter iOS app. Don't trust "being inside an app" for anything sensitive; have the app pass a token from your own server instead, and check it there.
