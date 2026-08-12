import { describe, it, expect } from 'vitest'
import { fmtEta, etaSeconds } from './format'

describe('etaSeconds', () => {
  it('returns Infinity when speed is zero', () => {
    expect(etaSeconds({ totalLength: '100', completedLength: '0', downloadSpeed: '0' })).toBe(Infinity)
  })
  it('returns Infinity when download complete', () => {
    expect(etaSeconds({ totalLength: '100', completedLength: '100', downloadSpeed: '10' })).toBe(Infinity)
  })
  it('computes remaining seconds', () => {
    expect(etaSeconds({ totalLength: '1000', completedLength: '500', downloadSpeed: '100' })).toBe(5)
  })
})

describe('fmtEta', () => {
  it('shows dash when not computable', () => {
    expect(fmtEta({ totalLength: '100', completedLength: '0', downloadSpeed: '0' })).toBe('—')
  })
  it('formats seconds tier', () => {
    expect(fmtEta({ totalLength: '1000', completedLength: '500', downloadSpeed: '100' })).toBe('5秒')
  })
  it('formats minutes tier', () => {
    expect(fmtEta({ totalLength: '120', completedLength: '0', downloadSpeed: '1' })).toBe('2分0秒')
  })
  it('formats hours tier', () => {
    expect(fmtEta({ totalLength: '3600', completedLength: '0', downloadSpeed: '1' })).toBe('1小时0分')
  })
  it('formats days tier', () => {
    expect(fmtEta({ totalLength: '90000', completedLength: '0', downloadSpeed: '1' })).toBe('1天1小时')
  })
})
