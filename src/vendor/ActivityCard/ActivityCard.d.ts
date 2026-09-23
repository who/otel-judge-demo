/*
 * Types for the vendored ActivityCard. The upstream component is plain JSX with
 * no types of its own, so this declaration is hand-written from its parameter
 * list and the values its switches accept: it is a description of that file, not
 * a second source of truth, and it moves only when the vendored copy does.
 */

import type { ReactElement, ReactNode } from 'react'

/** Seconds per border revolution, or one of the named presets. */
export type ActivityCardSpeed = 'slow' | 'normal' | 'fast' | number

export type ActivityCardParticleEffect =
  | 'none'
  | 'sparkler'
  | 'comet'
  | 'stardust'
  | 'ember'
  | 'electric'
  | 'bubble'

export type ActivityCardShape = 'rectangle' | 'circle'

export type ActivityCardLineStyle = 'solid' | 'scribble' | 'double' | 'wavy' | 'glow' | 'tapered'

export type ActivityCardHeadShape = 'round' | 'flat' | 'pointed' | 'soft'

export interface ActivityCardProps {
  children?: ReactNode
  /** Whether the border animates. False leaves the same border paused. */
  active?: boolean
  /** Any colour the canvas can parse; a hex value also parses without one. */
  color?: string
  speed?: ActivityCardSpeed
  particleEffect?: ActivityCardParticleEffect
  shape?: ActivityCardShape
  lineStyle?: ActivityCardLineStyle
  particleFollowDistance?: number
  headSize?: number
  headShape?: ActivityCardHeadShape
}

declare function ActivityCard(props: ActivityCardProps): ReactElement

export default ActivityCard
