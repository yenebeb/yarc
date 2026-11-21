// The floating player's "Try It" (its spotlight in What's New): a silent video made on the spot, in
// a page of its own, so there's something playing to float without the network or a site's consent
// wall. A data: URL never reaches history or the archive (both keep only http(s) pages).

const PAGE = `<!doctype html><meta charset="utf-8"><title>Floating Player Demo</title>
<style>
  html, body { margin: 0; height: 100%; background: #16131f; color: #f1eff6; font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 48px 24px; }
  video { width: 100%; aspect-ratio: 16 / 9; border-radius: 12px; background: #000; display: block; }
  h1 { font-size: 22px; margin: 20px 0 4px; }
  p { margin: 0; color: #b9b4c9; }
</style>
<main>
  <video id="v" muted playsinline></video>
  <h1>Floating player demo</h1>
  <p>Switch to another tab while this plays: the video keeps going in a small player in front of your other apps. Double-click it to come back here.</p>
</main>
<script>
  const w = 1280, h = 720, c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d'), start = performance.now()
  const draw = (now) => {
    const t = (now - start) / 1000
    const sky = g.createLinearGradient(0, 0, w, h)
    sky.addColorStop(0, 'hsl(' + (262 + 18 * Math.sin(t / 3)) + ' 62% 44%)')
    sky.addColorStop(1, 'hsl(' + (318 + 18 * Math.cos(t / 4)) + ' 70% 56%)')
    g.fillStyle = sky
    g.fillRect(0, 0, w, h)
    for (let i = 0; i < 7; i++) {
      const x = (w / 7) * i + 90 + 60 * Math.sin(t * 0.9 + i)
      const y = h / 2 + 150 * Math.sin(t * 0.7 + i * 1.3)
      g.beginPath()
      g.arc(x, y, 40 + 18 * Math.sin(t + i), 0, Math.PI * 2)
      g.fillStyle = 'rgba(255, 255, 255, ' + (0.12 + 0.05 * i / 7) + ')'
      g.fill()
    }
    g.fillStyle = '#fff'
    g.font = '600 64px -apple-system, BlinkMacSystemFont, sans-serif'
    g.textAlign = 'center'
    g.fillText('Still playing', w / 2, h / 2 - 10)
    g.font = '500 40px ui-monospace, Menlo, monospace'
    g.fillText(t.toFixed(1) + ' s', w / 2, h / 2 + 54)
    requestAnimationFrame(draw)
  }
  requestAnimationFrame(draw)
  const v = document.getElementById('v')
  v.srcObject = c.captureStream(30)
  v.play()
</script>`

export const FLOATING_DEMO_URL = `data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`
