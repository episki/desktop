import { nativeTheme } from 'electron'
import { APP_URL } from './config'

/**
 * Shown when the web app cannot be reached (offline, VPN, DNS, deploy in
 * progress). Previously a failed load left the user staring at a blank white
 * window with no explanation and no way to retry.
 *
 * Rendered as a data: URL so there is no asset to copy into dist/. The preload
 * script still runs here, so the retry button can talk to the main process.
 */
/** How long the error page waits before retrying on its own. */
const AUTO_RETRY_MS = 15_000

export function offlinePageUrl(detail: string): string {
  const dark = nativeTheme.shouldUseDarkColors
  const bg = dark ? '#0b1220' : '#f7f9fc'
  const fg = dark ? '#e6edf6' : '#1a2433'
  const muted = dark ? '#8fa3bd' : '#5b6b82'
  const cardBg = dark ? '#131c2b' : '#ffffff'
  const border = dark ? '#22304a' : '#dfe6ef'

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>episki</title>
<style>
  :root { color-scheme: ${dark ? 'dark' : 'light'}; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: ${bg}; color: ${fg};
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-user-select: none; user-select: none;
  }
  .card {
    width: min(460px, calc(100vw - 64px));
    background: ${cardBg}; border: 1px solid ${border}; border-radius: 14px;
    padding: 32px; text-align: center;
  }
  .mark { width: 56px; height: 56px; margin: 0 auto 20px; display: block; }
  h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
  p { margin: 0 0 6px; color: ${muted}; }
  code {
    display: block; margin: 16px 0 0; padding: 10px 12px; border-radius: 8px;
    background: ${bg}; border: 1px solid ${border}; color: ${muted};
    font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    word-break: break-all; text-align: left;
  }
  button {
    margin-top: 24px; padding: 9px 22px; border-radius: 8px; border: 0;
    background: #1c91fe; color: #fff; font-size: 14px; font-weight: 500;
    cursor: pointer; font-family: inherit;
  }
  button:hover { background: #0f7fe6; }
  button:disabled { opacity: 0.6; cursor: default; }
</style>
</head>
<body>
  <main class="card">
    <svg class="mark" viewBox="0 0 512 512" aria-hidden="true">
      <path d="M256 45.39L76.751 150.695v210.61L256 466.61l179.249-105.305v-210.61z"
        fill="#1c91fe" stroke="#1c91fe" stroke-width="90.78" stroke-linejoin="round"/>
      <path d="M352.227 256c0-53.145-43.082-96.227-96.227-96.227S159.773 202.855 159.773 256s43.082 96.227 96.227 96.227 96.227-43.082 96.227-96.227z"
        fill="#043f67" stroke="#fff" stroke-width="36.312" stroke-linejoin="round"/>
    </svg>
    <h1>Can&rsquo;t reach episki</h1>
    <p>Check your internet connection and try again.</p>
    <p>${escapeHtml(APP_URL)}</p>
    <code>${escapeHtml(detail)}</code>
    <button id="retry" type="button">Try again</button>
  </main>
  <script>
    var button = document.getElementById('retry')
    var timer = null

    function retry() {
      if (button.disabled) return
      if (timer) { clearTimeout(timer); timer = null }
      button.disabled = true
      button.textContent = 'Reconnecting\\u2026'
      if (window.electronAPI && window.electronAPI.retryLoad) {
        window.electronAPI.retryLoad()
      }
      // If the retry succeeds this page is replaced. If it fails the main
      // process reloads this page, restarting the cycle.
      setTimeout(function () {
        button.disabled = false
        button.textContent = 'Try again'
      }, 4000)
    }

    button.addEventListener('click', retry)
    // A VPN reconnecting or a deploy finishing should heal on its own without
    // the user having to notice the window at all.
    window.addEventListener('online', retry)
    timer = setTimeout(retry, ${AUTO_RETRY_MS})
  </script>
</body>
</html>`

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
