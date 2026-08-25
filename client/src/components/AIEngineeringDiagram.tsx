import { useState } from "react";
import { Brain, Cloud, Database, LayoutGrid, ScatterChart } from "lucide-react";

interface DiagramNode {
  id: string;
  label: string;
  description: string;
  icon: typeof Brain;
  position: { x: number; y: number };
}

interface AIEngineeringDiagramProps {
  className?: string;
}

const nodes: DiagramNode[] = [
  {
    id: "models",
    label: "Models",
    description: "LLMs, training pipelines, inference optimization, and model fine-tuning",
    icon: Brain,
    position: { x: 15, y: 20 },
  },
  {
    id: "data",
    label: "Data",
    description: "Vector stores, data pipelines, embeddings, and retrieval systems",
    icon: Database,
    position: { x: 70, y: 20 },
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    description: "Cloud deployment, scaling, monitoring, and production systems",
    icon: Cloud,
    position: { x: 15, y: 70 },
  },
  {
    id: "applications",
    label: "Applications",
    description: "AI agents, automation workflows, and intelligent products",
    icon: LayoutGrid,
    position: { x: 70, y: 70 },
  },
];

export function AIEngineeringDiagram({ className = "" }: AIEngineeringDiagramProps) {
  const [activeNode, setActiveNode] = useState<string | null>(null);
  
  const prefersReducedMotion = typeof window === "undefined" ? false : window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const activeDescription = (() => {
    if (!activeNode) return "AI Engineering connects models, data, infrastructure, and applications into intelligent systems.";
    const node = nodes.find(n => n.id === activeNode);
    return node?.description || "";
  })();

  return (
    <div className={`relative ${className}`} data-testid="ai-engineering-diagram">
      {/* Main Diagram Container */}
      <div className="relative w-full aspect-[4/3] max-w-lg mx-auto">
        {/* SVG Connection Lines */}
        <svg 
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
              <stop offset="50%" stopColor="hsl(var(--primary))" stopOpacity="0.6" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          
          {/* Lines from center to each node */}
          {nodes.map((node, index) => {
            const centerX = 50;
            const centerY = 50;
            const nodeX = node.position.x + 10;
            const nodeY = node.position.y + 5;
            const isActive = activeNode === node.id;
            
            return (
              <g key={node.id}>
                <line
                  x1={centerX}
                  y1={centerY}
                  x2={nodeX}
                  y2={nodeY}
                  stroke={isActive ? "hsl(var(--primary))" : "url(#lineGradient)"}
                  strokeWidth={isActive ? "0.8" : "0.5"}
                  className={`${!prefersReducedMotion ? "transition-all duration-300" : ""}`}
                  strokeOpacity={activeNode && !isActive ? 0.2 : 1}
                />
                {/* Animated dot on line */}
                {!prefersReducedMotion && (
                  <circle
                    r="1"
                    fill="hsl(var(--primary))"
                    opacity={activeNode && !isActive ? 0.2 : 0.8}
                  >
                    <animateMotion
                      dur={`${3 + index * 0.5}s`}
                      repeatCount="indefinite"
                      path={`M${centerX},${centerY} L${nodeX},${nodeY}`}
                    />
                  </circle>
                )}
              </g>
            );
          })}
        </svg>

        {/* Center Node - AI Engineering */}
        <div 
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20"
          onMouseEnter={() => setActiveNode(null)}
        >
          <div 
            className={`
              w-20 h-20 md:w-24 md:h-24 
              rounded-lg bg-primary 
              flex flex-col items-center justify-center gap-1
              shadow-lg
              ${!prefersReducedMotion ? "animate-pulse-slow" : ""}
            `}
          >
            <ScatterChart className="w-8 h-8 md:w-10 md:h-10 text-primary-foreground" />
            <span className="text-[10px] md:text-xs font-semibold text-primary-foreground text-center leading-tight">
              AI Eng
            </span>
          </div>
        </div>

        {/* Outer Nodes */}
        {nodes.map((node) => {
          const Icon = node.icon;
          const isActive = activeNode === node.id;
          const isDimmed = activeNode !== null && !isActive;
          
          return (
            <div
              key={node.id}
              className={`
                absolute z-10
                ${!prefersReducedMotion ? "transition-all duration-300" : ""}
              `}
              style={{
                left: `${node.position.x}%`,
                top: `${node.position.y}%`,
                opacity: isDimmed ? 0.4 : 1,
                transform: isActive ? "scale(1.05)" : "scale(1)",
              }}
              onMouseEnter={() => setActiveNode(node.id)}
              onMouseLeave={() => setActiveNode(null)}
              data-testid={`node-${node.id}`}
            >
              <div 
                className={`
                  w-16 h-12 md:w-20 md:h-14 
                  rounded-md 
                  flex flex-col items-center justify-center gap-0.5
                  cursor-pointer
                  border
                  ${isActive 
                    ? "bg-primary/10 border-primary shadow-md" 
                    : "bg-background border-border hover:border-primary/50"
                  }
                  ${!prefersReducedMotion ? "transition-all duration-200" : ""}
                `}
              >
                <Icon 
                  className={`w-5 h-5 md:w-6 md:h-6 ${isActive ? "text-primary" : "text-muted-foreground"}`} 
                />
                <span 
                  className={`text-[9px] md:text-[10px] font-medium ${isActive ? "text-primary" : "text-muted-foreground"}`}
                >
                  {node.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Description Caption */}
      <div 
        className={`
          mt-4 text-center min-h-[3rem]
          ${!prefersReducedMotion ? "transition-opacity duration-300" : ""}
        `}
        data-testid="diagram-description"
      >
        <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
          {activeDescription}
        </p>
      </div>
    </div>
  );
}
