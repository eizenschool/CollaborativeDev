import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const cards = readFileSync(resolve(import.meta.dirname, '../../presentation/components/search/RideCards.jsx'), 'utf8')
const search = readFileSync(resolve(import.meta.dirname, '../../presentation/components/search/SearchModule.jsx'), 'utf8')

describe('Module 4 multi-leg Search presentation contract', () => {
  it('renders a distinct alternative card and a keyboard-managed itinerary dialog', () => {
    expect(cards).toContain('export function MultiLegJourneyCard')
    expect(cards).toContain('export function MultiLegItinerary')
    expect(search).toContain('open={Boolean(selectedJourney)}')
    expect(search).toContain('triggerRef={itineraryTriggerRef}')
  })

  it('does not try to favourite a synthetic journey and opens each real leg independently', () => {
    const multiLegBranch = search.match(/ride\.journeyType === 'multi-leg'[\s\S]*?\) : \(/)?.[0] || ''
    expect(multiLegBranch).toContain('<MultiLegJourneyCard')
    expect(multiLegBranch).not.toContain('onToggleFavourite')
    expect(search).toContain('navigate(`/ride/${leg.id}`')
  })

  it('shows transfer instructions, both Hosts, requirements, ETAs, and waiting time', () => {
    expect(cards).toContain('Change rides here.')
    expect(cards).toContain('leg.host?.fullName')
    expect(cards).toContain('leg.restrictionTags?.join')
    expect(cards).toContain('formatArrival(leg.estimatedArrivalAt)')
    expect(cards).toContain('journey.waitMinutes')
  })
})
