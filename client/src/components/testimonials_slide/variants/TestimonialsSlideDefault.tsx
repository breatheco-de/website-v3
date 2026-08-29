import { CSSMarquee } from "@/components/ui/CSSMarquee";
import { Flag } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import UniversalImage from "@/components/UniversalImage";
import {
  isValidForSlide,
  testimonialText,
  type TestimonialBankRow,
} from "@shared/testimonials-listing";

export interface TestimonialsSlideTestimonial {
  name: string;
  img: string;
  status?: string;
  country: {
    name: string;
    iso: string;
  };
  contributor: string;
  description: string;
  achievement?: string;
}

export interface TestimonialsSlideData {
  title: string;
  description: string;
  background?: string;
  /** Runtime-resolved bank rows from dynamic_entries. */
  items?: TestimonialBankRow[];
  hardcoded_entries?: TestimonialBankRow[];
  dynamic_entries?: { hardcoded_entries?: TestimonialBankRow[] };
}

interface TestimonialsSlideProps {
  data: TestimonialsSlideData;
}

/**
 * Bank rows only carry core fields. Manually-added rows may also carry the
 * slide-only extras (country, status, achievement) authored on the section.
 */
function mapBankRowToSlideItem(row: TestimonialBankRow): TestimonialsSlideTestimonial {
  return {
    name: row.student_name || "",
    img: row.student_thumb || "",
    contributor: row.company || row.role || "",
    description: testimonialText(row),
    country: { name: row.country?.name || "", iso: row.country?.iso || "" },
    ...(row.status ? { status: row.status } : {}),
    ...(row.achievement ? { achievement: row.achievement } : {}),
  };
}

type CardSize = "small" | "medium" | "large";

const DEFAULT_TESTIMONIALS: TestimonialsSlideTestimonial[] = [
  {
    name: "Loretta Thompson",
    img: "ttaloretta-1764725322100",
    status: "Graduated",
    country: { iso: "us", name: "United States of America" },
    contributor: "United Way Miami",
    description: "Loretta joined in 2022 and graduated in 2023. She already found a job within the next few months and has fulfilled the whole circle of skills+job that we all want to complete!",
    achievement: "She got a 45% increase in her salary"
  },
  {
    name: "Rich Akers",
    img: "akers-1764725327796",
    status: "Graduated",
    country: { iso: "us", name: "United States of America" },
    contributor: "Clark University",
    description: "Richard is a great developer that just transitioned from a different background and is now working as a web dev in the tech field.",
    achievement: "He got a 30% increase in his salary"
  },
  {
    name: "MaiLinh Tran",
    img: "mailinh-1764725334980",
    status: "Graduated",
    country: { iso: "us", name: "United States of America" },
    contributor: "Clark University",
    description: "An entrepreneur with a passion for technology is now focusing on the dev side of their endeavour.",
    achievement: "She has launched her startup, is capable of hiring new tech talent and coordinates a dev team!"
  },
  {
    name: "Jorge Martín Coimbra",
    img: "coimbra-1764725341501",
    status: "Graduated",
    country: { iso: "uy", name: "Uruguay" },
    contributor: "UTEC-BID",
    description: "Martín joined the first program that we launched together with UTEC and IDB. He got a better paying job, a career that he is passionate about and a new professional life.",
    achievement: "He got a 100% increase in his salary"
  },
  {
    name: "Jean St. Cloud",
    img: "jeanstcloud-1764725356935",
    status: "Graduated",
    country: { iso: "us", name: "United States of America" },
    contributor: "Clark",
    description: "Jean is transitioning from other industries (Music) and is finding his way into Tech. He got it with the support of Clark University and is already performing as a developer and a Mentor.",
    achievement: "He got a 100% increase in his salary"
  },
  {
    name: "Alexandra Espinoza",
    img: "alexandraespinoza-1764725386161",
    status: "Graduated",
    country: { iso: "cr", name: "Costa Rica" },
    contributor: "CINDE-BID",
    description: "Alexandra came from a total different background is been a huge revelation for her and everyone around her. She is now a successful and talented software developer in Costa Rica.",
    achievement: "She got a 100% increase in her salary"
  },
  {
    name: "Gabriel Salazar",
    img: "gabrielsalazar-1764725392872",
    status: "Graduated",
    country: { iso: "cr", name: "Costa Rica" },
    contributor: "CINDE-BID",
    description: "Gabriel was already a support specialist at Microsoft and after completing the program he was able to achieve a new position within Microsoft where he is now working as a Software Engineer.",
    achievement: "He got a 50% increase in his salary"
  },
  {
    name: "Laura Magallanes",
    img: "laura-1764725397398",
    status: "Graduated",
    country: { iso: "uy", name: "Uruguay" },
    contributor: "UTEC-BID",
    description: "Laura is just extraordinary. From a little town in Uruguay with no experience in Coding, she is now a woman head of household, an Instructor and a Program Coordinator.",
    achievement: "She got a 120% increase in her salary"
  },
  {
    name: "Melanie Galaretto",
    img: "melamniegalaretto-1764725408397",
    status: "Graduated",
    country: { iso: "uy", name: "Uruguay" },
    contributor: "UTEC-BID",
    description: "Melanie is a young professional who is dreaming of achieving a life that now she owns. She is a resourceful and committed software developer working for a software firm in her home country.",
    achievement: "She got a +100% increase in her salary"
  },
  {
    name: "Natia Lombardo",
    img: "natialombardo-1764725413363",
    status: "Graduated",
    country: { iso: "uy", name: "Uruguay" },
    contributor: "UTEC-BID",
    description: "Natia is a philosopher and a software developer. Currently working as a QA Engineer of a huge and successful International firm."
  },
  {
    name: "Luis Larraburo",
    img: "luislarraburo-1764725418057",
    status: "Graduated",
    country: { iso: "cr", name: "Costa Rica" },
    contributor: "CINDE-BID",
    description: "Luis came to the program without any previous experience, He is now a software developer working on a tech firm in Costa Rica.",
    achievement: "He got a 50% increase in his salary"
  },
  {
    name: "Leandro Matonte",
    img: "leandro-1764725403142",
    status: "Graduated",
    country: { iso: "uy", name: "Uruguay" },
    contributor: "UTEC-BID",
    description: "Leandro got into the program with the expectation to achieve a better understanding and some coding skills that will help with his decision of being a computer scientist graduate. Now he is a software developer at a tech firm in Uruguay.",
    achievement: "He got a 60% increase in his salary"
  }
];

const DEFAULT_TESTIMONIALS_ES: TestimonialsSlideTestimonial[] = [
  {
    name: "Loretta Thompson",
    img: "ttaloretta-1764725322100",
    status: "Graduada",
    country: { iso: "us", name: "Estados Unidos" },
    contributor: "United Way Miami",
    description: "Loretta se unió en 2022 y se graduó en 2023. Encontró trabajo en los meses siguientes y completó el círculo de habilidades + empleo que todos queremos lograr.",
    achievement: "Obtuvo un aumento salarial del 45%"
  },
  {
    name: "Rich Akers",
    img: "akers-1764725327796",
    status: "Graduado",
    country: { iso: "us", name: "Estados Unidos" },
    contributor: "Clark University",
    description: "Richard es un gran desarrollador que hizo la transición desde un campo completamente diferente y ahora trabaja como desarrollador web en el sector tecnológico.",
    achievement: "Obtuvo un aumento salarial del 30%"
  },
  {
    name: "MaiLinh Tran",
    img: "mailinh-1764725334980",
    status: "Graduada",
    country: { iso: "us", name: "Estados Unidos" },
    contributor: "Clark University",
    description: "Una emprendedora apasionada por la tecnología que ahora se enfoca en el lado del desarrollo de su proyecto.",
    achievement: "Lanzó su startup, es capaz de contratar talento técnico y coordina un equipo de desarrollo."
  },
  {
    name: "Jorge Martín Coimbra",
    img: "coimbra-1764725341501",
    status: "Graduado",
    country: { iso: "uy", name: "Uruguay" },
    contributor: "UTEC-BID",
    description: "Martín se unió al primer programa que lanzamos junto con UTEC y el BID. Consiguió un trabajo mejor remunerado, una carrera que le apasiona y una nueva vida profesional.",
    achievement: "Obtuvo un aumento salarial del 100%"
  },
  {
    name: "Jean St. Cloud",
    img: "jeanstcloud-1764725356935",
    status: "Graduado",
    country: { iso: "us", name: "Estados Unidos" },
    contributor: "Clark",
    description: "Jean está haciendo la transición desde la industria musical y encontró su camino en la tecnología. Lo logró con el apoyo de Clark University y ya se desempeña como desarrollador y mentor.",
    achievement: "Obtuvo un aumento salarial del 100%"
  },
  {
    name: "Alexandra Espinoza",
    img: "alexandraespinoza-1764725386161",
    status: "Graduada",
    country: { iso: "cr", name: "Costa Rica" },
    contributor: "CINDE-BID",
    description: "Alexandra venía de un contexto completamente diferente y ha sido una gran revelación para ella y todos a su alrededor. Ahora es una desarrolladora de software exitosa y talentosa en Costa Rica.",
    achievement: "Obtuvo un aumento salarial del 100%"
  },
  {
    name: "Gabriel Salazar",
    img: "gabrielsalazar-1764725392872",
    status: "Graduado",
    country: { iso: "cr", name: "Costa Rica" },
    contributor: "CINDE-BID",
    description: "Gabriel ya era especialista de soporte en Microsoft y después de completar el programa logró una nueva posición dentro de Microsoft donde ahora trabaja como Ingeniero de Software.",
    achievement: "Obtuvo un aumento salarial del 50%"
  },
  {
    name: "Laura Magallanes",
    img: "laura-1764725397398",
    status: "Graduada",
    country: { iso: "uy", name: "Uruguay" },
    contributor: "UTEC-BID",
    description: "Laura es simplemente extraordinaria. De un pequeño pueblo en Uruguay sin experiencia en programación, ahora es jefa de hogar, instructora y coordinadora de programa.",
    achievement: "Obtuvo un aumento salarial del 120%"
  },
  {
    name: "Melanie Galaretto",
    img: "melamniegalaretto-1764725408397",
    status: "Graduada",
    country: { iso: "uy", name: "Uruguay" },
    contributor: "UTEC-BID",
    description: "Melanie es una joven profesional que soñaba con alcanzar una vida que ahora le pertenece. Es una desarrolladora de software ingeniosa y comprometida que trabaja en una empresa de software en su país.",
    achievement: "Obtuvo un aumento salarial del +100%"
  },
  {
    name: "Natia Lombardo",
    img: "natialombardo-1764725413363",
    status: "Graduada",
    country: { iso: "uy", name: "Uruguay" },
    contributor: "UTEC-BID",
    description: "Natia es filósofa y desarrolladora de software. Actualmente trabaja como Ingeniera QA en una gran empresa internacional exitosa."
  },
  {
    name: "Luis Larraburo",
    img: "luislarraburo-1764725418057",
    status: "Graduado",
    country: { iso: "cr", name: "Costa Rica" },
    contributor: "CINDE-BID",
    description: "Luis llegó al programa sin experiencia previa. Ahora es desarrollador de software trabajando en una empresa tecnológica en Costa Rica.",
    achievement: "Obtuvo un aumento salarial del 50%"
  },
  {
    name: "Leandro Matonte",
    img: "leandro-1764725403142",
    status: "Graduado",
    country: { iso: "uy", name: "Uruguay" },
    contributor: "UTEC-BID",
    description: "Leandro entró al programa con la expectativa de obtener una mejor comprensión y habilidades de programación que lo ayudarían con su decisión de graduarse en ciencias de la computación. Ahora es desarrollador de software en una empresa tecnológica en Uruguay.",
    achievement: "Obtuvo un aumento salarial del 60%"
  }
];

const sizeConfig: Record<CardSize, { lineClamp: string; minHeight: string }> = {
  small: { lineClamp: "line-clamp-3 md:line-clamp-2", minHeight: "min-h-[140px]" },
  medium: { lineClamp: "line-clamp-5 md:line-clamp-4", minHeight: "min-h-[180px]" },
  large: { lineClamp: "line-clamp-7 md:line-clamp-6", minHeight: "min-h-[220px]" }
};

function MasonryCard({ 
  testimonial, 
  size = "medium",
  hardcodedIndex,
}: { 
  testimonial: TestimonialsSlideTestimonial; 
  size?: CardSize;
  hardcodedIndex?: number;
}) {
  const config = sizeConfig[size];
  const fieldContext = hardcodedIndex !== undefined
    ? {
        arrayPath: "dynamic_entries.hardcoded_entries",
        index: hardcodedIndex,
        srcField: "student_thumb",
      }
    : undefined;
  
  return (
    <div 
      className={cn(
        "bg-muted/30 border max-w- border-border/50 rounded-[0.8rem] p-4 shadow-sm",
        config.minHeight
      )}
      data-testid={`card-testimonial-${testimonial.name.replace(/\s+/g, '-').toLowerCase()}`}
    >
      <div className="flex items-center gap-3 mb-3">
        <UniversalImage 
          id={testimonial.img} 
          alt={testimonial.name}
          className="w-10 h-10 rounded-full flex-shrink-0"
          style={{ objectFit: "cover" }}
          fieldContext={fieldContext}
        />
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold text-foreground text-sm leading-tight truncate">
            {testimonial.name}
          </h4>
          <p className="text-xs text-muted-foreground truncate">
            {testimonial.contributor}
          </p>
        </div>
      </div>
      
      <p className={cn(
        "text-sm text-foreground leading-relaxed mb-3",
        config.lineClamp
      )}>
        {testimonial.description}
      </p>
      
      {testimonial.achievement && (
        <div className="bg-primary/10 rounded-md px-2.5 py-1.5 inline-flex items-center gap-1.5">
          <Flag className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <span className="text-xs font-medium text-primary">
            {testimonial.achievement}
          </span>
        </div>
      )}
    </div>
  );
}

interface MasonryColumn {
  cards: { testimonial: TestimonialsSlideTestimonial; size: CardSize; hardcodedIndex?: number }[];
}

/**
 * Resolved items put manually-added rows first, so the first `editableCount`
 * cards map back to `dynamic_entries.hardcoded_entries` for inline editing.
 */
function createMasonryColumns(
  testimonials: TestimonialsSlideTestimonial[],
  editableCount: number = 0,
): MasonryColumn[] {
  const twoCardPatterns: CardSize[][] = [
    ["large", "small"],
    ["small", "large"],
    ["medium", "medium"],
    ["large", "medium"],
    ["medium", "small"],
    ["small", "medium"],
  ];
  
  const columns: MasonryColumn[] = [];
  
  for (let i = 0; i < testimonials.length; i += 2) {
    const pattern = twoCardPatterns[(i / 2) % twoCardPatterns.length];
    const column: MasonryColumn = { cards: [] };
    
    column.cards.push({
      testimonial: testimonials[i],
      size: pattern[0],
      hardcodedIndex: i < editableCount ? i : undefined,
    });
    
    if (i + 1 < testimonials.length) {
      column.cards.push({
        testimonial: testimonials[i + 1],
        size: pattern[1],
        hardcodedIndex: i + 1 < editableCount ? i + 1 : undefined,
      });
    } else if (columns.length > 0) {
      const lastColumn = columns[columns.length - 1];
      lastColumn.cards.push({
        testimonial: testimonials[i],
        size: "medium",
        hardcodedIndex: i < editableCount ? i : undefined,
      });
      continue;
    }
    
    columns.push(column);
  }
  
  return columns;
}

function MasonryColumnComponent({ column }: { column: MasonryColumn }) {
  return (
    <div className="flex flex-col gap-4 w-[280px] flex-shrink-0 mx-2">
      {column.cards.map((card, index) => (
        <MasonryCard 
          key={index} 
          testimonial={card.testimonial} 
          size={card.size}
          hardcodedIndex={card.hardcodedIndex}
        />
      ))}
    </div>
  );
}

export default function TestimonialsSlide({ data }: TestimonialsSlideProps) {
  const [location] = useLocation();
  const isSpanish = location.startsWith("/es/") || location === "/es";
  const [isPlaying, setIsPlaying] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const resumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // `items` is resolved server-side from dynamic_entries: manually-added rows
  // first, then bank matches, already capped at dynamic_entries.limit.
  const hardcodedCount =
    data.dynamic_entries?.hardcoded_entries?.length ?? data.hardcoded_entries?.length ?? 0;
  const serverRows = (data.items ?? [])
    .map((row, index) => ({ row, isHardcoded: index < hardcodedCount }))
    .filter(({ row }) => isValidForSlide(row));
  const serverItems = serverRows.map(({ row }) => mapBankRowToSlideItem(row));
  
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    if (mediaQuery.matches) {
      setIsPlaying(false);
    }
    
    const handler = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
      if (e.matches) {
        setIsPlaying(false);
      }
    };
    
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const handleInteractionStart = () => {
    if (prefersReducedMotion) return;
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }
    setIsPlaying(false);
  };

  const handleInteractionEnd = () => {
    if (prefersReducedMotion) return;
    resumeTimeoutRef.current = setTimeout(() => {
      setIsPlaying(true);
    }, 500);
  };

  const defaultFallback = isSpanish ? DEFAULT_TESTIMONIALS_ES : DEFAULT_TESTIMONIALS;
  const testimonials = serverItems.length > 0 ? serverItems : defaultFallback;
  // Only manually-added rows are authored, so only they get an editable image path.
  const editableCount =
    serverItems.length > 0 ? serverRows.filter((r) => r.isHardcoded).length : 0;
  const masonryColumns = createMasonryColumns(testimonials, editableCount);

  return (
    <section 
      className={`py-12 md:py-16 ${data.background || ""}`}
      data-testid="section-testimonials-slide"
    >
      <div className="max-w-6xl mx-auto px-4 mb-8">
        <h2 
          className="text-2xl md:text-3xl lg:text-4xl font-bold text-center text-foreground mb-4"
          data-testid="text-testimonials-slide-title"
        >
          {data.title}
        </h2>
        <p 
          className="text-center text-lg text-muted-foreground max-w-3xl mx-auto"
          data-testid="text-testimonials-slide-description"
        >
          {data.description}
        </p>
      </div>
      
      <div className="relative">
        {/* Mobile height constraint - limits visible content on mobile */}
        <div className="overflow-hidden h-[550px] md:h-[400px] md:h-auto">
          <div
            className={cn(
              prefersReducedMotion && "overflow-x-auto"
            )}
            onTouchStart={handleInteractionStart}
            onTouchEnd={handleInteractionEnd}
            onMouseEnter={handleInteractionStart}
            onMouseLeave={handleInteractionEnd}
          >
            <CSSMarquee gradient={false} speed={600} play={isPlaying && !prefersReducedMotion}>
              <div className="flex items-start py-4">
                {/* CSSMarquee duplicates the track; keep one column set here to avoid SSR DOM bloat. */}
                {masonryColumns.map((column, index) => (
                  <MasonryColumnComponent key={index} column={column} />
                ))}
              </div>
            </CSSMarquee>
        </div>
        </div>
        
        <div 
          className="absolute inset-0 top-auto pointer-events-none z-10"
          style={{
            height: '100%',
            maxHeight: '400px',
            background: 'radial-gradient(50% 100% at 50% 0%, transparent 0%, transparent 50%, hsl(var(--background)) 100%)'
          }}
        />
        
        <div 
          className="absolute left-0 right-0 pointer-events-none z-10"
          style={{
            top: 0,
            bottom: 0,
            background: 'linear-gradient(to right, hsl(var(--background)) 0%, transparent 15%, transparent 85%, hsl(var(--background)) 100%)'
          }}
        />
      </div>
    </section>
  );
}
