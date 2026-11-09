/**
 * Downloads the Questie WoW Forever database (GPL-3.0, https://github.com/Questie)
 * and converts it into public/data/quests.json for the visualiser.
 *
 * Usage: npm run import-data [-- --offline]
 *   --offline  reuse the files cached in .cache/ instead of downloading
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertQuestie, type RawSources } from './convert.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache')
const OUT = join(ROOT, 'public', 'data', 'quests.json')

const DB = 'https://raw.githubusercontent.com/Questie/QuestieDB/HEAD/data/Forever'
const L10N = 'https://raw.githubusercontent.com/Questie/Questie/HEAD/Localization/lookups'

const SOURCES: Record<keyof RawSources, string> = {
  quests: `${DB}/foreverQuestDB.lua`,
  npcs: `${DB}/foreverNpcDB.lua`,
  objects: `${DB}/foreverObjectDB.lua`,
  items: `${DB}/foreverItemDB.lua`,
  zones: `${L10N}/lookupZones.lua`,
  categories: `${L10N}/lookupQuestCategories.lua`,
}

async function load(name: string, url: string, offline: boolean): Promise<string> {
  const file = join(CACHE, `${name}.lua`)
  if (offline && existsSync(file)) return readFile(file, 'utf8')
  console.log(`Downloading ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const text = await res.text()
  await mkdir(CACHE, { recursive: true })
  await writeFile(file, text)
  return text
}

async function main() {
  const offline = process.argv.includes('--offline')
  const entries = await Promise.all(
    Object.entries(SOURCES).map(async ([k, url]) => [k, await load(k, url, offline)] as const),
  )
  const raw = Object.fromEntries(entries) as RawSources

  console.log('Converting Lua tables…')
  const db = await convertQuestie(raw)

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(db))
  const withPre = db.quests.filter((q) => q.preAll.length || q.preAny.length).length
  console.log(`Wrote ${db.quests.length} quests (${withPre} with prerequisites) to ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
