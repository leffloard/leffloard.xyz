"use client";

import { useEffect, useRef } from "react";

// The hero's moving contour map. WebGL2, one full-screen triangle, a few hundred bytes of shader.
// Skipped entirely for reduced motion, Save-Data, browsers without WebGL2, and where WebGL would be drawn
// by the processor instead of a graphics chip (no usable GPU: a virtual machine, a remote desktop, a blocked
// driver), which would make the whole page stutter; the page is complete without it. Pauses when off-screen
// or in a background tab, and caps itself at ~30 frames per second.

// Renderers that draw on the processor: Chrome's SwiftShader, Mesa's llvmpipe and softpipe, Windows' Basic
// Render Driver.
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

function softwareRendered(gl: WebGL2RenderingContext): boolean {
  // Firefox names the renderer here; Chrome and Safari say "WebKit WebGL" and name it through the debug
  // extension instead (asking Firefox for that extension logs a deprecation warning).
  let renderer = String(gl.getParameter(gl.RENDERER));
  if (/webkit webgl/i.test(renderer)) {
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    if (debug) renderer = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
  }
  return SOFTWARE_RENDERER.test(renderer);
}

const VERTEX = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uPointer;
uniform float uPointerStrength;
uniform vec3 uInk;
uniform vec3 uAccent;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.y;
  float t = uTime * 0.035;
  float height = fbm(uv * 1.35 + vec2(t, -t * 0.6));

  vec2 pointer = uPointer / uResolution.y;
  float d = distance(uv, pointer);
  float bump = exp(-d * d * 22.0) * uPointerStrength;
  height += bump * 0.16;

  float bands = height * 15.0;
  float distanceToLine = abs(fract(bands - 0.5) - 0.5);
  float width = fwidth(bands);
  float line = 1.0 - smoothstep(width * 0.6, width * 1.6, distanceToLine);
  float major = step(3.5, mod(floor(bands + 0.5), 4.0));

  float glow = clamp(bump * 1.6, 0.0, 1.0);
  vec3 color = mix(uInk, uAccent, glow);
  float alpha = line * mix(0.09 + major * 0.08, 0.55, glow);
  fragColor = vec4(color * alpha, alpha);
}`;

// Resolves any CSS color (oklch included) to sRGB through a 1x1 2D canvas.
function cssColor(value: string): [number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return [1, 1, 1];
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r = 255, g = 255, b = 255] = context.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

export function SignalField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Why the field stays off, on the canvas for the tests (the page is the same either way).
    const off = (reason: "reduced-motion" | "save-data" | "no-webgl" | "software" | "shader") => {
      canvas.dataset.off = reason;
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return off("reduced-motion");
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) {
      return off("save-data");
    }

    let stop = () => {};
    const start = () => {
      const gl = canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        failIfMajorPerformanceCaveat: true,
        powerPreference: "low-power",
      });
      if (!gl) return off("no-webgl");
      if (softwareRendered(gl)) {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        return off("software");
      }
      const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
      const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
      const program = gl.createProgram();
      if (!vertex || !fragment || !program) return off("shader");
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return off("shader");
      gl.useProgram(program);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "position");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      const uniform = (name: string) => gl.getUniformLocation(program, name);
      const uResolution = uniform("uResolution");
      const uTime = uniform("uTime");
      const uPointer = uniform("uPointer");
      const uPointerStrength = uniform("uPointerStrength");
      const uInk = uniform("uInk");
      const uAccent = uniform("uAccent");

      const applyColors = () => {
        const styles = getComputedStyle(canvas);
        gl.uniform3fv(uInk, cssColor(styles.getPropertyValue("--color-ink").trim() || "#fff"));
        gl.uniform3fv(uAccent, cssColor(styles.getPropertyValue("--color-accent").trim() || "#4ae9f9"));
      };
      applyColors();
      const scheme = window.matchMedia("(prefers-color-scheme: light)");
      scheme.addEventListener("change", applyColors);

      const resize = () => {
        const scale = Math.min(window.devicePixelRatio || 1, 1.5);
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(uResolution, canvas.width, canvas.height);
      };
      resize();
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);

      // The pointer bump eases towards the pointer and fades out when it leaves.
      const target = { x: canvas.width * 0.7, y: canvas.height * 0.5, strength: 0 };
      const current = { ...target };
      const onPointer = (event: PointerEvent) => {
        const box = canvas.getBoundingClientRect();
        const scale = canvas.width / box.width;
        target.x = (event.clientX - box.left) * scale;
        target.y = (box.bottom - event.clientY) * scale;
        target.strength = event.clientY >= box.top && event.clientY <= box.bottom ? 1 : 0;
      };
      window.addEventListener("pointermove", onPointer, { passive: true });

      let visible = true;
      const intersection = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? false;
        if (visible) schedule();
      });
      intersection.observe(canvas);

      let frame = 0;
      let last = 0;
      const origin = performance.now();
      const draw = (now: number) => {
        frame = 0;
        if (!visible || document.hidden) return;
        schedule();
        if (now - last < 32) return;
        last = now;
        current.x += (target.x - current.x) * 0.08;
        current.y += (target.y - current.y) * 0.08;
        current.strength += (target.strength - current.strength) * 0.05;
        gl.uniform1f(uTime, (now - origin) / 1000);
        gl.uniform2f(uPointer, current.x, current.y);
        gl.uniform1f(uPointerStrength, current.strength);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(draw);
      };
      const onVisibility = () => {
        if (!document.hidden) schedule();
      };
      document.addEventListener("visibilitychange", onVisibility);
      schedule();
      canvas.dataset.ready = "true";

      stop = () => {
        cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        intersection.disconnect();
        window.removeEventListener("pointermove", onPointer);
        document.removeEventListener("visibilitychange", onVisibility);
        scheme.removeEventListener("change", applyColors);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      };
    };

    // Starts once the browser is idle, after the page's own work.
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 200));
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(start);
    return () => {
      cancelIdle(handle);
      stop();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none opacity-0 transition-opacity duration-[1500ms] data-[ready=true]:opacity-100 ${className ?? ""}`}
    />
  );
}
