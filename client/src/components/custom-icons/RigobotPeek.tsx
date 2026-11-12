import RigobotHead, { RIGOBOT_GREY } from "./RigobotHead";

/**
 * Rigobot peeking over the top edge of a bottom bar. Render inside a `relative` container: the head rises
 * from behind the edge, looks right, winks and drops back; the hands grip the edge.
 */
export default function RigobotPeek({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <div className="absolute right-6 bottom-full w-[104px] h-[54px] overflow-hidden pointer-events-none">
        <RigobotHead
          width={104}
          height={65}
          className="absolute left-0 -bottom-3.5 motion-safe:animate-rigobot-peek"
          eyesClassName="motion-safe:animate-rigobot-look"
          winkClassName="motion-safe:animate-rigobot-wink"
        />
      </div>
      <div className="absolute right-[17px] -top-2 z-[2] w-[118px] flex justify-between pointer-events-none">
        <span className="w-[22px] h-3.5 rounded-[7px] motion-safe:animate-rigobot-grip" style={{ background: RIGOBOT_GREY }} />
        <span className="w-[22px] h-3.5 rounded-[7px] motion-safe:animate-rigobot-grip" style={{ background: RIGOBOT_GREY }} />
      </div>
    </div>
  );
}
