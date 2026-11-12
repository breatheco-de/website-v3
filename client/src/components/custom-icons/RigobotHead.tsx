// Brand mascot artwork: fixed Rigobot colors, like Rigobot.tsx.
export const RIGOBOT_NAVY = "#000619";
export const RIGOBOT_GREY = "#AEB8C6";
const ORANGE = "#FF5A00";
const BLUE = "#0084FF";

interface RigobotHeadProps {
  width: number;
  height: number;
  className?: string;
  /** Classes on the eyes group (look-around animation). */
  eyesClassName?: string;
  /** Classes on the right (blue) eye (wink animation). */
  winkClassName?: string;
}

/** Rigobot's head (visor, ears, antenna, eyes) used by the peeking animations. */
export default function RigobotHead({ width, height, className, eyesClassName, winkClassName }: RigobotHeadProps) {
  return (
    <svg className={className} viewBox="288 296 1110 694" width={width} height={height}>
      <path d="M348 540 V512 A135 135 0 0 1 483 378 H1203 A135 135 0 0 1 1338 512 V540 Z" fill={RIGOBOT_NAVY} />
      <rect x="294" y="521" width="130" height="277" rx="18" fill={RIGOBOT_NAVY} />
      <rect x="1262" y="521" width="130" height="277" rx="18" fill={RIGOBOT_NAVY} />
      <path d="M1018 424 L1072 318 Q1084 296 1096 318 L1152 424 Z" fill={RIGOBOT_GREY} />
      <rect x="453" y="423" width="780" height="564" rx="92" fill={RIGOBOT_GREY} />
      <rect x="411" y="480" width="864" height="357" rx="34" fill={RIGOBOT_GREY} />
      <rect x="432" y="500" width="822" height="317" rx="16" fill={RIGOBOT_NAVY} />
      <g className={eyesClassName}>
        <rect x="582" y="524" width="45" height="265" rx="22.5" fill={ORANGE} />
        <rect
          className={winkClassName}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
          x="1058"
          y="524"
          width="46"
          height="265"
          rx="23"
          fill={BLUE}
        />
      </g>
      <path d="M777 817 L835 650 Q843 630 851 650 L909 817 Z" fill={RIGOBOT_GREY} />
    </svg>
  );
}
