// One shared headless Chrome for all renders. Opening a fresh browser per
// render (Remotion's default) left idle Chrome processes behind after every
// export, slowly eating RAM. If the browser dies, the next render reopens it.

import { openBrowser } from "@remotion/renderer";

let browser = null;

export async function getBrowser() {
  browser ??= await openBrowser("chrome");
  return browser;
}

// Call after a render fails: the browser may be broken, so start fresh next time.
export async function resetBrowser() {
  const b = browser;
  browser = null;
  await b?.close({ silent: true }).catch(() => {});
}
