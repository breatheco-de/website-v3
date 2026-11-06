import { useState } from "react";
import { Calendar, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import SolidCard from "@/components/SolidCard";
import UniversalImage from "@/components/UniversalImage";
import type { ProjectsSection as ProjectsSectionType } from "@shared/schema";

interface ProjectsSectionProps {
  data: ProjectsSectionType;
}

const projectImages: Record<string, string> = {
  "flask-render": "flask-render-1765396097392",
  "streamlit-render": "streamlit-render-1765396163031",
  "ml-final-project": "final-project-applied-ai-1767880920613",
  "star-wars": "star-wars-1764729369149",
  "authentication": "authentication-python-1764729364254",
  "final-project": "fullstack-user-stories-1764729359334",
  "chatbot": "clon-yourself-1765501526533",
  "clone-yourself": "clon-yourself-1765501526533",
  "prompt-book-ai": "prompt-book-ai-1765501656292",
};

const difficultyColors: Record<string, string> = {
  easy: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  hard: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const MAX_MOBILE_TAGS = 3;

export function ProjectsSection({ data }: ProjectsSectionProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const items = data.items || [];
  const totalItems = items.length;
  
  if (totalItems === 0) {
    return (
      <section className="bg-background" data-testid="section-projects">
        <div className="max-w-6xl mx-auto px-4 text-center text-muted-foreground">
          Projects section requires at least one project item
        </div>
      </section>
    );
  }

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? totalItems - 1 : prev - 1));
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev === totalItems - 1 ? 0 : prev + 1));
  };

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };

  const currentProject = items[currentIndex];
  const imageKey = currentProject.image.toLowerCase().replace(/\s+/g, "-");
  const imageSrc = projectImages[imageKey] || projectImages["ml-final-project"];

  return (
    <section 
      className="bg-background"
      data-testid="section-projects"
    >
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-10">
          <h2 
            className="text-3xl md:text-4xl font-bold text-foreground"
            data-testid="text-projects-title"
          >
            {data.title}
          </h2>
          {data.subtitle && (
            <p 
              className="text-muted-foreground mt-4 max-w-3xl mx-auto"
              data-testid="text-projects-subtitle"
            >
              {data.subtitle}
            </p>
          )}
        </div>

        <div className="relative bg-secondary rounded-xl">
          <div 
            className="bg-muted border rounded-lg p-4 md:p-5 flex items-center min-h-[480px] md:min-h-[320px]"
            data-testid={`card-project-${currentIndex}`}
          >
            <div className="flex flex-col md:flex-row gap-7 h-full">

              <div className="md:w-2/5 aspect-video md:aspect-auto md:min-h-[240px] overflow-hidden bg-muted rounded-lg shrink-0 shadow-xs border">
                <UniversalImage 
                  id={imageSrc}
                  alt={currentProject.title}
                  className="w-full h-full"
                  style={{ objectFit: "cover" }}
                />
              </div>

              <div className="md:w-3/5 flex flex-col">
                <h3 className="text-xl md:text-2xl font-bold text-foreground mb-2">
                  {currentProject.title}
                </h3>
                
                {(currentProject.duration || currentProject.date || currentProject.difficulty) && (
                  <div className="flex items-center gap-3 mb-3 text-sm text-muted-foreground">
                    {currentProject.difficulty && (
                      <Badge 
                        className={`uppercase text-xs font-bold ${difficultyColors[currentProject.difficulty]}`}
                      >
                        {currentProject.difficulty}
                      </Badge>
                    )}
                    {currentProject.duration && (
                      <span className="flex items-center gap-1">
                        <Clock size={14} />
                        {currentProject.duration}
                      </span>
                    )}
                    {currentProject.date && (
                      <span className="flex items-center gap-1">
                        <Calendar size={14} />
                        {currentProject.date}
                      </span>
                    )}
                  </div>
                )}

                {currentProject.tags && currentProject.tags.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap mb-4">
                    {currentProject.tags.slice(0, MAX_MOBILE_TAGS).map((tag, idx) => (
                      <Badge 
                        key={idx} 
                        className="text-xs font-medium md:hidden bg-[#BEE3F8] text-[#2C5282]"
                      >
                        {tag}
                      </Badge>
                    ))}
                    {currentProject.tags.length > MAX_MOBILE_TAGS && (
                      <Badge 
                        variant="outline"
                        className="text-xs font-medium md:hidden"
                      >
                        +{currentProject.tags.length - MAX_MOBILE_TAGS} more
                      </Badge>
                    )}
                    {currentProject.tags.map((tag, idx) => (
                      <Badge 
                        key={idx} 
                        className="text-xs font-medium hidden md:inline-flex bg-[#BEE3F8] text-[#2C5282]"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                
                <p className="text-muted-foreground leading-relaxed flex-grow">
                  {currentProject.description}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between py-2 px-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={goToPrevious}
              className="rounded-full border"
              data-testid="button-projects-prev"
              aria-label="Previous project"
            >
              <ChevronLeft size={24} aria-hidden="true" />
            </Button>

            <div className="flex items-center gap-2">
              {items.map((_, index) => (
                <button
                  key={index}
                  onClick={() => goToSlide(index)}
                  className={`w-3 h-3 rounded-full transition-colors ${
                    index === currentIndex 
                      ? "bg-primary" 
                      : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                  }`}
                  data-testid={`button-project-dot-${index}`}
                  aria-label={`Go to project ${index + 1}`}
                />
              ))}
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={goToNext}
              className="rounded-full border"
              data-testid="button-projects-next"
              aria-label="Next project"
            >
              <ChevronRight size={24} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ProjectsSection;
