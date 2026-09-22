import { isLlamaSkipped, PACKET_STAGES } from '../types/board'
import { advanceMockBoard, mockBoardState } from './boardFixture'

describe('mockBoardState', () => {
  it('covers every stage', () => {
    const stages = new Set(mockBoardState().packets.map((packet) => packet.stage))
    for (const stage of PACKET_STAGES) {
      expect(stages.has(stage)).toBe(true)
    }
  })

  it('returns at least six packets', () => {
    expect(mockBoardState().packets.length).toBeGreaterThanOrEqual(6)
  })

  it('has an ingest packet with neither jev nor llama', () => {
    const ingest = mockBoardState().packets.find((packet) => packet.stage === 'ingest')
    expect(ingest).toBeDefined()
    expect(ingest?.jev).toBeUndefined()
    expect(ingest?.llama).toBeUndefined()
  })

  it('has a jev packet that settled with Llama skipped and no distribution', () => {
    const skipped = mockBoardState().packets.filter(isLlamaSkipped)
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.stage).toBe('jev')
    expect(skipped[0]?.jev).toBeUndefined()
    expect(skipped[0]?.llama).toBeUndefined()
  })

  it('has a packet carrying both a full jev distribution and a llama verdict', () => {
    const full = mockBoardState().packets.find((packet) => packet.jev && packet.llama)
    expect(full).toBeDefined()
    expect(full?.llama?.rationale.length).toBeGreaterThan(0)
  })

  it('jev distributions sum to approximately 1 with values in [0, 1]', () => {
    for (const packet of mockBoardState().packets) {
      if (!packet.jev) continue
      const values = Object.values(packet.jev)
      const total = values.reduce((sum, value) => sum + value, 0)
      // Floating point sums rarely land exactly on 1, so compare with tolerance.
      expect(total).toBeCloseTo(1, 6)
      for (const value of values) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    }
  })

  it('is deterministic across calls', () => {
    expect(mockBoardState()).toEqual(mockBoardState())
  })
})

describe('advanceMockBoard', () => {
  it('does not mutate its input', () => {
    const before = mockBoardState()
    const snapshot = structuredClone(before)
    const after = advanceMockBoard(before)
    expect(before).toEqual(snapshot)
    expect(after).not.toBe(before)
    expect(after.packets).not.toBe(before.packets)
  })

  it('moves each packet one stage forward and leaves verdict packets in place', () => {
    const before = mockBoardState()
    const after = advanceMockBoard(before)
    expect(after.packets).toHaveLength(before.packets.length)
    before.packets.forEach((packet, index) => {
      if (isLlamaSkipped(packet)) return
      const expected = PACKET_STAGES[Math.min(PACKET_STAGES.indexOf(packet.stage) + 1, PACKET_STAGES.length - 1)]
      expect(after.packets[index]?.stage).toBe(expected)
      expect(after.packets[index]?.id).toBe(packet.id)
    })
  })

  it('holds a Llama-skipped packet in the jev stage instead of walking it into llama', () => {
    let state = mockBoardState()
    const skippedId = state.packets.find(isLlamaSkipped)?.id
    expect(skippedId).toBeDefined()

    for (let tick = 0; tick < PACKET_STAGES.length + 1; tick += 1) {
      state = advanceMockBoard(state)
      const packet = state.packets.find((candidate) => candidate.id === skippedId)
      expect(packet?.stage).toBe('jev')
      expect(packet?.jevUnavailable).toBe(true)
    }
  })
})
