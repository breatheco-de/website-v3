import { UniversalVideo, type VideoConfig } from "@/components/UniversalVideo";
import { BarChart2, Brain, Briefcase, Code, LucideIcon, Rocket, Star, Users, UsersRound } from "lucide-react";
import { UniversalImage } from "@/components/UniversalImage";
import { StatCard, type StatCardProps } from "@/components/StatCard";
import { SyllabusModuleCard, type SyllabusModuleCardProps } from "@/components/syllabus/SyllabusModuleCard";
import { TechMolecule } from "@/components/TechMolecule";
import { CertificateDisplay } from "@/components/certificate/CertificateDisplay";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import SolidCard from "@/components/SolidCard";
import { DotsIndicator } from "@/components/DotsIndicator";
import StatsCard from "@/components/StatsCard";
import { SimpleLink } from "@/components/menus/SimpleLink";
import type { ImageRef } from "@shared/schema";

const STATS_ICON_MAP: Record<string, LucideIcon> = {
  "people-group": UsersRound,
  "chart-bar": BarChart2,
  "rocket": Rocket,
  "star": Star,
  "brain": Brain,
  "code": Code,
  "briefcase": Briefcase,
};

interface UniversalVideoMolecule {
  id: string;
  component: "UniversalVideo";
  variant: string;
  description?: string;
  tags: string[];
  props: VideoConfig;
}

interface UniversalImageMolecule {
  id: string;
  component: "UniversalImage";
  variant: string;
  description?: string;
  tags: string[];
  props: ImageRef & { loading?: "lazy" | "eager" };
}

interface StatCardMolecule {
  id: string;
  component: "StatCard";
  variant: string;
  description?: string;
  tags: string[];
  props: StatCardProps;
}

interface SyllabusModuleCardMolecule {
  id: string;
  component: "SyllabusModuleCard";
  variant: string;
  description?: string;
  tags: string[];
  props: SyllabusModuleCardProps;
}

interface TechMoleculeMolecule {
  id: string;
  component: "TechMolecule";
  variant: string;
  description?: string;
  tags: string[];
  props: { className?: string };
}

interface CertificateDisplayMolecule {
  id: string;
  component: "CertificateDisplay";
  variant: string;
  description?: string;
  tags: string[];
  props: {
    programName: string;
    description?: string;
    benefits?: { text: string }[];
    certificate_position?: "left" | "right";
    iconSetIndex?: number;
  };
}

interface ButtonMolecule {
  id: string;
  component: "Button";
  variant: string;
  description?: string;
  tags: string[];
  props: {
    variant: "default" | "secondary" | "outline" | "ghost" | "destructive";
    label: string;
  };
}

interface BadgeMolecule {
  id: string;
  component: "Badge";
  variant: string;
  description?: string;
  tags: string[];
  props: {
    variant: "default" | "secondary" | "outline" | "destructive";
    label: string;
  };
}

interface CardMolecule {
  id: string;
  component: "Card";
  variant: string;
  description?: string;
  tags: string[];
  props: { title: string; body: string };
}

interface InputMolecule {
  id: string;
  component: "Input";
  variant: string;
  description?: string;
  tags: string[];
  props: { placeholder: string; label: string };
}

interface SwitchMolecule {
  id: string;
  component: "Switch";
  variant: string;
  description?: string;
  tags: string[];
  props: { label: string; defaultChecked: boolean };
}

interface CheckboxMolecule {
  id: string;
  component: "Checkbox";
  variant: string;
  description?: string;
  tags: string[];
  props: { label: string; defaultChecked: boolean };
}

interface AvatarMolecule {
  id: string;
  component: "Avatar";
  variant: string;
  description?: string;
  tags: string[];
  props: { fallback: string; label: string };
}

interface CtaButtonMolecule {
  id: string;
  component: "CtaButton";
  variant: string;
  description?: string;
  tags: string[];
  props: {
    text: string;
    url: string;
    variant: "primary" | "secondary" | "outline" | "ghost";
    icon?: string;
  };
}

interface SimpleLinkMolecule {
  id: string;
  component: "SimpleLink";
  variant: string;
  description?: string;
  tags: string[];
  props: { label: string; href: string };
}

interface SolidCardMolecule {
  id: string;
  component: "SolidCard";
  variant: string;
  description?: string;
  tags: string[];
  props: { children: string };
}

interface DotsIndicatorMolecule {
  id: string;
  component: "DotsIndicator";
  variant: string;
  description?: string;
  tags: string[];
  props: { count: number; activeIndex: number };
}

interface StatsCardMolecule {
  id: string;
  component: "StatsCard";
  variant: string;
  description?: string;
  tags: string[];
  props: { title: string; value: string | number; icon: string; trend?: string; trendUp?: boolean };
}

export type MoleculeDefinition =
  | UniversalVideoMolecule
  | UniversalImageMolecule
  | StatCardMolecule
  | SyllabusModuleCardMolecule
  | TechMoleculeMolecule
  | CertificateDisplayMolecule
  | ButtonMolecule
  | BadgeMolecule
  | CardMolecule
  | InputMolecule
  | SwitchMolecule
  | CheckboxMolecule
  | AvatarMolecule
  | CtaButtonMolecule
  | SimpleLinkMolecule
  | SolidCardMolecule
  | DotsIndicatorMolecule
  | StatsCardMolecule;

interface MoleculeRendererProps {
  molecule: MoleculeDefinition;
}

function resolveCtaVariant(v: string): "default" | "secondary" | "outline" | "ghost" | "destructive" | "link" {
  if (v === "primary") return "default";
  if (v === "secondary") return "secondary";
  if (v === "outline") return "outline";
  if (v === "ghost") return "ghost";
  if (v === "destructive") return "destructive";
  if (v === "link") return "link";
  return "default";
}

export function MoleculeRenderer({ molecule }: MoleculeRendererProps) {
  switch (molecule.component) {
    case "UniversalVideo":
      return (
        <UniversalVideo
          url={molecule.props.url}
          ratio={molecule.props.ratio}
          muted={molecule.props.muted}
          autoplay={molecule.props.autoplay}
          loop={molecule.props.loop}
          preview_image_url={molecule.props.preview_image_url}
          withShadowBorder={molecule.props.with_shadow_border}
          open_modal_on_click={molecule.props.open_modal_on_click}
          show_controls_on_autoplay={molecule.props.show_controls_on_autoplay}
          overlay_on_muted={molecule.props.overlay_on_muted}
        />
      );
    case "UniversalImage":
      return (
        <UniversalImage
          id={molecule.props.id}
          preset={molecule.props.preset}
          alt={molecule.props.alt}
          className={molecule.props.className}
          loading={molecule.props.loading}
        />
      );
    case "StatCard":
      return (
        <div className="p-6">
          <StatCard
            value={molecule.props.value}
            title={molecule.props.title}
            use_card={molecule.props.use_card}
            card_color={molecule.props.card_color}
          />
        </div>
      );
    case "SyllabusModuleCard":
      return (
        <div className="p-6">
          <SyllabusModuleCard
            duration={molecule.props.duration}
            title={molecule.props.title}
            objectives={molecule.props.objectives}
            projects={molecule.props.projects}
            isActive={molecule.props.isActive}
            orientation={molecule.props.orientation}
          />
        </div>
      );
    case "TechMolecule":
      return <TechMolecule className={molecule.props.className} />;
    case "CertificateDisplay":
      return (
        <div className="p-4">
          <CertificateDisplay
            programName={molecule.props.programName}
            description={molecule.props.description}
            benefits={molecule.props.benefits}
            certificate_position={molecule.props.certificate_position}
            iconSetIndex={molecule.props.iconSetIndex}
          />
        </div>
      );
    case "Button":
      return (
        <Button variant={molecule.props.variant} size="lg">
          {molecule.props.label}
        </Button>
      );
    case "Badge":
      return (
        <Badge variant={molecule.props.variant}>
          {molecule.props.label}
        </Badge>
      );
    case "Card":
      return (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{molecule.props.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{molecule.props.body}</p>
          </CardContent>
        </Card>
      );
    case "Input":
      return (
        <div className="flex flex-col gap-1.5 w-full">
          <Label htmlFor={`input-${molecule.id}`}>{molecule.props.label}</Label>
          <Input id={`input-${molecule.id}`} placeholder={molecule.props.placeholder} />
        </div>
      );
    case "Switch":
      return (
        <div className="flex items-center gap-2">
          <Switch id={`switch-${molecule.id}`} defaultChecked={molecule.props.defaultChecked} />
          <Label htmlFor={`switch-${molecule.id}`}>{molecule.props.label}</Label>
        </div>
      );
    case "Checkbox":
      return (
        <div className="flex items-center gap-2">
          <Checkbox id={`checkbox-${molecule.id}`} defaultChecked={molecule.props.defaultChecked} />
          <Label htmlFor={`checkbox-${molecule.id}`}>{molecule.props.label}</Label>
        </div>
      );
    case "Avatar":
      return (
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{molecule.props.fallback}</AvatarFallback>
          </Avatar>
          <span className="text-sm text-muted-foreground">{molecule.props.label}</span>
        </div>
      );
    case "CtaButton": {
      const variant = resolveCtaVariant(molecule.props.variant);
      return (
        <Button asChild variant={variant} size="lg">
          <a href={molecule.props.url}>{molecule.props.text}</a>
        </Button>
      );
    }
    case "SimpleLink":
      return (
        <SimpleLink label={molecule.props.label} href={molecule.props.href} />
      );
    case "SolidCard":
      return (
        <SolidCard>
          <p className="p-4 text-sm">{molecule.props.children}</p>
        </SolidCard>
      );
    case "DotsIndicator":
      return (
        <DotsIndicator count={molecule.props.count} activeIndex={molecule.props.activeIndex} />
      );
    case "StatsCard": {
      const IconComponent = STATS_ICON_MAP[molecule.props.icon] || BarChart2;
      return (
        <StatsCard
          title={molecule.props.title}
          value={molecule.props.value}
          icon={IconComponent}
          trend={molecule.props.trend}
          trendUp={molecule.props.trendUp}
        />
      );
    }
    default:
      return (
        <div className="p-8 text-center text-muted-foreground bg-muted/30 rounded-lg">
          Unknown molecule component: {(molecule as { component: string }).component}
        </div>
      );
  }
}
