
import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { UniversalImage } from "@/components/UniversalImage";
import { UniversalVideo } from "@/components/UniversalVideo";

interface AccordionBullet {
  heading: string;
  text: string;
}

interface VideoConfig {
  url?: string;
  ratio?: string;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
}

interface TwoColumnAccordionCardImageBackgroundData {
  title?: string;
  description?: string;
  bullets?: AccordionBullet[];
  footer?: string;
  image?: string;
  image_alt?: string;
  image_object_fit?: "cover" | "contain" | "fill" | "none" | "scale-down";
  image_object_position?: string;
  reverse?: boolean;
  video?: VideoConfig;
}

interface TwoColumnAccordionCardImageBackgroundProps {
  data: TwoColumnAccordionCardImageBackgroundData;
}

const isDirectVideoUrl = (url: string): boolean => {
  return /\.(mp4|webm|mov|ogg|m4v)(\?.*)?$/i.test(url);
};

export default function TwoColumnAccordionCardImageBackground({ data }: TwoColumnAccordionCardImageBackgroundProps) {
  const { title, description, bullets, footer, image, image_alt, image_object_fit, image_object_position, reverse, video } = data;
  const hasVideo = video?.url && video.url.trim().length > 0;
  const isAutoplayLocal = hasVideo && isDirectVideoUrl(video.url!) && video.autoplay === true;
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const rafId = useRef<number>(0);

  const handleVideoCanPlay = () => {
    setVideoReady(true);
  };

  useEffect(() => {
    const section = sectionRef.current;
    const media = mediaRef.current;
    if (!section || !media) return;

    const MAX_OFFSET = 15;

    const handleMouseMove = (e: MouseEvent) => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        const rect = section.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = (e.clientX - cx) / (rect.width / 2);
        const dy = (e.clientY - cy) / (rect.height / 2);
        const tx = -dx * MAX_OFFSET;
        const ty = -dy * MAX_OFFSET;
        media.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      });
    };

    const handleMouseLeave = () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
      media.style.transform = "translate3d(0, 0, 0)";
    };

    section.addEventListener("mousemove", handleMouseMove);
    section.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
      section.removeEventListener("mousemove", handleMouseMove);
      section.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  return (
    <section ref={sectionRef} className="" data-testid="section-two-column-accordion-card">
      <div className="max-w-6xl mx-auto px-4">
        <Card className="overflow-hidden shadow-sm border-0">
          <CardContent className="!p-0 md:p-card">
            <div className={`grid grid-cols-1 md:grid-cols-12 md:min-h-[580px] ${reverse ? "md:flex-row-reverse" : ""}`}>
              <div className={`col-span-1 md:col-span-7 p-6 md:p-10 flex flex-col justify-center ${reverse ? "md:order-2" : "md:order-1"}`}>
                {title && (
                  <h2 
                    className="text-h2 text-foreground mb-4"
                    data-testid="text-two-column-accordion-title"
                  >
                    {title}
                  </h2>
                )}
                
                {description && (
                  <p 
                    className="text-muted-foreground mb-6 pt-0 pb-5 text-[18px] leading-[1.5rem]"
                    data-testid="text-two-column-accordion-description"
                  >
                    {description}
                  </p>
                )}

                {bullets && bullets.length > 0 && (
                  <Accordion type="single" collapsible defaultValue="item-0" className="w-full" data-testid="accordion-bullets">
                    {bullets.map((bullet, index) => (
                      <AccordionItem key={index} value={`item-${index}`}>
                        <AccordionTrigger className="text-left font-semibold text-foreground hover:no-underline py-2 md:py-4">
                          {bullet.heading}
                        </AccordionTrigger>
                        <AccordionContent className="text-muted-foreground leading-[1.5rem]">
                          {bullet.text}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                )}

                {footer && (
                  <p 
                    className="text-muted-foreground mt-6 text-sm italic"
                    data-testid="text-two-column-accordion-footer"
                  >
                    {footer}
                  </p>
                )}
              </div>

              {(image || hasVideo) && (
                <div className={`col-span-1 md:col-span-5 flex items-center ${reverse ? "md:order-1 justify-start" : "md:order-2 justify-end"}`}>
                  <div 
                    className={`relative bg-none md:bg-primary/30 rounded-2xl pt-0 md:py-14 ${reverse ? "md:pr-4 pl-0" : "pl-0 md:pl-4 pr-0"} flex items-center ${reverse ? "justify-start" : "justify-end"} min-h-[200px] md:min-h-[400px] w-full`}
                    data-testid="img-two-column-accordion-background"
                  >
                    <div ref={mediaRef} className="w-full md:w-[90%] flex items-center justify-end relative will-change-transform" style={{ transition: "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)" }}>
                      {isAutoplayLocal ? (
                        <div className="relative w-full rounded-lg shadow-lg overflow-hidden" data-testid="video-two-column-accordion">
                          <video
                            ref={videoRef}
                            src={video!.url!}
                            autoPlay
                            loop={video!.loop ?? true}
                            muted={video!.muted ?? true}
                            playsInline
                            onCanPlay={handleVideoCanPlay}
                            className="w-full h-auto rounded-lg"
                            style={{
                              objectFit: image_object_fit || "contain",
                              objectPosition: image_object_position || "center center",
                            }}
                          />
                          {image && (
                            <div
                              className="absolute inset-0 transition-opacity duration-700 ease-in-out pointer-events-none"
                              style={{ opacity: videoReady ? 0 : 1 }}
                              data-testid="img-video-overlay"
                            >
                              <UniversalImage
                                id={image}
                                alt={image_alt || ""}
                                className="w-full h-full object-cover rounded-lg"
                                fieldContext={{ fieldPath: "image" }}
                              />
                            </div>
                          )}
                        </div>
                      ) : hasVideo ? (
                        <div
                          className="w-full rounded-lg overflow-hidden shadow-lg"
                          data-testid="video-two-column-accordion"
                        >
                          <UniversalVideo
                            url={video!.url!}
                            ratio={video!.ratio || "16:9"}
                            autoplay={video!.autoplay === true}
                            loop={video!.loop ?? true}
                            muted={video!.muted ?? true}
                            preview_image_url={image}
                            open_modal_on_click={video!.open_modal_on_click}
                            overlay_on_muted={video!.overlay_on_muted}
                            className="w-full"
                          />
                        </div>
                      ) : image ? (
                        <UniversalImage
                          id={image}
                          alt={image_alt || ""}
                          className="w-full h-auto rounded-lg shadow-lg"
                          style={{
                            objectFit: image_object_fit || "contain",
                            objectPosition: image_object_position || "center center",
                          }}
                          fieldContext={{ fieldPath: "image" }}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
