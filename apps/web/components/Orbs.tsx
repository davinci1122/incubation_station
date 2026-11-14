import { orbsFor } from "@/lib/orbs";

/** ぼかした球の背景。親要素は position: relative; overflow: hidden にしておく。 */
export function Orbs({ seed, count = 4, scale = 1 }: { seed: string; count?: number; scale?: number }) {
  return (
    <>
      {orbsFor(seed, count, scale).map((orb, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="pointer-events-none absolute rounded-full"
          style={{
            left: `${orb.left}%`,
            top: `${orb.top}%`,
            width: orb.size,
            height: orb.size,
            background: orb.background,
            filter: `blur(${orb.blur}px)`,
          }}
        />
      ))}
    </>
  );
}
