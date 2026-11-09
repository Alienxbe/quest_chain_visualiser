/**
 * Downloads the Questie WoW Forever database (GPL-3.0, https://github.com/Questie)
 * and converts it into public/data/quests.json for the visualiser.
 *
 * The data comes from QuestieDB's Forever release build, which has all of Questie's
 * corrections applied (the raw data/Forever files don't). By default it uses the rolling
 * `preview` release, rebuilt from QuestieDB's latest commit, so fixes show up within a day.
 *
 * Usage: npm run import-data [-- --offline] [-- --stable]
 *   --offline  reuse the files cached in .cache/ instead of downloading
 *   --stable   use the latest versioned release instead of `preview`
 *
 * Set GITHUB_TOKEN to raise the GitHub API rate limit (CI does this).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBakedToc, parseEnumNames, parseQuestXp, unzip } from './baked.ts'
import { convertQuestie, parseFactionCsv, type LookupSources } from './convert.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache')
const OUT = join(ROOT, 'public', 'data', 'quests.json')

const RELEASES = 'https://api.github.com/repos/Questie/QuestieDB/releases'
const L10N = 'https://raw.githubusercontent.com/Questie/Questie/HEAD/Localization/lookups'
/** Faction names (Questie keeps a DBC export of the Faction table). */
const FACTIONS = 'https://raw.githubusercontent.com/Questie/Questie/HEAD/ExternalScripts(DONOTINCLUDEINRELEASE)/DBC%20-%20WoW.tools/faction_classic.csv'

const LOOKUPS: Record<keyof LookupSources, string> = {
  zones: `${L10N}/lookupZones.lua`,
  categories: `${L10N}/lookupQuestCategories.lua`,
}

const BAKED_TOC = 'QuestieDB/QuestieDB_Forever.toc'
/** Symbolic names, used to name new Forever zones/factions Questie's lookups don't have yet. */
const ZONE_ENUM = 'QuestieDB/src/corrections/enum/zones.lua'
const FACTION_ENUM = 'QuestieDB/src/corrections/enum/factions.lua'
const XP_FILES = [
  // Classic values first; in-game traces override them.
  'QuestieDB/support/Forever/QuestXP/xpDB-classic.lua',
  'QuestieDB/support/Forever/QuestXP/xpDB-traces.lua',
]

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': 'forever-quest-chains-importer' }
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  return h
}

async function fetchOk(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res
}

async function loadText(name: string, url: string, offline: boolean): Promise<string> {
  const file = join(CACHE, name)
  if (offline && existsSync(file)) return readFile(file, 'utf8')
  console.log(`Downloading ${url}`)
  const text = await (await fetchOk(url)).text()
  await mkdir(CACHE, { recursive: true })
  await writeFile(file, text)
  return text
}

interface ReleaseInfo {
  tag: string
  name: string
  url: string
}

/** Finds the Forever zip of the preview release (or the latest stable one). */
async function findRelease(stable: boolean): Promise<ReleaseInfo> {
  const tryTag = async (path: string): Promise<ReleaseInfo | undefined> => {
    const res = await fetch(`${RELEASES}/${path}`, { headers: headers() })
    if (res.status === 404) return undefined
    if (!res.ok) throw new Error(`GitHub releases API (${path}): HTTP ${res.status}`)
    const rel = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] }
    const asset = rel.assets.find((a) => a.name.endsWith('-Forever.zip'))
    return asset && { tag: rel.tag_name, name: asset.name, url: asset.browser_download_url }
  }
  const release = (!stable && await tryTag('tags/preview')) || await tryTag('latest')
  if (!release) throw new Error('No QuestieDB release with a Forever build was found')
  return release
}

/** Downloads (or reuses from cache) the Forever release zip. */
async function loadRelease(offline: boolean, stable: boolean): Promise<{ zip: Buffer; name: string }> {
  const zipFile = join(CACHE, 'questiedb-forever.zip')
  const infoFile = join(CACHE, 'questiedb-forever.json')
  if (offline && existsSync(zipFile) && existsSync(infoFile)) {
    const info = JSON.parse(await readFile(infoFile, 'utf8')) as ReleaseInfo
    return { zip: await readFile(zipFile), name: info.name }
  }
  const info = await findRelease(stable)
  console.log(`Downloading ${info.url}`)
  const zip = Buffer.from(await (await fetchOk(info.url)).arrayBuffer())
  await mkdir(CACHE, { recursive: true })
  await writeFile(zipFile, zip)
  await writeFile(infoFile, JSON.stringify(info))
  return { zip, name: info.name }
}

async function main() {
  const offline = process.argv.includes('--offline')
  const stable = process.argv.includes('--stable')

  const [release, zones, categories, factionCsv] = await Promise.all([
    loadRelease(offline, stable),
    loadText('zones.lua', LOOKUPS.zones, offline),
    loadText('categories.lua', LOOKUPS.categories, offline),
    loadText('factions.csv', FACTIONS, offline),
  ])

  const files = unzip(release.zip, (p) => [BAKED_TOC, ZONE_ENUM, FACTION_ENUM, ...XP_FILES].includes(p))
  const toc = files.get(BAKED_TOC)
  if (!toc) throw new Error(`${release.name} has no ${BAKED_TOC}`)

  console.log(`Decoding ${release.name}…`)
  const entities = parseBakedToc(toc.toString('utf8'))
  const questXp = parseQuestXp(...XP_FILES.map((f) => files.get(f)?.toString('utf8') ?? ''))
  const enumNames = (f: string) => parseEnumNames(files.get(f)?.toString('utf8') ?? '')

  const db = await convertQuestie(
    { entities, zones, categories, extraZoneNames: enumNames(ZONE_ENUM) },
    {
      // DBC names win; the enum only fills in new Forever factions.
      factionNames: { ...enumNames(FACTION_ENUM), ...parseFactionCsv(factionCsv) },
      questXp,
      source: `Questie QuestieDB (GPL-3.0), ${release.name.replace(/\.zip$/, '')} — https://github.com/Questie/QuestieDB`,
    },
  )

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(db))
  const count = (pred: (q: (typeof db.quests)[number]) => unknown) => db.quests.filter(pred).length
  console.log(
    `Wrote ${db.quests.length} quests (${count((q) => q.preAll.length || q.preAny.length)} with prerequisites, `
    + `${count((q) => q.xp)} with XP, ${count((q) => q.rewardItems?.length || q.reputation?.length)} with item/reputation rewards) to ${OUT}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
