// WebGL2 Signed Distance Field (SDF) liquid body renderer.
// Draws the carried droplet / morphing card's fill (#120f0c), rim (1px white band
// at d in [-1.5, -0.5] px, alpha 0.10) and soft shadow matching 0 12px 36px 0.45.
// Raw WebGL2, zero dependencies. 0% idle CPU: renders only when frame() is called
// by Mover's single rAF loop.

import { radiiToShader } from "./move-physics";

export interface SwellUniforms {

  ex: number;
  ey: number;
  along: number;
  rise: number;
  k: number;
  horizontal: boolean;
}

export interface LiquidFrame {
  w: number;
  h: number;
  radii: [number, number, number, number]; // [tl, tr, br, bl]
  cx: number;
  cy: number;
  swell?: SwellUniforms;
  work: [number, number, number, number]; // [x, y, w, h] in window-relative logical px
  dpr: number;
}

const VS_SRC = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const FS_SRC = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution; // Canvas physical size (width, height)
uniform float u_dpr;       // Device pixel ratio (capped at 2.0)
uniform vec2 u_center;     // Drop center in window logical coordinates (cx, cy)
uniform vec2 u_size;       // Drop size in logical coordinates (w, h)
uniform vec4 u_radii;      // Corner radii in logical px: vec4(tr, br, tl, bl)
uniform vec4 u_work;       // Work area rect in window logical coords: vec4(x, y, w, h)

// Optional swell and smooth-minimum union (prepared for Stage 3)
uniform int u_has_swell;
uniform vec2 u_swell_center;
uniform vec2 u_swell_size;
uniform float u_swell_k;

// Inigo Quilez 2D round box with 4 corner radii
// r = vec4(br, tr, bl, tl) matching y-down coordinates where p.y > 0 is bottom
float sdRoundBox(vec2 p, vec2 b, vec4 r) {
  r.xy = (p.x > 0.0) ? r.xy : r.zw;
  r.x  = (p.y > 0.0) ? r.x  : r.y;
  vec2 q = abs(p) - b + r.x;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
}

float sdEllipseApprox(vec2 p, vec2 ab) {
  vec2 p_abs = abs(p);
  vec2 k0 = p_abs / ab;
  vec2 k1 = p_abs / (ab * ab);
  float l0 = length(k0);
  float l1 = length(k1);
  if (l1 == 0.0) return 0.0;
  return l0 * (l0 - 1.0) / l1;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

void main() {
  // Window-relative logical coordinates (origin at top-left of window)
  vec2 p = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y) / u_dpr;

  // Scissor to monitor work area: discard pixels outside it
  if (p.x < u_work.x || p.x > u_work.x + u_work.z ||
      p.y < u_work.y || p.y > u_work.y + u_work.w) {
    discard;
  }

  vec2 halfSize = u_size * 0.5;

  // Signed distance of the carried shape
  float dDrop = sdRoundBox(p - u_center, halfSize, u_radii);
  float d = dDrop;

  if (u_has_swell != 0) {
    float dSwell = sdEllipseApprox(p - u_swell_center, u_swell_size);
    d = smin(dDrop, dSwell, u_swell_k);
  }

  // Shadow: offset downwards by (0, 8) logical px (matching 0 12px 36px 0.45)
  vec2 p_shadow = p - vec2(0.0, 8.0);
  float dShadowDrop = sdRoundBox(p_shadow - u_center, halfSize, u_radii);
  float dShadow = dShadowDrop;
  if (u_has_swell != 0) {
    float dShadowSwell = sdEllipseApprox(p_shadow - u_swell_center, u_swell_size);
    dShadow = smin(dShadowDrop, dShadowSwell, u_swell_k);
  }
  float alpha_shadow = 0.45 * (1.0 - smoothstep(0.0, 24.0, dShadow));

  // Coverage of the body with 1px anti-aliasing
  float alpha_body = clamp(0.5 - d, 0.0, 1.0);

  if (alpha_body <= 0.0 && alpha_shadow <= 0.0) {
    discard;
  }

  // Fill color: #120f0c
  vec3 fillColor = vec3(18.0 / 255.0, 15.0 / 255.0, 12.0 / 255.0);

  // Rim: 1px band at d in [-1.5, -0.5] px, white at alpha 0.10
  float in_outer = clamp(0.5 - (d - (-0.5)), 0.0, 1.0);
  float in_inner = clamp(0.5 - ((-1.5) - d), 0.0, 1.0);
  float rim = in_outer * in_inner * 0.10;

  // Composite rim highlight over fill
  vec3 bodyColor = mix(fillColor, vec3(1.0), rim);

  // Composite body over shadow using premultiplied alpha
  float alpha_total = alpha_body + alpha_shadow * (1.0 - alpha_body);
  vec3 rgb_premul = bodyColor * alpha_body;

  fragColor = vec4(rgb_premul, alpha_total);
}
`;

export class Liquid {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private ready = false;

  private locRes: WebGLUniformLocation | null = null;
  private locDpr: WebGLUniformLocation | null = null;
  private locCenter: WebGLUniformLocation | null = null;
  private locSize: WebGLUniformLocation | null = null;
  private locRadii: WebGLUniformLocation | null = null;
  private locWork: WebGLUniformLocation | null = null;
  private locHasSwell: WebGLUniformLocation | null = null;
  private locSwellCenter: WebGLUniformLocation | null = null;
  private locSwellSize: WebGLUniformLocation | null = null;
  private locSwellK: WebGLUniformLocation | null = null;

  onLost?: () => void;
  onRestored?: () => void;

  constructor(private canvas: HTMLCanvasElement) {
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.ready = false;
      this.onLost?.();
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.initGL();
      this.onRestored?.();
    });
    this.initGL();
  }

  isReady(): boolean {
    return this.ready;
  }

  private initGL(): void {
    try {
      const gl = this.canvas.getContext("webgl2", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
      });
      if (!gl) {
        this.ready = false;
        return;
      }
      this.gl = gl;

      const vs = this.compileShader(gl.VERTEX_SHADER, VS_SRC);
      const fs = this.compileShader(gl.FRAGMENT_SHADER, FS_SRC);
      if (!vs || !fs) {
        this.ready = false;
        return;
      }

      const program = gl.createProgram();
      if (!program) {
        this.ready = false;
        return;
      }
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn("Liquid shader link error:", gl.getProgramInfoLog(program));
        this.ready = false;
        return;
      }
      this.program = program;

      this.locRes = gl.getUniformLocation(program, "u_resolution");
      this.locDpr = gl.getUniformLocation(program, "u_dpr");
      this.locCenter = gl.getUniformLocation(program, "u_center");
      this.locSize = gl.getUniformLocation(program, "u_size");
      this.locRadii = gl.getUniformLocation(program, "u_radii");
      this.locWork = gl.getUniformLocation(program, "u_work");
      this.locHasSwell = gl.getUniformLocation(program, "u_has_swell");
      this.locSwellCenter = gl.getUniformLocation(program, "u_swell_center");
      this.locSwellSize = gl.getUniformLocation(program, "u_swell_size");
      this.locSwellK = gl.getUniformLocation(program, "u_swell_k");

      const locPos = gl.getAttribLocation(program, "a_pos");
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      this.vao = vao;

      const posBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
      // Quad covering full clip space [-1, 1]
      const quadVertices = new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1,
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(locPos);
      gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

      this.ready = true;
    } catch (err) {
      console.warn("Liquid WebGL2 init failed:", err);
      this.ready = false;
    }
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;
    const shader = this.gl.createShader(type);
    if (!shader) return null;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.warn("Liquid shader compile error:", this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  frame(u: LiquidFrame): void {
    if (!this.ready || !this.gl || !this.program || !this.vao) return;
    const gl = this.gl;

    const cw = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 480;
    const ch = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 480;
    const width = Math.max(1, Math.round(cw * u.dpr));
    const height = Math.max(1, Math.round(ch * u.dpr));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.uniform2f(this.locRes, width, height);
    gl.uniform1f(this.locDpr, u.dpr);
    gl.uniform2f(this.locCenter, u.cx, u.cy);
    gl.uniform2f(this.locSize, u.w, u.h);
    // Radii: mapped to IQ y-down uniform vec4(br, tr, bl, tl)
    const [rx, ry, rz, rw] = radiiToShader(u.radii);
    gl.uniform4f(this.locRadii, rx, ry, rz, rw);
    gl.uniform4f(this.locWork, u.work[0], u.work[1], u.work[2], u.work[3]);

    if (u.swell && u.swell.along > 0 && u.swell.rise > 0) {
      gl.uniform1i(this.locHasSwell, 1);
      gl.uniform2f(this.locSwellCenter, u.swell.ex, u.swell.ey);
      const sx = u.swell.horizontal ? u.swell.along : u.swell.rise;
      const sy = u.swell.horizontal ? u.swell.rise : u.swell.along;
      gl.uniform2f(this.locSwellSize, sx, sy);
      gl.uniform1f(this.locSwellK, u.swell.k);
    } else {
      gl.uniform1i(this.locHasSwell, 0);
      gl.uniform2f(this.locSwellCenter, 0, 0);
      gl.uniform2f(this.locSwellSize, 1, 1);
      gl.uniform1f(this.locSwellK, 1);
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  clear(): void {
    if (this.ready && this.gl) {
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
    this.canvas.style.display = "none";
  }
}
