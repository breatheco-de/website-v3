
import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Linkedin } from "lucide-react";
import { cn } from "@/lib/utils";
import { UniversalImage } from "@/components/UniversalImage";
import { Button } from "@/components/ui/button";
import type { ProfilesCarouselSection, ProfileCard } from "@shared/schema";
import { sectionBackgroundStyle } from "@shared/theme-palette";

interface ProfilesCarouselProps {
  data: ProfilesCarouselSection;
}

const PROFILES_PER_PAGE = 4;

function useItemsPerPage(isRound: boolean) {
  const [itemsPerPage, setItemsPerPage] = useState(4);

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w < 640) {
        setItemsPerPage(isRound ? 1 : 2);
      } else if (w < 1024) {
        setItemsPerPage(3);
      } else {
        setItemsPerPage(4);
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [isRound]);

  return itemsPerPage;
}

function ProfileCardItem({ profile, isRound, profileIndex }: { profile: ProfileCard; isRound: boolean; profileIndex: number }) {
  const imageElement = profile.image_id ? (
    <UniversalImage
      id={profile.image_id}
      alt={profile.name}
      className="w-full h-full"
      style={{
        objectFit: (profile.object_fit as React.CSSProperties["objectFit"]) || "cover",
        objectPosition: profile.object_position || "center center",
      }}
      fieldContext={{ arrayPath: "profiles", index: profileIndex, srcField: "image_id" }}
    />
  ) : (
    <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground text-3xl font-bold">
      {profile.name.charAt(0)}
    </div>
  );

  if (isRound) {
    return (
      <div
        className="flex flex-col flex-1 min-w-0 border p-4 rounded-lg h-full"
        data-testid={`profile-card-${profile.name.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <div
          className="w-14 h-14 rounded-full overflow-hidden flex-shrink-0 mx-auto mb-3"
          data-testid="profile-image-container"
        >
          {imageElement}
        </div>
        <h3 className="text-base md:text-lg font-semibold text-foreground text-center" data-testid="text-profile-name">
          {profile.name}
        </h3>
        {profile.role && (
          <p className="text-center text-sm md:text-base text-foreground mt-1 leading-tight" data-testid="text-profile-role">
            {profile.role}
          </p>
        )}
        {profile.description && (
          <p className="text-sm text-muted-foreground mt-2 text-center" data-testid="text-profile-description">
            {profile.description}
          </p>
        )}
        {profile.linkedin_url && (
          <a
            href={profile.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 text-muted-foreground transition-colors hover:text-foreground h-full flex items-end justify-center"
            aria-label={`${profile.name} on LinkedIn`}
            data-testid="link-profile-linkedin"
          >
            <Linkedin className="w-5 h-5" aria-hidden="true" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center text-center flex-1 min-w-0 rounded-lg h-full"
      data-testid={`profile-card-${profile.name.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div
        className="mb-4 overflow-hidden flex items-center justify-center w-full h-[180px] md:h-[220px] lg:h-[250px] rounded-lg bg-muted"
        data-testid="profile-image-container"
      >
        {imageElement}
      </div>

      <h3 className="text-lg md:text-xl font-semibold text-foreground" data-testid="text-profile-name">
        {profile.name}
      </h3>
      {profile.role && (
        <p className="text-sm md:text-base text-foreground mt-0.5" data-testid="text-profile-role">
          {profile.role}
        </p>
      )}

      {profile.description && (
        <p className="text-sm text-muted-foreground mt-2" data-testid="text-profile-description">
          {profile.description}
        </p>
      )}

      {profile.linkedin_url && (
        <a
          href={profile.linkedin_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`${profile.name} on LinkedIn`}
          data-testid="link-profile-linkedin"
        >
          <Linkedin className="w-5 h-5" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

export default function ProfilesCarousel({ data }: ProfilesCarouselProps) {
  const { profiles, heading, description } = data;
  const isRound = data.image_round === true;
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = useItemsPerPage(isRound);

  useEffect(() => {
    setCurrentPage(0);
  }, [itemsPerPage]);

  const totalPages = Math.ceil(profiles.length / itemsPerPage);

  const pages = (() => {
    const result: ProfileCard[][] = [];
    for (let i = 0; i < profiles.length; i += itemsPerPage) {
      result.push(profiles.slice(i, i + itemsPerPage));
    }
    return result;
  })();

  const gridColsClass = itemsPerPage === 1 ? 'grid-cols-1' : itemsPerPage === 2 ? 'grid-cols-2' : itemsPerPage === 3 ? 'grid-cols-3' : 'grid-cols-4';

  const goTo = (page: number) => {
    if (page >= 0 && page < totalPages) setCurrentPage(page);
  };

  return (
    <section
      className="w-full"
      style={sectionBackgroundStyle(data.background)}
      data-testid="section-profiles-carousel"
    >
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        {(heading || description) && (
          <div className="text-center mb-10">
            {heading && (
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3" data-testid="text-profiles-heading">
                {heading}
              </h2>
            )}
            {description && (
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto" data-testid="text-profiles-description">
                {description}
              </p>
            )}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mb-6" data-testid="carousel-dots">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={cn(
                  "w-2.5 h-2.5 rounded-full transition-all duration-300",
                  i === currentPage ? "bg-primary scale-110" : "bg-border"
                )}
                aria-label={`Go to page ${i + 1}`}
                aria-current={i === currentPage ? "true" : undefined}
                data-testid={`button-dot-${i}`}
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 md:gap-4" data-testid="carousel-controls">
          {totalPages > 1 && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => goTo(currentPage - 1)}
              disabled={currentPage === 0}
              className="flex-shrink-0"
              aria-label="Previous page"
              data-testid="button-page-prev"
            >
              <ChevronLeft className="!w-7 !h-7" />
            </Button>
          )}

          <div className="flex-1 overflow-hidden mx-2">
            <div
              className="flex transition-transform duration-500 ease-in-out"
              style={{ transform: `translateX(-${currentPage * 100}%)` }}
            >
              {pages.map((page, pageIndex) => (
                <div
                  key={pageIndex}
                  className={`grid ${gridColsClass} gap-4 md:gap-6 w-full flex-shrink-0`}
                >
                  {page.map((profile, i) => (
                    <ProfileCardItem
                      key={pageIndex * itemsPerPage + i}
                      profile={profile}
                      isRound={isRound}
                      profileIndex={pageIndex * itemsPerPage + i}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {totalPages > 1 && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => goTo(currentPage + 1)}
              disabled={currentPage === totalPages - 1}
              className="flex-shrink-0"
              aria-label="Next page"
              data-testid="button-page-next"
            >
              <ChevronRight className="!w-7 !h-7" />
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

