import { useEffect, useRef } from "react";

const vertexSource = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentSource = `
  precision mediump float;
  uniform vec2 resolution;
  uniform float phase;
  uniform float hero;

  // Each fold has a different width and twist, with highlights following its curved surface.
  vec4 ribbon(vec2 point, float fold, float width, float opacity) {
    float x = point.x;
    float wave = x * 6.2831853 - phase;
    float center = 0.43 + 0.42 * (x - 0.5) + 0.085 * sin(x * 10.5 - 3.05)
      + 0.105 * sin(wave - 1.6) + 0.036 * sin(2.0 * wave + 0.65);
    center += fold * (0.118 + 0.058 * sin(wave + 0.7)) - hero * 0.08;
    float thickness = width * (1.0 + 0.22 * cos(wave - 1.05 + fold));
    float across = (point.y - center) / thickness;
    float edge = abs(across);
    float antialias = 1.25 / (resolution.y * thickness);
    float coverage = 1.0 - smoothstep(1.0 - antialias, 1.0 + antialias, edge);

    float twist = across * 2.3 + 1.03 * sin(wave + fold * 0.75)
      + 0.25 * sin(2.0 * wave - across * 1.7);
    float violet = pow(max(0.0, cos(twist * 1.42 + 1.34)), 3.0);
    float pearl = pow(max(0.0, cos(twist * 2.0 - 0.68)), 14.0);
    float silk = pow(max(0.0, cos(twist * 2.0 - 0.79)), 4.0);
    float rose = pow(max(0.0, sin(twist + 0.9)), 7.0);
    float rim = smoothstep(0.80, 0.98, edge)
      * (0.24 + 0.76 * pow(0.5 + 0.5 * sin(wave * 2.0 + across * 1.9 + fold), 2.0));
    float light = 0.66 + 0.34 * sin(wave + 1.7 + fold * 0.55);

    vec3 color = vec3(0.028, 0.014, 0.06)
      + violet * vec3(0.31, 0.13, 0.83)
      + silk * vec3(0.21, 0.13, 0.33)
      + pearl * vec3(0.77, 0.66, 0.74)
      + rose * vec3(0.15, 0.075, 0.075)
      + rim * vec3(0.66, 0.50, 0.83);
    float sheen = max(max(violet, silk), rim);
    float alpha = coverage * opacity * (0.36 + 0.64 * sheen);
    return vec4(clamp(color * light, 0.0, 1.0) * alpha, alpha);
  }

  // Composite from the far ribbon to the near ribbon in premultiplied colors.
  vec4 over(vec4 front, vec4 back) {
    return front + back * (1.0 - front.a);
  }

  void main() {
    vec2 point = gl_FragCoord.xy / resolution;
    vec4 back = ribbon(point, 1.03, 0.103, 0.68);
    vec4 mainFold = ribbon(point, 0.0, 0.177, 0.96);
    vec4 front = ribbon(point, -0.87, 0.085, 0.79);
    gl_FragColor = over(front, over(mainFold, back));
  }
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function createRenderer(canvas: HTMLCanvasElement, hero: boolean) {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: false, powerPreference: "low-power" });
  if (!gl) return null;

  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = vertex && fragment ? gl.createProgram() : null;
  if (program && vertex && fragment) {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
  }
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!program) return null;
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  const triangle = gl.createBuffer();
  if (!triangle) {
    gl.deleteProgram(program);
    return null;
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, triangle);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const resolution = gl.getUniformLocation(program, "resolution");
  const phase = gl.getUniformLocation(program, "phase");
  gl.uniform1f(gl.getUniformLocation(program, "hero"), Number(hero));

  return {
    draw(angle: number) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform1f(phase, angle);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteBuffer(triangle);
      gl.deleteProgram(program);
    },
  };
}

export function CyberGlassBackdrop({ hero = false }: { hero?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof WebGLRenderingContext === "undefined") return;

    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let renderer: ReturnType<typeof createRenderer> = null;
    let visible = typeof IntersectionObserver !== "function";
    let contextLost = false;
    let frame = 0;
    let lastFrame = 0;
    let phase = hero ? 0.55 : 0;

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      renderer ??= createRenderer(canvas, hero);
      if (!renderer) {
        contextLost = true;
        return;
      }

      // Keep fill rate bounded on wide displays and constrain high density mobile canvases.
      const scale = Math.min(1, 960 / width, Math.sqrt(420_000 / (width * height)));
      const pixelsWide = Math.max(1, Math.round(width * scale));
      const pixelsHigh = Math.max(1, Math.round(height * scale));
      if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) {
        canvas.width = pixelsWide;
        canvas.height = pixelsHigh;
      }
      renderer.draw(phase);
      canvas.dataset.ready = "true";
    };

    const tick = (now: number) => {
      const elapsed = now - lastFrame;
      if (elapsed >= 32) {
        phase = (phase + Math.min(elapsed, 64) * (2 * Math.PI / 11_000)) % (2 * Math.PI);
        lastFrame = now;
        draw();
      }
      frame = contextLost ? 0 : window.requestAnimationFrame(tick);
    };
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      if (!visible || document.hidden || contextLost) return;
      draw();
      if (!motion?.matches && !contextLost) {
        lastFrame = performance.now();
        frame = window.requestAnimationFrame(tick);
      }
    };
    const onLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      delete canvas.dataset.ready;
      update();
    };
    const onRestored = () => {
      renderer = null;
      contextLost = false;
      update();
    };

    const intersection = typeof IntersectionObserver === "function" ? new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    }) : null;
    intersection?.observe(canvas);
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    resize?.observe(canvas);
    window.addEventListener("resize", update);
    motion?.addEventListener?.("change", update);
    document.addEventListener("visibilitychange", update);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    update();

    return () => {
      window.cancelAnimationFrame(frame);
      intersection?.disconnect();
      resize?.disconnect();
      window.removeEventListener("resize", update);
      motion?.removeEventListener?.("change", update);
      document.removeEventListener("visibilitychange", update);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      renderer?.dispose();
      delete canvas.dataset.ready;
    };
  }, [hero]);

  return <canvas ref={canvasRef} className="cyber-glass-backdrop" aria-hidden="true" />;
}
