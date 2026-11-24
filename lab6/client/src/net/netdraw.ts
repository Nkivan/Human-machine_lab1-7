import type { EntityId } from "@dogfight/shared/protocol/ids";
import type { PickupType } from "@dogfight/shared/sim/pickup";
import type { EntityRecord } from "@dogfight/shared/protocol/messages";
import { assertNever } from "@dogfight/shared/util";
import type { Manifest } from "../assets/loader.ts";
import type { View } from "../render/canvas.ts";

export interface Sprites {
  readonly sheet: ImageBitmap;
  readonly frames: Manifest["frames"];
}

// What the renderer draws: built from snapshots (remote entities) and from prediction (my ship, my bullets).
export type DrawItem =
  | {
      readonly kind: "ship";
      readonly x: number;
      readonly y: number;
      readonly angle: number;
      readonly thrust: boolean;
      readonly invuln: boolean;
      readonly shield: boolean;
      readonly me: boolean;
    }
  | { readonly kind: "bullet"; readonly x: number; readonly y: number; readonly homing: boolean }
  | { readonly kind: "pickup"; readonly x: number; readonly y: number; readonly type: PickupType }
  | {
      readonly kind: "asteroid";
      readonly id: number;
      readonly x: number;
      readonly y: number;
      readonly radius: number;
      readonly seeker: boolean;
    };

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

function sprite(ctx: CanvasRenderingContext2D, sprites: Sprites, name: string, size: number): void {
  const f = sprites.frames[name];
  if (f) ctx.drawImage(sprites.sheet, f[0], f[1], f[2], f[3], -size / 2, -size / 2, size, size);
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  view: View,
  items: readonly DrawItem[],
  particles: readonly Particle[],
  sprites: Sprites,
  time: number,
): void {
  ctx.save();
  ctx.translate(view.offsetX, view.offsetY);
  ctx.scale(view.scale, view.scale);
  for (const it of items) {
    ctx.save();
    ctx.translate(it.x, it.y);
    switch (it.kind) {
      case "asteroid":
        ctx.rotate(it.id);
        sprite(ctx, sprites, "asteroid", it.radius * 2.2);
        if (it.seeker) {
          ctx.strokeStyle = "#ff6b6b";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, it.radius + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      case "bullet":
        sprite(ctx, sprites, it.homing ? "bullet_homing" : "bullet", 14);
        break;
      case "ship":
        if (it.invuln && Math.floor(time / 80) % 2 === 0) break; // blink while invulnerable
        ctx.rotate(it.angle);
        if (it.thrust) {
          const len = 14 + Math.sin(time / 30) * 5;
          ctx.fillStyle = "#ff9d2e";
          ctx.beginPath();
          ctx.moveTo(-10, -5);
          ctx.lineTo(-10 - len, 0);
          ctx.lineTo(-10, 5);
          ctx.closePath();
          ctx.fill();
        }
        sprite(ctx, sprites, it.me ? "ship" : "drone", 46);
        if (it.shield) {
          ctx.strokeStyle = "#4fd1ff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 24, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      case "pickup":
        sprite(ctx, sprites, `pickup_${it.type}`, 30);
        break;
      default:
        assertNever(it);
    }
    ctx.restore();
  }
  ctx.fillStyle = "#ff9d2e";
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// Snapshot record -> draw item: an exhaustive switch over the discriminated union.
export function toItem(r: EntityRecord, myId: EntityId | null): DrawItem {
  switch (r.kind) {
    case "ship":
      return { kind: "ship", x: r.x, y: r.y, angle: r.angle, thrust: r.thrust, invuln: r.invuln, shield: r.shield > 0, me: r.id === myId };
    case "bullet":
      return { kind: "bullet", x: r.x, y: r.y, homing: r.homing };
    case "asteroid":
      return { kind: "asteroid", id: r.id, x: r.x, y: r.y, radius: r.radius, seeker: r.seeker };
    case "pickup":
      return { kind: "pickup", x: r.x, y: r.y, type: r.type };
    default:
      return assertNever(r);
  }
}
