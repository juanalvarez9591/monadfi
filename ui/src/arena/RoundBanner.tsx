interface BannerData { round: number; poolSize: number; avgScore10x: number }
interface Props { banner: BannerData | null }

export default function RoundBanner({ banner }: Props) {
  if (!banner) return null
  const avg  = banner.avgScore10x / 10
  const tone = avg >= 7 ? 'good' : avg >= 5 ? 'ok' : 'bad'
  return (
    <div className={`roundbanner r-${tone} animate__animated animate__fadeInDown`} key={banner.round}>
      <span className="rb-emoji">{avg >= 7 ? '🏆' : avg >= 5 ? '📊' : '📉'}</span>
      <span className="rb-title">Round #{banner.round} complete</span>
      <span className="rb-meta">{banner.poolSize} playlists · avg <b>{avg.toFixed(1)}</b>/10</span>
    </div>
  )
}
