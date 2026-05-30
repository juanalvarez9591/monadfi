import { useMemo } from 'react'
import { mosaicArt, SONG_MAP, albumColor } from './data'

interface Props {
  songIds: number[]
  className?: string
  rounded?: number
}

export default function Mosaic({ songIds, className = '', rounded = 6 }: Props) {
  const arts  = useMemo(() => mosaicArt(songIds), [songIds])
  const songs = songIds.map(id => SONG_MAP.get(id)).filter(Boolean)
  const cells = []

  for (let i = 0; i < 4; i++) {
    const url = arts[i]
    if (url) {
      cells.push(
        <div className="mosaic-cell" key={i}>
          <img src={url} alt="" loading="lazy" />
        </div>
      )
    } else {
      const s = songs[i] ?? songs[0]
      const c = albumColor(s ? (s.album || s.artist) : String(i))
      cells.push(
        <div className="mosaic-cell" key={i} style={{ background: c }}>
          <span className="mosaic-fallback">{s ? (s.artist[0] ?? '?').toUpperCase() : '♪'}</span>
        </div>
      )
    }
  }

  return (
    <div className={`mosaic ${className}`} style={{ borderRadius: rounded }}>
      {cells}
    </div>
  )
}
