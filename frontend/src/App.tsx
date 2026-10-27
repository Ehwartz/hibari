import { useEffect, useState } from 'react'
import { useAppSettings } from './lib/appearance'
import { Home } from './pages/Home'
import { Logs } from './pages/Logs'
import { NewGame } from './pages/NewGame'
import { Play } from './pages/Play'
import { Preview } from './pages/Preview'
import { Replay } from './pages/Replay'
import { SettingsPage } from './pages/SettingsPage'
import { Stats } from './pages/Stats'
import { User } from './pages/User'

function useHash() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const onChange = () => setHash(location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

const ID = '([0-9A-Za-z_-]+)'

export default function App() {
  useAppSettings() // loads settings once and applies table cloth / background
  const hash = useHash().split('?')[0]
  const play = hash.match(new RegExp(`^#/play/${ID}`))
  if (play) return <Play key={play[1]} gameId={play[1]} />
  const replay = hash.match(new RegExp(`^#/replay/${ID}`))
  if (replay) return <Replay key={replay[1]} gameId={replay[1]} />
  if (hash.startsWith('#/preview')) return <Preview />
  if (hash.startsWith('#/new')) return <NewGame />
  if (hash.startsWith('#/logs')) return <Logs />
  if (hash.startsWith('#/stats')) return <Stats />
  if (hash.startsWith('#/settings')) return <SettingsPage />
  if (hash.startsWith('#/user')) return <User />
  return <Home />
}
