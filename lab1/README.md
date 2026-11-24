# Dogfight — Lab 01

Controls: ←/→ or A/D rotate, ↑ or W thrust, H toggles HUD.

## Tuning notes (M2)
- (write what you changed and why: turnSpeed, thrustAccel, drag, maxSpeed)

## Experiment 1 — 100 ms busy-wait in render every 60th frame
- What the player sees:
- HUD numbers (steps/s, frames/s, frame ms):
- Why it can't be worked around on the same thread (event loop explanation):

## Experiment 2 — setInterval(frame, 16) instead of rAF
- frames/s and jitter over 10 s:
- Background tab for 5 s and back:
- What differed vs rAF:

## Experiment 3 — no accumulator (variable timestep), CPU throttle 6x
- Position after 5 s of thrust, unthrottled:
- Position after 5 s of thrust, throttled:
- With fixed step restored (both runs):
