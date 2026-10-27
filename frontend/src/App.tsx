import { useEffect, useState } from 'react'
import { Home } from './pages/Home'
import { Play } from './pages/Play'
import { Preview } from './pages/Preview'

function useHash() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const onChange = () => setHash(location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

export default function App() {
  const hash = useHash()
  if (hash.startsWith('#/preview')) return <Preview />
  const play = hash.match(/^#\/play\/([0-9a-f]+)/)
  if (play) return <Play key={play[1]} gameId={play[1]} />
  return <Home />
}
