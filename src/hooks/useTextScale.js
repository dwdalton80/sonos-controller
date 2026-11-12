import { useState, useEffect, useCallback } from 'react'
import { loadStore, saveKey, lsGet, lsSet } from '../lib/fileStore'

export const TEXT_SIZES = [
  { label: 'Normal', value: 1 },
  { label: 'Large', value: 1.15 },
  { label: 'Larger', value: 1.3 },
  { label: 'Largest', value: 1.5 },
]
const KEY = 'sonos-text-scale'
const DEFAULT = 1.15

function apply(v) {
  document.documentElement.style.setProperty('--text-scale', String(v))
}

export function useTextScale() {
  const [scale, setScaleState] = useState(() => {
    const v = lsGet(KEY, DEFAULT)
    apply(v)
    return v
  })

  // File store wins so the choice survives port changes
  useEffect(() => {
    loadStore().then((store) => {
      const v = store[KEY]
      if (typeof v === 'number') { apply(v); lsSet(KEY, v); setScaleState(v) }
    })
  }, [])

  const setScale = useCallback((v) => {
    apply(v)
    lsSet(KEY, v)
    saveKey(KEY, v)
    setScaleState(v)
  }, [])

  return { scale, setScale }
}
