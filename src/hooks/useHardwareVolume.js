import { useEffect, useRef } from 'react'

// Minimal 1-second silent WAV (44.1 kHz, mono, 16-bit PCM)
// Looped continuously so iOS treats the page as "playing media",
// which routes hardware volume buttons to media volume instead of ringer.
const SILENT_WAV =
  'data:audio/wav;base64,' +
  'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

// How many Sonos volume units to move per full device-volume step.
// iOS has 16 steps (1/16 ≈ 0.0625 each); Android has ~15 (1/15 ≈ 0.067).
// A multiplier of 48 gives ~3 Sonos units per button press — feels natural.
const STEP_MULTIPLIER = 32

/**
 * Intercepts hardware volume button presses and applies them to Sonos volume.
 *
 * @param {() => number} getVolume  - getter that returns the current Sonos volume (0-100)
 * @param {(v: number) => void} onVolumeChange - called with the new Sonos volume
 */
export function useHardwareVolume(getVolume, onVolumeChange) {
  // Keep callback refs stable so the effect closure is always current
  const getVolumeRef = useRef(getVolume)
  const onChangeRef = useRef(onVolumeChange)
  useEffect(() => { getVolumeRef.current = getVolume }, [getVolume])
  useEffect(() => { onChangeRef.current = onVolumeChange }, [onVolumeChange])

  useEffect(() => {
    const audio = new Audio(SILENT_WAV)
    audio.loop = true

    let lastDeviceVol = null
    let active = false

    const handleVolumeChange = () => {
      if (lastDeviceVol === null) {
        // First event — just record baseline, don't fire yet
        lastDeviceVol = audio.volume
        return
      }
      const delta = audio.volume - lastDeviceVol
      lastDeviceVol = audio.volume

      // Ignore sub-threshold noise (e.g. programmatic volume sync)
      if (Math.abs(delta) < 0.01) return

      const sonosDelta = Math.round(delta * STEP_MULTIPLIER)
      if (sonosDelta === 0) return

      const current = getVolumeRef.current()
      const next = Math.max(0, Math.min(100, current + sonosDelta))
      onChangeRef.current(next)
    }

    audio.addEventListener('volumechange', handleVolumeChange)

    // Must start after a user gesture (browser autoplay policy)
    const activate = () => {
      if (active) return
      active = true
      audio.play()
        .then(() => { lastDeviceVol = audio.volume })
        .catch(() => {})
    }

    document.addEventListener('touchstart', activate, { once: true, passive: true })
    document.addEventListener('click', activate, { once: true })

    return () => {
      audio.pause()
      audio.src = ''
      audio.removeEventListener('volumechange', handleVolumeChange)
      document.removeEventListener('touchstart', activate)
      document.removeEventListener('click', activate)
    }
  }, []) // intentionally empty — runs once, refs handle currency
}
