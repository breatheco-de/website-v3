import RigobotHead, { RIGOBOT_GREY } from "./RigobotHead";

/**
 * Rigobot peeking out from behind the left edge of a card (desktop only). Render as the first child of a
 * `relative` card without `overflow-hidden`: the head slides out, looks toward the card's button, winks and
 * slides back; two hands grip the edge. `bottomPx` is the window's distance from the card's bottom edge.
 */
export default function RigobotSidePeek({ bottomPx = 118 }: { bottomPx?: number }) {
  return (
    <div className="hidden lg:block" aria-hidden="true">
      <div
        className="absolute -left-24 w-24 h-20 overflow-hidden pointer-events-none"
        style={{ bottom: bottomPx }}
      >
        <RigobotHead
          width={124}
          height={78}
          className="absolute left-0 top-1.5 motion-safe:animate-rigobot-side-peek"
          eyesClassName="motion-safe:animate-rigobot-side-look motion-reduce:[transform:translate(70px,24px)]"
          winkClassName="motion-safe:animate-rigobot-side-wink"
        />
      </div>
      <span
        className="absolute -left-[9px] w-3.5 h-[22px] rounded-[7px] pointer-events-none"
        style={{ bottom: bottomPx + 88, background: RIGOBOT_GREY }}
      />
      <span
        className="absolute -left-[9px] w-3.5 h-[22px] rounded-[7px] pointer-events-none"
        style={{ bottom: bottomPx - 10, background: RIGOBOT_GREY }}
      />
    </div>
  );
}
