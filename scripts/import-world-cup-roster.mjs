import { writeFile } from 'node:fs/promises'
import { load } from 'cheerio'

const SQUADS_URL = 'https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_squads'
const OUTPUT_FILE = new URL('../src/data/officialRoster.json', import.meta.url)

function cleanText(value) {
  return value.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim()
}

function normalizeTitle(value) {
  return decodeURIComponent(value ?? '')
    .replace(/_/g, ' ')
    .normalize('NFC')
    .trim()
}

function ratingFrom(player) {
  const positionBase = {
    GK: 78,
    DF: 77,
    MF: 79,
    FW: 80,
  }[player.position] ?? 76

  const capsBoost = Math.min(12, Math.floor(player.caps / 12))
  const goalBoost = player.position === 'FW'
    ? Math.min(10, Math.floor(player.goals / 6))
    : Math.min(8, Math.floor(player.goals / 10))

  return Math.min(96, positionBase + capsBoost + goalBoost)
}

function statsFrom(player) {
  const rating = ratingFrom(player)
  const capsFactor = Math.min(10, Math.floor(player.caps / 15))
  const goalsFactor = Math.min(12, Math.floor(player.goals / 5))

  if (player.position === 'GK') {
    return {
      rating,
      attack: 18 + goalsFactor,
      defense: Math.min(96, rating + 8),
      pace: 52 + capsFactor,
    }
  }

  if (player.position === 'DF') {
    return {
      rating,
      attack: Math.min(76, 42 + goalsFactor + capsFactor),
      defense: Math.min(96, rating + 7),
      pace: Math.min(94, 68 + capsFactor),
    }
  }

  if (player.position === 'MF') {
    return {
      rating,
      attack: Math.min(94, rating - 3 + goalsFactor),
      defense: Math.min(90, rating - 6 + capsFactor),
      pace: Math.min(94, 70 + capsFactor),
    }
  }

  return {
    rating,
    attack: Math.min(97, rating + 6 + goalsFactor),
    defense: Math.min(74, 38 + capsFactor),
    pace: Math.min(97, 74 + capsFactor),
  }
}

async function getThumbnails(slugs) {
  const photos = new Map()
  const cleanSlugs = slugs.filter(Boolean)

  for (let index = 0; index < cleanSlugs.length; index += 50) {
    const titles = cleanSlugs
      .slice(index, index + 50)
      .map((slug) => normalizeTitle(slug))
      .join('|')
    const url = new URL('https://en.wikipedia.org/w/api.php')
    url.searchParams.set('action', 'query')
    url.searchParams.set('format', 'json')
    url.searchParams.set('origin', '*')
    url.searchParams.set('prop', 'pageimages')
    url.searchParams.set('piprop', 'thumbnail|original')
    url.searchParams.set('pithumbsize', '240')
    url.searchParams.set('titles', titles)

    const response = await fetch(url)
    if (!response.ok) continue

    const data = await response.json()
    for (const page of Object.values(data.query?.pages ?? {})) {
      if (!page.title) continue
      photos.set(normalizeTitle(page.title), page.thumbnail?.source ?? page.original?.source ?? null)
    }
  }

  return photos
}

async function main() {
  const response = await fetch(SQUADS_URL)
  if (!response.ok) {
    throw new Error(`Could not fetch squads: ${response.status}`)
  }

  const $ = load(await response.text())
  const players = []
  let currentGroup = ''
  let currentTeam = ''

  $('.mw-parser-output > .mw-heading, .mw-parser-output > table.wikitable').each((_, element) => {
    const node = $(element)
    const tag = element.tagName?.toLowerCase()

    if (node.find('h2').length) {
      const groupName = cleanText(node.find('h2').text())
      if (groupName.startsWith('Group ')) currentGroup = groupName
      return
    }

    if (node.find('h3').length) {
      currentTeam = cleanText(node.find('h3').text())
      return
    }

    if (tag !== 'table' || !currentGroup || !currentTeam) return

    node.find('tbody tr').each((__, row) => {
      const cells = $(row).find('td')
      const playerHeader = $(row).find('th[scope="row"]')
      if (cells.length < 6 || !playerHeader.length) return

      const number = Number.parseInt(cleanText($(cells[0]).text()), 10)
      const position = cleanText($(cells[1]).text()).match(/(GK|DF|MF|FW)/)?.[1]
      const playerCell = playerHeader
      const playerLink = playerCell.find('a').last()
      const name = cleanText(playerLink.text() || playerCell.text()).replace(/\s*\(captain\)\s*/i, '')
      const wikiSlug = playerLink.attr('href')?.replace('/wiki/', '')
      const caps = Number.parseInt(cleanText($(cells[3]).text()), 10) || 0
      const goals = Number.parseInt(cleanText($(cells[4]).text()), 10) || 0
      const club = cleanText($(cells[5]).text())

      if (!number || !position || !name || name.length < 2) return

      const base = {
        id: `${currentTeam}-${number}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        number,
        name,
        team: currentTeam,
        group: currentGroup,
        position,
        caps,
        goals,
        club,
        wikiSlug,
        photo: null,
        photoCredit: wikiSlug ? 'Wikimedia / Wikipedia thumbnail' : null,
      }

      players.push({ ...base, ...statsFrom(base) })
    })
  })

  const uniquePlayers = Array.from(new Map(players.map((player) => [player.id, player])).values())

  const thumbnails = await getThumbnails(uniquePlayers.map((player) => player.wikiSlug))
  for (const player of uniquePlayers) {
    player.photo = thumbnails.get(normalizeTitle(player.wikiSlug)) ?? null
  }

  const teams = Array.from(new Set(uniquePlayers.map((player) => player.team))).map((team) => ({
    name: team,
    group: uniquePlayers.find((player) => player.team === team)?.group ?? '',
    players: uniquePlayers.filter((player) => player.team === team).length,
  }))

  await writeFile(
    OUTPUT_FILE,
    JSON.stringify(
      {
        source: SQUADS_URL,
        importedAt: new Date().toISOString(),
        teams,
        players: uniquePlayers,
      },
      null,
      2,
    ),
  )

  console.log(`Imported ${uniquePlayers.length} players across ${teams.length} teams`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
