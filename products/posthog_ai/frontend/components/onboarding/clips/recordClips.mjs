#!/usr/bin/env node
/**
 * Films the onboarding step clips from their Storybook stories.
 *
 * Usage (Storybook must already be running on :6006):
 *   pnpm storybook
 *   node products/posthog_ai/frontend/components/onboarding/clips/recordClips.mjs [stepKey ...]
 *
 * Frames are captured through the DevTools screencast rather than Playwright's own video recorder, because
 * recording starts when the page opens — several seconds before a Storybook story mounts — and a clip
 * trimmed by guesswork loses its first beat. Here capture starts first, then `window.__phaiClipReplay()`
 * runs the clip on cue, so the film begins exactly at the clip's t=0.
 *
 * Writes `<key>.mp4` and a poster `<key>.jpg` into `frontend/public/posthog-ai-onboarding/`.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..', '..', '..', '..')
const OUT_DIR = join(REPO, 'frontend', 'public', 'posthog-ai-onboarding')
const TMP_DIR = join(REPO, '.clip-frames')
const STORYBOOK = process.env.STORYBOOK_URL ?? 'http://localhost:6006'

const WIDTH = 1088
const HEIGHT = 612
const FPS = 25

/** One entry per step that gets a clip. `posterAt` is the frame the panel rests on, in clip milliseconds. */
const CLIPS = [
    { key: 'ask', story: 'products-posthog-ai-onboarding-clips--ask', durationMs: 9500, posterAt: 4000 },
    { key: 'delegate', story: 'products-posthog-ai-onboarding-clips--delegate', durationMs: 12000, posterAt: 6000 },
    { key: 'skills', story: 'products-posthog-ai-onboarding-clips--skills', durationMs: 7500, posterAt: 2000 },
    { key: 'connect', story: 'products-posthog-ai-onboarding-clips--connect', durationMs: 9000, posterAt: 7000 },
    { key: 'start', story: 'products-posthog-ai-onboarding-clips--start', durationMs: 8500, posterAt: 7500 },
]

async function record(browser, clip) {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
    await page.goto(`${STORYBOOK}/iframe.html?id=${clip.story}&viewMode=story&clipAutoplay=0`, {
        waitUntil: 'load',
        timeout: 180_000,
    })
    await page.waitForFunction(() => typeof window.__phaiClipReplay === 'function', null, { timeout: 60_000 })
    // Let the first render settle (fonts, icons) so frame one isn't a half-painted stage.
    await page.waitForTimeout(1500)

    const frames = []
    const cdp = await page.context().newCDPSession(page)
    cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
        frames.push({ data, timestamp: metadata.timestamp })
        try {
            await cdp.send('Page.screencastFrameAck', { sessionId })
        } catch {
            // The session is gone once capture stops; late acks are expected and harmless.
        }
    })

    await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 95,
        maxWidth: WIDTH,
        maxHeight: HEIGHT,
        everyNthFrame: 1,
    })

    await page.evaluate(() => window.__phaiClipReplay?.())
    await page.waitForTimeout(clip.durationMs)
    await cdp.send('Page.stopScreencast')
    await page.close()

    if (frames.length === 0) {
        throw new Error(`${clip.key}: the screencast produced no frames`)
    }
    return frames
}

/**
 * Screencast frames arrive only when something repaints, so a still beat is one frame held for seconds.
 * The concat demuxer replays them on their real timings; ffmpeg resamples that to a constant frame rate.
 */
function encode(clip, frames) {
    rmSync(TMP_DIR, { recursive: true, force: true })
    mkdirSync(TMP_DIR, { recursive: true })

    const base = frames[0].timestamp
    const lines = []
    frames.forEach((frame, i) => {
        const name = `f${String(i).padStart(5, '0')}.jpg`
        writeFileSync(join(TMP_DIR, name), Buffer.from(frame.data, 'base64'))
        const next = frames[i + 1] ? frames[i + 1].timestamp : base + clip.durationMs / 1000
        // Floor at a millisecond, not a frame: screencast frames often arrive a few milliseconds apart,
        // and padding each one out to 1/FPS would stretch the film well past its real length.
        lines.push(`file '${name}'`, `duration ${Math.max(next - frame.timestamp, 0.001).toFixed(4)}`)
    })
    // The concat demuxer ignores the last entry's duration unless the file is repeated.
    lines.push(`file '${`f${String(frames.length - 1).padStart(5, '0')}.jpg`}'`)
    writeFileSync(join(TMP_DIR, 'frames.txt'), lines.join('\n'))

    mkdirSync(OUT_DIR, { recursive: true })
    const mp4 = join(OUT_DIR, `${clip.key}.mp4`)
    execFileSync(
        'ffmpeg',
        [
            '-y',
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            join(TMP_DIR, 'frames.txt'),
            '-vf',
            `fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos`,
            '-c:v',
            'libx264',
            '-profile:v',
            'main',
            '-pix_fmt',
            'yuv420p',
            '-crf',
            '26',
            '-movflags',
            '+faststart',
            '-an',
            mp4,
        ],
        { stdio: 'inherit' }
    )

    const poster = join(OUT_DIR, `${clip.key}.jpg`)
    execFileSync(
        'ffmpeg',
        [
            '-y',
            '-ss',
            (clip.posterAt / 1000).toFixed(2),
            '-i',
            mp4,
            '-frames:v',
            '1',
            '-update',
            '1',
            '-q:v',
            '4',
            poster,
        ],
        { stdio: 'inherit' }
    )

    rmSync(TMP_DIR, { recursive: true, force: true })
    return mp4
}

const wanted = process.argv.slice(2)
const selected = wanted.length ? CLIPS.filter((c) => wanted.includes(c.key)) : CLIPS
if (selected.length === 0) {
    throw new Error(`No clips matched ${wanted.join(', ')}. Known: ${CLIPS.map((c) => c.key).join(', ')}`)
}

const browser = await chromium.launch()
try {
    for (const clip of selected) {
        process.stdout.write(`recording ${clip.key}…\n`)
        const frames = await record(browser, clip)
        const out = encode(clip, frames)
        process.stdout.write(`  ${frames.length} frames → ${out}\n`)
    }
} finally {
    await browser.close()
}
