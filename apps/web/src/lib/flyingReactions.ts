export type ReactionDeltas = Record<string, number>;
export type FlyingReactionsConfig = {
    maxParticles: number;
    maxSpawnPerTick: number;
    maxSpawnPerTap: number;
    lifetimeMs: number;
};
export const DEFAULT_FLYING_REACTIONS_CONFIG: FlyingReactionsConfig = {
    maxParticles: 96,
    maxSpawnPerTick: 48,
    maxSpawnPerTap: 2,
    lifetimeMs: 2400,
};
type Particle = {
    emoji: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    scale: number;
    rotation: number;
    rotationSpeed: number;
    age: number;
    lifetime: number;
    active: boolean;
};
const rand = (min: number, max: number): number => min + Math.random() * (max - min);
export const allocateSpawnCounts = (deltas: ReactionDeltas, maxSpawn: number): ReactionDeltas => {
    const entries = Object.entries(deltas).filter(([, delta]) => delta > 0);
    if (entries.length === 0)
        return {};
    const total = entries.reduce((sum, [, delta]) => sum + delta, 0);
    if (total <= maxSpawn) {
        return Object.fromEntries(entries);
    }
    const allocated: ReactionDeltas = {};
    let used = 0;
    for (const [emoji, delta] of entries) {
        const share = Math.floor((delta / total) * maxSpawn);
        if (share > 0) {
            allocated[emoji] = share;
            used += share;
        }
    }
    let remainder = maxSpawn - used;
    const byWeight = [...entries].sort((a, b) => b[1] - a[1]);
    for (const [emoji] of byWeight) {
        if (remainder <= 0)
            break;
        allocated[emoji] = (allocated[emoji] ?? 0) + 1;
        remainder -= 1;
    }
    return allocated;
};
export class FlyingReactionsEngine {
    private readonly pool: Particle[];
    private activeCount = 0;
    private width = 0;
    private height = 0;
    private rafId = 0;
    private lastFrame = 0;
    private running = false;
    constructor(private readonly canvas: HTMLCanvasElement, private readonly config: FlyingReactionsConfig = DEFAULT_FLYING_REACTIONS_CONFIG) {
        this.pool = Array.from({ length: config.maxParticles }, () => ({
            emoji: '',
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            scale: 1,
            rotation: 0,
            rotationSpeed: 0,
            age: 0,
            lifetime: config.lifetimeMs,
            active: false,
        }));
    }
    resize(width: number, height: number): void {
        const dpr = window.devicePixelRatio || 1;
        this.width = width;
        this.height = height;
        this.canvas.width = Math.max(1, Math.floor(width * dpr));
        this.canvas.height = Math.max(1, Math.floor(height * dpr));
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        const ctx = this.canvas.getContext('2d');
        if (ctx)
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    start(): void {
        if (this.running)
            return;
        this.running = true;
        this.lastFrame = performance.now();
        const tick = (now: number) => {
            if (!this.running)
                return;
            const dt = Math.min(48, now - this.lastFrame);
            this.lastFrame = now;
            this.step(dt);
            this.draw();
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
    }
    stop(): void {
        this.running = false;
        if (this.rafId)
            cancelAnimationFrame(this.rafId);
        this.rafId = 0;
        for (const particle of this.pool)
            particle.active = false;
        this.activeCount = 0;
        const ctx = this.canvas.getContext('2d');
        if (ctx)
            ctx.clearRect(0, 0, this.width, this.height);
    }
    spawn(emoji: string, count = 1): void {
        const capped = Math.min(count, this.config.maxSpawnPerTap);
        for (let i = 0; i < capped; i += 1)
            this.activate(emoji);
    }
    ingestDeltas(deltas: ReactionDeltas): void {
        const allocation = allocateSpawnCounts(deltas, this.config.maxSpawnPerTick);
        for (const [emoji, count] of Object.entries(allocation)) {
            for (let i = 0; i < count; i += 1)
                this.activate(emoji);
        }
    }
    private activate(emoji: string): void {
        const particle = this.pool.find((p) => !p.active);
        if (!particle)
            return;
        particle.active = true;
        particle.emoji = emoji;
        particle.x = rand(this.width * 0.08, this.width * 0.92);
        particle.y = rand(this.height * 0.72, this.height * 0.92);
        particle.vx = rand(-42, 42);
        particle.vy = rand(-150, -95);
        particle.scale = rand(0.75, 1.05);
        particle.rotation = rand(-0.35, 0.35);
        particle.rotationSpeed = rand(-1.4, 1.4);
        particle.age = 0;
        particle.lifetime = this.config.lifetimeMs * rand(0.85, 1.15);
        this.activeCount += 1;
    }
    private step(dtMs: number): void {
        const dt = dtMs / 1000;
        for (const particle of this.pool) {
            if (!particle.active)
                continue;
            particle.age += dtMs;
            particle.x += particle.vx * dt;
            particle.y += particle.vy * dt;
            particle.rotation += particle.rotationSpeed * dt;
            particle.vy -= 18 * dt;
            if (particle.age >= particle.lifetime || particle.y < -48) {
                particle.active = false;
                this.activeCount -= 1;
            }
        }
    }
    private draw(): void {
        const ctx = this.canvas.getContext('2d');
        if (!ctx)
            return;
        ctx.clearRect(0, 0, this.width, this.height);
        if (this.activeCount === 0)
            return;
        for (const particle of this.pool) {
            if (!particle.active)
                continue;
            const t = particle.age / particle.lifetime;
            const fadeIn = Math.min(1, t / 0.12);
            const fadeOut = t > 0.62 ? 1 - (t - 0.62) / 0.38 : 1;
            const opacity = fadeIn * fadeOut;
            const size = 26 * particle.scale * (0.85 + t * 0.35);
            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.translate(particle.x, particle.y);
            ctx.rotate(particle.rotation);
            ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(particle.emoji, 0, 0);
            ctx.restore();
        }
    }
}
