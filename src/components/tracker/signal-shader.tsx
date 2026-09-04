"use client";

import dynamic from "next/dynamic";
import { useReducedMotion } from "motion/react";

const PulsingBorder = dynamic(
  () =>
    import("@paper-design/shaders-react").then(
      (module) => module.PulsingBorder,
    ),
  { ssr: false },
);

export function SignalShader() {
  const reduceMotion = useReducedMotion();

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-0 right-0 h-28 w-44 overflow-hidden rounded-tr-xl opacity-35 [mask-image:radial-gradient(circle_at_100%_0%,black_0%,black_28%,transparent_74%)]"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_90%_8%,rgba(57,135,229,0.36),transparent_64%)]" />
      <PulsingBorder
        colorBack="#00000000"
        colors={["#3987e5", "#1baf7a"]}
        roundness={0.22}
        thickness={0.018}
        softness={0.16}
        intensity={0.1}
        bloom={0.06}
        spots={1}
        spotSize={0.34}
        pulse={0.08}
        smoke={0}
        speed={reduceMotion ? 0 : 0.15}
        frame={1200}
        minPixelRatio={1}
        maxPixelCount={40_000}
        className="absolute inset-0 size-full"
      />
    </div>
  );
}
