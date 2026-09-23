/*
 * Vendored from https://github.com/who/ActivityCard
 * (src/components/ActivityCard.jsx). This is that component's animated border,
 * copied rather than re-implemented so the pulse a chip shows is the same one
 * the upstream card shows and a future fix there can be re-copied here.
 *
 * ActivityCard ships as part of a Next.js app rather than as a package, so the
 * only edit to the upstream file is the removal of its 'use client' directive:
 * this demo is a plain Vite + React client bundle and has no server components
 * to mark a boundary against. Everything below is upstream's, untouched —
 * treat it as third-party source and send behaviour changes upstream instead of
 * editing here. Chip-specific sizing is imposed from CSS by the caller, since
 * the component styles its own wrapper inline and takes no class or style prop.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';

const keyframesStyle = `
@property --border-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

@property --particle-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: true;
}

@keyframes borderTrace {
  from {
    --border-angle: 0deg;
  }
  to {
    --border-angle: 360deg;
  }
}

@keyframes sparklerBurst {
  0% {
    transform: translate(0, 0) scale(1);
    opacity: 1;
  }
  100% {
    transform: translate(var(--tx), var(--ty)) scale(0);
    opacity: 0;
  }
}

@keyframes followBorder {
  0% {
    offset-distance: 0%;
  }
  100% {
    offset-distance: 100%;
  }
}

@keyframes followAngle {
  from {
    --particle-angle: 0deg;
  }
  to {
    --particle-angle: 360deg;
  }
}

@keyframes cometTrail {
  0% {
    transform: translateX(0) scaleX(1);
    opacity: 1;
  }
  50% {
    opacity: 0.8;
  }
  100% {
    transform: translateX(var(--trail-distance)) scaleX(0.3);
    opacity: 0;
  }
}

@keyframes stardustFloat {
  0% {
    transform: translate(0, 0) rotate(0deg);
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  80% {
    opacity: 1;
  }
  100% {
    transform: translate(var(--drift-x), var(--drift-y)) rotate(360deg);
    opacity: 0;
  }
}

@keyframes stardustTwinkle {
  0%, 100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1.2);
  }
}

@keyframes emberRise {
  0% {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
  50% {
    opacity: 0.8;
  }
  100% {
    transform: translateY(var(--rise-distance)) scale(0.5);
    opacity: 0;
  }
}

@keyframes emberGlow {
  0%, 100% {
    filter: brightness(1);
  }
  50% {
    filter: brightness(1.5);
  }
}

@keyframes electricCrackle {
  0% {
    transform: scaleX(0) scaleY(1);
    opacity: 1;
  }
  30% {
    transform: scaleX(1) scaleY(1);
    opacity: 1;
  }
  60% {
    transform: scaleX(1) scaleY(0.5);
    opacity: 0.5;
  }
  100% {
    transform: scaleX(1) scaleY(0);
    opacity: 0;
  }
}

@keyframes bubbleFloat {
  0% {
    transform: translateY(0) scale(0.5);
    opacity: 0;
  }
  20% {
    opacity: 0.8;
    transform: translateY(-10px) scale(1);
  }
  80% {
    opacity: 0.6;
  }
  100% {
    transform: translateY(var(--float-distance)) scale(1.2);
    opacity: 0;
  }
}

@keyframes bubbleWobble {
  0%, 100% {
    transform: translateX(-2px);
  }
  50% {
    transform: translateX(2px);
  }
}

@keyframes strokeTrace {
  from {
    stroke-dashoffset: var(--path-length);
  }
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes glowPulse {
  0%, 100% {
    filter: blur(2px) brightness(1);
  }
  50% {
    filter: blur(4px) brightness(1.3);
  }
}
`;

const SHAPE_STYLES = {
  rectangle: {
    wrapper: {
      position: 'relative',
      width: '300px',
      height: '180px',
      borderRadius: '12px',
    },
    borderRadius: '12px',
  },
  circle: {
    wrapper: {
      position: 'relative',
      width: '180px',
      height: '180px',
      borderRadius: '50%',
      aspectRatio: '1',
    },
    borderRadius: '50%',
  },
};

const baseBorderStyles = {
  position: 'absolute',
  inset: 0,
  padding: '2px',
  WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
  WebkitMaskComposite: 'xor',
  maskComposite: 'exclude',
  pointerEvents: 'none',
};

// Default color for initial server render
const DEFAULT_RGB = [59, 130, 246];

function parseColor(color) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Canvas not supported (jsdom, some browsers)
  if (!ctx) {
    return parseHexColor(color);
  }

  ctx.fillStyle = color;
  const computed = ctx.fillStyle;
  if (computed.startsWith('#')) {
    const hex = computed.slice(1);
    const num = parseInt(hex, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }
  // Handle rgb/rgba format
  const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
  }
  return DEFAULT_RGB;
}

function parseHexColor(color) {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const fullHex = hex.length === 3
      ? hex.split('').map(c => c + c).join('')
      : hex;
    const num = parseInt(fullHex, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }
  // Default fallback
  return DEFAULT_RGB;
}

function createBorderGradient(rgb) {
  const [r, g, b] = rgb;
  return `conic-gradient(
    from var(--border-angle, 0deg),
    transparent 0deg,
    transparent 270deg,
    rgba(${r}, ${g}, ${b}, 0.1) 280deg,
    rgba(${r}, ${g}, ${b}, 0.5) 320deg,
    rgba(${r}, ${g}, ${b}, 1) 360deg
  )`;
}

const baseContentStyles = {
  width: '100%',
  height: '100%',
  backgroundColor: 'rgba(128, 128, 128, 0.1)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const SPEED_PRESETS = {
  slow: 5,
  normal: 3,
  fast: 1.5,
};

function getAnimationDuration(speed) {
  if (typeof speed === 'number') {
    return speed;
  }
  return SPEED_PRESETS[speed] ?? SPEED_PRESETS.normal;
}

// Calculate intensity multiplier based on speed (faster = more intense)
// Uses an easing function for smooth transitions
function getIntensityFromSpeed(duration) {
  // Map duration to intensity: 0.5s -> 1.5x, 3s -> 1x, 8s -> 0.6x
  // Using inverse relationship with easing
  const minDuration = 0.5;
  const maxDuration = 8;
  const normalDuration = 3;

  // Clamp duration to valid range
  const clampedDuration = Math.max(minDuration, Math.min(maxDuration, duration));

  if (clampedDuration <= normalDuration) {
    // Faster than normal: intensity increases (1.0 to 1.5)
    const t = 1 - (clampedDuration - minDuration) / (normalDuration - minDuration);
    // Ease-out cubic for smooth transition
    const eased = 1 - Math.pow(1 - t, 3);
    return 1 + eased * 0.5;
  } else {
    // Slower than normal: intensity decreases (1.0 to 0.6)
    const t = (clampedDuration - normalDuration) / (maxDuration - normalDuration);
    // Ease-in cubic for gradual reduction
    const eased = Math.pow(t, 2);
    return 1 - eased * 0.4;
  }
}

// Get intensity parameters for effects
function getEffectIntensity(duration, hovered = false) {
  const intensity = getIntensityFromSpeed(duration);
  // Hover multiplier for accentuated effects
  const hoverMult = hovered ? 1.4 : 1;

  return {
    intensity: intensity * hoverMult,
    // Glow parameters
    glowBlur: Math.round(4 * intensity * hoverMult),
    glowBlur2: Math.round(8 * intensity * hoverMult),
    glowOpacity: Math.min(0.95, 0.6 * intensity * hoverMult),
    // Particle parameters
    particleCount: Math.round(12 * intensity),
    particleSizeMultiplier: (0.7 + intensity * 0.3) * hoverMult,
    particleOpacityMultiplier: Math.min(1, (0.7 + intensity * 0.3) * hoverMult),
    particleBlurMultiplier: intensity * hoverMult,
  };
}

const PARTICLE_EFFECTS = ['sparkler', 'comet', 'stardust', 'ember', 'electric', 'bubble', 'none'];

const LINE_STYLES = ['solid', 'scribble', 'double', 'wavy', 'glow', 'tapered'];

const HEAD_SHAPES = ['round', 'flat', 'pointed', 'soft'];

// Map head shape to SVG strokeLinecap value
function getStrokeLinecapFromShape(headShape) {
  switch (headShape) {
    case 'flat':
      return 'butt';
    case 'pointed':
      return 'butt'; // Pointed uses butt + custom marker
    case 'soft':
      return 'round'; // Soft uses round + blur
    case 'round':
    default:
      return 'round';
  }
}

// Get SVG stroke properties for different line styles
function getStrokeStyle(lineStyle, baseStrokeWidth = 2, headShape = 'round', headSize = 1) {
  const strokeLinecap = getStrokeLinecapFromShape(headShape);
  const sizeMultiplier = headSize;

  switch (lineStyle) {
    case 'double':
      // Double lines are rendered as two separate paths
      return {
        strokeDasharray: 'none',
        strokeLinecap,
        strokeWidth: baseStrokeWidth * 0.6 * sizeMultiplier,
        isDouble: true,
        spacing: baseStrokeWidth * 1.5,
        headShape,
        headSize: sizeMultiplier,
      };
    case 'glow':
      return {
        strokeDasharray: 'none',
        strokeLinecap,
        strokeWidth: baseStrokeWidth * 2 * sizeMultiplier,
        isGlow: true,
        headShape,
        headSize: sizeMultiplier,
      };
    case 'tapered':
      // Tapered uses stroke-dasharray to simulate varying thickness
      return {
        strokeDasharray: 'none',
        strokeLinecap,
        strokeWidth: baseStrokeWidth * sizeMultiplier,
        isTapered: true,
        headShape,
        headSize: sizeMultiplier,
      };
    case 'solid':
    default:
      return {
        strokeDasharray: 'none',
        strokeLinecap,
        strokeWidth: baseStrokeWidth * sizeMultiplier,
        headShape,
        headSize: sizeMultiplier,
      };
  }
}

function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// Generate SVG path for the border based on shape
// Path must start at top center to match conic-gradient origin (0deg = top)
function getBorderPath(shape, width, height, borderRadius) {
  if (shape === 'circle') {
    // For circle, use two semicircular arcs starting from top center, going clockwise
    // Using two arcs instead of one ensures a proper closed path
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(width, height) / 2;
    // Start at top, arc to bottom, then arc back to top and close
    return `M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r} A ${r} ${r} 0 0 1 ${cx} ${cy - r} Z`;
  }
  // For rectangle with border radius
  // Start from top center and go clockwise to match conic-gradient
  const r = Math.min(parseFloat(borderRadius) || 12, Math.min(width, height) / 2);
  const midX = width / 2;
  return `M ${midX} 0
          L ${width - r} 0
          Q ${width} 0 ${width} ${r}
          L ${width} ${height - r}
          Q ${width} ${height} ${width - r} ${height}
          L ${r} ${height}
          Q 0 ${height} 0 ${height - r}
          L 0 ${r}
          Q 0 0 ${r} 0
          Z`;
}

// Generate a wavy version of a path by adding sinusoidal offsets
function getWavyPath(shape, width, height, borderRadius, amplitude = 3, frequency = 20) {
  if (shape === 'circle') {
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(width, height) / 2;
    const circumference = 2 * Math.PI * r;
    const segments = Math.max(60, Math.floor(circumference / 4));

    let path = '';
    for (let i = 0; i < segments; i++) {
      // Start from top center (-90 degrees / -PI/2)
      const angle = -Math.PI / 2 + (i / segments) * 2 * Math.PI;
      const wave = Math.sin((i / segments) * frequency * Math.PI) * amplitude;
      const currentR = r + wave;
      const x = cx + Math.cos(angle) * currentR;
      const y = cy + Math.sin(angle) * currentR;

      if (i === 0) {
        path = `M ${x} ${y}`;
      } else {
        path += ` L ${x} ${y}`;
      }
    }
    // Close path to connect end to start
    path += ' Z';
    return path;
  }

  // For rectangle, trace the perimeter with wavy deformations
  const r = Math.min(parseFloat(borderRadius) || 12, Math.min(width, height) / 2);
  const perimeter = 2 * (width + height - 4 * r) + 2 * Math.PI * r;
  const segments = Math.max(80, Math.floor(perimeter / 3));

  // Calculate total distances for each segment of the rectangle
  const topLength = width - 2 * r;
  const rightLength = height - 2 * r;
  const bottomLength = width - 2 * r;
  const leftLength = height - 2 * r;
  const cornerArc = Math.PI * r / 2;

  const points = [];
  const midX = width / 2;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const waveOffset = Math.sin(t * frequency * Math.PI) * amplitude;

    // Determine position along perimeter starting from top center
    let totalDist = t * perimeter;
    let x, y, nx, ny; // position and normal vector

    // Start from top center, go right
    const halfTop = topLength / 2;

    if (totalDist < halfTop) {
      // Top edge (right half, from center to corner)
      x = midX + totalDist;
      y = 0;
      nx = 0; ny = -1;
    } else if (totalDist < halfTop + cornerArc) {
      // Top-right corner
      const arcDist = totalDist - halfTop;
      const angle = -Math.PI / 2 + (arcDist / cornerArc) * (Math.PI / 2);
      x = width - r + Math.cos(angle) * r;
      y = r + Math.sin(angle) * r;
      nx = Math.cos(angle); ny = Math.sin(angle);
    } else if (totalDist < halfTop + cornerArc + rightLength) {
      // Right edge
      const edgeDist = totalDist - halfTop - cornerArc;
      x = width;
      y = r + edgeDist;
      nx = 1; ny = 0;
    } else if (totalDist < halfTop + 2 * cornerArc + rightLength) {
      // Bottom-right corner
      const arcDist = totalDist - halfTop - cornerArc - rightLength;
      const angle = 0 + (arcDist / cornerArc) * (Math.PI / 2);
      x = width - r + Math.cos(angle) * r;
      y = height - r + Math.sin(angle) * r;
      nx = Math.cos(angle); ny = Math.sin(angle);
    } else if (totalDist < halfTop + 2 * cornerArc + rightLength + bottomLength) {
      // Bottom edge
      const edgeDist = totalDist - halfTop - 2 * cornerArc - rightLength;
      x = width - r - edgeDist;
      y = height;
      nx = 0; ny = 1;
    } else if (totalDist < halfTop + 3 * cornerArc + rightLength + bottomLength) {
      // Bottom-left corner
      const arcDist = totalDist - halfTop - 2 * cornerArc - rightLength - bottomLength;
      const angle = Math.PI / 2 + (arcDist / cornerArc) * (Math.PI / 2);
      x = r + Math.cos(angle) * r;
      y = height - r + Math.sin(angle) * r;
      nx = Math.cos(angle); ny = Math.sin(angle);
    } else if (totalDist < halfTop + 3 * cornerArc + rightLength + bottomLength + leftLength) {
      // Left edge
      const edgeDist = totalDist - halfTop - 3 * cornerArc - rightLength - bottomLength;
      x = 0;
      y = height - r - edgeDist;
      nx = -1; ny = 0;
    } else if (totalDist < halfTop + 4 * cornerArc + rightLength + bottomLength + leftLength) {
      // Top-left corner
      const arcDist = totalDist - halfTop - 3 * cornerArc - rightLength - bottomLength - leftLength;
      const angle = Math.PI + (arcDist / cornerArc) * (Math.PI / 2);
      x = r + Math.cos(angle) * r;
      y = r + Math.sin(angle) * r;
      nx = Math.cos(angle); ny = Math.sin(angle);
    } else {
      // Top edge (left half, from corner back to center)
      const edgeDist = totalDist - halfTop - 4 * cornerArc - rightLength - bottomLength - leftLength;
      x = r + edgeDist;
      y = 0;
      nx = 0; ny = -1;
    }

    // Apply wave offset along normal
    points.push({
      x: x + nx * waveOffset,
      y: y + ny * waveOffset,
    });
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    path += ` L ${points[i].x} ${points[i].y}`;
  }
  // Close path to connect end to start
  path += ' Z';
  return path;
}

// Generate a scribble/hand-drawn path with random wobble
function getScribblePath(shape, width, height, borderRadius, seed = 42) {
  const amplitude = 2;
  const segments = shape === 'circle' ? 80 : 100;

  if (shape === 'circle') {
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(width, height) / 2;

    let path = '';
    for (let i = 0; i < segments; i++) {
      const angle = -Math.PI / 2 + (i / segments) * 2 * Math.PI;
      // Use seeded random for consistent wobble
      const wobble = (seededRandom(seed + i * 7) - 0.5) * amplitude * 2;
      const currentR = r + wobble;
      const x = cx + Math.cos(angle) * currentR;
      const y = cy + Math.sin(angle) * currentR;

      if (i === 0) {
        path = `M ${x} ${y}`;
      } else {
        path += ` L ${x} ${y}`;
      }
    }
    // Close path to connect end to start
    path += ' Z';
    return path;
  }

  // For rectangle, similar to wavy but with random offsets
  const r = Math.min(parseFloat(borderRadius) || 12, Math.min(width, height) / 2);
  const perimeter = 2 * (width + height - 4 * r) + 2 * Math.PI * r;

  const topLength = width - 2 * r;
  const rightLength = height - 2 * r;
  const bottomLength = width - 2 * r;
  const leftLength = height - 2 * r;
  const cornerArc = Math.PI * r / 2;

  const points = [];
  const midX = width / 2;
  const halfTop = topLength / 2;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const wobble = (seededRandom(seed + i * 13) - 0.5) * amplitude * 2;

    let totalDist = t * perimeter;
    let x, y, nx, ny;

    if (totalDist < halfTop) {
      x = midX + totalDist;
      y = 0;
      nx = 0; ny = -1;
    } else if (totalDist < halfTop + cornerArc) {
      const arcDist = totalDist - halfTop;
      const angle = -Math.PI / 2 + (arcDist / cornerArc) * (Math.PI / 2);
      x = width - r + Math.cos(angle) * r;
      y = r + Math.sin(angle) * r;
      nx = Math.cos(angle); ny = Math.sin(angle);
    } else if (totalDist < halfTop + cornerArc + rightLength) {
      const edgeDist = totalDist - halfTop - cornerArc;
      x = width;
      y = r + edgeDist;
      nx = 1; ny = 0;
    } else if (totalDist < halfTop + 2 * cornerArc + rightLength) {
      const arcDist = totalDist - halfTop - cornerArc - rightLength;
      const angle = 0 + (arcDist / cornerArc) * (Math.PI / 2);
      x = width - r + Math.cos(angle) * r;
      y = height - r + Math.sin(angle) * r;
      nx = Math.cos(angle); ny = Math.sin(angle);
    } else if (totalDist < halfTop + 2 * cornerArc + rightLength + bottomLength) {
      const edgeDist = totalDist - halfTop - 2 * cornerArc - rightLength;
      x = width - r - edgeDist;
      y = height;
      nx = 0; ny = 1;
    } else if (totalDist < halfTop + 3 * cornerArc + rightLength + bottomLength) {
      const arcDist = totalDist - halfTop - 2 * cornerArc - rightLength - bottomLength;
      const angle = Math.PI / 2 + (arcDist / cornerArc) * (Math.PI / 2);
      x = r + Math.cos(angle) * r;
      y = height - r + Math.sin(angle) * r;
      nx = Math.cos(angle); ny = Math.sin(angle);
    } else if (totalDist < halfTop + 3 * cornerArc + rightLength + bottomLength + leftLength) {
      const edgeDist = totalDist - halfTop - 3 * cornerArc - rightLength - bottomLength;
      x = 0;
      y = height - r - edgeDist;
      nx = -1; ny = 0;
    } else if (totalDist < halfTop + 4 * cornerArc + rightLength + bottomLength + leftLength) {
      const arcDist = totalDist - halfTop - 3 * cornerArc - rightLength - bottomLength - leftLength;
      const angle = Math.PI + (arcDist / cornerArc) * (Math.PI / 2);
      x = r + Math.cos(angle) * r;
      y = r + Math.sin(angle) * r;
      nx = Math.cos(angle); ny = Math.sin(angle);
    } else {
      const edgeDist = totalDist - halfTop - 4 * cornerArc - rightLength - bottomLength - leftLength;
      x = r + edgeDist;
      y = 0;
      nx = 0; ny = -1;
    }

    points.push({
      x: x + nx * wobble,
      y: y + ny * wobble,
    });
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    path += ` L ${points[i].x} ${points[i].y}`;
  }
  // Close path to connect end to start
  path += ' Z';
  return path;
}

// Get the appropriate path for the line style
function getStyledBorderPath(lineStyle, shape, width, height, borderRadius) {
  switch (lineStyle) {
    case 'wavy':
      return getWavyPath(shape, width, height, borderRadius, 3, 24);
    case 'scribble':
      return getScribblePath(shape, width, height, borderRadius);
    default:
      return getBorderPath(shape, width, height, borderRadius);
  }
}

// Calculate border position from angle (0-360 degrees, 0=top center, clockwise)
// This matches the conic-gradient coordinate system
function getPositionFromAngle(angleDeg, shape, width, height, borderRadius) {
  const cx = width / 2;
  const cy = height / 2;
  // Normalize angle to 0-360
  const normAngle = ((angleDeg % 360) + 360) % 360;
  const angleRad = (normAngle * Math.PI) / 180;

  if (shape === 'circle') {
    // For circle, straightforward: position on the circumference
    const r = Math.min(width, height) / 2;
    // Angle 0 is at top (negative Y direction), rotating clockwise
    return {
      x: cx + r * Math.sin(angleRad),
      y: cy - r * Math.cos(angleRad),
    };
  }

  // For rectangle, find where a ray from center at given angle
  // intersects the rounded rectangle border
  const r = Math.min(parseFloat(borderRadius) || 12, Math.min(width, height) / 2);

  // Calculate intersection with rectangle edges
  // Angle 0 = top center, 90 = right center, 180 = bottom center, 270 = left center
  const sinA = Math.sin(angleRad);
  const cosA = Math.cos(angleRad);

  // Calculate diagonal angles to corners (from top, going clockwise)
  // Top-right corner
  const diagTR = Math.atan2(width / 2, height / 2) * 180 / Math.PI;
  // Bottom-right corner
  const diagBR = 180 - diagTR;
  // Bottom-left corner
  const diagBL = 180 + diagTR;
  // Top-left corner
  const diagTL = 360 - diagTR;

  let x, y;

  // Determine which edge the angle intersects based on diagonal angles
  if (normAngle <= diagTR || normAngle > diagTL) {
    // Top edge
    // Ray equation: x = cx + t*sinA, y = cy - t*cosA
    // Intersect with y = 0: cy - t*cosA = 0 => t = cy/cosA
    const t = cy / cosA;
    x = cx + t * sinA;
    y = 0;
    // Check if we're in the corner region
    if (x > width - r) {
      return getCornerPosition(width - r, r, r, normAngle);
    } else if (x < r) {
      return getCornerPosition(r, r, r, normAngle);
    }
  } else if (normAngle > diagTR && normAngle <= diagBR) {
    // Right edge
    // Intersect with x = width: cx + t*sinA = width => t = (width-cx)/sinA
    const t = (width - cx) / sinA;
    x = width;
    y = cy - t * cosA;
    // Check corners
    if (y < r) {
      return getCornerPosition(width - r, r, r, normAngle);
    } else if (y > height - r) {
      return getCornerPosition(width - r, height - r, r, normAngle);
    }
  } else if (normAngle > diagBR && normAngle <= diagBL) {
    // Bottom edge
    // Intersect with y = height: cy - t*cosA = height => t = (cy-height)/cosA = -t
    const t = (cy - height) / cosA;
    x = cx + t * sinA;
    y = height;
    // Check corners
    if (x < r) {
      return getCornerPosition(r, height - r, r, normAngle);
    } else if (x > width - r) {
      return getCornerPosition(width - r, height - r, r, normAngle);
    }
  } else {
    // Left edge (normAngle > diagBL && normAngle <= diagTL)
    // Intersect with x = 0: cx + t*sinA = 0 => t = -cx/sinA
    const t = -cx / sinA;
    x = 0;
    y = cy - t * cosA;
    // Check corners
    if (y > height - r) {
      return getCornerPosition(r, height - r, r, normAngle);
    } else if (y < r) {
      return getCornerPosition(r, r, r, normAngle);
    }
  }

  return { x, y };
}

// Get position on a corner arc given the corner center, radius, and angle
function getCornerPosition(cornerX, cornerY, radius, angleDeg) {
  const angleRad = (angleDeg * Math.PI) / 180;
  // Our coordinate system: angle 0 = up (negative Y), angles increase clockwise
  // x = cx + r*sin(angle), y = cy - r*cos(angle)
  return {
    x: cornerX + radius * Math.sin(angleRad),
    y: cornerY - radius * Math.cos(angleRad),
  };
}

function generateBorderParticles(effect, rgb, effectIntensity, duration, shape, particleFollowDistance = 0) {
  if (effect === 'none' || !PARTICLE_EFFECTS.includes(effect)) {
    return [];
  }

  const [r, g, b] = rgb;
  const particles = [];

  const {
    particleCount,
    particleSizeMultiplier: sizeMult,
    particleOpacityMultiplier: opacityMult,
    particleBlurMultiplier: blurMult,
  } = effectIntensity;

  // Base spread ensures particles are always dispersed along the path
  // This creates visible spacing between individual particles
  const baseSpread = 0.08; // 8% of the path as minimum spread

  // particleFollowDistance adds additional trail distance behind the pulse head
  // 0 = particles at head with base spread, higher values = particles trail further behind
  const additionalTrailDistance = 0.15 * particleFollowDistance;
  const totalTrailDistance = baseSpread + additionalTrailDistance;

  // Particles follow the pulse head with slight offsets
  for (let i = 0; i < particleCount; i++) {
    const seed = i * 137.5;
    const random1 = seededRandom(seed);
    const random2 = seededRandom(seed + 1);
    const random3 = seededRandom(seed + 2);
    const random4 = seededRandom(seed + 3);

    // Each particle trails behind the pulse head by a different amount
    // Negative offset means trailing behind
    // Distribute particles evenly along the trail distance
    const trailOffset = -(i / particleCount) * totalTrailDistance;

    let particle = {
      id: i,
      trailOffset,
      style: {},
      burstStyle: null,
    };

    switch (effect) {
      case 'sparkler': {
        const size = Math.round((3 + random1 * 3) * sizeMult);
        const blur1 = Math.round(4 * blurMult);
        const blur2 = Math.round(8 * blurMult);
        // Sparkler bursts outward from the path
        const burstAngle = (random2 - 0.5) * 180; // Random angle perpendicular-ish
        const burstDistance = (15 + random3 * 25) * sizeMult;
        const tx = Math.cos((burstAngle * Math.PI) / 180) * burstDistance;
        const ty = Math.sin((burstAngle * Math.PI) / 180) * burstDistance;
        particle.style = {
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '50%',
          backgroundColor: `rgba(${r}, ${g}, ${b}, ${0.9 * opacityMult})`,
          boxShadow: `0 0 ${blur1}px rgba(${r}, ${g}, ${b}, ${0.8 * opacityMult}), 0 0 ${blur2}px rgba(${r}, ${g}, ${b}, ${0.5 * opacityMult})`,
          '--tx': `${tx}px`,
          '--ty': `${ty}px`,
        };
        particle.burstAnimation = `sparklerBurst ${0.4 + random4 * 0.3}s ease-out infinite`;
        particle.burstDelay = `${random1 * 0.5}s`;
        break;
      }
      case 'comet': {
        const trailWidth = Math.round((6 + random1 * 6) * sizeMult);
        particle.style = {
          width: `${trailWidth}px`,
          height: `${Math.max(2, Math.round(2 * sizeMult))}px`,
          borderRadius: '2px',
          background: `linear-gradient(90deg, rgba(${r}, ${g}, ${b}, ${0.9 * opacityMult}), rgba(${r}, ${g}, ${b}, 0))`,
          transformOrigin: 'right center',
        };
        // Comet trails just follow along the path (uses 1.67x total trail for longer effect)
        particle.trailOffset = -(i / particleCount) * totalTrailDistance * 1.67;
        break;
      }
      case 'stardust': {
        const starSize = Math.round((2 + random1 * 3) * sizeMult);
        const blur = Math.round(3 * blurMult);
        const driftX = Math.round((random4 - 0.5) * 20 * sizeMult);
        const driftY = Math.round((random1 - 0.5) * 20 * sizeMult);
        particle.style = {
          width: `${starSize}px`,
          height: `${starSize}px`,
          borderRadius: '50%',
          backgroundColor: `rgba(${r}, ${g}, ${b}, ${0.7 * opacityMult})`,
          boxShadow: `0 0 ${blur}px rgba(${r}, ${g}, ${b}, ${0.6 * opacityMult})`,
          '--drift-x': `${driftX}px`,
          '--drift-y': `${driftY}px`,
        };
        particle.burstAnimation = `stardustFloat ${1.5 + random2 * 1}s ease-in-out infinite, stardustTwinkle ${0.8 + random3 * 0.5}s ease-in-out infinite`;
        particle.burstDelay = `${random4 * 0.3}s, ${random1 * 0.2}s`;
        break;
      }
      case 'ember': {
        const emberSize = Math.round((3 + random1 * 3) * sizeMult);
        const blur = Math.round(6 * blurMult);
        const riseDistance = Math.round((-25 - random4 * 25) * sizeMult);
        particle.style = {
          width: `${emberSize}px`,
          height: `${emberSize}px`,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(${Math.min(255, r + 50)}, ${Math.max(0, g - 30)}, ${Math.max(0, b - 50)}, ${0.9 * opacityMult}), rgba(${r}, ${g}, ${b}, ${0.6 * opacityMult}))`,
          boxShadow: `0 0 ${blur}px rgba(${r}, ${Math.max(0, g - 30)}, ${Math.max(0, b - 50)}, ${0.8 * opacityMult})`,
          '--rise-distance': `${riseDistance}px`,
        };
        particle.burstAnimation = `emberRise ${1.2 + random1 * 0.8}s ease-out infinite, emberGlow ${0.4 + random2 * 0.3}s ease-in-out infinite`;
        particle.burstDelay = `${random3 * 0.3}s, ${random4 * 0.2}s`;
        break;
      }
      case 'electric': {
        const boltWidth = Math.round((8 + random1 * 10) * sizeMult);
        const blur1 = Math.round(4 * blurMult);
        const blur2 = Math.round(8 * blurMult);
        const isOutward = i % 2 === 0;
        particle.style = {
          width: `${boltWidth}px`,
          height: `${Math.max(2, Math.round(2 * sizeMult))}px`,
          background: `linear-gradient(${isOutward ? '0deg' : '180deg'}, rgba(${r}, ${g}, ${b}, ${0.9 * opacityMult}), rgba(${Math.min(255, r + 100)}, ${Math.min(255, g + 100)}, ${Math.min(255, b + 100)}, ${0.3 * opacityMult}))`,
          boxShadow: `0 0 ${blur1}px rgba(${r}, ${g}, ${b}, ${0.8 * opacityMult}), 0 0 ${blur2}px rgba(${r}, ${g}, ${b}, ${0.4 * opacityMult})`,
          transformOrigin: 'center bottom',
        };
        particle.burstAnimation = `electricCrackle ${0.12 + random3 * 0.08}s linear infinite`;
        particle.burstDelay = `${random4 * 0.5}s`;
        break;
      }
      case 'bubble': {
        const bubbleSize = Math.round((5 + random1 * 6) * sizeMult);
        const floatDistance = Math.round((-35 - random3 * 35) * sizeMult);
        particle.style = {
          width: `${bubbleSize}px`,
          height: `${bubbleSize}px`,
          borderRadius: '50%',
          background: `radial-gradient(circle at 30% 30%, rgba(${Math.min(255, r + 80)}, ${Math.min(255, g + 80)}, ${Math.min(255, b + 80)}, ${0.4 * opacityMult}), rgba(${r}, ${g}, ${b}, ${0.2 * opacityMult}))`,
          border: `1px solid rgba(${r}, ${g}, ${b}, ${0.4 * opacityMult})`,
          '--float-distance': `${floatDistance}px`,
        };
        particle.burstAnimation = `bubbleFloat ${1.8 + random1 * 1}s ease-out infinite, bubbleWobble ${0.6 + random4 * 0.3}s ease-in-out infinite`;
        particle.burstDelay = `${random2 * 0.3}s, ${random3 * 0.2}s`;
        break;
      }
      default:
        break;
    }

    particles.push(particle);
  }

  return particles;
}

// SVG-based border component for non-solid line styles
function SvgBorder({ path, rgb, duration, active, lineStyle, effectIntensity, width, height, headShape, headSize }) {
  const [r, g, b] = rgb;
  const strokeStyle = getStrokeStyle(lineStyle, 2, headShape, headSize);
  const { glowBlur, glowOpacity } = effectIntensity;
  const pathRef = useRef(null);
  const [pathLength, setPathLength] = useState(null);

  // Measure actual path length for accurate animation
  // getTotalLength() may not be available in test environments (jsdom)
  useEffect(() => {
    if (pathRef.current && typeof pathRef.current.getTotalLength === 'function') {
      const actualLength = pathRef.current.getTotalLength();
      setPathLength(actualLength);
    }
  }, [path]);

  // Fallback to estimate until we measure the actual path
  const estimatedPathLength = 2 * (width + height) * 1.1;
  const actualPathLength = pathLength || estimatedPathLength;

  // Trail length as percentage of path (25% visible trail)
  const trailLength = actualPathLength * 0.25;
  const gapLength = actualPathLength * 0.75;

  // Base filter for the shape
  const getBaseFilter = () => {
    if (headShape === 'soft') {
      // Soft shape adds significant blur and expanded glow for dreamy effect
      return `blur(3px) drop-shadow(0 0 ${glowBlur * 3}px rgba(${r}, ${g}, ${b}, ${glowOpacity * 1.5}))`;
    }
    return `drop-shadow(0 0 ${glowBlur}px rgba(${r}, ${g}, ${b}, ${glowOpacity}))`;
  };

  const baseStrokeProps = {
    fill: 'none',
    strokeLinecap: strokeStyle.strokeLinecap,
  };

  // Trail animation dash array
  const dashArray = `${trailLength} ${gapLength}`;

  const renderPath = (offset = 0, opacity = 1, extraFilter = '', useRef = false) => {
    const strokeWidth = strokeStyle.strokeWidth + offset;
    const style = {
      '--path-length': `${actualPathLength}px`,
      animation: `strokeTrace ${duration}s linear infinite`,
      animationPlayState: active ? 'running' : 'paused',
      filter: extraFilter || getBaseFilter(),
    };

    return (
      <path
        ref={useRef ? pathRef : undefined}
        d={path}
        {...baseStrokeProps}
        stroke={`rgb(${r}, ${g}, ${b})`}
        strokeWidth={strokeWidth}
        strokeDasharray={dashArray}
        strokeOpacity={opacity}
        style={style}
      />
    );
  };

  // For pointed shape, render an additional tapered overlay at the head
  const renderPointedHead = () => {
    if (headShape !== 'pointed') return null;
    // Create multiple layered strokes to simulate an arrow/pointed effect
    // Each layer is progressively shorter and narrower to create a taper
    const layers = [];
    const baseWidth = strokeStyle.strokeWidth;
    const sizeMultiplier = strokeStyle.headSize || 1;

    for (let i = 0; i < 4; i++) {
      const fraction = 1 - (i / 4);
      const layerLength = trailLength * 0.08 * fraction * sizeMultiplier;
      const layerWidth = baseWidth * (2.5 - i * 0.5) * sizeMultiplier;
      const layerGap = gapLength + trailLength - layerLength;
      const layerDashArray = `${layerLength} ${layerGap}`;
      const layerOpacity = 0.4 + (i * 0.15);

      layers.push(
        <path
          key={`pointed-layer-${i}`}
          d={path}
          fill="none"
          strokeLinecap="round"
          stroke={`rgb(${r}, ${g}, ${b})`}
          strokeWidth={layerWidth}
          strokeDasharray={layerDashArray}
          strokeOpacity={layerOpacity}
          style={{
            '--path-length': `${actualPathLength}px`,
            animation: `strokeTrace ${duration}s linear infinite`,
            animationPlayState: active ? 'running' : 'paused',
            filter: `drop-shadow(0 0 ${glowBlur * 2}px rgba(${r}, ${g}, ${b}, ${glowOpacity}))`,
          }}
        />
      );
    }

    // Add a bright tip at the very front
    const tipLength = trailLength * 0.02 * sizeMultiplier;
    const tipGap = gapLength + trailLength - tipLength;
    layers.push(
      <path
        key="pointed-tip"
        d={path}
        fill="none"
        strokeLinecap="round"
        stroke="#ffffff"
        strokeWidth={baseWidth * 0.8 * sizeMultiplier}
        strokeDasharray={`${tipLength} ${tipGap}`}
        strokeOpacity={0.9}
        style={{
          '--path-length': `${actualPathLength}px`,
          animation: `strokeTrace ${duration}s linear infinite`,
          animationPlayState: active ? 'running' : 'paused',
          filter: `drop-shadow(0 0 ${glowBlur}px rgba(255, 255, 255, 0.8))`,
        }}
      />
    );

    return <>{layers}</>;
  };

  // For flat shape, render a sharp bright edge at the head
  const renderFlatHead = () => {
    if (headShape !== 'flat') return null;
    const sizeMultiplier = strokeStyle.headSize || 1;
    // Create a sharp, bright edge at the front to emphasize the flat termination
    const edgeLength = trailLength * 0.015 * sizeMultiplier;
    const edgeGap = gapLength + trailLength - edgeLength;
    const edgeDashArray = `${edgeLength} ${edgeGap}`;

    return (
      <path
        d={path}
        fill="none"
        strokeLinecap="butt"
        stroke="#ffffff"
        strokeWidth={strokeStyle.strokeWidth * 1.8 * sizeMultiplier}
        strokeDasharray={edgeDashArray}
        strokeOpacity={0.95}
        style={{
          '--path-length': `${actualPathLength}px`,
          animation: `strokeTrace ${duration}s linear infinite`,
          animationPlayState: active ? 'running' : 'paused',
          filter: `drop-shadow(0 0 ${glowBlur * 0.5}px rgba(255, 255, 255, 0.9))`,
        }}
      />
    );
  };

  // For soft shape, render an additional diffuse glow at the head
  const renderSoftHead = () => {
    if (headShape !== 'soft') return null;
    const sizeMultiplier = strokeStyle.headSize || 1;
    // Create a prominent diffuse glow at the head for a dreamy effect
    const glowLength = trailLength * 0.3 * sizeMultiplier;
    const glowGap = gapLength + trailLength - glowLength;
    const glowDashArray = `${glowLength} ${glowGap}`;

    return (
      <path
        d={path}
        fill="none"
        strokeLinecap="round"
        stroke={`rgb(${r}, ${g}, ${b})`}
        strokeWidth={strokeStyle.strokeWidth * 4 * sizeMultiplier}
        strokeDasharray={glowDashArray}
        strokeOpacity={0.25}
        style={{
          '--path-length': `${actualPathLength}px`,
          animation: `strokeTrace ${duration}s linear infinite`,
          animationPlayState: active ? 'running' : 'paused',
          filter: `blur(8px) drop-shadow(0 0 ${glowBlur * 4}px rgba(${r}, ${g}, ${b}, 0.8))`,
        }}
      />
    );
  };

  // Handle special line styles
  if (strokeStyle.isDouble) {
    // Render two parallel strokes
    const spacing = strokeStyle.spacing;
    return (
      <svg
        style={{
          position: 'absolute',
          inset: `-${spacing}px`,
          width: `calc(100% + ${spacing * 2}px)`,
          height: `calc(100% + ${spacing * 2}px)`,
          pointerEvents: 'none',
          overflow: 'visible',
        }}
        viewBox={`${-spacing} ${-spacing} ${width + spacing * 2} ${height + spacing * 2}`}
      >
        {renderSoftHead()}
        {/* Outer stroke */}
        {renderPath(spacing, 0.8, '', true)}
        {/* Inner stroke */}
        {renderPath(-spacing * 0.5, 1)}
        {renderPointedHead()}
        {renderFlatHead()}
      </svg>
    );
  }

  if (strokeStyle.isGlow) {
    // Render with extra glow layers
    return (
      <svg
        style={{
          position: 'absolute',
          inset: '-4px',
          width: 'calc(100% + 8px)',
          height: 'calc(100% + 8px)',
          pointerEvents: 'none',
          overflow: 'visible',
        }}
        viewBox={`-4 -4 ${width + 8} ${height + 8}`}
      >
        {renderSoftHead()}
        {/* Outer glow */}
        {renderPath(6, 0.2, `blur(6px)`, true)}
        {/* Middle glow */}
        {renderPath(3, 0.4, `blur(3px)`)}
        {/* Core stroke */}
        {renderPath(0, 1, `drop-shadow(0 0 ${glowBlur * 2}px rgba(${r}, ${g}, ${b}, ${glowOpacity}))`)}
        {renderPointedHead()}
        {renderFlatHead()}
      </svg>
    );
  }

  if (strokeStyle.isTapered) {
    // Tapered effect: render multiple paths with varying widths
    // Simulate tapering by overlaying strokes
    const segments = 5;
    const paths = [];
    for (let i = 0; i < segments; i++) {
      const t = i / (segments - 1);
      // Width tapers from thick to thin
      const segWidth = strokeStyle.strokeWidth * (2 - t * 1.5);
      const segOpacity = 1 - t * 0.3;
      // Each segment is offset in the animation
      const segDelay = (t * 0.2 * duration);
      paths.push(
        <path
          key={i}
          ref={i === 0 ? pathRef : undefined}
          d={path}
          {...baseStrokeProps}
          stroke={`rgb(${r}, ${g}, ${b})`}
          strokeWidth={segWidth}
          strokeDasharray={`${trailLength / segments} ${gapLength + trailLength * (segments - 1) / segments}`}
          strokeOpacity={segOpacity}
          style={{
            '--path-length': `${actualPathLength}px`,
            animation: `strokeTrace ${duration}s linear infinite`,
            animationDelay: `-${segDelay}s`,
            animationPlayState: active ? 'running' : 'paused',
            filter: `drop-shadow(0 0 ${glowBlur}px rgba(${r}, ${g}, ${b}, ${glowOpacity}))`,
          }}
        />
      );
    }
    return (
      <svg
        style={{
          position: 'absolute',
          inset: '-4px',
          width: 'calc(100% + 8px)',
          height: 'calc(100% + 8px)',
          pointerEvents: 'none',
          overflow: 'visible',
        }}
        viewBox={`-4 -4 ${width + 8} ${height + 8}`}
      >
        {renderSoftHead()}
        {paths}
        {renderPointedHead()}
        {renderFlatHead()}
      </svg>
    );
  }

  // Default rendering for solid, wavy, scribble
  return (
    <svg
      style={{
        position: 'absolute',
        inset: '-4px',
        width: 'calc(100% + 8px)',
        height: 'calc(100% + 8px)',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      viewBox={`-4 -4 ${width + 8} ${height + 8}`}
    >
      {renderSoftHead()}
      {renderPath(0, 1, '', true)}
      {renderPointedHead()}
      {renderFlatHead()}
    </svg>
  );
}

// Particle system that follows the pulse head using JS animation
// Uses absolute time (performance.now()) to stay in sync with CSS animations
function BorderParticles({ particles, active, duration, shape, width, height, borderRadius }) {
  const containerRef = useRef(null);
  const animationRef = useRef(null);
  // Store the time offset when animation was paused, to resume correctly
  const pauseOffsetRef = useRef(0);
  const pausedAtRef = useRef(null);

  const updateParticlePositions = useCallback((timestamp) => {
    if (!containerRef.current) return;

    // Use absolute time (timestamp from performance.now()) with pause offset adjustment
    // This keeps JS animation in sync with CSS animations that also use performance.now()
    const adjustedTime = timestamp - pauseOffsetRef.current;
    const elapsed = adjustedTime / 1000; // Convert to seconds
    const progress = (elapsed % duration) / duration; // 0 to 1 progress through animation cycle
    const headAngle = progress * 360; // Current angle of pulse head

    const particleElements = containerRef.current.children;
    for (let i = 0; i < particles.length && i < particleElements.length; i++) {
      const particle = particles[i];
      // Particle angle trails behind head by trailOffset (negative value)
      const particleAngle = headAngle + particle.trailOffset * 360;
      const pos = getPositionFromAngle(particleAngle, shape, width, height, borderRadius);

      // Center the particle on its position
      const particleEl = particleElements[i];
      particleEl.style.left = `${pos.x}px`;
      particleEl.style.top = `${pos.y}px`;
    }

    animationRef.current = requestAnimationFrame(updateParticlePositions);
  }, [duration, shape, width, height, borderRadius, particles]);

  useEffect(() => {
    if (active) {
      // Resume animation - adjust offset to account for paused time
      if (pausedAtRef.current !== null) {
        pauseOffsetRef.current += performance.now() - pausedAtRef.current;
        pausedAtRef.current = null;
      }
      animationRef.current = requestAnimationFrame(updateParticlePositions);
    } else {
      // Pause - record when we paused
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      pausedAtRef.current = performance.now();
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [active, updateParticlePositions]);

  if (particles.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {particles.map((particle) => (
        <div
          key={particle.id}
          style={{
            position: 'absolute',
            transform: 'translate(-50%, -50%)', // Center on position
          }}
        >
          <div
            style={{
              ...particle.style,
              animation: particle.burstAnimation || 'none',
              animationDelay: particle.burstDelay || '0s',
              animationPlayState: active ? 'running' : 'paused',
            }}
          />
        </div>
      ))}
    </div>
  );
}

function ActivityCard({ children, active = true, color = '#3b82f6', speed = 'normal', particleEffect = 'none', shape = 'rectangle', lineStyle = 'solid', particleFollowDistance = 0, headSize = 1, headShape = 'round' }) {
  const [rgb, setRgb] = useState(DEFAULT_RGB);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    setRgb(parseColor(color));
  }, [color]);

  const [r, g, b] = rgb;
  const duration = getAnimationDuration(speed);
  const effectIntensity = getEffectIntensity(duration, hovered);

  const { glowBlur, glowBlur2, glowOpacity } = effectIntensity;
  const glowColor = `rgba(${r}, ${g}, ${b}, ${glowOpacity})`;

  const shapeStyles = SHAPE_STYLES[shape] || SHAPE_STYLES.rectangle;
  const { borderRadius } = shapeStyles;

  // Get dimensions for path calculation
  const width = parseFloat(shapeStyles.wrapper.width) || 300;
  const height = parseFloat(shapeStyles.wrapper.height) || 180;

  // Get the styled path for SVG-based line styles
  const styledBorderPath = useMemo(() => {
    return getStyledBorderPath(lineStyle, shape, width, height, borderRadius);
  }, [lineStyle, shape, width, height, borderRadius]);

  const particles = useMemo(() => {
    return generateBorderParticles(particleEffect, rgb, effectIntensity, duration, shape, particleFollowDistance);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [particleEffect, rgb, duration, shape, hovered, particleFollowDistance]);

  // Use SVG border for non-solid line styles
  const useSvgBorder = lineStyle !== 'solid';

  const borderStyles = {
    ...baseBorderStyles,
    borderRadius,
    background: createBorderGradient(rgb),
    animation: `borderTrace ${duration}s linear infinite`,
    animationPlayState: active ? 'running' : 'paused',
    filter: `drop-shadow(0 0 ${glowBlur}px ${glowColor}) drop-shadow(0 0 ${glowBlur2}px ${glowColor})`,
    transition: 'filter 0.2s ease-out',
  };

  // Static border that gains contrast on hover
  const staticBorderOpacity = hovered ? 0.4 : 0.2;

  const contentStyles = {
    ...baseContentStyles,
    borderRadius,
    border: `1px solid rgba(${r}, ${g}, ${b}, ${staticBorderOpacity})`,
    transition: 'border-color 0.2s ease-out',
  };

  // Wrapper styles with hover scale effect
  const wrapperStyles = {
    ...shapeStyles.wrapper,
    transform: hovered ? 'scale(1.02)' : 'scale(1)',
    transition: 'transform 0.2s ease-out',
    cursor: 'pointer',
  };

  return (
    <>
      <style>{keyframesStyle}</style>
      <div
        style={wrapperStyles}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {useSvgBorder ? (
          <SvgBorder
            path={styledBorderPath}
            rgb={rgb}
            duration={duration}
            active={active}
            lineStyle={lineStyle}
            effectIntensity={effectIntensity}
            width={width}
            height={height}
            headSize={headSize}
            headShape={headShape}
          />
        ) : (
          <div style={borderStyles} />
        )}
        {particleEffect !== 'none' && (
          <BorderParticles
            particles={particles}
            active={active}
            duration={duration}
            shape={shape}
            width={width}
            height={height}
            borderRadius={borderRadius}
          />
        )}
        <div style={contentStyles}>
          {children}
        </div>
      </div>
    </>
  );
}

export default ActivityCard;
