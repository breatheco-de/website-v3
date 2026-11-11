import type { ComparisonTableSection, ComparisonTableCellValue, ComparisonTableCtaButton } from "@shared/schema";
import { Check, X } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import SolidCard from "@/components/SolidCard.tsx";

interface ComparisonTableProps {
  data: ComparisonTableSection;
}

function getCellText(value: ComparisonTableCellValue): string {
  if (typeof value === "string") return value;
  return value.text || "";
}

function getCellCta(value: ComparisonTableCellValue): ComparisonTableCtaButton[] | undefined {
  if (typeof value === "string") return undefined;
  return value.cta;
}

function mapCtaVariant(variant?: string): "default" | "outline" | "ghost" | "secondary" | "accent" {
  if (variant === "primary") return "default";
  if (variant === "outline") return "outline";
  if (variant === "accent") return "accent";
  if (variant === "ghost") return "ghost";
  if (variant === "secondary") return "secondary";
  return "default";
}

function CtaButtons({ buttons }: { buttons: ComparisonTableCtaButton[] }) {
  return (
    <div className="flex flex-col items-center gap-2 mt-2">
      {buttons.map((btn, i) => (
        <Button
          key={i}
          variant={mapCtaVariant(btn.variant)}
          size="sm"
          asChild
          data-testid={`button-cta-${i}`}
        >
          <a href={btn.url}>{btn.text}</a>
        </Button>
      ))}
    </div>
  );
}

function CellValue({ value, isHighlighted }: { value: string; isHighlighted?: boolean }) {
  const lowerValue = value.toLowerCase();
  
  if (lowerValue === "yes" || lowerValue === "true" || value === "✓" || value === "check") {
    return <Check className="w-6 h-6 text-primary mx-auto" />;
  }
  if (lowerValue === "no" || lowerValue === "false" || value === "✗" || value === "x") {
    return <X className="w-6 h-6 text-muted-foreground mx-auto" />;
  }
  
  if (isHighlighted) {
    return (
      <span className="flex items-center justify-center gap-2">
        <Check className="w-4 h-4 text-primary flex-shrink-0" />
        <span>{value}</span>
      </span>
    );
  }
  
  return <span>{value}</span>;
}

function TableContent({ 
  data, 
  columnCount, 
  highlightIndex, 
  firstColumnMuted, 
  oddRowColor 
}: { 
  data: ComparisonTableSection; 
  columnCount: number; 
  highlightIndex: number; 
  firstColumnMuted: boolean;
  oddRowColor: string;
}) {
  return (
    <div className="rounded-xl overflow-hidden shadow-lg ring-1 ring-black/5" data-testid="table-comparison">
      <div 
        className="grid"
        style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      >
        {data.columns.map((column, colIndex) => {
          const isFeatureCol = colIndex === 0;
          const isHighlighted = column.highlight;
          const isLastCol = colIndex === columnCount - 1;
          
          return (
            <div
              key={colIndex}
              className={`py-6 px-6 font-semibold text-body ${
                isFeatureCol ? "text-left" : "text-center"
              } ${
                !isLastCol ? "border-r border-border/50" : ""
              } ${
                firstColumnMuted && isFeatureCol
                  ? "bg-muted/50 text-muted-foreground"
                  : isHighlighted
                    ? "bg-gradient-to-r from-primary to-primary/80 text-primary-foreground shadow-md"
                    : firstColumnMuted
                      ? "bg-card text-foreground"
                      : "bg-muted text-foreground"
              }`}
              data-testid={`th-column-${colIndex}`}
            >
              <span>{column.name}</span>
            </div>
          );
        })}
      </div>
      {data.rows.map((row, rowIndex) => {
        const isLastRow = rowIndex === data.rows.length - 1;
        
        return (
          <div
            key={rowIndex}
            className="grid transition-colors"
            style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
            data-testid={`tr-row-${rowIndex}`}
          >
            <div className={`py-5 px-6 font-medium text-left border-r border-border/50 ${
              firstColumnMuted && !isLastRow ? "border-b border-border/50" : ""
            } ${
              firstColumnMuted ? "bg-muted/50 text-muted-foreground" : rowIndex % 2 === 0 ? "bg-card text-foreground" : `${oddRowColor} text-foreground`
            }`}>
              <span>{row.feature}</span>
              {row.feature_description && (
                <p className="text-sm text-muted-foreground font-normal mt-1">
                  {row.feature_description}
                </p>
              )}
            </div>
            {row.values.map((value, valIndex) => {
              const isHighlightedCol = valIndex === highlightIndex - 1;
              const isLastCol = valIndex === row.values.length - 1;
              const rowBg = rowIndex % 2 === 0 ? "bg-card" : oddRowColor;
              const cellText = getCellText(value);
              const cellCta = getCellCta(value);
              
              return (
                <div
                  key={valIndex}
                  className={`py-5 px-6 text-center flex flex-col items-center justify-center ${
                    !isLastCol ? "border-r border-border/50" : ""
                  } ${rowBg} ${
                    isHighlightedCol
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground font-normal"
                  }`}
                  data-testid={`td-value-${rowIndex}-${valIndex}`}
                >
                  {cellText && <CellValue value={cellText} isHighlighted={isHighlightedCol} />}
                  {cellCta && cellCta.length > 0 && <CtaButtons buttons={cellCta} />}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function ComparisonTable({ data }: ComparisonTableProps) {
  const highlightIndex = data.columns.findIndex(col => col.highlight);
  const columnCount = data.columns.length;
  const firstColumnMuted = data.first_column_muted ?? false;
  const bordered = data.bordered ?? false;
  const oddRowColor = data.odd_row_color ?? "bg-primary/5";

  return (
    <section
      className={`${data.background || "bg-background"}`}
      data-testid="section-comparison-table"
    >
      <div className="max-w-6xl mx-auto px-4">
        {data.title && (
          <h2
            className="text-h2 text-center mb-4 text-foreground"
            data-testid="text-comparison-title"
          >
            {data.title}
          </h2>
        )}
        {data.subtitle && (
          <p
            className="text-body text-muted-foreground text-center mb-12 max-w-3xl mx-auto"
            data-testid="text-comparison-subtitle"
          >
            {data.subtitle}
          </p>
        )}

        <div className="hidden md:block">
          {bordered ? (
            <SolidCard className="rounded-xl">
              <TableContent 
                data={data} 
                columnCount={columnCount} 
                highlightIndex={highlightIndex} 
                firstColumnMuted={firstColumnMuted}
                oddRowColor={oddRowColor}
              />
            </SolidCard>
          ) : (
            <TableContent 
              data={data} 
              columnCount={columnCount} 
              highlightIndex={highlightIndex} 
              firstColumnMuted={firstColumnMuted}
              oddRowColor={oddRowColor}
            />
          )}
        </div>

        <div className="md:hidden">
          <Accordion type="single" collapsible className="flex flex-col gap-2">
            {data.rows.map((row, rowIndex) => (
              <AccordionItem
                key={rowIndex}
                value={`row-${rowIndex}`}
                className="rounded-card shadow-sm px-6 [&]:border-0 bg-card transition-colors duration-200 data-[state=open]:bg-primary/5 data-[state=open]:shadow-card"
                data-testid={`accordion-comparison-${rowIndex}`}
              >
                <AccordionTrigger className="hover:no-underline py-4 min-h-[56px] [&>svg]:w-5 [&>svg]:h-5">
                  <span className="font-semibold text-foreground text-base">
                    {row.feature}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pt-4 pb-6">
                  <div className="flex flex-col gap-3">
                    {row.values.map((value, valIndex) => {
                      const columnName = data.columns[valIndex + 1]?.name || `Column ${valIndex + 2}`;
                      const isHighlightedCol = valIndex === highlightIndex - 1;
                      const cellText = getCellText(value);
                      const cellCta = getCellCta(value);
                      
                      return (
                        <div 
                          key={valIndex}
                          className={`rounded-card p-4 ${
                            isHighlightedCol 
                              ? "bg-primary/5 border-l-[3px] border-primary" 
                              : "bg-card"
                          }`}
                        >
                          <p className={`text-xs font-semibold mb-1 ${
                            isHighlightedCol ? "text-primary" : "text-muted-foreground"
                          }`}>
                            {columnName}
                          </p>
                          {cellText && (
                            <p className={`text-sm ${
                              isHighlightedCol ? "font-bold text-foreground" : "text-muted-foreground"
                            }`}>
                              <CellValue value={cellText} isHighlighted={isHighlightedCol} />
                            </p>
                          )}
                          {cellCta && cellCta.length > 0 && <CtaButtons buttons={cellCta} />}
                        </div>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {data.footer_note && (
          <p
            className="text-sm text-muted-foreground text-center mt-8"
            data-testid="text-comparison-footer"
          >
            {data.footer_note}
          </p>
        )}
      </div>
    </section>
  );
}

export default ComparisonTable;
