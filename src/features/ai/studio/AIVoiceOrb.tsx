import { useEffect, useRef } from 'react';
import type { MentorVoiceState } from '../../../core/voice/mentor-voice';

/**
 * The mentor's visual identity: a holographic orb drawn on a 2D canvas.
 *
 * Deliberately NOT Three.js. A full WebGL scene costs a renderer, a camera, shader compilation and a
 * second animation loop for an orb that is a sphere, three rings and a handful of particles — the
 * canvas version draws the same picture in a few hundred microseconds, works on every mid-range
 * phone, and needs no asset download before the conversation can start.
 *
 * The motion is honest:
 *  · `levelRef` is driven by the platform's real word-boundary events while an utterance plays — it
 *    is a speech pulse, not a sampled waveform, so the orb never claims sound the engine is not making.
 *  · `micLevelRef` is a real analyser reading of the microphone, and only while the recogniser is open.
 *  · reduced motion draws one still frame; a hidden tab draws nothing at all.
 */
export interface AIVoiceOrbProps {
  state: MentorVoiceState;
  levelRef: { current: number };
  micLevelRef: { current: number };
  size?: number;
  label: string;
}

const PARTICLE_COUNT = 14;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const ACCENT: Record<MentorVoiceState, [number, number, number]> = {
  idle: [110, 200, 255],
  ready: [110, 220, 255],
  listening: [80, 240, 230],
  thinking: [160, 140, 255],
  speaking: [120, 200, 255],
  paused: [150, 170, 210],
  completed: [110, 220, 200],
  error: [255, 130, 150],
  unsupported: [150, 170, 210],
  'permission-required': [255, 205, 120],
};

export function AIVoiceOrb({ state, levelRef, micLevelRef, size = 232, label }: AIVoiceOrbProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const element = canvas.current;
    const wrapper = host.current;
    if (!element || !wrapper) return;
    const context = element.getContext('2d');
    if (!context) return;

    const reduced = prefersReducedMotion();
    let frame = 0;
    let running = true;
    let width = size;
    let height = size;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      const rect = wrapper.getBoundingClientRect();
      width = Math.max(160, rect.width || size);
      height = width;
      element.width = Math.round(width * dpr);
      element.height = Math.round(height * dpr);
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const onMove = (event: PointerEvent) => {
      const rect = wrapper.getBoundingClientRect();
      pointer.current = {
        x: ((event.clientX - rect.left) / rect.width - 0.5) * 2,
        y: ((event.clientY - rect.top) / rect.height - 0.5) * 2,
      };
    };
    const onLeave = () => { pointer.current = { x: 0, y: 0 }; };

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(wrapper);

    const draw = (time: number) => {
      if (!running) return;
      const level = state === 'speaking' ? Math.min(1, levelRef.current) : 0;
      const mic = state === 'listening' ? Math.min(1, micLevelRef.current) : 0;
      const energy = Math.max(level, mic * 0.72);
      const [r, g, b] = ACCENT[state] ?? ACCENT.idle;
      const cx = width / 2;
      const cy = height / 2;
      const radius = width * (0.22 + energy * 0.035);

      context.clearRect(0, 0, width, height);

      // Atmospheric glow — the only thing that touches the whole canvas.
      const glow = context.createRadialGradient(cx, cy, radius * 0.2, cx, cy, width * 0.5);
      glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.16 + energy * 0.14})`);
      glow.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, 0.05)`);
      glow.addColorStop(1, 'rgba(3, 8, 22, 0)');
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);

      // Holographic rings, tilted by the pointer for depth.
      const tilt = 0.16 + pointer.current.y * 0.1;
      for (let ring = 0; ring < 3; ring += 1) {
        const spin = reduced ? ring * 0.5 : time * (0.00016 + ring * 0.00007) * (ring % 2 ? -1 : 1);
        const rx = radius * (1.5 + ring * 0.28) + energy * 10;
        const ry = rx * (tilt + ring * 0.04);
        context.save();
        context.translate(cx + pointer.current.x * (6 + ring * 3), cy + pointer.current.y * (5 + ring * 2));
        context.rotate(spin);
        context.beginPath();
        context.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        context.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.2 - ring * 0.045})`;
        context.lineWidth = 1;
        context.stroke();
        // A single travelling node per ring: motion without noise.
        const angle = spin * 3.2 + ring * 1.9;
        context.beginPath();
        context.arc(Math.cos(angle) * rx, Math.sin(angle) * ry, 2.1, 0, Math.PI * 2);
        context.fillStyle = `rgba(${r}, ${g}, ${b}, 0.8)`;
        context.fill();
        context.restore();
      }

      // Ambient particles on elliptical orbits.
      for (let i = 0; i < PARTICLE_COUNT; i += 1) {
        const seed = (i / PARTICLE_COUNT) * Math.PI * 2;
        const orbit = reduced ? seed : seed + time * 0.00012 * (1 + (i % 3) * 0.4);
        const dist = radius * (1.85 + (i % 4) * 0.16);
        const x = cx + Math.cos(orbit) * dist + pointer.current.x * 10;
        const y = cy + Math.sin(orbit) * dist * 0.42 + pointer.current.y * 8;
        const alpha = 0.18 + ((i % 5) / 5) * 0.4 + energy * 0.25;
        context.beginPath();
        context.arc(x, y, i % 3 === 0 ? 1.9 : 1.2, 0, Math.PI * 2);
        context.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(0.9, alpha)})`;
        context.fill();
      }

      // The core: a sphere with a light source, breathing with the real level.
      const breathe = reduced ? 1 : 1 + Math.sin(time * 0.0016) * 0.018;
      const core = context.createRadialGradient(
        cx - radius * 0.32, cy - radius * 0.38, radius * 0.12,
        cx, cy, radius * breathe,
      );
      core.addColorStop(0, `rgba(${Math.min(255, r + 80)}, ${Math.min(255, g + 70)}, 255, 0.96)`);
      core.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, 0.62)`);
      core.addColorStop(1, `rgba(6, 14, 34, 0.92)`);
      context.beginPath();
      context.arc(cx, cy, radius * breathe, 0, Math.PI * 2);
      context.fillStyle = core;
      context.fill();
      context.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.4 + energy * 0.4})`;
      context.lineWidth = 1.2;
      context.stroke();

      // Inner waveform: bars across the sphere, driven by the same level.
      const bars = 22;
      const barWidth = (radius * 1.35) / bars;
      for (let i = 0; i < bars; i += 1) {
        const t = i / (bars - 1);
        const wave = reduced ? 0.24 : 0.24 + Math.abs(Math.sin(time * 0.004 + i * 0.55)) * 0.7;
        const magnitude = energy > 0.02 ? energy * wave : 0.06;
        const barHeight = radius * 0.9 * magnitude;
        const x = cx - (radius * 1.35) / 2 + i * barWidth;
        context.fillStyle = `rgba(${Math.min(255, r + 50)}, ${Math.min(255, g + 40)}, 255, ${0.5 + energy * 0.4})`;
        context.fillRect(x, cy - barHeight / 2, Math.max(1.4, barWidth * 0.42), barHeight);
      }

      if (!reduced && running) frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        window.cancelAnimationFrame(frame);
      } else if (!running) {
        running = true;
        frame = window.requestAnimationFrame(draw);
      }
    };

    wrapper.addEventListener('pointermove', onMove);
    wrapper.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      wrapper.removeEventListener('pointermove', onMove);
      wrapper.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [state, levelRef, micLevelRef, size]);

  return (
    <div className="orb" ref={host} style={{ maxWidth: size }} data-state={state}>
      <canvas ref={canvas} aria-hidden="true" />
      <span className="sr-only" role="img" aria-label={label}>{label}</span>
    </div>
  );
}
