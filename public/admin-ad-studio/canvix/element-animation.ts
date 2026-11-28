// Adapted from Canvix src/lib/animations.ts (MIT; see LICENSE.txt).
type AnimationEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'spring'
type ElementAnimation = { kind: string; delay?: number; duration?: number; easing?: AnimationEasing; direction?: string }
// ── easings ──────────────────────────────────────────────────

export function applyEasing(t: number, easing: AnimationEasing): number {
  switch (easing) {
    case 'linear':
      return t
    case 'easeIn':
      return t * t * t
    case 'easeOut':
      return 1 - Math.pow(1 - t, 3)
    case 'easeInOut':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    case 'spring': {
      // damped spring approximation
      const c = 2 * Math.PI * 0.9 // frequency
      const decay = 4.5
      return 1 - Math.exp(-decay * t) * Math.cos(c * t)
    }
    default:
      return t
  }
}

// ── per-element animation state at time t ────────────────────

export interface AnimatedElementState {
  /** 0..1 multiplier over the element's base opacity */
  opacity: number
  /** page-space translation deltas */
  dx: number
  dy: number
  /** scale multipliers (relative to base size) */
  scaleX: number
  scaleY: number
  /** additional rotation in degrees */
  rotation: number
  /** wipe reveal: 0..1 fraction of the width visible from the anchor edge */
  reveal: number
}

const IDENTITY: AnimatedElementState = {
  opacity: 1,
  dx: 0,
  dy: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  reveal: 1,
}

/** Travel distance for pan/rise — relative to element size / page. */
function travelDistance(el: { width: number; height: number }): { x: number; y: number } {
  return { x: Math.max(80, el.width * 0.35), y: Math.max(80, el.height * 0.35) }
}

/**
 * Compute an element's animated state at time `t` (seconds since the page
 * was shown). Returns IDENTITY when the animation is finished or absent.
 */
export function animateElementAt(
  el: { width: number; height: number; animation?: ElementAnimation },
  t: number
): AnimatedElementState {
  const a = el.animation
  if (!a || a.kind === 'none' || a.kind === undefined) return IDENTITY

  const local = t - (a.delay || 0)
  if (local <= 0) {
    // before the animation starts: element is at its "from" state (hidden)
    return startState(el, a)
  }
  const dur = Math.max(0.05, a.duration || 0.9)
  if (a.kind === 'breathe') {
    // continuous loop — scale pulse 1 → 1.04 → 1
    const phase = (local % dur) / dur
    const s = 1 + 0.04 * Math.sin(phase * Math.PI * 2)
    return { ...IDENTITY, scaleX: s, scaleY: s }
  }
  if (local >= dur) return IDENTITY

  const p = applyEasing(local / dur, a.easing || 'easeOut')
  const inv = 1 - p
  const travel = travelDistance(el)
  const dir = a.direction ?? 'up'

  switch (a.kind) {
    case 'fade':
      return { ...IDENTITY, opacity: p }
    case 'rise': {
      // rise = move up + fade in (direction-aware)
      const dy = dir === 'down' ? inv * travel.y : -inv * travel.y
      return { ...IDENTITY, opacity: p, dy }
    }
    case 'pan': {
      const dx = dir === 'left' ? -inv * travel.x : dir === 'right' ? inv * travel.x : 0
      const dy2 = dir === 'up' ? -inv * travel.y : dir === 'down' ? inv * travel.y : 0
      return { ...IDENTITY, dx, dy: dy2 }
    }
    case 'pop': {
      // overshoot springy scale-in
      const s = 0.6 + 0.4 * p * (1 + 0.25 * Math.sin(p * Math.PI))
      return { ...IDENTITY, scaleX: s, scaleY: s, opacity: Math.min(1, p * 1.6) }
    }
    case 'wipe': {
      // reveal from the anchor edge (scale-on-one-axis approximation)
      return { ...IDENTITY, reveal: p, opacity: 1 }
    }
    case 'zoom': {
      const s = 0.65 + 0.35 * p
      return { ...IDENTITY, scaleX: s, scaleY: s, opacity: p }
    }
    case 'rotate': {
      return { ...IDENTITY, rotation: inv * (dir === 'left' ? -90 : 90), opacity: p, scaleX: Math.max(0.1, 0.8 + 0.2 * p) }
    }
    default:
      return IDENTITY
  }
}

/** the state an element sits in before its animation starts */
function startState(
  el: { width: number; height: number },
  a: ElementAnimation
): AnimatedElementState {
  const travel = travelDistance(el)
  const dir = a.direction ?? 'up'
  switch (a.kind) {
    case 'fade':
    case 'rise':
    case 'zoom':
    case 'pop':
    case 'rotate':
      return { ...IDENTITY, opacity: 0 }
    case 'pan':
      return {
        ...IDENTITY,
        dx: dir === 'left' ? -travel.x : dir === 'right' ? travel.x : 0,
        dy: dir === 'up' ? -travel.y : dir === 'down' ? travel.y : 0,
      }
    case 'wipe':
      return { ...IDENTITY, reveal: 0 }
    case 'breathe':
      return IDENTITY
    default:
      return IDENTITY
  }
}

