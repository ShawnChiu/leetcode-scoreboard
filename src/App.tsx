import { useState, useEffect, useCallback, useRef } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AcSubmission {
  title: string
  titleSlug: string
  timestamp: string
  statusDisplay: string
  lang: string
}

interface AcSubmissionResponse {
  count: number
  submission: AcSubmission[]
}

interface Player {
  id: string
  displayName?: string
}

interface CompetitionConfig {
  startTime: number  // Unix seconds; 0 = not set
  endTime: number    // Unix seconds; 0 = not set
  problemSlugs: string[]
}

interface PlayerScore {
  player: Player
  solvedCount: number
  lastAcTime: number             // timestamp of last problem solved (tie-breaker)
  solvedSlugs: Map<string, string> // slug → lang
  error?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LS_PLAYERS = 'lc_sb_players'
const LS_CONFIG  = 'lc_sb_config'
const API_BASE   = 'http://localhost:3000'
const REFRESH_MS = 30_000

const DEFAULT_CONFIG: CompetitionConfig = {
  startTime: 0,
  endTime: 0,
  problemSlugs: [],
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function save<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value))
}

// ─── Domain logic ─────────────────────────────────────────────────────────────

// alfa-leetcode-api caps at ~20 unique AC submissions per request.
// Passing limit=100 ensures we get as many as the API allows.
async function fetchSubmissions(leetcodeId: string): Promise<AcSubmission[]> {
  const res = await fetch(`${API_BASE}/${leetcodeId}/acSubmission?limit=100`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as AcSubmissionResponse
  return data.submission ?? []
}

function computeScore(
  submissions: AcSubmission[],
  config: CompetitionConfig,
  player: Player,
): PlayerScore {
  const { startTime, endTime, problemSlugs } = config
  const targetSlugs = new Set(problemSlugs.map((s) => s.trim().toLowerCase()))

  // First AC per problem within the competition window: slug → {ts, lang}
  const firstAcAt = new Map<string, { ts: number; lang: string }>()

  for (const sub of submissions) {
    const slug = sub.titleSlug.toLowerCase()
    const ts   = parseInt(sub.timestamp, 10)

    if (sub.statusDisplay !== 'Accepted') continue
    if (!targetSlugs.has(slug)) continue
    if (startTime > 0 && ts < startTime) continue
    if (endTime   > 0 && ts > endTime)   continue

    const existing = firstAcAt.get(slug)
    if (existing === undefined || ts < existing.ts) {
      firstAcAt.set(slug, { ts, lang: sub.lang })
    }
  }

  const solvedSlugs = new Map(
    Array.from(firstAcAt.entries()).map(([slug, { lang }]) => [slug, lang]),
  )
  const lastAcTime =
    solvedSlugs.size > 0
      ? Math.max(...Array.from(firstAcAt.values()).map((v) => v.ts))
      : 0

  return { player, solvedCount: solvedSlugs.size, lastAcTime, solvedSlugs }
}

function rank(scores: PlayerScore[]): PlayerScore[] {
  return [...scores].sort((a, b) => {
    if (b.solvedCount !== a.solvedCount) return b.solvedCount - a.solvedCount
    if (a.solvedCount === 0) return 0
    return a.lastAcTime - b.lastAcTime // earlier last-AC wins
  })
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleTimeString('zh-TW', {
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const LANG_SHORT: Record<string, string> = {
  python3: 'py3', python: 'py', cpp: 'c++', c: 'c',
  javascript: 'js', typescript: 'ts', java: 'java',
  rust: 'rs', golang: 'go', csharp: 'c#', kotlin: 'kt',
  swift: 'swift', ruby: 'rb', php: 'php', scala: 'scala',
}

function shortLang(lang: string): string {
  return LANG_SHORT[lang] ?? lang
}

function fmtDatetimeLocal(ts: number): string {
  if (!ts) return ''
  // datetime-local input expects "YYYY-MM-DDTHH:mm" in local time
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [players, setPlayers] = useState<Player[]>(() =>
    load<Player[]>(LS_PLAYERS, []),
  )
  const [config, setConfig] = useState<CompetitionConfig>(() =>
    load<CompetitionConfig>(LS_CONFIG, DEFAULT_CONFIG),
  )
  const [scores,      setScores]      = useState<PlayerScore[]>([])
  const [loadingIds,  setLoadingIds]  = useState<Set<string>>(new Set())
  const [corsWarning, setCorsWarning] = useState(false)
  const [adminOpen,   setAdminOpen]   = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const fetching = useRef(false)

  useEffect(() => { save(LS_PLAYERS, players) }, [players])
  useEffect(() => { save(LS_CONFIG,  config)  }, [config])

  const fetchAll = useCallback(async () => {
    if (fetching.current || players.length === 0) return
    fetching.current = true
    setCorsWarning(false)
    setLoadingIds(new Set(players.map((p) => p.id)))

    const results: PlayerScore[] = []

    try {
      await Promise.allSettled(
        players.map(async (player) => {
          try {
            const subs  = await fetchSubmissions(player.id)
            const score = computeScore(subs, config, player)
            results.push(score)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (msg === 'Failed to fetch' || msg.includes('NetworkError')) {
              setCorsWarning(true)
            }
            results.push({
              player,
              solvedCount: 0,
              lastAcTime:  0,
              solvedSlugs: new Map(),
              error: msg,
            })
          } finally {
            setLoadingIds((prev) => {
              const next = new Set(prev)
              next.delete(player.id)
              return next
            })
          }
        }),
      )

      setScores(rank(results))
      setLastUpdated(new Date())
    } finally {
      fetching.current = false
    }
  }, [players, config])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  const ranked = rank(scores)
  const top3   = ranked.slice(0, 3)
  const rest   = ranked.slice(3)

  const configIncomplete =
    config.startTime === 0 ||
    config.endTime   === 0 ||
    config.problemSlugs.length === 0

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono">
      {/* ── Header ── */}
      <header className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/90 backdrop-blur-sm px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-green-400 tracking-widest uppercase leading-none">
            ⚡ LeetCode Scoreboard
          </h1>
          <p className="text-xs text-gray-600 mt-1">
            {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString()} · auto-refresh 30s`
              : 'Waiting for first fetch…'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchAll}
            disabled={loadingIds.size > 0}
            className="px-3 py-1.5 text-xs rounded border border-green-700 text-green-400 hover:bg-green-950 disabled:opacity-40 transition-colors"
          >
            {loadingIds.size > 0 ? '⏳ Fetching…' : '↻ Refresh'}
          </button>
          <button
            onClick={() => setAdminOpen(true)}
            className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:bg-gray-800 transition-colors"
          >
            ⚙ Admin
          </button>
        </div>
      </header>

      {/* ── Banners ── */}
      {corsWarning && (
        <div className="mx-6 mt-4 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          <span className="font-semibold">⚠ 無法連線</span>{' '}
          <code className="text-red-200">http://localhost:3000</code>
          &nbsp;— 請確認 Docker 容器已啟動：
          <code className="mt-1 block rounded bg-black/40 px-2 py-1 text-xs text-red-200">
            docker run -p 3000:3000 alfa/leetcode-api
          </code>
        </div>
      )}

      {players.length > 0 && configIncomplete && (
        <div className="mx-6 mt-4 rounded-lg border border-yellow-800 bg-yellow-950/30 px-4 py-2 text-xs text-yellow-400">
          ⚠ 比賽設定未完成（需設定開始/結束時間與題目清單）
        </div>
      )}


      {/* ── Main ── */}
      <main className="mx-auto max-w-5xl px-6 py-8">
        {players.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-gray-700">
            <span className="text-5xl">🏁</span>
            <p className="mt-4 text-lg">尚未新增選手</p>
            <p className="mt-1 text-sm">點擊右上角 ⚙ Admin 開始設定</p>
          </div>
        ) : (
          <>
            {/* ── Podium (Top 3) ── */}
            {top3.length > 0 && (
              <section className="mb-10">
                <SectionLabel>排行榜</SectionLabel>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {top3.map((score, i) => (
                    <PodiumCard
                      key={score.player.id}
                      score={score}
                      rank={i + 1}
                      total={config.problemSlugs.length}
                      loading={loadingIds.has(score.player.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* ── Rest of field ── */}
            {rest.length > 0 && (
              <section>
                <SectionLabel>其他選手</SectionLabel>
                <div className="overflow-hidden rounded-xl border border-gray-800">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-900 text-xs uppercase text-gray-500">
                      <tr>
                        <th className="w-10 px-4 py-3 text-left">#</th>
                        <th className="px-4 py-3 text-left">選手</th>
                        <th className="px-4 py-3 text-center">Solved</th>
                        <th className="hidden px-4 py-3 text-center sm:table-cell">Last AC</th>
                        <th className="hidden px-4 py-3 text-left md:table-cell">題目</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {rest.map((score, i) => (
                        <ScoreRow
                          key={score.player.id}
                          score={score}
                          rank={i + 4}
                          slugs={config.problemSlugs}
                          loading={loadingIds.has(score.player.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {/* ── Admin modal ── */}
      {adminOpen && (
        <AdminPanel
          players={players}
          config={config}
          onPlayersChange={setPlayers}
          onConfigChange={(cfg) => {
            setConfig(cfg)
            setAdminOpen(false)
          }}
          onClose={() => setAdminOpen(false)}
        />
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-xs uppercase tracking-widest text-gray-600">
      {children}
    </p>
  )
}

const MEDAL       = ['🥇', '🥈', '🥉']
const CARD_STYLES = [
  'border-yellow-600/40 bg-gradient-to-b from-yellow-500/10 to-transparent shadow-[0_0_24px_rgba(234,179,8,0.12)]',
  'border-slate-500/40  bg-gradient-to-b from-slate-400/8  to-transparent',
  'border-amber-700/40  bg-gradient-to-b from-amber-600/8  to-transparent',
]

interface PodiumCardProps {
  score:   PlayerScore
  rank:    number
  total:   number
  loading: boolean
}

function PodiumCard({ score, rank, total, loading }: PodiumCardProps) {
  return (
    <div
      className={`flex flex-col items-center rounded-xl border p-6 text-center ${CARD_STYLES[rank - 1]}`}
    >
      <span className="text-4xl">{MEDAL[rank - 1]}</span>
      <span className="mt-3 text-xl font-bold text-white">
        {score.player.displayName ?? score.player.id}
      </span>
      <span className="mt-4 text-5xl font-black text-green-400">
        {score.solvedCount}
      </span>
      <span className="text-xs text-gray-600">/ {total} solved</span>

      {score.lastAcTime > 0 && (
        <span className="mt-2 text-xs text-gray-500">
          Last AC: {fmtTime(score.lastAcTime)}
        </span>
      )}
      {score.solvedSlugs.size > 0 && (
        <div className="mt-3 flex flex-wrap justify-center gap-1">
          {Array.from(score.solvedSlugs.entries()).map(([slug, lang]) => (
            <span key={slug} className="rounded bg-green-900/40 px-1.5 py-0.5 text-xs text-green-400">
              {slug}
              <span className="ml-1 text-green-600/80">{shortLang(lang)}</span>
            </span>
          ))}
        </div>
      )}
      {loading && (
        <span className="mt-2 animate-pulse text-xs text-gray-600">syncing…</span>
      )}
      {score.error && (
        <span className="mt-2 text-xs text-red-500" title={score.error}>
          ✗ fetch error
        </span>
      )}
    </div>
  )
}

interface ScoreRowProps {
  score:   PlayerScore
  rank:    number
  slugs:   string[]
  loading: boolean
}

function ScoreRow({ score, rank, slugs, loading }: ScoreRowProps) {
  return (
    <tr className="transition-colors hover:bg-gray-900/50">
      <td className="px-4 py-3 text-gray-600">{rank}</td>
      <td className="px-4 py-3">
        <span className="font-medium text-white">
          {score.player.displayName ?? score.player.id}
        </span>
        {loading && (
          <span className="ml-2 animate-pulse text-xs text-gray-700">•••</span>
        )}
        {score.error && (
          <span className="ml-2 text-xs text-red-500" title={score.error}>
            ✗
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        <span className="font-bold text-green-400">{score.solvedCount}</span>
        <span className="text-gray-700">/{slugs.length}</span>
      </td>
      <td className="hidden px-4 py-3 text-center text-gray-500 sm:table-cell">
        {fmtTime(score.lastAcTime)}
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        <div className="flex flex-wrap gap-1">
          {slugs.map((slug) => {
            const key  = slug.trim().toLowerCase()
            const lang = score.solvedSlugs.get(key)
            return (
              <span
                key={slug}
                className={`rounded px-1.5 py-0.5 text-xs ${
                  lang
                    ? 'bg-green-900/50 text-green-400'
                    : 'bg-gray-800 text-gray-600'
                }`}
              >
                {slug}
                {lang && (
                  <span className="ml-1 text-green-600/80">{shortLang(lang)}</span>
                )}
              </span>
            )
          })}
        </div>
      </td>
    </tr>
  )
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────

interface AdminPanelProps {
  players:          Player[]
  config:           CompetitionConfig
  onPlayersChange:  (p: Player[]) => void
  onConfigChange:   (c: CompetitionConfig) => void
  onClose:          () => void
}

function AdminPanel({
  players,
  config,
  onPlayersChange,
  onConfigChange,
  onClose,
}: AdminPanelProps) {
  const [newId,          setNewId]          = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [slugInput,      setSlugInput]      = useState(
    config.problemSlugs.join('\n'),
  )
  const [startInput, setStartInput] = useState(fmtDatetimeLocal(config.startTime))
  const [endInput,   setEndInput]   = useState(fmtDatetimeLocal(config.endTime))

  function addPlayer() {
    const id = newId.trim()
    if (!id || players.some((p) => p.id === id)) return
    onPlayersChange([
      ...players,
      { id, displayName: newDisplayName.trim() || undefined },
    ])
    setNewId('')
    setNewDisplayName('')
  }

  function removePlayer(id: string) {
    onPlayersChange(players.filter((p) => p.id !== id))
  }

  function save() {
    const slugs = slugInput
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const startTime = startInput
      ? Math.floor(new Date(startInput).getTime() / 1000)
      : 0
    const endTime = endInput
      ? Math.floor(new Date(endInput).getTime() / 1000)
      : 0
    onConfigChange({ startTime, endTime, problemSlugs: slugs })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="mx-4 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-700 bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 className="font-bold text-white">⚙ 管理面板</h2>
          <button
            onClick={onClose}
            className="text-xl leading-none text-gray-600 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* Time */}
          <section>
            <SectionLabel>比賽時間</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-gray-500">開始時間</span>
                <input
                  type="datetime-local"
                  value={startInput}
                  onChange={(e) => setStartInput(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-green-600 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-gray-500">結束時間</span>
                <input
                  type="datetime-local"
                  value={endInput}
                  onChange={(e) => setEndInput(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-green-600 focus:outline-none"
                />
              </label>
            </div>
          </section>

          {/* Slugs */}
          <section>
            <SectionLabel>題目清單 (Title Slugs)</SectionLabel>
            <textarea
              value={slugInput}
              onChange={(e) => setSlugInput(e.target.value)}
              rows={5}
              placeholder={'two-sum\nadd-two-numbers\nreverse-linked-list'}
              className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-white focus:border-green-600 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-600">每行一題，或以逗號分隔</p>
          </section>

          {/* Players */}
          <section>
            <SectionLabel>選手名單</SectionLabel>
            <div className="mb-3 flex gap-2">
              <input
                type="text"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
                placeholder="LeetCode Username"
                className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-green-600 focus:outline-none"
              />
              <input
                type="text"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
                placeholder="顯示名稱"
                className="w-28 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-green-600 focus:outline-none"
              />
              <button
                onClick={addPlayer}
                className="rounded-lg bg-green-700 px-3 py-2 text-sm text-white transition-colors hover:bg-green-600"
              >
                +
              </button>
            </div>

            {players.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-600">尚無選手</p>
            ) : (
              <ul className="max-h-52 space-y-1.5 overflow-y-auto">
                {players.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-lg bg-gray-800/60 px-3 py-2"
                  >
                    <div>
                      <span className="text-sm text-white">{p.id}</span>
                      {p.displayName && (
                        <span className="ml-2 text-xs text-gray-500">
                          ({p.displayName})
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => removePlayer(p.id)}
                      className="text-gray-600 transition-colors hover:text-red-400"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-gray-800 px-6 py-4">
          <button
            onClick={onClose}
            className="text-sm text-gray-500 transition-colors hover:text-white"
          >
            取消
          </button>
          <button
            onClick={save}
            className="rounded-lg bg-green-700 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-green-600"
          >
            儲存設定
          </button>
        </div>
      </div>
    </div>
  )
}
